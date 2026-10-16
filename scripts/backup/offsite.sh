#!/usr/bin/env bash
# Nightly encrypted copy of the PulseBot backup off the server (#692), with restic
# to Cloudflare R2 (S3 backend). Runs from the systemd timer
# scripts/backup/systemd/pulsebot-backup.timer, outside the bot, and ends again
# (no daemon, 0 MB at rest). Setup step by step: docs/backup.md.
#
#   offsite.sh [--dry-run] [config-file]
#
#   config-file  default /etc/pulsebot/backup.env (or $PULSEBOT_BACKUP_ENV); a
#                shell file of KEY=value lines, mode 600:
#                  RESTIC_REPOSITORY    s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>
#                  RESTIC_PASSWORD_FILE path of the password file (preferred), or
#                  RESTIC_PASSWORD      the password itself
#                  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 API token
#                  BACKUP_DIR           default /var/backups/pulsebot (contract of #691)
#                  DEPLOY_DIR           default /var/www/pulsebot (its .env is saved)
#                Optional: OFFSITE_KEEP_DAILY (14), _WEEKLY (8), _MONTHLY (12),
#                OFFSITE_TIMEOUT (2h), OFFSITE_CHECK_DAY (7 = Sunday),
#                OFFSITE_CHECK_SUBSET (5%), OFFSITE_HOST (pulsebot),
#                OFFSITE_S3_REGION (auto), OFFSITE_SRC_ETC (/etc),
#                OFFSITE_SRC_HOME (/root), OFFSITE_LOCK.
#   --dry-run    restic backup/forget with --dry-run, no init, no check, no
#                status file; server config is still staged locally.
#
# What one run does:
#   1. stages the server configuration in $BACKUP_DIR/server-config/
#   2. hard-links the newest snapshot ($BACKUP_DIR/latest, a symlink that restic
#      would store as a link) to the stable path $BACKUP_DIR/offsite-stage/latest,
#      so restic sees real files and finds its parent snapshot every night
#   3. restic init (only if the repository does not exist), restic backup of
#      stage + server-config + $DEPLOY_DIR/.env, restic forget --prune,
#      on Sundays restic check --read-data-subset
#   4. writes $BACKUP_DIR/status/offsite.json (also on failure) for the bot (#696)
#
# R2 notes: R2 is S3-compatible; restic's S3 backend takes the endpoint in the
# repository URL (restic docs, "Preparing a new repository", "S3-compatible
# storage": s3:https://server:port/bucket_name). The region is "us-east-1" unless
# set with -o s3.region=... or AWS_DEFAULT_REGION; Cloudflare's S3 API documents
# the region "auto" (us-east-1 is accepted as an alias), so we pass
# -o s3.region=auto. The restic docs do not mention R2 explicitly.
#
# Sets nice/ionice, an flock against a second run and a timeout around itself.

set -euo pipefail

DRY_RUN=0
CONFIG_FILE="${PULSEBOT_BACKUP_ENV:-/etc/pulsebot/backup.env}"
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        *) CONFIG_FILE="$arg" ;;
    esac
done

log() { echo "pulsebot-offsite: $*" >&2; }

load_config() {
    if [ ! -r "$CONFIG_FILE" ]; then
        log "ERROR: cannot read $CONFIG_FILE"
        exit 2
    fi
    local mode
    mode=$(stat -c %a "$CONFIG_FILE" 2>/dev/null || echo "")
    if [ -n "$mode" ] && [ "$mode" != "600" ] && [ "$mode" != "400" ]; then
        log "WARNING: $CONFIG_FILE has mode $mode, expected 600 (it holds the repository password and access keys)"
    fi
    set -a
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
    set +a
    BACKUP_DIR="${BACKUP_DIR:-/var/backups/pulsebot}"
    DEPLOY_DIR="${DEPLOY_DIR:-/var/www/pulsebot}"
    export BACKUP_DIR DEPLOY_DIR
}

