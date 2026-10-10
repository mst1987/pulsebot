#!/usr/bin/env bash
# Puts a commit live on the production server (docs/deployment.md).
#
#   ./deploy.sh [branch] [--force]      by hand on the server (branch: main)
#
# CI (.github/workflows/ci.yml) builds the web client on GitHub's runners,
# copies dist/ to $DEPLOY_DIR/.deploy/dist-<sha> and runs this script with
#   DEPLOY_SHA=<sha>        exactly this commit instead of the tip of origin/<branch>
#   PREBUILT_DIST=<dir>     the built client; nothing is compiled on the server
#
# The server has 1 vCPU and under 1 GB RAM. Doing everything on every deploy
# (npm ci twice, tsc + vite, registering the commands, respawning pm2) took
# 9-12 minutes of heavy swapping in which the bot hardly answered. Now a step
# runs only when its input changed since the last successful deploy; what was
# done last is kept in $DEPLOY_DIR/.deploy/state (KEY=value lines):
#   DEPS              sha256 of package-lock.json + Node ABI  -> npm ci --omit=dev
#   COMMANDS          hash of the slash-command registration   -> register-commands.js
#   NODE              node --version the PM2 daemon was last respawned with
#   DEPLOYED_COMMIT   the commit that passed the health check last
# No state file simply means: do everything once.
#
# Force a step anyway with DEPLOY_FORCE (comma list) or --force (= all):
#   install   npm ci in the root
#   build     ignore PREBUILT_DIST and build the client here
#   register  register the slash commands
#   pm2       respawn the PM2 daemon
#   node      look for a newer Node patch release of the .nvmrc line (nvm install)
#   all       everything above
#
# Before anything restarts the bot on the new code, a data snapshot is taken
# (#695, scripts/backup/snapshot.js --reason deploy): only where backups run,
# and a failed one never stops the deploy (see take_deploy_snapshot).
#   DEPLOY_SNAPSHOT=0|1             never | always (default: where backups run)
#   DEPLOY_SNAPSHOT_RETRY_DELAY=30  seconds to wait while the hourly one holds the lock
#   DEPLOY_SNAPSHOT_TIMEOUT=600     seconds before a hanging snapshot is given up
set -euo pipefail

APP_NAME="pulsebot"
# Where the checkout lives. The workflow and this script used to disagree about
# it (/opt/eventhelper vs /var/www/pulsebot, #314), so the path is no longer
# written down twice: DEPLOY_DIR wins — the same repository variable the
# workflow passes in — and otherwise the script deploys the checkout it is part
# of. Both end up at the directory this file was run from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DEPLOY_DIR:-$SCRIPT_DIR}"
LOG_TAG="[deploy]"
STATE_DIR="$APP_DIR/.deploy"
STATE_FILE="$STATE_DIR/state"
DIST_DIR="src/web-client/dist"
# Every chunk under dist/assets/ carries its content hash in the name. A tab
# opened before this deploy still asks for the old names (#530) - the previous
# build's assets stay next to the new ones so it goes on working; files older
# than ASSET_KEEP_DAYS are pruned. index.html is never carried over, so every
# new page load gets the new build. A tab that asks for a chunk that is gone
# anyway reloads itself (lib/app/chunkReload.ts).
ASSET_KEEP_DAYS=14
SNAPSHOT_RETRY_DELAY="${DEPLOY_SNAPSHOT_RETRY_DELAY:-30}"
SNAPSHOT_TIMEOUT="${DEPLOY_SNAPSHOT_TIMEOUT:-600}"
# Set by take_deploy_snapshot: the snapshot's name, or why there is none.
SNAPSHOT_NAME=""
SNAPSHOT_WARNING=""
SNAPSHOT_JSON=""

log() {
    echo "$LOG_TAG $*"
}

# --- state file ---------------------------------------------------------------

state_get() {
    [ -f "$STATE_FILE" ] || return 0
    grep -E "^$1=" "$STATE_FILE" | tail -n 1 | cut -d'=' -f2- || true
}

# Written to a temp file and renamed: a deploy cut off midway never leaves a
# half-written state behind.
state_set() {
    local tmp="$STATE_FILE.tmp.$$"
    mkdir -p "$STATE_DIR"
    {
        if [ -f "$STATE_FILE" ]; then grep -vE "^$1=" "$STATE_FILE" || true; fi
        echo "$1=$2"
    } > "$tmp"
    mv "$tmp" "$STATE_FILE"
}

