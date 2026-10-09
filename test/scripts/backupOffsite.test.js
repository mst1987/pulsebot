// scripts/backup/offsite.sh (#692) runs against a stub restic that logs its
// calls and prints restic-like JSON, with temp directories for everything the
// script reads or writes. The script needs the Linux tools nice, ionice, flock
// and timeout; where they are missing (Windows, Git Bash) the runs are skipped.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "..");
const posix = (p) => p.replace(/\\/g, "/");
const SCRIPT = posix(path.join(root, "scripts", "backup", "offsite.sh"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const canRun = (() => {
    if (process.platform === "win32") return false;
    try {
        execFileSync("bash", ["-c", `command -v nice ionice flock timeout runuser stat mktemp pkill && test -f "${SCRIPT}"`], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();
const run = canRun ? it : it.skip;

const STUB_RESTIC = `#!/usr/bin/env bash
echo "restic $*" >> "$STUB_LOG"
case "$1" in
  -o) shift 2 ;;
esac
case "$1" in
  cat) exit "\${STUB_CAT_RC:-0}" ;;
  init) exit 0 ;;
  backup)
    [ -n "\${STUB_BACKUP_FAIL:-}" ] && { echo "backup exploded" >&2; exit 1; }
    for a in "$@"; do
      case "$a" in /*)
        [ -L "$a" ] && echo "symlink $a" >> "$STUB_LOG"
        [ -d "$a" ] && find "$a" -type f | sort | sed 's/^/file /' >> "$STUB_LOG"
        [ -f "$a" ] && echo "file $a" >> "$STUB_LOG"
      ;; esac
    done
    echo '{"message_type":"status","percent_done":0.5}'
    echo '{"message_type":"summary","snapshot_id":"abc123def","data_added":4242,"total_bytes_processed":99999}'
    ;;
  stats) echo '{"total_size":777000,"total_file_count":3}' ;;
esac
exit 0
`;

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-offsite-"));
    const mk = (p, content = "x") => {
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
        fs.writeFileSync(path.join(dir, p), content);
    };
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "restic"), STUB_RESTIC, { mode: 0o755 });
    // a snapshot as #691 leaves it: snapshots/<name>/ with latest -> snapshots/<name>
    mk("backup/snapshots/20261010-030000-hourly/data/settings/events.json", "{}");
    mk("backup/snapshots/20261010-030000-hourly/manifest.json", "{}");
    fs.symlinkSync("snapshots/20261010-030000-hourly", path.join(dir, "backup", "latest"));
    // server pieces
    mk("etc/nginx/nginx.conf", "worker_processes 1;");
    mk("etc/systemd/system/mine.service", "[Service]");
    fs.symlinkSync("/lib/systemd/system/ssh.service", path.join(dir, "etc/systemd/system/ssh.service"));
    mk("home/site.cer", "cert");
    mk("home/site_private_key.key", "key");
    mk("home/readme.txt", "no");
    mk("deploy/.env", "TOKEN=1");
    mk("pw", "secret");
    fs.chmodSync(path.join(dir, "pw"), 0o600);
    const env = path.join(dir, "backup.env");
    fs.writeFileSync(env, [
        "RESTIC_REPOSITORY=s3:https://acc.r2.cloudflarestorage.com/bucket",
        `RESTIC_PASSWORD_FILE=${dir}/pw`,
        "AWS_ACCESS_KEY_ID=id",
        "AWS_SECRET_ACCESS_KEY=key",
        `BACKUP_DIR=${dir}/backup`,
        `DEPLOY_DIR=${dir}/deploy`,
        `OFFSITE_SRC_ETC=${dir}/etc`,
        `OFFSITE_SRC_HOME=${dir}/home`,
        "",
    ].join("\n"), { mode: 0o600 });
    const log = path.join(dir, "calls.log");
    fs.writeFileSync(log, "");
    return { dir, env, log, bin };
}

function exec(ctx, { args = [], extraEnv = {} } = {}) {
    const res = spawnSync("bash", [SCRIPT, ...args, ctx.env], {
        env: { ...process.env, PATH: [ctx.bin, process.env.PATH].join(":"), STUB_LOG: ctx.log, ...extraEnv },
        encoding: "utf8",
    });
    const calls = fs.readFileSync(ctx.log, "utf8").split("\n").filter(Boolean);
    const statusFile = path.join(ctx.dir, "backup", "status", "offsite.json");
    const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, "utf8")) : null;
    return { ...res, calls, status };
}

const withCtx = (fn) => () => {
    const ctx = setup();
    try {
        fn(ctx);
    } finally {
        fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
};

describe("offsite.sh source", () => {
    const src = read("scripts/backup/offsite.sh");
    it("is strict, rate-limited and never passes the password on a command line", () => {
        expect(src).toMatch(/^set -euo pipefail$/m);
        expect(src).toMatch(/nice -n 19/);
        expect(src).toMatch(/ionice -c3/);
        expect(src).toMatch(/flock -n/);
        expect(src).toMatch(/timeout -k 30/);
        expect(src).not.toMatch(/--password(?!-file)/);
        expect(src).toMatch(/s3\.region=/);
    });

    it("has an installable timer and service", () => {
        const service = read("scripts/backup/systemd/pulsebot-backup.service");
        const timer = read("scripts/backup/systemd/pulsebot-backup.timer");
        expect(service).toMatch(/Type=oneshot/);
        expect(service).toMatch(/Nice=19/);
        expect(service).toMatch(/IOSchedulingClass=idle/);
        expect(service).toMatch(/MemoryMax=\d+M/);
        expect(service).toMatch(/EnvironmentFile=\/etc\/pulsebot\/backup\.env/);
        expect(timer).toMatch(/Persistent=true/);
        expect(timer).toMatch(/RandomizedDelaySec=/);
        expect(timer).toMatch(/OnCalendar=.*03:30/);
    });

    it("ships an env example without secrets", () => {
        const example = read("scripts/backup/backup.env.example");
        expect(example).toMatch(/^AWS_ACCESS_KEY_ID=$/m);
        expect(example).toMatch(/^AWS_SECRET_ACCESS_KEY=$/m);
        expect(example).toMatch(/<account-id>/);
    });
});

describe("offsite.sh run", () => {
    run("backs up stage, server config and .env with tag and host, then forgets", withCtx((ctx) => {
        const r = exec(ctx);
        expect(r.stderr).not.toMatch(/WARNING|ERROR/);
        expect(r.calls.join("\n")).not.toMatch(/restic .*init/);
        const backup = r.calls.find((c) => / backup /.test(c));
        expect(backup).toContain("-o s3.region=auto");
        expect(backup).toContain("--json --tag pulsebot --host pulsebot");
        expect(backup).toContain(`${ctx.dir}/backup/offsite-stage/latest`);
        expect(backup).toContain(`${ctx.dir}/backup/server-config`);
        expect(backup).toContain(`${ctx.dir}/deploy/.env`);
        const forget = r.calls.find((c) => c.includes(" forget "));
        expect(forget).toContain("--keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune");
        expect(forget).toContain("--tag pulsebot --host pulsebot");
    }));

    run("writes the status contract on success", withCtx((ctx) => {
        const r = exec(ctx);
        expect(r.status).toMatchObject({ ok: true, addedBytes: 4242, totalBytes: 777000, snapshotId: "abc123def" });
        expect(r.status.error).toBeUndefined();
        expect(typeof r.status.durationMs).toBe("number");
        expect(new Date(r.status.at).toString()).not.toBe("Invalid Date");
        expect(fs.statSync(path.join(ctx.dir, "backup", "status", "offsite.json")).mode & 0o777).toBe(0o600);
    }));

    run("hands restic real files for latest, not the symlink", withCtx((ctx) => {
        const r = exec(ctx);
        expect(r.calls.some((c) => c.startsWith("symlink "))).toBe(false);
        const stage = `${ctx.dir}/backup/offsite-stage/latest`;
        expect(r.calls).toContain(`file ${stage}/data/settings/events.json`);
        expect(r.calls).toContain(`file ${stage}/manifest.json`);
    }));

    run("collects the server configuration, without symlinked units and stray files", withCtx((ctx) => {
        exec(ctx);
        const base = path.join(ctx.dir, "backup", "server-config", "files");
        const found = execFileSync("find", [base, "(", "-type", "f", "-o", "-type", "l", ")"], { encoding: "utf8" })
            .split("\n").filter(Boolean).map((f) => f.slice(base.length));
        expect(found.some((f) => f.endsWith("/etc/nginx/nginx.conf"))).toBe(true);
        expect(found.some((f) => f.endsWith("/etc/systemd/system/mine.service"))).toBe(true);
        expect(found.some((f) => f.endsWith("/ssh.service"))).toBe(false);
        expect(found.some((f) => f.endsWith("/home/site.cer"))).toBe(true);
        expect(found.some((f) => f.endsWith("/home/site_private_key.key"))).toBe(true);
        expect(found.some((f) => f.endsWith("/readme.txt"))).toBe(false);
        expect(fs.existsSync(path.join(ctx.dir, "backup", "server-config", "node-versions.txt"))).toBe(true);
    }));

    run("skips PostgreSQL without pg_dumpall", withCtx((ctx) => {
        const r = exec(ctx);
        expect(fs.existsSync(path.join(ctx.dir, "backup", "server-config", "postgres-dumpall.sql.gz"))).toBe(false);
        expect(r.status.ok).toBe(true);
    }));

    run("skips PostgreSQL when the service is not active", withCtx((ctx) => {
        fs.writeFileSync(path.join(ctx.bin, "systemctl"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
        fs.writeFileSync(path.join(ctx.bin, "pg_dumpall"), "#!/bin/sh\necho SHOULD-NOT-RUN >> \"$STUB_LOG\"\n", { mode: 0o755 });
        const r = exec(ctx);
        expect(r.calls).not.toContain("SHOULD-NOT-RUN");
        expect(fs.existsSync(path.join(ctx.dir, "backup", "server-config", "postgres-dumpall.sql.gz"))).toBe(false);
        expect(r.status.ok).toBe(true);
    }));

    run("runs restic init only when the repository does not exist", withCtx((ctx) => {
        const r = exec(ctx, { extraEnv: { STUB_CAT_RC: "10" } });
        const verbs = r.calls.map((c) => c.split(" ").find((w) => ["cat", "init", "backup"].includes(w))).filter(Boolean);
        expect(verbs.slice(0, 3)).toEqual(["cat", "init", "backup"]);
        expect(r.status.ok).toBe(true);
    }));

    run("does not init on another repository error (wrong password, network)", withCtx((ctx) => {
        const r = exec(ctx, { extraEnv: { STUB_CAT_RC: "1" } });
        const text = r.calls.join("\n");
        expect(text).not.toMatch(/ init/);
        expect(text).not.toMatch(/ backup /);
        expect(r.status.ok).toBe(false);
        expect(r.status.error).toMatch(/cannot open the repository/);
        expect(r.status.addedBytes).toBe(0);
        expect(r.status.totalBytes).toBeUndefined();
        expect(r.status.snapshotId).toBeUndefined();
    }));

    run("writes ok:false with the error when the backup fails, and does not forget", withCtx((ctx) => {
        const r = exec(ctx, { extraEnv: { STUB_BACKUP_FAIL: "1" } });
        expect(r.status.ok).toBe(false);
        expect(r.status.error).toMatch(/restic backup failed: backup exploded/);
        expect(r.calls.join("\n")).not.toMatch(/ forget /);
    }));

    run("fails with a status when there is no snapshot to copy", withCtx((ctx) => {
        fs.unlinkSync(path.join(ctx.dir, "backup", "latest"));
        const r = exec(ctx);
        expect(r.status.ok).toBe(false);
        expect(r.status.error).toMatch(/no snapshot/);
        expect(r.calls.join("\n")).not.toMatch(/ backup /);
    }));

    run("takes the retention from the environment", withCtx((ctx) => {
        const r = exec(ctx, { extraEnv: { OFFSITE_KEEP_DAILY: "3", OFFSITE_KEEP_WEEKLY: "2", OFFSITE_KEEP_MONTHLY: "1" } });
        expect(r.calls.find((c) => c.includes(" forget "))).toContain("--keep-daily 3 --keep-weekly 2 --keep-monthly 1");
    }));

    run("checks a subset of the data only on the check day", withCtx((ctx) => {
        const today = execFileSync("date", ["+%u"], { encoding: "utf8" }).trim();
        const other = String((Number(today) % 7) + 1);
        const off = exec(ctx, { extraEnv: { OFFSITE_CHECK_DAY: other } });
        expect(off.calls.join("\n")).not.toMatch(/ check /);
        const on = exec(ctx, { extraEnv: { OFFSITE_CHECK_DAY: today } });
        expect(on.calls.find((c) => c.includes(" check "))).toContain("--read-data-subset=5%");
    }));

    run("refuses a second run at the same time and leaves the first status alone", withCtx((ctx) => {
        fs.mkdirSync(path.join(ctx.dir, "backup", "status"), { recursive: true });
        const lock = `${ctx.dir}/backup/status/offsite.lock`;
        // the shell holds the lock on fd 8 while the script runs and tries to take it
        const held = spawnSync("bash", ["-c", `exec 8>"${lock}"; flock -n 8; bash "${SCRIPT}" "${ctx.env}"; echo "rc=$?"`], {
            env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}`, STUB_LOG: ctx.log },
            encoding: "utf8",
        });
        expect(held.stdout).toContain("rc=75");
        expect(fs.existsSync(path.join(ctx.dir, "backup", "status", "offsite.json"))).toBe(false);
        expect(fs.readFileSync(ctx.log, "utf8")).toBe("");
    }));

    run("--dry-run changes nothing in the repository and writes no status", withCtx((ctx) => {
        const r = exec(ctx, { args: ["--dry-run"], extraEnv: { STUB_CAT_RC: "10" } });
        const text = r.calls.join("\n");
        expect(text).not.toMatch(/ init/);
        expect(text).not.toMatch(/ check /);
        expect(text).toMatch(/ backup .*--dry-run/);
        expect(text).toMatch(/ forget .*--dry-run/);
        expect(text).not.toMatch(/--prune/);
        expect(r.status).toBeNull();
    }));

    run("stops with a message without a password", withCtx((ctx) => {
        fs.writeFileSync(ctx.env, fs.readFileSync(ctx.env, "utf8").replace(/^RESTIC_PASSWORD_FILE=.*$/m, ""));
        const r = exec(ctx);
        expect(r.status.ok).toBe(false);
        expect(r.status.error).toMatch(/RESTIC_PASSWORD/);
    }));

    run("warns about a config file that is not mode 600", withCtx((ctx) => {
        fs.chmodSync(ctx.env, 0o644);
        const r = exec(ctx);
        expect(r.stderr).toMatch(/mode 644, expected 600/);
        expect(r.status.ok).toBe(true);
    }));
});