# ---------------------------------------------------------------- outer part
# Re-executes itself under nice/ionice/flock/timeout. A second run finds the
# lock taken and ends with 75 without touching the status file of the first.
if [ -z "${PULSEBOT_OFFSITE_INNER:-}" ]; then
    load_config
    mkdir -p "$BACKUP_DIR/status"
    LOCK="${OFFSITE_LOCK:-$BACKUP_DIR/status/offsite.lock}"
    PREFIX=()
    command -v nice > /dev/null 2>&1 && PREFIX+=(nice -n 19)
    command -v ionice > /dev/null 2>&1 && PREFIX+=(ionice -c3)
    exec "${PREFIX[@]}" flock -n -E 75 "$LOCK" \
        timeout -k 30 "${OFFSITE_TIMEOUT:-2h}" \
        env PULSEBOT_OFFSITE_INNER=1 bash "$0" "$@"
fi

# ---------------------------------------------------------------- inner part
load_config

HOST="${OFFSITE_HOST:-pulsebot}"
KEEP_DAILY="${OFFSITE_KEEP_DAILY:-14}"
KEEP_WEEKLY="${OFFSITE_KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${OFFSITE_KEEP_MONTHLY:-12}"
CHECK_DAY="${OFFSITE_CHECK_DAY:-7}"
CHECK_SUBSET="${OFFSITE_CHECK_SUBSET:-5%}"
SRC_ETC="${OFFSITE_SRC_ETC:-/etc}"
SRC_HOME="${OFFSITE_SRC_HOME:-/root}"
STATUS_DIR="$BACKUP_DIR/status"
STATUS_FILE="$STATUS_DIR/offsite.json"
STAGE_DIR="$BACKUP_DIR/offsite-stage"
CONFIG_STAGE="$BACKUP_DIR/server-config"
WORK="$(mktemp -d)"

START_MS=$(( $(date +%s) * 1000 ))
ERROR_MSG=""
ADDED_BYTES=0
TOTAL_BYTES=""
SNAPSHOT_ID=""

