// Guards the deployment toolchain against the failure mode that made a manual
// Node upgrade on the server look like it was reverted by the next deploy:
//   1. the deploy runs in a non-interactive ssh shell that never loads nvm, so
//      it silently fell back to the old system-wide Node, and
//   2. the PM2 daemon keeps spawning the app with the Node it was started with,
//      so even a correct upgrade never reached the running bot.
// These are shell/infra concerns, so the tests assert on the files themselves.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const nvmrc = read(".nvmrc").trim();
const requiredMajor = Number(nvmrc.replace(/^v/, "").split(".")[0]);

describe(".nvmrc is the single source of truth for the Node version", () => {
    it("pins a plain major version", () => {
        expect(nvmrc).toMatch(/^v?\d+(\.\d+)*$/);
        expect(Number.isInteger(requiredMajor)).toBe(true);
    });

    it("is not an end-of-life release", () => {
        // Node 18 went EOL in April 2025; 20 follows. Keep the pin on a
        // maintained LTS line.
        expect(requiredMajor).toBeGreaterThanOrEqual(22);
    });

    it("matches the engines range in package.json", () => {
        const pkg = JSON.parse(read("package.json"));
        expect(pkg.engines?.node).toBe(`>=${requiredMajor}`);
    });

    it("matches the Docker base image", () => {
        const from = read("Dockerfile").match(/^FROM node:(\d+)-/m);
        expect(from).not.toBeNull();
        expect(Number(from[1])).toBe(requiredMajor);
    });

    it("is what CI installs", () => {
        const ci = read(".github/workflows/ci.yml");
        expect(ci).toContain("node-version-file: \".nvmrc\"");
    });
});

