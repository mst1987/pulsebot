const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../helpers/tempStore");
const ov = require("../../scripts/agent-overview");

describe("agent overview - parsers", () => {
    test("parseWorktrees reads path, head and branch; the primary comes first", () => {
        const raw = "worktree D:/p/eh\nHEAD abc123\nbranch refs/heads/main\n\nworktree D:/p/eh-x\nHEAD def456\nbranch refs/heads/feature/x\n\nworktree D:/p/eh-d\nHEAD 999\ndetached\n";
        const wts = ov.parseWorktrees(raw);
        expect(wts.map((w) => w.branch)).toEqual(["main", "feature/x", ""]);
        expect(wts[1].head).toBe("def456");
    });

    test("parseStatusLines takes the target of a rename", () => {
        expect(ov.parseStatusLines(" M a.js\n?? b.js\nR  old.js -> new.js\n")).toEqual([
            { code: " M", file: "a.js" }, { code: "??", file: "b.js" }, { code: "R ", file: "new.js" },
        ]);
    });

    test("parseNameStatus", () => {
        expect(ov.parseNameStatus("M\ta.js\nR100\told.js\tnew.js\n")).toEqual([{ status: "M", file: "a.js" }, { status: "R", file: "new.js" }]);
    });

    test("parsePort", () => {
        expect(ov.parsePort("A=1\nWEB_PORT=3011\nDEV_AUTO_LOGIN=1\n")).toBe(3011);
        expect(ov.parsePort("WEB_PORT=\"3012\"")).toBe(3012);
        expect(ov.parsePort("nothing")).toBe(0);
    });

    test("testSectionFromBody finds the test section and stops at the next heading", () => {
        const body = "## Summary\n- did a thing\n\n## Test plan\n- [x] npm test\n- open /events on port 3010\n\n## Notes\n- not a test";
        expect(ov.testSectionFromBody(body)).toEqual(["npm test", "open /events on port 3010"]);
        expect(ov.testSectionFromBody("no sections")).toEqual([]);
    });

    test("testHints lists each matching area once and stays silent for tests only", () => {
        const hints = ov.testHints(["src/web-client/src/a.tsx", "src/web-client/src/b.tsx", "src/web/apiRoutes/x.js", "test/x.test.js"]);
        expect(hints).toHaveLength(3);
        expect(hints[0]).toMatch(/Web-Oberfläche/);
        expect(hints[1]).toMatch(/API/);
        expect(hints[2]).toMatch(/Backend/);
        expect(ov.testHints(["test/x.test.js"])).toEqual([]);
    });

    test("projectSlug replaces every non-alphanumeric character", () => {
        expect(ov.projectSlug("d:\\programming\\eventhelper")).toBe("d--programming-eventhelper");
    });
});

describe("agent overview - agents", () => {
    const wts = [
        { path: path.resolve("D:/p/eh"), branch: "main", head: "a" },
        { path: path.resolve("D:/p/eh-raidplan"), branch: "feature/raidplan-6", head: "b" },
        { path: path.resolve("D:/p/eh-raidplan-assign"), branch: "feature/raidplan-6b", head: "c" },
    ];
    const assign = (a) => ov.assignAgent(a, wts);

    test("assignAgent prefers the longest matching path", () => {
        expect(assign({ prompt: "Arbeite in " + wts[2].path.replace(/\\/g, "/") + " bitte" }).branch).toBe("feature/raidplan-6b");
        expect(assign({ prompt: "im " + wts[1].path }).branch).toBe("feature/raidplan-6");
    });

    test("assignAgent falls back to the branch name and returns null otherwise", () => {
        expect(assign({ prompt: "Branch feature/raidplan-6b" }).branch).toBe("feature/raidplan-6b");
        expect(assign({ prompt: "nothing here" })).toBeNull();
    });

    test("firstPrompt reads string and block content", () => {
        const l1 = JSON.stringify({ type: "user", message: { role: "user", content: "hallo" } });
        const l2 = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "block" }] } });
        expect(ov.firstPrompt("{\"type\":\"queue\"}\n" + l1 + "\n")).toBe("hallo");
        expect(ov.firstPrompt(l2)).toBe("block");
        expect(ov.firstPrompt("garbage")).toBe("");
    });

    test("findAgents marks recent transcripts as running and drops old ones", () => {
        const root = path.dirname(tempStoreFile("x"));
        const dir = path.join(root, "sess", "subagents");
        fs.mkdirSync(dir, { recursive: true });
        const line = JSON.stringify({ type: "user", message: { content: "Worktree D:/p/eh-raidplan" } });
        for (const id of ["new", "old"]) {
            fs.writeFileSync(path.join(dir, "agent-" + id + ".jsonl"), line + "\n");
            fs.writeFileSync(path.join(dir, "agent-" + id + ".meta.json"), JSON.stringify({ description: "task " + id, agentType: "general-purpose" }));
        }
        const now = Date.now();
        fs.utimesSync(path.join(dir, "agent-new.jsonl"), new Date(now - 30000), new Date(now - 30000));
        fs.utimesSync(path.join(dir, "agent-old.jsonl"), new Date(now - 30 * 3600 * 1000), new Date(now - 30 * 3600 * 1000));
        const found = ov.findAgents({ projectDir: root, hours: 24, now });
        expect(found.map((a) => a.id)).toEqual(["new"]);
        expect(found[0]).toMatchObject({ running: true, description: "task new" });
        expect(ov.findAgents({ projectDir: path.join(root, "missing") })).toEqual([]);
    });
});