json_escape() {
    # backslash, quote, and newlines/tabs flattened to spaces
    printf '%s' "$1" | tr '\n\t\r' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

write_status() {
    local ok="$1" now_ms dur
    now_ms=$(( $(date +%s) * 1000 ))
    dur=$(( now_ms - START_MS ))
    mkdir -p "$STATUS_DIR"
    {
        printf '{"at":"%s","ok":%s,"durationMs":%s,"addedBytes":%s' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ok" "$dur" "$ADDED_BYTES"
        [ -n "$TOTAL_BYTES" ] && printf ',"totalBytes":%s' "$TOTAL_BYTES"
        [ -n "$SNAPSHOT_ID" ] && printf ',"snapshotId":"%s"' "$SNAPSHOT_ID"
        [ -n "$ERROR_MSG" ] && printf ',"error":"%s"' "$(json_escape "$ERROR_MSG")"
        printf '}\n'
    } > "$STATUS_FILE.tmp"
    chmod 600 "$STATUS_FILE.tmp"
    mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

finish() {
    local rc=$?
    trap - EXIT
    pkill -P $$ 2> /dev/null || true
    rm -rf "$WORK"
    if [ "$DRY_RUN" -eq 1 ]; then
        exit "$rc"
    fi
    if [ "$rc" -eq 0 ]; then
        write_status true
    else
        [ -n "$ERROR_MSG" ] || ERROR_MSG="offsite.sh failed (exit $rc)"
        write_status false
        log "ERROR: $ERROR_MSG"
    fi
    exit "$rc"
}
trap finish EXIT
trap 'ERROR_MSG="timeout or terminated"; exit 124' TERM INT

fail() {
    ERROR_MSG="$1"
    exit 1
}

# --- configuration check
[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is not set in $CONFIG_FILE"
if [ -z "${RESTIC_PASSWORD_FILE:-}" ] && [ -z "${RESTIC_PASSWORD:-}" ]; then
    fail "neither RESTIC_PASSWORD_FILE nor RESTIC_PASSWORD is set in $CONFIG_FILE"
fi
if [ -n "${RESTIC_PASSWORD_FILE:-}" ] && [ ! -r "$RESTIC_PASSWORD_FILE" ]; then
    fail "RESTIC_PASSWORD_FILE $RESTIC_PASSWORD_FILE is not readable"
fi
command -v restic > /dev/null 2>&1 || fail "restic is not installed"

# restic keeps a local cache under $XDG_CACHE_HOME or $HOME - and a systemd
# service has neither, so the first timer run died with "unable to locate cache
# directory". One fixed place next to the snapshots (a dot name, which the
# snapshot readers skip) serves the timer and a run by hand alike.
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}"
mkdir -p "$RESTIC_CACHE_DIR" && chmod 700 "$RESTIC_CACHE_DIR" 2> /dev/null || true

RESTIC=(restic)
case "$RESTIC_REPOSITORY" in
    s3:*) RESTIC+=(-o "s3.region=${OFFSITE_S3_REGION:-auto}") ;;
esac

# ---------------------------------------------------------------- 1. server config
# Copies one path into the staging area, keeping its absolute path below it.
# A missing source is only a log line: not every server has everything.
stage_path() {
    local src="$1"
    if [ -e "$src" ]; then
        mkdir -p "$CONFIG_STAGE/files$(dirname "$src")"
        cp -a "$src" "$CONFIG_STAGE/files$(dirname "$src")/" 2> "$WORK/cp.err" || log "WARNING: could not copy $src: $(cat "$WORK/cp.err")"
    else
        log "note: $src does not exist, skipped"
    fi
}

stage_server_config() {
    rm -rf "$CONFIG_STAGE"
    mkdir -p "$CONFIG_STAGE/files"
    chmod 700 "$BACKUP_DIR" "$CONFIG_STAGE" 2> /dev/null || true

    stage_path "$SRC_ETC/nginx"
    stage_path "$SRC_ETC/letsencrypt"
    stage_path "$SRC_ETC/cron.d"
    stage_path "$SRC_HOME/.pm2/dump.pm2"

    # certificates and private keys lying in the home directory
    local f
    if [ -d "$SRC_HOME" ]; then
        while IFS= read -r -d '' f; do
            stage_path "$f"
        done < <(find "$SRC_HOME" -maxdepth 1 -type f \( -name '*.cer' -o -name '*private_key.key' \) -print0)
    fi

    # own systemd units: regular files only, no symlinks (those point into /lib)
    if [ -d "$SRC_ETC/systemd/system" ]; then
        while IFS= read -r -d '' f; do
            stage_path "$f"
        done < <(find "$SRC_ETC/systemd/system" -maxdepth 1 -type f \( -name '*.service' -o -name '*.timer' \) -print0)
    fi

    if command -v crontab > /dev/null 2>&1; then
        crontab -l > "$CONFIG_STAGE/crontab-root.txt" 2> /dev/null || true
    fi
    if command -v dpkg > /dev/null 2>&1; then
        dpkg --get-selections > "$CONFIG_STAGE/dpkg-selections.txt" 2> /dev/null || true
    fi
    ls "$SRC_HOME/.nvm/versions/node" > "$CONFIG_STAGE/node-versions.txt" 2> /dev/null || true

    # PostgreSQL only if it is installed AND running. From /: the postgres user
    # may not enter root's working directory, and pg_dumpall says so on stderr
    # ("could not change directory to /root") - which counted as a failure.
    if command -v pg_dumpall > /dev/null 2>&1 && systemctl is-active --quiet postgresql 2> /dev/null; then
        if (cd / && runuser -u postgres -- pg_dumpall) 2> "$WORK/pg.err" | gzip > "$CONFIG_STAGE/postgres-dumpall.sql.gz" && [ ! -s "$WORK/pg.err" ]; then
            log "postgres dump written"
        else
            log "WARNING: pg_dumpall reported: $(cat "$WORK/pg.err" 2> /dev/null)"
        fi
        chmod 600 "$CONFIG_STAGE/postgres-dumpall.sql.gz" 2> /dev/null || true
    else
        log "note: no running PostgreSQL, dump skipped"
    fi

    chmod -R go-rwx "$CONFIG_STAGE"
}

# ---------------------------------------------------------------- 2. latest snapshot
# restic stores a symlink given as a path as a link. Hard links to the newest
# snapshot give it real files under a path that stays the same every night.
stage_latest() {
    local target
    target=$(readlink -f "$BACKUP_DIR/latest" 2> /dev/null || true)
    if [ -z "$target" ] || [ ! -d "$target" ]; then
        fail "no snapshot at $BACKUP_DIR/latest (is the snapshot job from #691 running?)"
    fi
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR/latest"
    chmod 700 "$STAGE_DIR"
    # hard links cost no space; a different filesystem falls back to a copy
    cp -al "$target/." "$STAGE_DIR/latest/" 2> /dev/null || cp -a "$target/." "$STAGE_DIR/latest/"
}

# ---------------------------------------------------------------- 3. restic
repo_exists() {
    local rc=0
    "${RESTIC[@]}" cat config > "$WORK/cat.out" 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
        return 0
    fi
    # restic >= 0.17 exits 10 for "repository does not exist"; older versions
    # exit 1 with this message. Anything else (wrong key, no network) is an error
    # and must not lead to an init.
    if [ "$rc" -eq 10 ] || grep -q "Is there a repository at the following location" "$WORK/cat.out"; then
        return 1
    fi
    fail "restic cannot open the repository: $(tail -n 3 "$WORK/cat.out")"
}

stage_server_config
stage_latest

if [ "$DRY_RUN" -eq 0 ]; then
    if ! repo_exists; then
        log "repository does not exist yet, running restic init"
        "${RESTIC[@]}" init > "$WORK/init.out" 2>&1 || fail "restic init failed: $(tail -n 3 "$WORK/init.out")"
    fi
fi

PATHS=("$STAGE_DIR/latest" "$CONFIG_STAGE")
if [ -f "$DEPLOY_DIR/.env" ]; then
    PATHS+=("$DEPLOY_DIR/.env")
else
    log "WARNING: $DEPLOY_DIR/.env not found, it is not part of this copy"
fi

BACKUP_ARGS=(backup --json --tag pulsebot --host "$HOST")
[ "$DRY_RUN" -eq 1 ] && BACKUP_ARGS+=(--dry-run)
"${RESTIC[@]}" "${BACKUP_ARGS[@]}" "${PATHS[@]}" > "$WORK/backup.json" 2> "$WORK/backup.err" \
    || fail "restic backup failed: $(tail -n 3 "$WORK/backup.err")"

SUMMARY=$(grep '"message_type":"summary"' "$WORK/backup.json" | tail -n 1 || true)
if [ -n "$SUMMARY" ]; then
    ADDED_BYTES=$(printf '%s' "$SUMMARY" | sed -n 's/.*"data_added":\([0-9][0-9]*\).*/\1/p')
    ADDED_BYTES="${ADDED_BYTES:-0}"
    SNAPSHOT_ID=$(printf '%s' "$SUMMARY" | sed -n 's/.*"snapshot_id":"\([0-9a-f]*\)".*/\1/p')
fi

if [ "$DRY_RUN" -eq 1 ]; then
    FORGET_ARGS=(forget --tag pulsebot --host "$HOST" --group-by "host,tags"
        --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --dry-run)
    "${RESTIC[@]}" "${FORGET_ARGS[@]}" || log "forget --dry-run failed"
    log "dry run done: nothing was written to the repository or the status file"
    exit 0
fi

"${RESTIC[@]}" forget --tag pulsebot --host "$HOST" --group-by host,tags \
    --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --prune \
    > "$WORK/forget.out" 2>&1 || fail "restic forget failed: $(tail -n 3 "$WORK/forget.out")"

if [ "$(date +%u)" = "$CHECK_DAY" ]; then
    "${RESTIC[@]}" check --read-data-subset="$CHECK_SUBSET" > "$WORK/check.out" 2>&1 \
        || fail "restic check failed: $(tail -n 3 "$WORK/check.out")"
fi

# totalBytes: restic stats in raw-data mode only reads the index, which is
# cheap on a repository under 1 GB; a failure leaves the field out.
if "${RESTIC[@]}" stats --mode raw-data --json > "$WORK/stats.json" 2> /dev/null; then
    TOTAL_BYTES=$(sed -n 's/.*"total_size":\([0-9][0-9]*\).*/\1/p' "$WORK/stats.json" | head -n 1)
fi

log "done, snapshot ${SNAPSHOT_ID:-?}, $ADDED_BYTES bytes added"
