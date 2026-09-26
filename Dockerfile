# Second, self-contained way to run the bot next to the pm2 deploy (deploy.sh,
# docs/deployment.md). Two stages: the React admin client is built with its
# dev toolchain, and only its dist/ ends up in the slim runtime image.

# --- Stage 1: build the web admin client (src/web-client -> dist/) ------------
FROM node:22-alpine AS client

WORKDIR /app/src/web-client

COPY src/web-client/package.json src/web-client/package-lock.json ./
RUN npm ci

COPY src/web-client/ ./
# The menu list is shared with the server-rendered report chrome and imported
# from outside the client's folder (src/web-client/src/lib/menu.ts).
COPY src/config/menu.json /app/src/config/menu.json
RUN npm run build

# --- Stage 2: runtime ------------------------------------------------------------
FROM node:22-alpine AS runtime

# German timezone so any bare Date/logging renders in CET/CEST. The web UI
# formatters pin the zone explicitly (full-ICU, always correct), but tzdata +
# TZ makes the whole process default to Berlin as a safety net.
ENV TZ=Europe/Berlin
RUN apk add --no-cache tzdata

ENV NODE_ENV=production
# Default port of src/config/variables.js; override with -e WEB_PORT=... and
# publish the same port. The healthcheck below follows it.
ENV WEB_PORT=3005

# There is no .git in the image, so src/web/version.js cannot ask git which
# commit runs - pass it in: docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD)
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
# App emojis are synced from assets/emojis on start (src/web/appEmojis.js).
COPY assets/ ./assets/
COPY scripts/ ./scripts/
# The menu is served from src/web-client/dist (src/web/staticClient.js).
COPY --from=client /app/src/web-client/dist ./src/web-client/dist

# Every store writes below data/ - keep it on a volume so settings, sessions
# and imports survive a new image. Created here so it belongs to `node`.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${WEB_PORT}/health" > /dev/null || exit 1

USER node

CMD ["node", "./src/bot.js"]
