# Afterframe — self-hosted production image (VPS / DigitalOcean)
# Same stack as the Electron shell: dist/ static + all /api/* plugins.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_legacy_peer_deps=false
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:server

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5199 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# ffmpeg/ffprobe power export, probe and thumbnail paths.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist

# Persistent state: projects, uploaded media, keystore, agent runs.
VOLUME ["/app/data"]
ENV AFTERFRAME_DATA_DIR=/app/data

EXPOSE 5199
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server-dist/serve-prod.mjs"]