describe("agent overview - instance and report", () => {
    const wt = { port: 3010, head: "abcdef1234" };

    test("instanceState compares the running commit with the branch head", () => {
        expect(ov.instanceState(wt, { up: true, commit: "abcdef1234" })).toMatchObject({ up: true, current: true });
        expect(ov.instanceState(wt, { up: true, commit: "0000000" })).toMatchObject({ up: true, current: false });
        expect(ov.instanceState(wt, null)).toMatchObject({ up: false, url: "http://localhost:3010/" });
        expect(ov.instanceState({ port: 0 }, null).up).toBe(false);
    });

    test("collect ties agents, changes, PR and instance together", async () => {
        const gitFn = (args) => {
            if (args[0] === "worktree") return "worktree D:/p/eh\nHEAD a\nbranch refs/heads/main\n\nworktree D:/p/eh-x\nHEAD b\nbranch refs/heads/feature/x\n";
            if (args[0] === "log") return "b1\tAdd thing\t2026-09-25T10:00:00+02:00\n";
            if (args[0] === "rev-list") return "3\n";
            if (args[0] === "diff") return "M\tsrc/web-client/src/p.tsx\n";
            return "";
        };
        const pulls = [{ number: 7, title: "Thing", state: "OPEN", url: "u", headRefName: "feature/x", body: "## Test plan\n- click it" }];
        const claudeDir = path.dirname(tempStoreFile("y"));
        const dir = path.join(claudeDir, ov.projectSlug("D:/p/eh"), "s", "subagents");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "agent-1.jsonl"), JSON.stringify({ type: "user", message: { content: "in D:/p/eh-x arbeiten" } }) + "\n");
        fs.writeFileSync(path.join(dir, "agent-1.meta.json"), JSON.stringify({ description: "Do X" }));
        fs.writeFileSync(path.join(dir, "agent-2.jsonl"), JSON.stringify({ type: "user", message: { content: "irgendwo" } }) + "\n");
        const entries = await ov.collect({ gitFn, healthFn: async () => null, pullsFn: () => pulls, claudeDir });
        const x = entries.find((e) => e.branch === "feature/x");
        expect(x).toMatchObject({ behind: 3, pr: { number: 7 }, prTests: ["click it"] });
        expect(x.agents.map((a) => a.description)).toEqual(["Do X"]);
        expect(x.ahead).toHaveLength(1);
        expect(entries.find((e) => !e.path).agents).toHaveLength(1);
        expect(entries.some((e) => e.primary)).toBe(false);

        const text = ov.formatText(entries).join("\n");
        expect(text).toMatch(/feature\/x/);
        expect(text).toMatch(/Do X/);
        expect(text).toMatch(/click it \(laut PR\)/);
        const html = ov.formatHtml(entries);
        expect(html).toMatch(/<title>Agenten-Übersicht<\/title>/);
        expect(html).toMatch(/Do X/);
    });

    test("formatText says so when empty; formatHtml escapes", () => {
        expect(ov.formatText([])[0]).toMatch(/Keine Worktrees/);
        const e = { name: "<b>", branch: "x", path: "p", agents: [], ahead: [], dirty: [], files: [], behind: 0, prTests: [], hints: [], pr: null, instance: { label: "l", up: false } };
        expect(ov.formatHtml([e])).toContain("&lt;b&gt;");
    });

    test("parseArgs", () => {
        expect(ov.parseArgs(["--all", "--no-pr", "--hours", "6", "--html"])).toMatchObject({ all: true, usePr: false, hours: 6, html: true });
    });
});
