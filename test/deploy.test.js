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