# True when DEPLOY_FORCE asks for this step ("all" or "1" asks for every step).
is_forced() {
    local force=",${DEPLOY_FORCE:-},"
    [[ "$force" == *",all,"* || "$force" == *",1,"* || "$force" == *",$1,"* ]]
}

file_hash() {
    if command -v sha256sum > /dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

# Heavy work at the lowest CPU and I/O priority, so the running bot keeps
# answering while it happens (ionice is missing on some systems).
low_prio() {
    if command -v ionice > /dev/null 2>&1; then
        nice -n 19 ionice -c3 "$@"
    else
        nice -n 19 "$@"
    fi
}

# pm2 never sees the deploy lock's descriptor (fd 9, see main): a PM2 daemon
# spawned by `pm2 update` or a first `pm2 start` would inherit it and hold
# the lock for as long as it runs - every later deploy would wait for it.
pm2() {
    command pm2 "$@" 9>&-
}

# Staging leftovers of an earlier, interrupted deploy. Only what is older than
# an hour: a CI upload for the next deploy may be arriving right now.
cleanup_staging() {
    [ -d "$STATE_DIR" ] || return 0
    find "$STATE_DIR" -mindepth 1 -maxdepth 1 \( -name 'dist-*' -o -name 'build-*' -o -name 'deploy-*.sh' \) \
        -mmin +60 -exec rm -rf {} + 2>/dev/null || true
}

# --- web client ----------------------------------------------------------------

# The fallback when no PREBUILT_DIST came along (a manual ./deploy.sh): build
# on the server like before, but into a directory of its own (never into the
# live dist/) and at the lowest priority.
build_dist_here() {
    local out="$1"
    log "WARNING: no prebuilt web client (PREBUILT_DIST) - building it on this server."
    log "WARNING: npm ci + tsc + vite take several minutes here and swap heavily; the bot answers slowly meanwhile."
    rm -rf "$out"
    mkdir -p "$out"
    # npm appends the arguments to the script's last command, `vite build`.
    (cd src/web-client && low_prio npm ci && low_prio npm run build -- --outDir "$out" --emptyOutDir)
}

# Puts a complete build in place of dist/. It is assembled next to the live
# one first (dist.next: the new files plus the kept assets of the previous
# build), then two renames switch it over - a request never sees a half-copied
# dist/, at worst none for the blink between the renames. Nothing of the #530
# bookkeeping can fail the deploy.
install_dist() {
    local src="$1"
    local next="$DIST_DIR.next"
    local old="$DIST_DIR.old"
    rm -rf "$next" "$old"
    mv "$src" "$next"
    if [ -d "$DIST_DIR/assets" ]; then
        log "Keeping the previous build's assets for open tabs (up to $ASSET_KEEP_DAYS days)..."
        mkdir -p "$next/assets"
        # -n: a file the new build wrote itself (same hash) is never overwritten
        cp -an "$DIST_DIR/assets/." "$next/assets/" 2>/dev/null || true
        find "$next/assets" -type f -mtime +"$ASSET_KEEP_DAYS" -delete || true
    fi
    if [ -d "$DIST_DIR" ]; then mv "$DIST_DIR" "$old"; fi
    mv "$next" "$DIST_DIR"
    rm -rf "$old"
}

# --- health check helpers --------------------------------------------------------

read_env_port() {
    local file="$1"
    [ -f "$file" ] || return 0
    grep -E '^[[:space:]]*WEB_PORT=' "$file" | tail -n 1 | cut -d'=' -f2- | tr -d "\"' \r" || true
}

# curl on any normal server; Node (which is on PATH by now) as the fallback.
health_get() {
    if command -v curl > /dev/null 2>&1; then
        curl -fsS --max-time 5 "$1"
    else
        node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then(async (r) => { if (!r.ok) process.exit(1); console.log(await r.text()); }).catch(() => process.exit(1));' "$1"
    fi
}

# --- data snapshot before the restart (#695) ---------------------------------------
#
# Taken by the CLI (scripts/backup/snapshot.js), not by the running bot: the
# bot may be the very thing this deploy fixes (hanging, crash-looping), and a
# route into it would need its own auth. The CLI copies settings/ and
# sessions.json in one synchronous pass too; only a store write of the old bot
# landing within those few milliseconds could tear it - the bot's hourly
# snapshot, at most an hour old, stays the fallback (docs/deployment.md).

# KEY's value in an env file (the last line wins), without surrounding quotes.
read_env_value() {
    local file="$1"
    [ -f "$file" ] || return 0
    grep -E "^[[:space:]]*$2=" "$file" | tail -n 1 | cut -d'=' -f2- | tr -d '\r' \
        | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//" || true
}

# The env file the bot (and the snapshot CLI) reads: .env.dev wins over .env.
bot_env_file() {
    if [ -f "$APP_DIR/.env.dev" ]; then echo "$APP_DIR/.env.dev"; else echo "$APP_DIR/.env"; fi
}

# A setting as the bot sees it: exported in this shell, else from its env file.
bot_setting() {
    local value="${!1:-}"
    if [ -z "$value" ]; then value="$(read_env_value "$(bot_env_file)" "$1")"; fi
    echo "$value"
}

# "on", "off" or nothing for a switch value (1/true/yes/on, 0/false/no/off).
switch_value() {
    case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) echo on ;;
        0|false|no|off) echo off ;;
    esac
}

