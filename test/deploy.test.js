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
            expect(docker).toMatch(new RegExp(`^COPY ${dir}/ \./${dir}/$`, "m"));
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
        for (const entry of ["**/node_modules", "data/", "coverage/", "test/", "reference/", "docs/", "bin/", "src/web-client/dist", ".claude/", ".github/"]) {
            expect(lines).toContain(entry);
        }
    });
});
