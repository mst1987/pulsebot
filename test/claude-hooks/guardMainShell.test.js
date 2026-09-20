// The Bash/PowerShell prefilter (#315). Two halves matter equally: it must
// catch the ways a shell wrote into the primary checkout (a redirection with a
// relative path, [IO.File]::WriteAllText), and it must stay silent for
// everything else — a guard that cries wolf gets switched off.
const path = require("path");
const { execFileSync } = require("child_process");

const { makeRepo, removeRepo } = require("../helpers/tempRepo");
const { decide, writeTargets, rawTargets, resolveTarget, stripHeredocs } = require("../../.claude/hooks/guardMainShell");
const { OVERRIDE_ENV } = require("../../.claude/hooks/guardMainCheckout");

// Built while the suite is collected: the table of commands below names paths
// inside it, and a describe body runs before beforeAll does.
const repo = makeRepo();

describe("guardMainShell hook", () => {
    afterAll(() => removeRepo(repo));

    // The worst case: the session sits in the primary checkout, so a relative
    // path lands there.
    const bash = (command, opts = {}) => decide(
        { tool_name: "Bash", tool_input: { command } },
        { env: {}, cwd: repo.main, projectDir: repo.main, win32: false, ...opts },
    );
    const inMain = (rel) => path.join(repo.main, rel);

    describe("blocks a write into the primary checkout", () => {
        const blocked = {
            "a redirection with a relative path": "echo \"\" > test/commands/signup/eventButton.test.js",
            "an append": "printf 'x' >> src/web.js",
            "a redirection with an absolute path": `node build.js > ${inMain("src/out.js")}`,
            "a PowerShell redirection": `Get-Content a.js | Out-File -FilePath ${inMain("src/copy.js")}`,
            "Set-Content": `Set-Content -Path ${inMain("src/copy.js")} -Value ""`,
            "Out-File with a positional path after a parameter": `"x" | Out-File -Encoding utf8 ${inMain("src/copy.js")}`,
            "New-Item": `New-Item -ItemType File ${inMain("src/copy.js")}`,
            "Add-Content with a relative path": "Add-Content -Path src/web.js -Value x",
            "[IO.File]::WriteAllText": `[IO.File]::WriteAllText("${inMain("SetupEditor.tsx").replace(/\\/g, "/")}", "")`,
            "[System.IO.File]::AppendAllText": `[System.IO.File]::AppendAllText('${inMain("a.js").replace(/\\/g, "/")}', "x")`,
            "a target in the middle of a pipeline": "cat a.js | tee src/copy.js | wc -l",
            "a heredoc, whose opening line carries the target": "cat > src/copy.js <<'EOF'\n<div>hi</div>\nEOF",
        };
        for (const [what, command] of Object.entries(blocked)) {
            it(what, () => {
                const v = bash(command);
                expect(v.allow).toBe(false);
                expect(v.reason).toMatch(/primary checkout/);
                expect(v.reason).toMatch(/git worktree add/);
            });
        }
    });

    describe("keeps quiet for everything else", () => {
        const allowed = {
            "a plain command": "ls -la",
            "a git command naming the checkout": `git -C ${repo.main} status --porcelain`,
            "a test run": "npm test",
            "a discarded output": "npm test > /dev/null",
            "a descriptor duplication": "npx jest 2>&1 | tail -40",
            "a redirection into the null device on Windows": "npm run lint > NUL",
            "a > inside double quotes": "echo \"a > b.js\"",
            "a > inside single quotes": "awk '{ print > \"a.js\" }' input",
            "a cmdlet name inside quotes": "grep -rn \"Set-Content\" src/",
            "an arithmetic comparison": "if (( count > limit )); then echo a.js; fi",
            "a string comparison": "[[ \"$a\" > \"$b\" ]] && echo a.js",
            "a heredoc whose body has tags": "cat <<'EOF' > /tmp/x.tsx\n<div>a.js</div>\nEOF",
            "a target behind a variable": "echo x > $TMPDIR/a.js",
            "a target behind a Windows variable": "echo x > %TEMP%\\a.js",
            "a glob": "cat parts/* > merged-*.js",
            "a format string with a percent": "git log --format=%h>%s",
            "a write outside the repository": "npm test > /tmp/run.log",
            "a write into a linked worktree": `npm test > ${path.join(repo.linked, "run.log")}`,
            "a git-ignored file": "printf x > .env.dev",
            "a git-ignored directory": "echo {} > data/settings/events.json",
            "a relative target after the command moved itself": `cd ${repo.linked} && npm test > out.log`,
            "a relative target after a Set-Location": "Set-Location D:\\somewhere; npx jest > out.log",
            "a PowerShell switch that takes no value": "Get-Content a.js | Set-Content -Force -NoNewline /tmp/a.js",
            "a command without a command string": "",
        };
        for (const [what, command] of Object.entries(allowed)) {
            it(what, () => {
                expect(bash(command)).toEqual({ allow: true });
            });
        }

        it("the real commands of a working session", () => {
            const session = [
                "cd /d/programming/eventhelper-guardfix && npm ci",
                "git -C /d/programming/eventhelper worktree add /d/programming/eventhelper-x -b feature/x origin/main",
                "npx jest test/claude-hooks --detectOpenHandles",
                "gh issue view 315 --repo mst1987/pulsebot",
                "gh pr create --body-file C:\\Temp\\body.md",
                "grep -rn \"tmpdir()\" test/ --include=*.js",
                "node -e \"console.log(require('./package.json').version)\"",
                "npm run lint",
                "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 3010 }",
                "1..5 | ForEach-Object { npx jest 2>&1 | Select-String -Pattern \"^Tests:\" }",
            ];
            for (const command of session) expect(bash(command)).toEqual({ allow: true });
        });
    });

    it("lets a write into the primary checkout through with the override set", () => {
        expect(bash("echo x > src/web.js", { env: { [OVERRIDE_ENV]: "1" } })).toEqual({ allow: true });
    });

    it("judges a relative target against the session's directory", () => {
        // The same command from a worktree writes into the worktree: allowed.
        expect(decide(
            { tool_name: "Bash", tool_input: { command: "echo x > src/web.js" } },
            { env: {}, cwd: repo.linked, projectDir: repo.linked, win32: false },
        )).toEqual({ allow: true });
    });

    it("reads a Git-Bash path as the Windows path it is", () => {
        const abs = resolveTarget("/d/programming/eventhelper/x.js", { cwd: "C:\\tmp", win32: true, relativeOk: true });
        expect(abs.replace(/\\/g, "/")).toContain("d:/programming/eventhelper/x.js");
        expect(resolveTarget("/dev/null", { cwd: "C:\\tmp", win32: true, relativeOk: true })).toBe("");
        expect(resolveTarget("$HOME/x.js", { cwd: "/tmp", win32: false, relativeOk: true })).toBe("");
        expect(resolveTarget("&2", { cwd: "/tmp", win32: false, relativeOk: true })).toBe("");
        expect(resolveTarget("rel.js", { cwd: "/tmp", win32: false, relativeOk: false })).toBe("");
    });

    it("reads the targets out of a command", () => {
        expect(rawTargets("a > b.js")).toEqual(["b.js"]);
        expect(rawTargets("a >> b.js 2>&1")).toEqual(["b.js"]);
        expect(rawTargets("Out-File -FilePath x.txt")).toEqual(["x.txt"]);
        expect(rawTargets("tee a.log | grep x > b.log").sort()).toEqual(["a.log", "b.log"]);
        expect(rawTargets("echo 'a > b'")).toEqual([]);
        expect(rawTargets("node x.js")).toEqual([]);
        expect(writeTargets("echo x > out.log", { cwd: "/w", win32: false })).toEqual([path.resolve("/w", "out.log")]);
        expect(writeTargets("echo x > out.log && cd /elsewhere", { cwd: "/w", win32: false })).toEqual([]);
    });

    it("drops a heredoc's body but keeps the line that opens it", () => {
        expect(stripHeredocs("cat > a.js <<'EOF'\n<div>x</div>\nEOF\necho done")).toBe("cat > a.js <<'EOF'echo done");
        expect(rawTargets("cat <<EOF > a.js\n1 > 2\nEOF")).toEqual(["a.js"]);
        expect(rawTargets("cat <<'EOF' > /tmp/a.js\nfoo > bar.js\nEOF")).toEqual(["/tmp/a.js"]);
    });

    it("blocks with exit code 2 when run as a process", () => {
        const script = path.resolve(__dirname, "../../.claude/hooks/guardMainShell.js");
        const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo x > src/web.js" }, cwd: repo.main });
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
        expect(stderr).toMatch(/Shell write refused/);
    });
});
