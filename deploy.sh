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

REQUIRED_NODE=$(sed 's/^v//' .nvmrc | cut -d'.' -f1)

# The deploy runs through a NON-INTERACTIVE ssh shell, which never sources
# ~/.bashrc — so an nvm-managed Node is simply not on PATH here and the old
# system-wide binary gets used instead. That is why a Node upgrade done by
# hand appears to be reverted by the next deploy. Load nvm explicitly and
# activate the version pinned in .nvmrc.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    echo "$LOG_TAG Loading nvm and activating Node $REQUIRED_NODE (from .nvmrc)..."
    set +u                      # nvm.sh trips over `set -u`
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    # Installs the pinned version if it is missing, otherwise just activates it.
    # Global packages (pm2!) are per-version under nvm, so carry them over.
    nvm install --reinstall-packages-from=current || nvm use
    set -u
else
    echo "$LOG_TAG nvm not found at $NVM_DIR — using the system Node."
fi

CURRENT_NODE=$(node --version | sed 's/^v//' | cut -d'.' -f1)
if [ "$CURRENT_NODE" -lt "$REQUIRED_NODE" ]; then
    echo "$LOG_TAG ERROR: Node.js $REQUIRED_NODE+ required, found $CURRENT_NODE ($(command -v node))"
    exit 1
fi
echo "$LOG_TAG Node $(node --version) at $(command -v node), npm $(npm --version)"

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

if ! command -v pm2 > /dev/null 2>&1; then
    echo "$LOG_TAG ERROR: pm2 is not on PATH for Node $(node --version)."
    echo "$LOG_TAG nvm keeps global packages per Node version — install it once with: npm install -g pm2"
    exit 1
fi

# The PM2 daemon keeps running under whatever Node it was started with and
# spawns the app with that very binary. Without `pm2 update` a Node upgrade
# never reaches the bot: `pm2 restart` would happily bring the process back up
# on the old version. `pm2 update` respawns the daemon on the current Node and
# restores the managed processes; it is idempotent and safe to run every time.
echo "$LOG_TAG Updating the PM2 daemon to Node $(node --version)..."
pm2 update

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
