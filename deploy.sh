#!/usr/bin/env bash
set -euo pipefail

APP_NAME="pulsebot"
APP_DIR="/var/www/pulsebot"
BRANCH="${1:-main}"
LOG_TAG="[deploy]"

echo "$LOG_TAG Starting deployment of $APP_NAME from branch $BRANCH"
echo "$LOG_TAG Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

cd "$APP_DIR"

echo "$LOG_TAG Fetching origin..."
git fetch origin

echo "$LOG_TAG Checking out $BRANCH..."
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

REQUIRED_NODE=$(cat .nvmrc)
CURRENT_NODE=$(node --version | sed 's/v//' | cut -d'.' -f1)
if [ "$CURRENT_NODE" -lt "$REQUIRED_NODE" ]; then
    echo "$LOG_TAG ERROR: Node.js $REQUIRED_NODE+ required, found $CURRENT_NODE"
    exit 1
fi

echo "$LOG_TAG Installing dependencies..."
npm ci --omit=dev

echo "$LOG_TAG Building web admin client..."
(cd src/web-client && npm ci && npm run build)

echo "$LOG_TAG Checking required environment variables..."
REQUIRED_VARS=("DISCORDJS_BOT_TOKEN" "CLIENT_ID" "GUILD_ID" "RAIDHELPER_API_KEY" "RAIDHELPER_SERVER_ID")
ENV_FILE="$APP_DIR/.env"
MISSING=0
for VAR in "${REQUIRED_VARS[@]}"; do
    # accept the var if it is exported in the shell OR present (non-empty) in .env
    if [ -n "${!VAR:-}" ]; then continue; fi
    if [ -f "$ENV_FILE" ] && grep -qE "^[[:space:]]*${VAR}=.+" "$ENV_FILE"; then continue; fi
    echo "$LOG_TAG ERROR: Required env var $VAR is not set"
    MISSING=1
done
if [ "$MISSING" -eq 1 ]; then
    echo "$LOG_TAG Deployment aborted: missing environment variables"
    exit 1
fi

echo "$LOG_TAG Registering slash commands..."
node scripts/register-commands.js || echo "$LOG_TAG WARNING: Command registration failed — run 'npm run register' manually if commands are missing"

echo "$LOG_TAG Restarting PM2 process..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
else
    echo "$LOG_TAG Process not found — starting fresh..."
    pm2 start ecosystem.config.js --env production
    pm2 save
fi

echo "$LOG_TAG Deployment complete."
pm2 show "$APP_NAME"
