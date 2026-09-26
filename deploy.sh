#!/usr/bin/env bash
set -euo pipefail

APP_NAME="pulsebot"
# Where the checkout lives. The workflow and this script used to disagree about
# it (/opt/eventhelper vs /var/www/pulsebot, #314), so the path is no longer
# written down twice: DEPLOY_DIR wins — the same repository variable the
# workflow passes in — and otherwise the script deploys the checkout it is part
# of. Both end up at the directory this file was run from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DEPLOY_DIR:-$SCRIPT_DIR}"
BRANCH="${1:-main}"
LOG_TAG="[deploy]"

echo "$LOG_TAG Starting deployment of $APP_NAME from branch $BRANCH"
echo "$LOG_TAG Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$LOG_TAG Directory: $APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
    echo "$LOG_TAG ERROR: $APP_DIR is not a git checkout — set DEPLOY_DIR to the directory the bot is checked out in."
    exit 1
fi

cd "$APP_DIR"

echo "$LOG_TAG Fetching origin..."
git fetch origin

echo "$LOG_TAG Checking out $BRANCH..."
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# The commit this deploy puts live — the same one the bot then reports on
# /health and in the menu's footer (#314).
echo "$LOG_TAG Now at $(git log -1 --format='%h %cI %s')"

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

pm2 show "$APP_NAME"

# pm2 reports "online" as soon as the process exists — even when it dies a
# second later on a bad require or a taken port. Ask the bot itself: /health is
# served before the Discord login (src/bot.js start()), so it answers as soon as
# the web server is up. No answer means a red deploy job instead of a green one
# over a dead bot. The port comes from the same file src/bot.js reads (.env.dev
# wins over .env), an exported WEB_PORT beats both, 3005 is the code's default.
read_env_port() {
    local file="$1"
    [ -f "$file" ] || return 0
    grep -E '^[[:space:]]*WEB_PORT=' "$file" | tail -n 1 | cut -d'=' -f2- | tr -d "\"' \r" || true
}
HEALTH_ENV_FILE="$APP_DIR/.env"
[ -f "$APP_DIR/.env.dev" ] && HEALTH_ENV_FILE="$APP_DIR/.env.dev"
WEB_PORT="${WEB_PORT:-$(read_env_port "$HEALTH_ENV_FILE")}"
WEB_PORT="${WEB_PORT:-3005}"
HEALTH_URL="http://localhost:$WEB_PORT/health"
HEALTH_ATTEMPTS=20
HEALTH_DELAY=3

# curl on any normal server; Node (which is on PATH by now) as the fallback.
health_get() {
    if command -v curl > /dev/null 2>&1; then
        curl -fsS --max-time 5 "$1"
    else
        node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then(async (r) => { if (!r.ok) process.exit(1); console.log(await r.text()); }).catch(() => process.exit(1));' "$1"
    fi
}

echo "$LOG_TAG Waiting for $HEALTH_URL (up to $((HEALTH_ATTEMPTS * HEALTH_DELAY)) s)..."
HEALTHY=0
for ATTEMPT in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if HEALTH_BODY=$(health_get "$HEALTH_URL" 2>/dev/null); then
        echo "$LOG_TAG Health check passed (attempt $ATTEMPT): $HEALTH_BODY"
        HEALTHY=1
        break
    fi
    sleep "$HEALTH_DELAY"
done

if [ "$HEALTHY" -ne 1 ]; then
    echo "$LOG_TAG ERROR: $APP_NAME did not answer on $HEALTH_URL after $((HEALTH_ATTEMPTS * HEALTH_DELAY)) s — the deploy failed."
    echo "$LOG_TAG Last log lines:"
    pm2 logs "$APP_NAME" --lines 40 --nostream || true
    exit 1
fi

echo "$LOG_TAG Deployment complete."
