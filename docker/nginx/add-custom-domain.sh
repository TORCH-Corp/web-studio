#!/bin/sh
# Map a customer's own domain to Web Studio on this server (run as root on the host).
#
#   add-custom-domain.sh shop.example.com
#
# Precondition: the site's host is already set in Web Studio (site settings; the domain
# is verified in Organization Setup) and the domain's DNS points here: a CNAME to
# sites.torchcorp.com, or an A record to this server's address.
#
# What it does, in order, and stops at the first failure:
# Needs WS_CERTBOT_EMAIL in the environment (the address Let's Encrypt may write to).
#   1. checks the name and that DNS reaches this server;
#   2. writes the port-80 block (Let's Encrypt HTTP-01 challenge, then the redirect);
#   3. issues the certificate with certbot (webroot), renewed by certbot's timer, whose
#      deploy hook reloads nginx;
#   4. writes the port-443 block, same locations as sites.torchcorp.com, and reloads nginx.
# Web Studio itself needs nothing: it finds the site by the Host header nginx forwards.
set -eu

domain="${1:?usage: add-custom-domain.sh <domain>}"
case "$domain" in
  *[!a-z0-9.-]*|.*|*.|*..*|-*) echo "not a plain lower-case host name: $domain" >&2; exit 2 ;;
esac
case "$domain" in
  *.sites.torchcorp.com|sites.torchcorp.com) echo "$domain is a platform address, already served" >&2; exit 2 ;;
esac

webroot=/var/www/letsencrypt
conf="/etc/nginx/sites-available/ws-custom-$domain"
enabled="/etc/nginx/sites-enabled/ws-custom-$domain"
server_ip="${WS_SERVER_IP:-194.163.187.88}"

resolved="$( (getent ahostsv4 "$domain" || true) | awk '{print $1}' | sort -u | tr '\n' ' ')"
case " $resolved " in
  *" $server_ip "*) ;;
  *) echo "DNS: $domain resolves to '${resolved}', not $server_ip. Point it here first." >&2; exit 3 ;;
esac

mkdir -p "$webroot"
if [ -e "$conf" ] && [ -e "/etc/letsencrypt/live/$domain/fullchain.pem" ]; then
  echo "$domain already has a certificate and a site file; rewriting the site file only"
else
  cat > "$conf" <<HTTP
# $domain -> web-studio (customer domain), written by add-custom-domain.sh
server {
    listen 80;
    server_name $domain;
    location /.well-known/acme-challenge/ { root $webroot; }
    location / { return 301 https://\$host\$request_uri; }
}
HTTP
  ln -sf "$conf" "$enabled"
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w "$webroot" -d "$domain" --non-interactive --agree-tos \
    -m "${WS_CERTBOT_EMAIL:?set WS_CERTBOT_EMAIL to the address Let's Encrypt may write to}" --deploy-hook 'systemctl reload nginx'
fi

cat > "$conf" <<HTTPS
# $domain -> web-studio (customer domain), written by add-custom-domain.sh
server {
    listen 80;
    server_name $domain;
    location /.well-known/acme-challenge/ { root $webroot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    server_name $domain;

    ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 60m;

    location ~ ^/ycode/(api/ai/chat|mcp)(/|\$) {
        proxy_pass http://127.0.0.1:6030;
        include /etc/nginx/snippets/web-studio-proxy.conf;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:6030;
        include /etc/nginx/snippets/web-studio-proxy.conf;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
HTTPS
ln -sf "$conf" "$enabled"
nginx -t
systemctl reload nginx
echo "$domain is served by Web Studio"
