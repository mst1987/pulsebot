// scripts/check-main-clean.js and the Stop hook built on it (#315): what
// dirties the primary checkout, and that only git's own ignore rules excuse a
// file there (#416).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { makeRepo, removeRepo, git } = require("../helpers/tempRepo");
const check = require("../../scripts/check-main-clean");
const stopHook = require("../../.claude/hooks/mainCheckoutClean");
const { OVERRIDE_ENV } = require("../../.claude/hooks/guardMainCheckout");

const SCRIPT = path.resolve(__dirname, "../../scripts/check-main-clean.js");

describe("scripts/check-main-clean", () => {
    let repo;

    beforeEach(() => {
        repo = makeRepo();
    });

    afterEach(() => removeRepo(repo));

    const write = (file, text = "x\n") => {
        const abs = path.join(repo.main, file);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text);
    };
    const files = (cwd = repo.main) => check.findings({ cwd }).entries.map((e) => `${e.label} ${e.file}`);

    it("says nothing about a clean primary checkout", () => {
        expect(check.findings({ cwd: repo.main })).toEqual({ main: repo.main, entries: [] });
        expect(check.format(check.findings({ cwd: repo.main }))).toEqual([]);
    });

    it("finds an untracked file, also when run from a linked worktree", () => {
        write("test/commands/signup/eventButton.test.js", "");
        expect(files()).toEqual(["untracked test/commands/signup/eventButton.test.js"]);
        // The whole point: an agent works in ../eventhelper-<name> and must still see it.
        expect(files(repo.linked)).toEqual(["untracked test/commands/signup/eventButton.test.js"]);
        expect(check.findings({ cwd: repo.linked }).main).toBe(repo.main);
    });

    it("finds a changed, a staged and a deleted file", () => {
        write("a.js", "module.exports = 9;\n");
        write("src/new.js");
        git(["add", "src/new.js"], repo.main);
        fs.rmSync(path.join(repo.main, "src", "web.js"));
        expect(files().sort()).toEqual(["added src/new.js", "deleted src/web.js", "modified a.js"]);
    });

    it("reports a path with spaces and umlauts exactly as it is", () => {
        write("src/ein Modul ö.js");
        expect(files()).toEqual(["untracked src/ein Modul ö.js"]);
    });

    it("leaves a linked worktree's own changes alone", () => {
        fs.writeFileSync(path.join(repo.linked, "a.js"), "changed\n");
        fs.writeFileSync(path.join(repo.linked, "brandnew.js"), "x\n");
        expect(files(repo.linked)).toEqual([]);
    });

    it("leaves out whatever .gitignore covers", () => {
        // makeRepo's .gitignore holds .env.dev and data/ - the repository's own
        // rules decide, not a list of names in the script.
        write(".env.dev");
        fs.mkdirSync(path.join(repo.main, "data", "settings"), { recursive: true });
        write("data/settings/events.json", "{}");
        expect(files()).toEqual([]);
    });

    it("reports the stray files it used to excuse by name", () => {
        const stray = [
            "nodemon", // a mistyped `npm run dev`
            "tbc-guild-simulator-backend@0.1.0", // a mistyped `npm install`
            ".env.dev.bak", // not covered by this repository's .gitignore
            "src/.env.js",
        ];
        for (const f of stray) write(f);
        expect(check.findings({ cwd: repo.main }).entries.map((e) => e.file).sort()).toEqual(stray.slice().sort());
    });

    it("follows the ignore rules of the repository it looks at", () => {
        removeRepo(repo);
        repo = makeRepo({ ignore: ".env.*\n!.env.example\n*.bak\ncoverage/\n" });
        for (const f of [".env.dev", ".env.dev.bak", "coverage/lcov.info"]) write(f);
        expect(files()).toEqual([]);
        write(".env.example");
        expect(files()).toEqual(["untracked .env.example"]);
    });

    it("still reports a tracked file under an ignore rule once it changes", () => {
        fs.appendFileSync(path.join(repo.main, ".git", "info", "exclude"), "a.js\n");
        write("a.js", "changed\n");
        expect(files()).toEqual(["modified a.js"]);
    });

    it("keeps quiet when git is not there or answers nothing", () => {
        const gitFn = () => { throw new Error("git: not found"); };
        expect(check.findings({ cwd: repo.main, gitFn })).toEqual({ main: "", entries: [] });
        expect(check.mainWorktree(repo.main, gitFn)).toBe("");
    });

    it("parses git's NUL format including a rename", () => {
        const raw = "R  new.js\0old.js\0?? stray.js\0 M src/web.js\0";
        expect(check.parseStatus(raw)).toEqual([
            { code: "R ", file: "new.js" },
            { code: "??", file: "stray.js" },
            { code: " M", file: "src/web.js" },
        ]);
        expect(check.label("R ")).toBe("renamed");
        expect(check.label("??")).toBe("untracked");
        expect(check.label(" M")).toBe("modified");
        expect(check.label("XY")).toBe("changed");
    });

    it("prints one line per find and exits 1", () => {
        write("stray.js");
        write("src/other.js");
        const lines = [];
        expect(check.main({ cwd: repo.main, log: (l) => lines.push(l) })).toBe(1);
        expect(lines[0]).toContain(repo.main);
        expect(lines.filter((l) => l.startsWith("  "))).toEqual(["  untracked  src/other.js", "  untracked  stray.js"]);
        expect(lines.join("\n")).toMatch(/git worktree add/);
    });

    it("exits 0 and says nothing when everything is clean", () => {
        const lines = [];
        expect(check.main({ cwd: repo.main, log: (l) => lines.push(l) })).toBe(0);
        expect(lines).toEqual([]);
    });

    it("runs as a process: exit 1 with the report on stdout", () => {
        write("stray.js");
        let status = 0;
        let stdout;
        try {
            stdout = execFileSync(process.execPath, [SCRIPT, repo.main], { encoding: "utf8" });
        } catch (err) {
            status = err.status;
            stdout = String(err.stdout);
        }
        expect(status).toBe(1);
        expect(stdout).toMatch(/untracked {2}stray\.js/);
    });
});

describe("mainCheckoutClean stop hook", () => {
    const dirty = { main: "D:/repo", entries: [{ code: "??", file: "stray.js", label: "untracked" }] };
    const clean = { main: "D:/repo", entries: [] };

    it("blocks the stop while the primary checkout is dirty", () => {
        const v = stopHook.decide({}, { env: {}, findings: () => dirty });
        expect(v.block).toBe(true);
        expect(v.message).toMatch(/untracked {2}stray\.js/);
    });

    it("lets a clean stop through", () => {
        expect(stopHook.decide({}, { env: {}, findings: () => clean })).toEqual({ block: false, message: "" });
    });

    it("never loops: the second round is let through", () => {
        const v = stopHook.decide({ stop_hook_active: true }, { env: {}, findings: () => dirty });
        expect(v.block).toBe(false);
    });

    it("honours the override and survives a check that throws", () => {
        expect(stopHook.decide({}, { env: { [OVERRIDE_ENV]: "1" }, findings: () => dirty }).block).toBe(false);
        expect(stopHook.decide({}, { env: {}, findings: () => { throw new Error("no git"); } }).block).toBe(false);
    });
});
