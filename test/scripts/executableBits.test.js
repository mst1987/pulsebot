// Every shell script in the repo is checked in as executable (git mode 100755).
// The server runs them directly - deploy.sh from the workflow, offsite.sh as the
// ExecStart of a systemd unit - and a script committed from Windows loses the x
// bit silently: the first nightly backup would have died with "Permission denied".
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function trackedShellScripts() {
    const out = execFileSync("git", ["ls-files", "-s", "--", "*.sh"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").filter(Boolean).map((line) => {
        const [meta, file] = line.split("\t");
        return { mode: meta.split(" ")[0], file };
    }).filter(({ file }) => !file.includes("node_modules/"));
}

describe("shell scripts in git", () => {
    it("finds the scripts the server runs", () => {
        const files = trackedShellScripts().map((s) => s.file);
        expect(files).toEqual(expect.arrayContaining(["deploy.sh", "scripts/backup/offsite.sh"]));
    });

    it("are all executable (100755)", () => {
        const notExecutable = trackedShellScripts().filter((s) => s.mode !== "100755").map((s) => s.file);
        expect(notExecutable).toEqual([]);
    });
});
