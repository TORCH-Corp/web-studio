# sites.torchcorp.com and *.sites.torchcorp.com -> web-studio (port 6030): published sites.
# DNS only (not proxied by Cloudflare); the wildcard certificate is Let's Encrypt by DNS-01,
# renewed by certbot's timer, whose renew hook reloads nginx. The app sets the sites' own
# security headers, so none are added here.
server {
    listen 80;
    server_name sites.torchcorp.com *.sites.torchcorp.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name sites.torchcorp.com *.sites.torchcorp.com;

    ssl_certificate     /etc/letsencrypt/live/sites.torchcorp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sites.torchcorp.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 60m;

    # The Business OS access token travels in this GET's query string (OPEN_QUESTIONS 13):
    # it must not reach the access log.
    location = /ycode/api/auth/callback {
        access_log off;
        proxy_pass http://127.0.0.1:6030;
        include /etc/nginx/snippets/web-studio-proxy.conf;
    }

    # text/event-stream: the AI chat and the MCP endpoint. Unbuffered, one hour.
    location ~ ^/ycode/(api/ai/chat|mcp)(/|$) {
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
