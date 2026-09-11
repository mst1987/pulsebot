const fs = require("fs");
const os = require("os");
const path = require("path");

const { run, lintTarget, eslintBin } = require("../../.claude/hooks/lintChanged");

describe("lintChanged hook", () => {
    const projectDir = path.resolve("D:/proj");
    const p = (...parts) => path.join(projectDir, ...parts);

    describe("lintTarget", () => {
        it("lints bot sources, tests and the hooks with the root config", () => {
            expect(lintTarget(p("src", "utils", "date.js"), projectDir)).toEqual({ cwd: projectDir, file: p("src", "utils", "date.js") });
            expect(lintTarget(p("test", "utils", "date.test.js"), projectDir).cwd).toBe(projectDir);
            expect(lintTarget(p(".claude", "hooks", "lintChanged.js"), projectDir).cwd).toBe(projectDir);
            expect(lintTarget(p("jest.config.js"), projectDir).cwd).toBe(projectDir);
        });

        it("lints the React client from its own directory", () => {
            const t = lintTarget(p("src", "web-client", "src", "App.tsx"), projectDir);
            expect(t).toEqual({ cwd: p("src", "web-client"), file: p("src", "web-client", "src", "App.tsx") });
            expect(lintTarget(p("src", "web-client", "vite.config.ts"), projectDir).cwd).toBe(p("src", "web-client"));
        });

        it("skips build output, dependencies and non-code files", () => {
            expect(lintTarget(p("src", "web-client", "dist", "index.js"), projectDir)).toBeNull();
            expect(lintTarget(p("src", "web-client", "node_modules", "x", "index.js"), projectDir)).toBeNull();
            expect(lintTarget(p("src", "web-client", "index.html"), projectDir)).toBeNull();
            expect(lintTarget(p("CLAUDE.md"), projectDir)).toBeNull();
            expect(lintTarget(p("data", "reports", "x.json"), projectDir)).toBeNull();
            expect(lintTarget(p(".claude", "settings.json"), projectDir)).toBeNull();
            expect(lintTarget(p("scripts", "fetch-tbc-loot.js"), projectDir)).toBeNull();
        });

        it("skips files outside the project and empty input", () => {
            expect(lintTarget(path.resolve("D:/elsewhere/src/a.js"), projectDir)).toBeNull();
            expect(lintTarget(null, projectDir)).toBeNull();
            expect(lintTarget("", projectDir)).toBeNull();
        });
    });

    describe("run", () => {
        let tmp;

        beforeEach(() => {
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eh-lint-"));
            fs.mkdirSync(path.join(tmp, "src"));
            fs.writeFileSync(path.join(tmp, "src", "a.js"), "module.exports = 1;\n");
        });

        afterEach(() => {
            fs.rmSync(tmp, { recursive: true, force: true });
        });

        const edit = (file) => ({ tool_name: "Write", tool_input: { file_path: file } });

        it("passes a clean file through silently", () => {
            const spawn = jest.fn(() => ({ status: 0, stdout: "", stderr: "" }));
            const resolveBin = () => "/eslint.js";
            const r = run(edit(path.join(tmp, "src", "a.js")), { projectDir: tmp, spawn, resolveBin });
            expect(r).toEqual({ status: 0, output: "" });
            expect(spawn).toHaveBeenCalledTimes(1);
            const [cmd, args, opts] = spawn.mock.calls[0];
            expect(cmd).toBe(process.execPath);
            expect(args).toEqual(["/eslint.js", "--no-warn-ignored", "--", path.join(tmp, "src", "a.js")]);
            expect(opts.cwd).toBe(tmp);
        });

        it("reports ESLint problems with exit code 2", () => {
            const spawn = () => ({ status: 1, stdout: "1:7 error Strings must use doublequote", stderr: "" });
            const r = run(edit(path.join(tmp, "src", "a.js")), { projectDir: tmp, spawn, resolveBin: () => "/eslint.js" });
            expect(r.status).toBe(2);
            expect(r.output).toMatch(/ESLint reports problems in src[\\/]a\.js/);
            expect(r.output).toMatch(/doublequote/);
        });

        it("stays quiet when ESLint is not installed", () => {
            const spawn = jest.fn();
            const r = run(edit(path.join(tmp, "src", "a.js")), { projectDir: tmp, spawn, resolveBin: () => null });
            expect(r).toEqual({ status: 0, output: "" });
            expect(spawn).not.toHaveBeenCalled();
        });

        it("stays quiet when ESLint cannot be started", () => {
            const spawn = () => ({ error: new Error("ENOENT"), status: null });
            const r = run(edit(path.join(tmp, "src", "a.js")), { projectDir: tmp, spawn, resolveBin: () => "/eslint.js" });
            expect(r).toEqual({ status: 0, output: "" });
        });

        it("skips non-targets and files that no longer exist", () => {
            const spawn = jest.fn();
            expect(run(edit(path.join(tmp, "README.md")), { projectDir: tmp, spawn, resolveBin: () => "/e" }).status).toBe(0);
            expect(run(edit(path.join(tmp, "src", "gone.js")), { projectDir: tmp, spawn, resolveBin: () => "/e" }).status).toBe(0);
            expect(run({ tool_input: { command: "ls" } }, { projectDir: tmp, spawn, resolveBin: () => "/e" }).status).toBe(0);
            expect(spawn).not.toHaveBeenCalled();
        });
    });

    describe("eslintBin", () => {
        it("finds the ESLint CLI of this project", () => {
            const bin = eslintBin(path.resolve(__dirname, "../.."));
            expect(bin).toMatch(/eslint[\\/]bin[\\/]eslint\.js$/);
        });

        it("returns null where no ESLint is installed", () => {
            expect(eslintBin(os.tmpdir())).toBeNull();
        });
    });
});
