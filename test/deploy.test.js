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

    it("lints, type-checks and builds the web client in its own directory", () => {
        const web = job("web-client");
        expect(web).toMatch(/working-directory: src\/web-client/);
        expect(web).toMatch(/cache-dependency-path: src\/web-client\/package-lock\.json/);
        expect(web).toContain("node-version-file: \".nvmrc\"");
        const steps = ["npm ci", "npm run lint -- --max-warnings=", "npx tsc -b", "npm run build"];
        const at = steps.map((s) => web.indexOf(`run: ${s}`));
        for (const i of at) expect(i).toBeGreaterThan(-1);
        expect(at).toEqual([...at].sort((a, b) => a - b));
    });

    it("never lets the client's warning budget grow", () => {
        // A ratchet from the 30 warnings at the time of #414: lower it, never raise it.
        const budget = Number(job("web-client").match(/--max-warnings=(\d+)/)[1]);
        expect(budget).toBeLessThanOrEqual(30);
    });

    it("deploys only after lint, tests and the web client passed", () => {
        const needs = job("deploy").match(/needs: \[([^\]]*)\]/);
        expect(needs).not.toBeNull();
        expect(needs[1].split(",").map((s) => s.trim()).sort()).toEqual(["lint", "test", "web-client"]);
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
