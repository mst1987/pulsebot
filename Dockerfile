FROM node:20-alpine

# German timezone so any bare Date/logging renders in CET/CEST. The web UI
# formatters pin the zone explicitly (full-ICU, always correct), but tzdata +
# TZ makes the whole process default to Berlin as a safety net.
ENV TZ=Europe/Berlin
RUN apk add --no-cache tzdata

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src/ ./src/

USER node

CMD ["node", "./src/bot.js"]
