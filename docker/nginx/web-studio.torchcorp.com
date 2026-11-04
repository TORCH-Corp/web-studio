# web-studio.torchcorp.com -> web-studio (port 6030): the builder and the sites API.
# Proxied by Cloudflare; the origin certificate is the one the other hosts use.
server {
    listen 80;
    server_name web-studio.torchcorp.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name web-studio.torchcorp.com;

    ssl_certificate     /etc/nginx/ssl/products-services.crt;
    ssl_certificate_key /etc/nginx/ssl/products-services.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header X-Content-Type-Options "nosniff" always;

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
