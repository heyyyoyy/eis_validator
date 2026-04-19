# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Cache npm install separately from source
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config and default html
RUN rm /etc/nginx/conf.d/default.conf && \
    rm -rf /usr/share/nginx/html/*

COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Create directories required by nginx when running as non-root
RUN mkdir -p /tmp/nginx_client_body /tmp/nginx_proxy /tmp/nginx_fastcgi \
             /tmp/nginx_uwsgi /tmp/nginx_scgi /var/log/nginx && \
    chown -R nginx:nginx /var/log/nginx /usr/share/nginx/html && \
    touch /tmp/nginx.pid && \
    chown nginx:nginx /tmp/nginx.pid

# Certs volume mount point (populated by cert-gen service at runtime)
VOLUME ["/etc/nginx/certs"]

USER nginx

# Use non-privileged ports; the compose file maps 80→8080 and 443→8443
EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- --no-check-certificate https://localhost:8443/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
