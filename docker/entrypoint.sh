#!/bin/sh
# Web Studio container start: migrate, then run the server.
set -eu

# BOS_JWT_PUBLIC_KEY is auth-service's public key (a PEM); compose mounts the
# file read-only and names it here so the key never sits in the compose file.
if [ -z "${BOS_JWT_PUBLIC_KEY:-}" ] && [ -n "${BOS_JWT_PUBLIC_KEY_FILE:-}" ]; then
  BOS_JWT_PUBLIC_KEY="$(cat "$BOS_JWT_PUBLIC_KEY_FILE")"
  export BOS_JWT_PUBLIC_KEY
fi

# The first start of the process (not a command run by hand) migrates.
if [ "${1:-}" = "node" ] && [ "${WS_SKIP_MIGRATE:-}" != "1" ]; then
  echo "[web-studio] knex migrate:latest"
  (cd /tooling && TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json NODE_NO_WARNINGS=1 \
    node --require ts-node/register --require tsconfig-paths/register \
    node_modules/knex/bin/cli.js migrate:latest --knexfile knexfile.ts)
fi

exec "$@"
