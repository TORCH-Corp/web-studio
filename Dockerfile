# Web Studio production image (part 1, session 11).
#
#   build:  docker build -t web-studio:local .
#   run:    see docs/PLATFORM.md (compose service `web-studio` on the server)
#
# /app      the Next.js standalone server (what runs)
# /tooling  the repository with its full node_modules: the migrations and the
#           template seed run from here with the ts-node and tsconfig-paths
#           requires the repository already needs (the standalone trace has neither).

FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml .npmrc ./
RUN HUSKY=0 CI=1 pnpm install --frozen-lockfile
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build
# The repository without node_modules and the build: what the migrations and the seed import (lib, components, stores, types).
RUN mkdir /tooling && for f in $(ls -A | grep -v -e '^node_modules$' -e '^\.next$' -e '^\.git$'); do cp -r "$f" /tooling/; done

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=6030 HOSTNAME=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/webstudio/storage && chown -R node:node /var/lib/webstudio /app
COPY --from=build --chown=node:node /src/.next/standalone ./
COPY --from=build --chown=node:node /src/.next/static ./.next/static
COPY --from=build --chown=node:node /src/public ./public
# Tooling: migrations and the template seed.
COPY --from=build --chown=node:node /src/node_modules /tooling/node_modules
COPY --from=build --chown=node:node /tooling /tooling
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/web-studio-entrypoint
RUN chmod +x /usr/local/bin/web-studio-entrypoint
USER node
EXPOSE 6030
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/ycode/api/health || exit 1
ENTRYPOINT ["web-studio-entrypoint"]
CMD ["node", "server.js"]
