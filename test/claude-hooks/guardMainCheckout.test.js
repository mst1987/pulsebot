const path = require("path");
const { execFileSync } = require("child_process");

const { makeRepo, removeRepo } = require("../helpers/tempRepo");
const { decide, existingDir, targetPath, OVERRIDE_ENV } = require("../../.claude/hooks/guardMainCheckout");

describe("guardMainCheckout hook", () => {
    let repo;
    let other;

    beforeAll(() => {
        repo = makeRepo();
        other = makeRepo(); // an unrelated repository
    });

    afterAll(() => {
        removeRepo(repo);
        removeRepo(other);
    });

    const edit = (file) => ({ tool_name: "Edit", tool_input: { file_path: file } });

    it("refuses an edit inside the primary checkout", () => {
        const v = decide(edit(path.join(repo.main, "a.js")), { projectDir: repo.main, env: {} });
        expect(v.allow).toBe(false);
        expect(v.reason).toMatch(/primary checkout/);
        expect(v.reason).toMatch(/git worktree add/);
    });

    it("refuses a new file in a directory that does not exist yet", () => {
        const v = decide(edit(path.join(repo.main, "src", "new", "deep.js")), { projectDir: repo.main, env: {} });
        expect(v.allow).toBe(false);
    });

    it("refuses the primary checkout even when the session runs in a worktree", () => {
        const v = decide(edit(path.join(repo.main, "a.js")), { projectDir: repo.linked, env: {} });
        expect(v.allow).toBe(false);
    });

    it("allows an edit inside a linked worktree", () => {
        const v = decide(edit(path.join(repo.linked, "a.js")), { projectDir: repo.linked, env: {} });
        expect(v.allow).toBe(true);
    });

    it("allows a git-ignored file in the primary checkout (.env.dev)", () => {
        const v = decide(edit(path.join(repo.main, ".env.dev")), { projectDir: repo.main, env: {} });
        expect(v.allow).toBe(true);
    });

    it("allows a file outside any repository", () => {
        const v = decide(edit(path.join(repo.root, "scratch.js")), { projectDir: repo.main, env: {} });
        expect(v.allow).toBe(true);
    });

    it("allows the main checkout of a different repository", () => {
        const v = decide(edit(path.join(other.main, "a.js")), { projectDir: repo.main, env: {} });
        expect(v.allow).toBe(true);
    });

    it("allows everything with the override variable set", () => {
        const env = { [OVERRIDE_ENV]: "1" };
        const v = decide(edit(path.join(repo.main, "a.js")), { projectDir: repo.main, env });
        expect(v.allow).toBe(true);
    });

    it("ignores tool calls without a file path", () => {
        expect(decide({ tool_name: "Bash", tool_input: { command: "ls" } }, { projectDir: repo.main, env: {} }).allow).toBe(true);
        expect(decide({}, { projectDir: repo.main, env: {} }).allow).toBe(true);
        expect(decide(null, { projectDir: repo.main, env: {} }).allow).toBe(true);
    });

    it("reads notebook_path as well", () => {
        expect(targetPath({ tool_input: { notebook_path: "/x.ipynb" } })).toBe("/x.ipynb");
        expect(targetPath({ tool_input: { file_path: "/y.js" } })).toBe("/y.js");
    });

    it("existingDir walks up to the nearest existing ancestor", () => {
        expect(existingDir(path.join(repo.main, "no", "such", "dir", "f.js"))).toBe(repo.main);
    });

    it("survives a git that fails outright", () => {
        const gitFn = () => { throw new Error("boom"); };
        const v = decide(edit(path.join(repo.main, "a.js")), { projectDir: repo.main, env: {}, gitFn });
        expect(v.allow).toBe(true);
    });

    it("blocks with exit code 2 when run as a process", () => {
        const script = path.resolve(__dirname, "../../.claude/hooks/guardMainCheckout.js");
        const input = JSON.stringify(edit(path.join(repo.main, "a.js")));
        let status = 0;
        let stderr = "";
        try {
            execFileSync(process.execPath, [script], {
                input,
                encoding: "utf8",
                env: { ...process.env, CLAUDE_PROJECT_DIR: repo.main, [OVERRIDE_ENV]: "" },
                stdio: ["pipe", "pipe", "pipe"],
            });
        } catch (err) {
            status = err.status;
            stderr = String(err.stderr);
        }
        expect(status).toBe(2);
        expect(stderr).toMatch(/Edit refused/);
    });
});