describe("deploy.sh", () => {
    const deploy = read("deploy.sh");

    it("loads nvm itself instead of relying on the ssh shell's PATH", () => {
        expect(deploy).toMatch(/NVM_DIR/);
        expect(deploy).toMatch(/\.\s+"\$NVM_DIR\/nvm\.sh"/);
    });

    it("activates the .nvmrc version and keeps global packages", () => {
        expect(deploy).toMatch(/nvm install --reinstall-packages-from=current/);
    });

    it("derives the required major version from .nvmrc", () => {
        expect(deploy).toMatch(/REQUIRED_NODE=\$\(sed 's\/\^v\/\/' \.nvmrc/);
        expect(deploy).not.toMatch(/REQUIRED_NODE=\$\(cat \.nvmrc\)/);
    });

    it("aborts when the active Node is older than required", () => {
        expect(deploy).toMatch(/if \[ "\$CURRENT_NODE" -lt "\$REQUIRED_NODE" \]/);
        expect(deploy).toMatch(/exit 1/);
    });

    it("respawns the PM2 daemon before restarting the app", () => {
        const update = deploy.indexOf("pm2 update");
        const restart = deploy.indexOf("pm2 restart");
        expect(update).toBeGreaterThan(-1);
        expect(restart).toBeGreaterThan(-1);
        // Order matters: restarting first would bring the app back up on the
        // daemon's old Node.
        expect(update).toBeLessThan(restart);
    });

    it("fails loudly when pm2 is missing for the active Node version", () => {
        // nvm installs global packages per Node version, so pm2 can vanish from
        // PATH after a version bump. type -P looks for the binary, not the
        // pm2() wrapper function.
        expect(deploy).toMatch(/if ! type -P pm2 > \/dev\/null 2>&1; then/);
    });

    it("never hands the deploy lock to a PM2 daemon", () => {
        // a daemon spawned by pm2 update would inherit fd 9 and keep the lock
        expect(deploy).toMatch(/exec 9> "\$STATE_DIR\/lock"/);
        expect(deploy).toMatch(/pm2\(\) \{\n\s+command pm2 "\$@" 9>&-\n\}/);
    });

    // #612: --update-env takes the deploy shell's environment, which has no
    // NODE_ENV — the live bot ran as "development" until this was set here
    it("restarts the bot with NODE_ENV=production and saves that for a reboot", () => {
        expect(deploy).toMatch(/NODE_ENV=production pm2 restart "\$APP_NAME" --update-env\n\s*pm2 save/);
        expect(deploy).not.toMatch(/^\s*pm2 restart/m);
    });
});

describe("deploy.sh health check", () => {
    const deploy = read("deploy.sh");
    const healthAt = deploy.indexOf("HEALTH_URL=");
    const restartAt = deploy.lastIndexOf("pm2 restart");

    it("asks /health with curl after the restart, not before", () => {
        expect(deploy).toMatch(/curl -fsS/);
        expect(healthAt).toBeGreaterThan(restartAt);
        expect(deploy.indexOf("pm2 start ecosystem.config.js")).toBeLessThan(healthAt);
    });

    it("retries before giving up", () => {
        const attempts = Number(deploy.match(/HEALTH_ATTEMPTS=(\d+)/)?.[1]);
        const delay = Number(deploy.match(/HEALTH_DELAY=(\d+)/)?.[1]);
        expect(attempts).toBeGreaterThanOrEqual(10);
        expect(delay).toBeGreaterThanOrEqual(1);
        expect(deploy).toMatch(/for ATTEMPT in \$\(seq 1 "\$HEALTH_ATTEMPTS"\)/);
        expect(deploy).toMatch(/sleep "\$HEALTH_DELAY"/);
    });

    it("fails the deploy (exit 1) when the bot never answers", () => {
        const failure = deploy.slice(deploy.indexOf("if [ \"$HEALTHY\" -ne 1 ]"));
        expect(failure).toMatch(/ERROR: .*did not answer/);
        expect(failure).toMatch(/exit 1/);
    });

    it("reads WEB_PORT from the env file the bot reads, defaulting to 3005", () => {
        expect(deploy).toMatch(/WEB_PORT=\S*read_env_port "\$HEALTH_ENV_FILE"/);
        expect(deploy).toMatch(/\.env\.dev" \] && HEALTH_ENV_FILE=/);
        expect(deploy).toMatch(/WEB_PORT="\$\{WEB_PORT:-3005\}"/);
    });

    it("only reports the deploy complete once the check has passed", () => {
        expect(deploy.lastIndexOf("Deployment complete.")).toBeGreaterThan(healthAt);
    });
});

// The tests below run deploy.sh itself - sourced (only its functions are
// defined, main() does not run) or whole. They need a bash that sees this
// checkout under the same path (Git Bash or Linux; not WSL's bash.exe, which
// PowerShell finds first on Windows) - otherwise they are skipped.
const { execFileSync, spawnSync } = require("child_process");
const os = require("os");
const posix = (p) => p.replace(/\\/g, "/");
const DEPLOY_SH = posix(path.join(root, "deploy.sh"));
const hasBash = (() => {
    try {
        execFileSync("bash", ["-c", `command -v cp find mv git sha256sum nice seq && test -f "${DEPLOY_SH}"`], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();
const scratch = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writeFile = (file, content, mode) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mode) fs.chmodSync(file, mode);
};
const sourced = (dir, lines, env = {}) => execFileSync("bash", ["-c", [`source "${DEPLOY_SH}"`, `cd "${posix(dir)}"`, ...lines].join("\n")], {
    env: { ...process.env, DEPLOY_DIR: posix(dir), DEPLOY_FORCE: "", ...env },
    stdio: "pipe",
}).toString();

// #530: a tab opened before a deploy asks for the old build's chunks; the
// previous assets stay next to the new ones for a while (never index.html).
// The new dist/ is put together beside the live one and switched by renames.
describe("deploy.sh installs a web client build (#530)", () => {
    const deploy = read("deploy.sh");
    const start = deploy.indexOf("install_dist() {");
    const fn = deploy.slice(start, deploy.indexOf("\n}\n", start) + 2);

    it("assembles the new dist next to the live one and switches it by renaming", () => {
        expect(start).toBeGreaterThan(-1);
        expect(fn).toMatch(/mv "\$src" "\$next"/);
        expect(fn.indexOf("cp -an")).toBeLessThan(fn.indexOf("mv \"$next\" \"$DIST_DIR\""));
        expect(fn.indexOf("mv \"$DIST_DIR\" \"$old\"")).toBeLessThan(fn.indexOf("mv \"$next\" \"$DIST_DIR\""));
        expect(fn).not.toContain("index.html");
    });

    it("prunes kept assets after a fixed number of days", () => {
        expect(Number(deploy.match(/ASSET_KEEP_DAYS=(\d+)/)?.[1])).toBeGreaterThanOrEqual(1);
        expect(fn).toMatch(/find "\$next\/assets" -type f -mtime \+"\$ASSET_KEEP_DAYS" -delete \|\| true/);
    });

    it("never fails the deploy over the kept assets", () => {
        expect(fn).toMatch(/cp -an "\$DIST_DIR\/assets\/\." "\$next\/assets\/" 2>\/dev\/null \|\| true/);
    });

    (hasBash ? it : it.skip)("keeps the old chunks, takes the new ones and leaves nothing behind", () => {
        const dir = scratch("eh-deploy-dist-");
        try {
            const live = path.join(dir, "src", "web-client", "dist");
            writeFile(path.join(live, "index.html"), "old html");
            writeFile(path.join(live, "assets", "RaidplanTab-OLD.js"), "old");
            writeFile(path.join(live, "assets", "vendor-SAME.js"), "old build");
            writeFile(path.join(live, "assets", "Gone-ANCIENT.js"), "ancient");
            const month = Date.now() / 1000 - 30 * 24 * 3600;
            fs.utimesSync(path.join(live, "assets", "Gone-ANCIENT.js"), month, month);
            const build = path.join(dir, ".deploy", "dist-abc");
            writeFile(path.join(build, "index.html"), "new html");
            writeFile(path.join(build, "assets", "RaidplanTab-NEW.js"), "new");
            writeFile(path.join(build, "assets", "vendor-SAME.js"), "new build");

            sourced(dir, [`install_dist "${posix(build)}"`]);

            expect(fs.readdirSync(path.join(live, "assets")).sort()).toEqual(["RaidplanTab-NEW.js", "RaidplanTab-OLD.js", "vendor-SAME.js"]);
            expect(fs.readFileSync(path.join(live, "assets", "vendor-SAME.js"), "utf8")).toBe("new build");
            expect(fs.readFileSync(path.join(live, "index.html"), "utf8")).toBe("new html");
            expect(fs.readdirSync(path.join(dir, "src", "web-client")).sort()).toEqual(["dist"]);
            expect(fs.existsSync(build)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    (hasBash ? it : it.skip)("installs the very first build when there is no dist yet", () => {
        const dir = scratch("eh-deploy-dist-");
        try {
            const build = path.join(dir, ".deploy", "dist-abc");
            writeFile(path.join(build, "index.html"), "first");
            sourced(dir, ["mkdir -p src/web-client", `install_dist "${posix(build)}"`]);
            expect(fs.readFileSync(path.join(dir, "src", "web-client", "dist", "index.html"), "utf8")).toBe("first");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("deploy.sh state file and forced steps", () => {
    (hasBash ? it : it.skip)("sets, overwrites and reads keys; a missing file or key reads empty", () => {
        const dir = scratch("eh-deploy-state-");
        try {
            const out = sourced(dir, [
                "echo \"[$(state_get DEPS)]\"",
                "state_set DEPS a",
                "state_set NODE v22.1.0",
                "state_set DEPS b=c",
                "echo \"[$(state_get DEPS)][$(state_get NODE)][$(state_get NOPE)]\"",
            ]);
            expect(out.trim().split("\n")).toEqual(["[]", "[b=c][v22.1.0][]"]);
            expect(fs.readFileSync(path.join(dir, ".deploy", "state"), "utf8").trim().split("\n")).toEqual(["NODE=v22.1.0", "DEPS=b=c"]);
            expect(fs.readdirSync(path.join(dir, ".deploy"))).toEqual(["state"]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    (hasBash ? it : it.skip)("forces exactly the named steps, or all of them", () => {
        const dir = scratch("eh-deploy-state-");
        try {
            const check = "for s in install build register pm2 node; do if is_forced $s; then printf '%s ' $s; fi; done";
            expect(sourced(dir, [check], { DEPLOY_FORCE: "register,pm2" }).trim()).toBe("register pm2");
            expect(sourced(dir, [check], { DEPLOY_FORCE: "all" }).trim()).toBe("install build register pm2 node");
            expect(sourced(dir, [check], { DEPLOY_FORCE: "1" }).trim()).toBe("install build register pm2 node");
            expect(sourced(dir, [check], { DEPLOY_FORCE: "" }).trim()).toBe("");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

// The whole script against a scratch git repository, with node, npm, pm2 and
// curl replaced by stubs that write down how they were called.
describe("deploy.sh does only what changed since the last deploy", () => {
    let dir;
    let app;
    let calls;
    const sha = {};

    const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" }).toString().trim();
    const stub = (name, body) => writeFile(path.join(dir, "bin", name), `#!/usr/bin/env bash\n${body}\n`, 0o755);
    const prebuilt = (commit, marker) => {
        const target = path.join(app, ".deploy", `dist-${commit}`);
        writeFile(path.join(target, "index.html"), marker);
        writeFile(path.join(target, "assets", `app-${marker}.js`), marker);
        return posix(target);
    };
    const state = () => Object.fromEntries(fs.readFileSync(path.join(app, ".deploy", "state"), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    const run = (args = [], env = {}) => {
        fs.writeFileSync(calls, "");
        const clean = { ...process.env };
        for (const key of ["DEPLOY_FORCE", "DEPLOY_SHA", "PREBUILT_DIST", "WEB_PORT", "NODE_ENV"]) delete clean[key];
        const res = spawnSync("bash", [DEPLOY_SH, ...args], {
            cwd: app,
            env: {
                ...clean,
                PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`,
                DEPLOY_DIR: posix(app),
                NVM_DIR: posix(path.join(dir, "no-nvm")),
                CALLS: posix(calls),
                DISCORDJS_BOT_TOKEN: "t", CLIENT_ID: "c", GUILD_ID: "g", RAIDHELPER_API_KEY: "k", RAIDHELPER_SERVER_ID: "s",
                ...env,
            },
            encoding: "utf8",
        });
        const out = `${res.stdout}${res.stderr}`;
        if (res.status !== 0) throw new Error(`deploy.sh exited ${res.status}:\n${out}`);
        return { out, calls: fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
    };
    const has = (list, line) => list.some((l) => l === line);

    beforeAll(() => {
        if (!hasBash) return;
        dir = scratch("eh-deploy-run-");
        calls = path.join(dir, "calls.log");
        stub("node", [
            "echo \"node $*\" >> \"$CALLS\"",
            "case \"$1\" in",
            "  --version) echo \"${FAKE_NODE_VERSION:-v22.1.0}\" ;;",
            "  -p) echo 127 ;;",
            "  scripts/register-commands.js)",
            "    if [ \"${2:-}\" = \"--print-hash\" ]; then echo 'a module logging while it loads'; echo \"commands-hash: ${FAKE_COMMANDS_HASH:-aaa}\"; exit 0; fi",
            "    [ -z \"${FAKE_REGISTER_FAIL:-}\" ] ;;",
            "esac",
        ].join("\n"));
        stub("npm", [
            "echo \"npm $* ($(basename \"$PWD\"))\" >> \"$CALLS\"",
            "case \"$1\" in",
            "  --version) echo 10.0.0 ;;",
            "  ci) mkdir -p node_modules ;;",
            "  run) out=''; while [ $# -gt 0 ]; do if [ \"$1\" = --outDir ]; then out=\"$2\"; fi; shift; done",
            "       mkdir -p \"$out/assets\" && echo built > \"$out/index.html\" ;;",
            "esac",
        ].join("\n"));
        // where flock exists (Linux), fd 9 is the deploy lock and must not reach pm2
        stub("pm2", "echo \"pm2 $*\" >> \"$CALLS\"\nif [ -e /dev/fd/9 ]; then echo 'pm2 got fd 9' >> \"$CALLS\"; fi");
        stub("curl", "echo '{\"status\":\"ok\"}'");

        const origin = path.join(dir, "origin.git");
        const work = path.join(dir, "work");
        app = path.join(dir, "app");
        git(dir, "init", "--bare", "-q", origin);
        git(origin, "symbolic-ref", "HEAD", "refs/heads/main");
        git(dir, "clone", "-q", origin, work);
        git(work, "checkout", "-q", "-b", "main");
        const commit = (name, files) => {
            for (const [file, content] of Object.entries(files)) writeFile(path.join(work, file), content);
            git(work, "add", "-A");
            git(work, "commit", "-q", "-m", name);
            sha[name] = git(work, "rev-parse", "HEAD");
        };
        commit("c1", { ".nvmrc": "22\n", "package-lock.json": "{\"v\":1}\n", "src/a.txt": "1\n" });
        commit("c2", { "src/a.txt": "2\n" });
        commit("c3", { "package-lock.json": "{\"v\":2}\n" });
        git(work, "push", "-q", "origin", "main");
        git(dir, "clone", "-q", origin, app);
        writeFile(path.join(app, "src", "web-client", "dist", "assets", "app-OLD.js"), "old");
        writeFile(path.join(app, "src", "web-client", "dist", "index.html"), "old");
    }, 60000);

    afterAll(() => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    const step = hasBash ? it : it.skip;

    step("the first deploy (no state file) does every step once and puts the CI build live", () => {
        const { out, calls: c } = run(["main"], { DEPLOY_SHA: sha.c1, PREBUILT_DIST: prebuilt(sha.c1, "one") });
        expect(has(c, "npm ci --omit=dev (app)")).toBe(true);
        expect(has(c, "node scripts/register-commands.js")).toBe(true);
        expect(has(c, "pm2 update")).toBe(true);
        expect(has(c, "pm2 restart pulsebot --update-env")).toBe(true);
        expect(has(c, "pm2 got fd 9")).toBe(false);
        expect(c.some((l) => l.startsWith("npm run build"))).toBe(false);
        expect(out).toContain("Deployment complete.");
        expect(git(app, "rev-parse", "HEAD")).toBe(sha.c1);
        const dist = path.join(app, "src", "web-client", "dist");
        expect(fs.readFileSync(path.join(dist, "index.html"), "utf8")).toBe("one");
        expect(fs.readdirSync(path.join(dist, "assets")).sort()).toEqual(["app-OLD.js", "app-one.js"]);
        expect(state()).toEqual(expect.objectContaining({ COMMANDS: "aaa", NODE: "v22.1.0", DEPLOYED_COMMIT: sha.c1 }));
        expect(state().DEPS).toMatch(/^[0-9a-f]{64}-abi127$/);
        expect(fs.readdirSync(path.join(app, ".deploy")).filter((f) => f.startsWith("dist-"))).toEqual([]);
    }, 60000);

    step("a code-only change skips npm ci, the registration and pm2 update", () => {
        const { out, calls: c } = run(["main"], { DEPLOY_SHA: sha.c2, PREBUILT_DIST: prebuilt(sha.c2, "two") });
        expect(c.some((l) => l.startsWith("npm ci"))).toBe(false);
        expect(has(c, "node scripts/register-commands.js --print-hash")).toBe(true);
        expect(has(c, "node scripts/register-commands.js")).toBe(false);
        expect(has(c, "pm2 update")).toBe(false);
        expect(has(c, "pm2 restart pulsebot --update-env")).toBe(true);
        expect(out).toMatch(/no npm ci/);
        expect(out).toMatch(/not registering/);
        expect(out).toMatch(/no pm2 update/);
        expect(state().DEPLOYED_COMMIT).toBe(sha.c2);
    }, 60000);

    step("a deploy whose commit is older than the live one does nothing", () => {
        const build = prebuilt(sha.c1, "late");
        const { out, calls: c } = run(["main"], { DEPLOY_SHA: sha.c1, PREBUILT_DIST: build });
        expect(out).toMatch(/already contains/);
        expect(c.some((l) => l.startsWith("pm2"))).toBe(false);
        expect(git(app, "rev-parse", "HEAD")).toBe(sha.c2);
        expect(fs.existsSync(build)).toBe(false);
        expect(state().DEPLOYED_COMMIT).toBe(sha.c2);
    }, 60000);

    step("a new lock file, new commands and a new Node redo their steps", () => {
        const { calls: c } = run(["main"], {
            DEPLOY_SHA: sha.c3, PREBUILT_DIST: prebuilt(sha.c3, "three"), FAKE_COMMANDS_HASH: "bbb", FAKE_NODE_VERSION: "v22.2.0",
        });
        expect(has(c, "npm ci --omit=dev (app)")).toBe(true);
        expect(has(c, "node scripts/register-commands.js")).toBe(true);
        expect(has(c, "pm2 update")).toBe(true);
        expect(state()).toEqual(expect.objectContaining({ COMMANDS: "bbb", NODE: "v22.2.0", DEPLOYED_COMMIT: sha.c3 }));
    }, 60000);

    step("a failed registration is retried on the next deploy", () => {
        const env = { FAKE_COMMANDS_HASH: "ccc", FAKE_NODE_VERSION: "v22.2.0" };
        const first = run(["main"], { ...env, DEPLOY_SHA: sha.c3, PREBUILT_DIST: prebuilt(sha.c3, "four"), FAKE_REGISTER_FAIL: "1" });
        expect(first.out).toMatch(/WARNING: Command registration failed/);
        expect(state().COMMANDS).toBe("bbb");
        const second = run(["main"], { ...env, DEPLOY_SHA: sha.c3, PREBUILT_DIST: prebuilt(sha.c3, "five") });
        expect(has(second.calls, "node scripts/register-commands.js")).toBe(true);
        expect(state().COMMANDS).toBe("ccc");
    }, 60000);

    step("without a CI build it builds on the server at low priority, never into the live dist", () => {
        const { out, calls: c } = run(["main"], { FAKE_COMMANDS_HASH: "ccc", FAKE_NODE_VERSION: "v22.2.0" });
        expect(out).toMatch(/WARNING: no prebuilt web client/);
        expect(has(c, "npm ci (web-client)")).toBe(true);
        const build = c.find((l) => l.startsWith("npm run build -- --outDir"));
        expect(build).toMatch(/--outDir \S*\/\.deploy\/build-[0-9a-f]{12} --emptyOutDir \(web-client\)$/);
        expect(fs.readFileSync(path.join(app, "src", "web-client", "dist", "index.html"), "utf8").trim()).toBe("built");
        expect(fs.readdirSync(path.join(app, ".deploy")).filter((f) => f.startsWith("build-"))).toEqual([]);
    }, 60000);

    step("--force redoes every step", () => {
        const { out, calls: c } = run(["main", "--force"], {
            DEPLOY_SHA: sha.c3, PREBUILT_DIST: prebuilt(sha.c3, "six"), FAKE_COMMANDS_HASH: "ccc", FAKE_NODE_VERSION: "v22.2.0",
        });
        expect(out).toMatch(/Forced steps: all/);
        expect(has(c, "npm ci --omit=dev (app)")).toBe(true);
        expect(has(c, "node scripts/register-commands.js")).toBe(true);
        expect(has(c, "pm2 update")).toBe(true);
        // "build" is forced too: the server builds although a CI build came along
        expect(has(c, "npm ci (web-client)")).toBe(true);
    }, 60000);
});

describe("deploy.sh skips what is unchanged", () => {
    const deploy = read("deploy.sh");

    it("keys npm ci on the lock file and the Node ABI, and installs at low priority", () => {
        expect(deploy).toMatch(/DEPS_KEY="\$\(file_hash package-lock\.json\)-abi\$\(node -p 'process\.versions\.modules'\)"/);
        expect(deploy).toMatch(/low_prio npm ci --omit=dev/);
        expect(deploy).toMatch(/\[ ! -d node_modules \]/);
    });

    it("uses an installed Node of the .nvmrc line instead of asking nvm for the newest", () => {
        const use = deploy.indexOf("nvm use --silent");
        expect(use).toBeGreaterThan(-1);
        expect(use).toBeLessThan(deploy.indexOf("nvm install --reinstall-packages-from=current"));
    });

    it("runs pm2 update only when the Node version changed", () => {
        expect(deploy).toMatch(/if is_forced pm2 \|\| \[ "\$LAST_NODE" != "\$NODE_VERSION" \]; then/);
    });

    it("lowers the priority of the fallback build and warns about it", () => {
        expect(deploy).toMatch(/nice -n 19 ionice -c3/);
        expect(deploy).toMatch(/low_prio npm run build -- --outDir "\$out" --emptyOutDir/);
    });

    it("records the deployed commit only after the health check passed", () => {
        expect(deploy.indexOf("state_set DEPLOYED_COMMIT")).toBeGreaterThan(deploy.indexOf("if [ \"$HEALTHY\" -ne 1 ]"));
    });
});

describe("ecosystem.config.js", () => {
    const [app] = require(path.join(root, "ecosystem.config.js")).apps;

    it("runs production unless told otherwise", () => {
        expect(app.env.NODE_ENV).toBe("production");
        expect(app.env_production.NODE_ENV).toBe("production");
        expect(app.env_development.NODE_ENV).toBe("development");
    });

    it("gives the bot at least 512M before pm2 restarts it", () => {
        const mb = Number(String(app.max_memory_restart).match(/^(\d+)M$/)?.[1]);
        expect(mb).toBeGreaterThanOrEqual(512);
    });
});

describe("Dockerfile", () => {
    const docker = read("Dockerfile");

    it("builds the web client in its own stage and ships only dist/", () => {
        expect(docker).toMatch(/^FROM node:\d+-alpine AS client$/m);
        expect(docker).toMatch(/npm run build/);
        expect(docker).toMatch(/COPY --from=client \/app\/src\/web-client\/dist \.\/src\/web-client\/dist/);
    });

    it("copies what the bot reads at runtime", () => {
        for (const dir of ["src", "assets", "scripts"]) {
            expect(docker).toMatch(new RegExp(`^COPY ${dir}/ \\./${dir}/$`, "m"));
        }
        // The client imports the shared menu list from outside its folder.
        expect(docker).toMatch(/COPY src\/config\/menu\.json/);
    });

    it("installs only production dependencies in the runtime stage", () => {
        const runtime = docker.slice(docker.indexOf("AS runtime"));
        expect(runtime).toMatch(/npm ci --omit=dev/);
    });

    it("passes the commit in, keeps data on a volume and checks /health", () => {
        expect(docker).toMatch(/^ARG GIT_COMMIT/m);
        expect(docker).toMatch(/^ENV GIT_COMMIT=\$GIT_COMMIT$/m);
        expect(docker).toMatch(/^VOLUME \/app\/data$/m);
        expect(docker).toMatch(/HEALTHCHECK[\s\S]*\$\{WEB_PORT\}\/health/);
        expect(docker).toMatch(/^USER node$/m);
    });
});

describe(".dockerignore", () => {
    const lines = read(".dockerignore").split(/\r?\n/).map((l) => l.trim());

    it("keeps every env file with secrets out of the build context", () => {
        expect(lines).toContain(".env*");
        expect(lines).toContain("!.env.example");
        expect(lines).toContain("*.bak");
    });

    it("leaves out nested node_modules, local data and what the image never needs", () => {
        for (const entry of ["**/node_modules", "data/", "coverage/", "test/", "scripts/data-sources/", "docs/", "bin/", "src/web-client/dist", ".claude/", ".github/"]) {
            expect(lines).toContain(entry);
        }
    });
});

describe("CI workflow (#414)", () => {
    // Line endings depend on core.autocrlf; the checks below read LF.
    const ci = read(".github/workflows/ci.yml").replace(/\r\n/g, "\n");
    // The body of one job: from its key up to the next top-level job key.
    const job = (name) => {
        const start = ci.indexOf(`\n  ${name}:\n`);
        expect(start).toBeGreaterThan(-1);
        const rest = ci.slice(start + 1);
        const next = rest.slice(1).search(/\n {2}[A-Za-z][\w-]*:\n/);
        return next === -1 ? rest : rest.slice(0, next + 1);
    };

    it("runs on pushes to main only, no longer on dev", () => {
        expect(ci).toMatch(/push:\n\s+branches: \[main\]/);
        expect(ci).not.toMatch(/branches: \[[^\]]*\bdev\b/);
    });

    it("lints, tests, type-checks and builds the web client in its own directory", () => {
        const web = job("web-client");
        expect(web).toMatch(/working-directory: src\/web-client/);
        expect(web).toMatch(/cache-dependency-path: src\/web-client\/package-lock\.json/);
        expect(web).toContain("node-version-file: \".nvmrc\"");
        const steps = ["npm ci", "npm run lint -- --max-warnings=", "npm run lint:css", "npm test", "npx tsc -b", "npm run build"];
        const at = steps.map((s) => web.indexOf(`run: ${s}`));
        for (const i of at) expect(i).toBeGreaterThan(-1);
        expect(at).toEqual([...at].sort((a, b) => a - b));
        // the client tests load backend twins (test/backend.ts): the backend's runtime deps come first
        expect(web).toMatch(/working-directory: \.\n\s+run: npm ci --omit=dev/);
        expect(web.indexOf("run: npm ci --omit=dev")).toBeLessThan(web.indexOf("run: npm test"));
    });

    it("never lets the client's warning budget grow", () => {
        // A ratchet (30 warnings at #414, 18 after #415): lower it, never raise it.
        const budget = Number(job("web-client").match(/--max-warnings=(\d+)/)[1]);
        expect(budget).toBeLessThanOrEqual(18);
    });

    it("can be paused with DEPLOY_PAUSED and still deploys on a manual run", () => {
        // Many merges in a row: pause the per-merge deploy and bring the
        // server up to date once at the end (docs/deployment.md).
        expect(ci).toMatch(/^on:\n(?:.*\n)*?\s+workflow_dispatch:\n/m);
        const condition = job("deploy").match(/\n {4}if: >-\n((?: {6}.*\n)+)/);
        expect(condition).not.toBeNull();
        const text = condition[1].replace(/\s+/g, " ");
        expect(text).toContain("github.ref == 'refs/heads/main'");
        expect(text).toContain("github.event_name == 'workflow_dispatch'");
        expect(text).toContain("github.event_name == 'push' && vars.DEPLOY_PAUSED != '1'");
    });

    it("deploys only after lint, tests and the web client passed", () => {
        const needs = job("deploy").match(/needs: \[([^\]]*)\]/);
        expect(needs).not.toBeNull();
        expect(needs[1].split(",").map((s) => s.trim()).sort()).toEqual(["lint", "test", "web-client"]);
    });

    it("runs deploys one after another and never cancels a running one", () => {
        // Three overlapping deploys crash-looped the bot on the server (see the
        // comment in ci.yml): each ran git reset + npm ci while another one was
        // restarting pm2. A concurrency group serialises them; GitHub keeps one
        // waiting deploy (the newest), which is why each deploy pins its commit.
        expect(job("deploy")).toMatch(/concurrency:\n\s+group: deploy-production\n\s+cancel-in-progress: false/);
    });

    it("gives the SSH script more than the action's 10-minute default", () => {
        // The web client build took 4-5 min on the server; the default once cut
        // the script off in the middle of it. DEPLOY_FORCE=build still does.
        const minutes = job("deploy").match(/command_timeout: (\d+)m/);
        expect(minutes).not.toBeNull();
        expect(Number(minutes[1])).toBeGreaterThanOrEqual(20);
    });

    // The server (1 vCPU, 921 MB) swapped for 9-12 minutes building the client
    // on every deploy; the build from the web-client job is shipped instead.
    it("keeps the client build of a main run as an artifact, not of a PR", () => {
        const web = job("web-client");
        const upload = web.slice(web.indexOf("uses: actions/upload-artifact@"));
        expect(web.indexOf("uses: actions/upload-artifact@v")).toBeGreaterThan(web.indexOf("run: npm run build"));
        expect(web).toMatch(/if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'\n\s+uses: actions\/upload-artifact@v\d+\n/);
        expect(upload).toMatch(/name: web-client-dist\n/);
        expect(upload).toMatch(/path: src\/web-client\/dist\/\n/);
        expect(upload).toMatch(/if-no-files-found: error/);
    });

    it("ships that build and deploys exactly the commit it was built from", () => {
        const deploy = job("deploy");
        expect(deploy).toMatch(/DEPLOY_SHA: \$\{\{ github\.sha \}\}/);
        const download = deploy.indexOf("uses: actions/download-artifact@v");
        const copy = deploy.indexOf("tar -C web-client-dist -czf - .");
        const run = deploy.indexOf("uses: appleboy/ssh-action@");
        expect(download).toBeGreaterThan(-1);
        expect(deploy.slice(download)).toMatch(/name: web-client-dist\n\s+path: web-client-dist\n/);
        expect(copy).toBeGreaterThan(download);
        expect(run).toBeGreaterThan(copy);
        // staged under .part until complete, then renamed
        expect(deploy).toContain("mv '$target.part' '$target'");
        expect(deploy).toMatch(/target="\$DEPLOY_DIR\/\.deploy\/dist-\$DEPLOY_SHA"/);
        expect(deploy).toMatch(/envs: DEPLOY_DIR,DEPLOY_SHA,DEPLOY_FORCE\n/);
        // the deploy.sh of the deployed commit, with the staged build
        expect(deploy).toContain("git show \"$DEPLOY_SHA:deploy.sh\" > \".deploy/deploy-$DEPLOY_SHA.sh\"");
        expect(deploy).toContain("PREBUILT_DIST=\"$DEPLOY_DIR/.deploy/dist-$DEPLOY_SHA\" bash \".deploy/deploy-$DEPLOY_SHA.sh\" main");
    });

    it("refuses a DEPLOY_DIR that could break the quoted remote commands", () => {
        expect(job("deploy")).toContain("if [[ ! \"$DEPLOY_DIR\" =~ ^/[A-Za-z0-9._/-]+$ ]]; then");
    });

    it("offers the forced steps of deploy.sh on a manual run", () => {
        const options = ci.match(/workflow_dispatch:\n\s+inputs:\n\s+force:\n(?:.*\n)*?\s+options: \[([^\]]*)\]/);
        expect(options).not.toBeNull();
        const list = options[1].split(",").map((s) => s.trim());
        expect(list[0]).toBe("none");
        const deploy = read("deploy.sh");
        for (const step of list.slice(1)) {
            if (step !== "all") expect(deploy).toContain(`is_forced ${step}`);
        }
        expect(job("deploy")).toContain("DEPLOY_FORCE: ${{ inputs.force != 'none' && inputs.force || '' }}");
    });

    it("keeps the deploy state and staging out of git and the Docker context", () => {
        const ignore = (file) => read(file).split(/\r?\n/).map((l) => l.trim());
        expect(ignore(".gitignore")).toContain(".deploy/");
        expect(ignore(".dockerignore")).toContain(".deploy/");
        expect(ignore("src/web-client/.gitignore")).toEqual(expect.arrayContaining(["dist", "dist.next", "dist.old"]));
    });

    it("runs the tests with coverage", () => {
        expect(job("test")).toContain("run: npm run test:coverage");
    });

    it("audits the runtime dependencies of the bot and the client", () => {
        expect(job("lint")).toContain("npm audit --omit=dev --audit-level=");
        expect(job("web-client")).toContain("npm audit --omit=dev --audit-level=");
    });

    it("keeps dependencies current through Dependabot", () => {
        const bot = read(".github/dependabot.yml").replace(/\r\n/g, "\n");
        for (const dir of ["\"/\"", "\"/src/web-client\""]) expect(bot).toContain(`directory: ${dir}`);
        expect(bot).toMatch(/package-ecosystem: "github-actions"/);
        expect(bot.match(/interval: "monthly"/g)).toHaveLength(3);
        expect(bot).not.toMatch(/interval: "weekly"/);
    });

    it("bundles Dependabot updates so a run opens few PRs", () => {
        const bot = read(".github/dependabot.yml").replace(/\r\n/g, "\n");
        expect(bot.match(/open-pull-requests-limit: 3/g)).toHaveLength(3);
        expect(bot.match(/minor-and-patch:\n\s+update-types: \["minor", "patch"\]/g)).toHaveLength(3);
        expect(bot.match(/majors:\n\s+update-types: \["major"\]/g)).toHaveLength(3);
    });

    it("leaves TypeScript and Vite majors in the client to a manual migration", () => {
        const bot = read(".github/dependabot.yml").replace(/\r\n/g, "\n");
        const client = bot.slice(bot.indexOf("directory: \"/src/web-client\""), bot.indexOf("package-ecosystem: \"github-actions\""));
        for (const name of ["typescript", "vite"]) {
            expect(client).toContain(`dependency-name: "${name}"\n        update-types: ["version-update:semver-major"]`);
        }
    });

    it("gives the web client the same Node requirement as the bot", () => {
        const client = JSON.parse(read("src/web-client/package.json"));
        expect(client.engines?.node).toBe(`>=${requiredMajor}`);
    });
});