# Where the snapshots go - the rule of resolveBackupDir()
# (src/services/backup/backupConfig.js): BACKUP_DIR (relative = from the
# checkout), else /var/backups/pulsebot for the live bot (runMode.js: NODE_ENV
# production, or none and the .env), else ../pulsebot-backups.
backup_dir() {
    local dir node_env
    dir="$(bot_setting BACKUP_DIR)"
    if [ -n "$dir" ]; then
        case "$dir" in
            # (a drive letter only in the tests under Git Bash)
            /* | [A-Za-z]:/*) echo "$dir" ;;
            *) echo "$APP_DIR/$dir" ;;
        esac
        return 0
    fi
    node_env="$(bot_setting NODE_ENV)"
    if [ "$node_env" = "production" ] || { [ -z "$node_env" ] && [ "$(basename "$(bot_env_file)")" = ".env" ]; }; then
        echo "/var/backups/pulsebot"
    else
        echo "$(dirname "$APP_DIR")/pulsebot-backups"
    fi
}

# Whether this deploy takes a snapshot into $1. DEPLOY_SNAPSHOT=0 never, =1
# always; otherwise only where backups run: not switched off with
# BACKUP_ENABLED, and the snapshot directory exists (the bot's hourly job makes
# it on the live server within minutes of its start; a test or staging checkout
# has none). Says why not.
snapshot_wanted() {
    local flag
    flag="$(switch_value "${DEPLOY_SNAPSHOT:-}")"
    if [ "$flag" = off ]; then
        log "No data snapshot before the restart: DEPLOY_SNAPSHOT=$DEPLOY_SNAPSHOT."
        return 1
    fi
    if [ "$flag" = on ]; then return 0; fi
    if [ "$(switch_value "$(bot_setting BACKUP_ENABLED)")" = off ]; then
        log "No data snapshot before the restart: backups are off here (BACKUP_ENABLED)."
        return 1
    fi
    if [ ! -d "$1" ]; then
        log "No data snapshot before the restart: no backup directory at $1 (backups are not set up here; DEPLOY_SNAPSHOT=1 takes one anyway)."
        return 1
    fi
}

# One run of the snapshot CLI at the lowest CPU and I/O priority, with a time
# limit. Prints its log lines indented, keeps its JSON result in SNAPSHOT_JSON
# and returns its exit code (0 done, 1 failed, 2 arguments, 3 locked, 124 timeout).
run_snapshot_cli() {
    local dir="$1" from="$2" to="$3" out rc=0
    local -a args=(--reason deploy)
    local -a limit=()
    if [ -n "$from" ]; then args+=(--from "$from"); fi
    args+=(--to "$to" --json)
    if command -v timeout > /dev/null 2>&1; then limit=(timeout "$SNAPSHOT_TIMEOUT"); fi
    # BACKUP_DIR handed over: the CLI writes exactly where this script looked.
    out="$(low_prio env BACKUP_DIR="$dir" ${limit[@]+"${limit[@]}"} node scripts/backup/snapshot.js "${args[@]}" 2>&1 9>&-)" || rc=$?
    SNAPSHOT_JSON="$(printf '%s\n' "$out" | grep -E '^\{.*\}$' | tail -n 1 || true)"
    if [ -n "$out" ]; then
        printf '%s\n' "$out" | grep -vE '^\{.*\}$' | sed "s/^/$LOG_TAG   /" || true
    fi
    return "$rc"
}

# $BACKUP_DIR/status/deploy-snapshot.json for the monitoring (#696): the CLI's
# own status/snapshot.json is overwritten by the next hourly run and stays
# untouched when the lock was taken, so a failed deploy snapshot would vanish.
# { at, ok, exitCode, attempts, fromCommit, toCommit, error?, result } - result
# is the CLI's JSON (name, error, durationMs, ...) or null.
write_snapshot_status() {
    local dir="$1" rc="$2" from="$3" to="$4" attempts="$5" error="$6"
    local file="$dir/status/deploy-snapshot.json" ok=false
    if [ "$rc" -eq 0 ]; then ok=true; fi
    (
        umask 077
        mkdir -p "$dir/status" \
            && printf '{"at":"%s","ok":%s,"exitCode":%s,"attempts":%s,"fromCommit":"%s","toCommit":"%s"%s,"result":%s}\n' \
                "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ok" "$rc" "$attempts" "$from" "$to" \
                "${error:+,\"error\":\"$error\"}" "${SNAPSHOT_JSON:-null}" > "$file.tmp.$$" \
            && mv "$file.tmp.$$" "$file"
    ) || log "WARNING: could not write $file."
}

# The snapshot of the data as the running code left it, marked with the commit
# that runs ($1) and the one coming ($2). Never fails the deploy: a failure is a
# WARNING here, at the end of the log and in status/deploy-snapshot.json. While
# the bot's hourly snapshot holds the lock (exit 3) it waits once and retries.
take_deploy_snapshot() {
    local from="$1" to="$2" dir rc=0 attempts=1 error="" started=$SECONDS
    dir="$(backup_dir)"
    snapshot_wanted "$dir" || return 0
    log "Taking a data snapshot before the restart (${from:0:7} -> ${to:0:7}) in $dir..."
    run_snapshot_cli "$dir" "$from" "$to" || rc=$?
    if [ "$rc" -eq 3 ]; then
        log "Another snapshot holds the lock (most likely the bot's hourly one) - trying again in $SNAPSHOT_RETRY_DELAY s..."
        sleep "$SNAPSHOT_RETRY_DELAY"
        attempts=2
        rc=0
        run_snapshot_cli "$dir" "$from" "$to" || rc=$?
    fi
    case "$rc" in
        0) SNAPSHOT_NAME="$(printf '%s' "$SNAPSHOT_JSON" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
           log "Data snapshot ${SNAPSHOT_NAME:-?} taken ($((SECONDS - started)) s)." ;;
        3) error="another snapshot still held the lock after $attempts attempts" ;;
        124) error="timed out after $SNAPSHOT_TIMEOUT s" ;;
        2) error="the snapshot CLI refused its arguments (exit 2)" ;;
        *) error="the snapshot CLI failed (exit $rc)" ;;
    esac
    if [ -n "$error" ]; then
        SNAPSHOT_WARNING="$error"
        log "WARNING: no data snapshot before this deploy - $error. The deploy goes on; the newest earlier snapshot under $dir/snapshots is the fallback."
    fi
    write_snapshot_status "$dir" "$rc" "$from" "$to" "$attempts" "$error"
}

# --- the deploy -------------------------------------------------------------------

main() {
    local BRANCH="main"
    local arg
    for arg in "$@"; do
        case "$arg" in
            --force) DEPLOY_FORCE="all" ;;
            -*) log "ERROR: unknown option $arg"; exit 1 ;;
            *) BRANCH="$arg" ;;
        esac
    done

    echo "$LOG_TAG Starting deployment of $APP_NAME from branch $BRANCH"
    echo "$LOG_TAG Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "$LOG_TAG Directory: $APP_DIR"
    if [ -n "${DEPLOY_FORCE:-}" ]; then log "Forced steps: $DEPLOY_FORCE"; fi

    if [ ! -d "$APP_DIR/.git" ]; then
        echo "$LOG_TAG ERROR: $APP_DIR is not a git checkout — set DEPLOY_DIR to the directory the bot is checked out in."
        exit 1
    fi

    cd "$APP_DIR"
    mkdir -p "$STATE_DIR"

    # A manual deploy started while CI deploys (or the other way round) waits
    # for the first one instead of resetting the checkout under it.
    if command -v flock > /dev/null 2>&1; then
        exec 9> "$STATE_DIR/lock"
        if ! flock -w 900 9; then
            log "ERROR: another deploy has held $STATE_DIR/lock for 15 minutes - giving up."
            exit 1
        fi
    fi
    cleanup_staging

    echo "$LOG_TAG Fetching origin..."
    git fetch origin

    local TARGET="origin/$BRANCH"
    if [ -n "${DEPLOY_SHA:-}" ]; then
        if ! git merge-base --is-ancestor "$DEPLOY_SHA" "origin/$BRANCH" 2>/dev/null; then
            log "ERROR: $DEPLOY_SHA is not a commit on origin/$BRANCH."
            exit 1
        fi
        # CI pins the commit its client was built from. Deploy jobs wait in
        # line, and one that got its turn late must not put an older commit
        # back over a newer one.
        local LAST
        LAST="$(state_get DEPLOYED_COMMIT)"
        if [ -n "$LAST" ] && [ "$LAST" != "$(git rev-parse "$DEPLOY_SHA")" ] \
            && git merge-base --is-ancestor "$DEPLOY_SHA" "$LAST" 2>/dev/null; then
            log "${LAST:0:7} is live and already contains ${DEPLOY_SHA:0:7} - nothing to do."
            if [ -n "${PREBUILT_DIST:-}" ]; then rm -rf "$PREBUILT_DIST"; fi
            exit 0
        fi
        TARGET="$DEPLOY_SHA"
    fi

    # The commit the bot runs now - "from" of the snapshot before the restart.
    local PREV_COMMIT
    PREV_COMMIT="$(git rev-parse --verify -q HEAD 2>/dev/null || true)"

    echo "$LOG_TAG Checking out $BRANCH..."
    git checkout "$BRANCH"
    git reset --hard "$TARGET"
    local COMMIT
    COMMIT="$(git rev-parse HEAD)"

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
        set +u                      # nvm.sh trips over `set -u`
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        # .nvmrc names only the major line. `nvm install` asks the internet for
        # the newest release of it, so every deploy used to install each new
        # patch release (copying pm2 over) as soon as one appeared. An
        # installed version of the line is now used as it is;
        # DEPLOY_FORCE=node looks for a newer one.
        if ! is_forced node && nvm use --silent > /dev/null 2>&1; then
            log "Using the installed Node $(node --version) for .nvmrc ($REQUIRED_NODE)."
        else
            log "Installing Node $REQUIRED_NODE (from .nvmrc) with nvm..."
            # Global packages (pm2!) are per-version under nvm, so carry them over.
            nvm install --reinstall-packages-from=current || nvm use
        fi
        set -u
    else
        echo "$LOG_TAG nvm not found at $NVM_DIR — using the system Node."
    fi

    CURRENT_NODE=$(node --version | sed 's/^v//' | cut -d'.' -f1)
    if [ "$CURRENT_NODE" -lt "$REQUIRED_NODE" ]; then
        echo "$LOG_TAG ERROR: Node.js $REQUIRED_NODE+ required, found $CURRENT_NODE ($(command -v node))"
        exit 1
    fi
    local NODE_VERSION
    NODE_VERSION="$(node --version)"
    echo "$LOG_TAG Node $NODE_VERSION at $(command -v node), npm $(npm --version)"

    # Same lock file and same Node ABI: node_modules already is what npm ci
    # would produce (git reset never touches it).
    local DEPS_KEY
    DEPS_KEY="$(file_hash package-lock.json)-abi$(node -p 'process.versions.modules')"
    if is_forced install || [ ! -d node_modules ] || [ "$(state_get DEPS)" != "$DEPS_KEY" ]; then
        echo "$LOG_TAG Installing dependencies..."
        low_prio npm ci --omit=dev
        state_set DEPS "$DEPS_KEY"
    else
        log "Dependencies unchanged since the last deploy (package-lock.json, Node ABI) - no npm ci."
    fi

    local NEW_DIST
    if [ -n "${PREBUILT_DIST:-}" ] && ! is_forced build; then
        if [ ! -f "$PREBUILT_DIST/index.html" ]; then
            log "ERROR: PREBUILT_DIST=$PREBUILT_DIST holds no built client (index.html missing)."
            exit 1
        fi
        log "Using the web client built in CI ($PREBUILT_DIST)."
        NEW_DIST="$PREBUILT_DIST"
    else
        # A CI build that DEPLOY_FORCE=build passed over is not needed any more.
        if [ -n "${PREBUILT_DIST:-}" ]; then rm -rf "$PREBUILT_DIST"; fi
        NEW_DIST="$STATE_DIR/build-${COMMIT:0:12}"
        echo "$LOG_TAG Building web admin client..."
        build_dist_here "$NEW_DIST"
    fi

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

    # Only when the definitions (or the servers they go to) changed. The
    # fingerprint comes from the same script, the same env and the same
    # collection as the registration itself.
    local CMD_HASH
    CMD_HASH="$(node scripts/register-commands.js --print-hash 2>/dev/null | sed -n 's/^commands-hash: //p' | tail -n 1)" || CMD_HASH=""
    if is_forced register || [ -z "$CMD_HASH" ] || [ "$CMD_HASH" != "$(state_get COMMANDS)" ]; then
        echo "$LOG_TAG Registering slash commands..."
        if node scripts/register-commands.js; then
            if [ -n "$CMD_HASH" ]; then state_set COMMANDS "$CMD_HASH"; fi
        else
            echo "$LOG_TAG WARNING: Command registration failed — run 'npm run register' manually if commands are missing"
        fi
    else
        log "Slash commands unchanged since the last deploy - not registering."
    fi

    # type -P: the binary, not the wrapper function above
    if ! type -P pm2 > /dev/null 2>&1; then
        echo "$LOG_TAG ERROR: pm2 is not on PATH for Node $(node --version)."
        echo "$LOG_TAG nvm keeps global packages per Node version — install it once with: npm install -g pm2"
        exit 1
    fi

    # The data as the running code left it, before anything restarts the bot on
    # the new code: pm2 update below does, and the start-up migrations
    # (settingsMigration.js) run with the new code's first start. As late as
    # that allows - nothing after it touches the data.
    take_deploy_snapshot "$PREV_COMMIT" "$COMMIT" \
        || log "WARNING: the data snapshot step failed unexpectedly - the deploy goes on."

    # The PM2 daemon keeps running under whatever Node it was started with and
    # spawns the app with that very binary. Without `pm2 update` a Node upgrade
    # never reaches the bot: `pm2 restart` would happily bring the process back up
    # on the old version. `pm2 update` respawns the daemon on the current Node and
    # restores the managed processes. It is idempotent but restarts the bot one
    # more time, so it runs whenever the Node version differs from the one the
    # daemon was last respawned with - and on the first deploy with a state file.
    local LAST_NODE
    LAST_NODE="$(state_get NODE)"
    if is_forced pm2 || [ "$LAST_NODE" != "$NODE_VERSION" ]; then
        echo "$LOG_TAG Updating the PM2 daemon to Node $NODE_VERSION (last deploy: ${LAST_NODE:-unknown})..."
        pm2 update
        state_set NODE "$NODE_VERSION"
    else
        log "PM2 daemon already runs Node $NODE_VERSION - no pm2 update."
    fi

    # Switched right before the restart, so the old process serves the new
    # index.html only for these few seconds.
    echo "$LOG_TAG Installing the web client build..."
    install_dist "$NEW_DIST"

    echo "$LOG_TAG Restarting PM2 process..."
    if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
        # --update-env hands the bot THIS shell's environment, and the deploy shell
        # has no NODE_ENV: without it here the live bot ran as "development" — TLS
        # checks off and the Raid-Helper sync treating it as a test instance (#612).
        NODE_ENV=production pm2 restart "$APP_NAME" --update-env
        pm2 save
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
    HEALTH_ENV_FILE="$APP_DIR/.env"
    [ -f "$APP_DIR/.env.dev" ] && HEALTH_ENV_FILE="$APP_DIR/.env.dev"
    WEB_PORT="${WEB_PORT:-$(read_env_port "$HEALTH_ENV_FILE")}"
    WEB_PORT="${WEB_PORT:-3005}"
    HEALTH_URL="http://localhost:$WEB_PORT/health"
    HEALTH_ATTEMPTS=20
    HEALTH_DELAY=3

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
        if [ -n "$SNAPSHOT_NAME" ]; then
            log "The data from before this deploy: snapshot $SNAPSHOT_NAME (restore: docs/backup.md)."
        fi
        exit 1
    fi

    state_set DEPLOYED_COMMIT "$COMMIT"
    if [ -n "$SNAPSHOT_WARNING" ]; then
        log "WARNING: this deploy ran without a fresh data snapshot ($SNAPSHOT_WARNING)."
    fi
    echo "$LOG_TAG Deployment complete. ($SECONDS s)"
}

# Run when executed; when sourced (test/deploy.test.js) only the functions
# above are defined.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
