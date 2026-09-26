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
        // PATH after a version bump.
        expect(deploy).toMatch(/command -v pm2/);
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
        const steps = ["npm ci", "npm run lint -- --max-warnings=", "npm test", "npx tsc -b", "npm run build"];
        const at = steps.map((s) => web.indexOf(`run: ${s}`));
        for (const i of at) expect(i).toBeGreaterThan(-1);
        expect(at).toEqual([...at].sort((a, b) => a - b));
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

    it("runs deploys one after another and never cancels a queued one", () => {
        // Three overlapping deploys crash-looped the bot on the server (see the
        // comment in ci.yml): each ran git reset + npm ci while another one was
        // restarting pm2. A concurrency group serialises them.
        expect(job("deploy")).toMatch(/concurrency:\n\s+group: deploy-production\n\s+cancel-in-progress: false/);
    });

    it("gives the SSH script more than the action's 10-minute default", () => {
        // The web client build alone takes 4-5 min on the server; the default
        // once cut the script off in the middle of it.
        const minutes = job("deploy").match(/command_timeout: (\d+)m/);
        expect(minutes).not.toBeNull();
        expect(Number(minutes[1])).toBeGreaterThanOrEqual(20);
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
        expect(bot.match(/interval: "weekly"/g)).toHaveLength(3);
    });

    it("gives the web client the same Node requirement as the bot", () => {
        const client = JSON.parse(read("src/web-client/package.json"));
        expect(client.engines?.node).toBe(`>=${requiredMajor}`);
    });
});
