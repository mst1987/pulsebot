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
        { path: "D:/p/eh", branch: "main", head: "a" },
        { path: "D:/p/eh-raidplan", branch: "feature/raidplan-6", head: "b" },
        { path: "D:/p/eh-raidplan-assign", branch: "feature/raidplan-6b", head: "c" },
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
            if (args[0] === "log") return "b1\x1fAdd thing\x1f2026-09-25T10:00:00+02:00\x1fAdds the thing\nand more\n\nCo-Authored-By: X <x@y>\n\x1e";
            if (args[0] === "rev-list") return "3\n";
            if (args[0] === "diff" && args.includes("--numstat")) return args.includes("HEAD") && args.length === 3 ? "1\t2\tsrc/web/u.js\n" : "10\t4\tsrc/web-client/src/p.tsx\n";
            if (args[0] === "diff") return "M\tsrc/web-client/src/p.tsx\n";
            if (args[0] === "status") return "?? src/new.js\n";
            return "";
        };
        const pulls = [{ number: 7, title: "Thing", state: "OPEN", url: "u", headRefName: "feature/x", body: "## Summary\nDoes the thing.\n\n## Test plan\n- click it" }];
        const claudeDir = path.dirname(tempStoreFile("y"));
        const dir = path.join(claudeDir, ov.projectSlug("D:/p/eh"), "s", "subagents");
        fs.mkdirSync(dir, { recursive: true });
        const assistant = (content) => JSON.stringify({ type: "assistant", timestamp: "2026-09-25T10:00:00Z", message: { content } });
        fs.writeFileSync(path.join(dir, "agent-1.jsonl"), [
            JSON.stringify({ type: "user", message: { content: "in D:/p/eh-x arbeiten" } }),
            assistant([{ type: "text", text: "Ich baue jetzt die Seite." }, { type: "tool_use", name: "Edit", input: { file_path: "D:/p/eh-x/src/a.js" } }]),
        ].join("\n") + "\n");
        fs.writeFileSync(path.join(dir, "agent-1.meta.json"), JSON.stringify({ description: "Do X" }));
        fs.writeFileSync(path.join(dir, "agent-2.jsonl"), JSON.stringify({ type: "user", message: { content: "irgendwo" } }) + "\n");
        const entries = await ov.collect({ gitFn, healthFn: async () => null, pullsFn: () => pulls, claudeDir });
        const x = entries.find((e) => e.branch === "feature/x");
        expect(x).toMatchObject({ behind: 3, pr: { number: 7 }, prTests: ["click it"] });
        expect(x.agents.map((a) => a.description)).toEqual(["Do X"]);
        expect(x.ahead).toHaveLength(1);
        expect(x.ahead[0]).toMatchObject({ sha: "b1", subject: "Add thing", body: "Adds the thing and more" });
        expect(x.pr.summary).toBe("Does the thing.");
        expect(x.agents[0]).toMatchObject({ lastText: "Ich baue jetzt die Seite.", actions: ["bearbeitet D:/p/eh-x/src/a.js"] });
        expect(x.fileStats).toEqual([
            { file: "src/web-client/src/p.tsx", added: 10, removed: 4, uncommitted: false, isNew: false },
            { file: "src/web/u.js", added: 1, removed: 2, uncommitted: true, isNew: false },
            { file: "src/new.js", added: 0, removed: 0, uncommitted: true, isNew: true },
        ]);
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
        const e = { name: "<b>", branch: "x", path: "p", agents: [], ahead: [], dirty: [], files: [], fileStats: [], behind: 0, prTests: [], hints: [], pr: null, instance: { label: "l", up: false } };
        expect(ov.formatHtml([e])).toContain("&lt;b&gt;");
    });

    test("the served page refreshes itself, the plain page does not", () => {
        expect(ov.formatHtml([], { refreshSeconds: 5 })).toMatch(/setInterval\(tick, 5000\)/);
        expect(ov.formatHtml([])).not.toMatch(/setInterval/);
    });

    test("parseArgs", () => {
        expect(ov.parseArgs(["--all", "--no-pr", "--hours", "6", "--html"])).toMatchObject({ all: true, usePr: false, hours: 6, html: true });
        expect(ov.parseArgs(["--watch"])).toMatchObject({ watch: 10, serve: 0 });
        expect(ov.parseArgs(["--watch", "1"]).watch).toBe(2);
        expect(ov.parseArgs(["--serve"]).serve).toBe(3099);
        expect(ov.parseArgs(["--serve", "3200", "--all"])).toMatchObject({ serve: 3200, all: true });
    });
});

describe("agent overview - what was done", () => {
    test("parseNumstat and mergeFileStats add committed and uncommitted work, biggest first", () => {
        const c = ov.parseNumstat("5\t1\ta.js\n-\t-\timg.png\n");
        expect(c).toEqual([{ file: "a.js", added: 5, removed: 1 }, { file: "img.png", added: 0, removed: 0 }]);
        const merged = ov.mergeFileStats(c, ov.parseNumstat("2\t0\ta.js\n"), ["n.js"]);
        expect(merged[0]).toEqual({ file: "a.js", added: 7, removed: 1, uncommitted: true, isNew: false });
        expect(merged.find((f) => f.file === "n.js")).toMatchObject({ isNew: true, uncommitted: true });
    });

    test("summaryFromBody keeps what comes before the test section", () => {
        expect(ov.summaryFromBody("## Was\nEins\nZwei\n\n## Wie geprüft\n- x\n")).toBe("Eins Zwei");
        expect(ov.summaryFromBody("")).toBe("");
    });

    test("parseActivity keeps the last text and the last distinct actions", () => {
        const line = (content) => JSON.stringify({ type: "assistant", timestamp: "t", message: { content } });
        const tail = [
            "cut off half a li",
            line([{ type: "text", text: "erst" }, { type: "tool_use", name: "Read", input: { file_path: "C:\\x\\eventhelper-w\\src\\a.js" } }]),
            line([{ type: "tool_use", name: "Read", input: { file_path: "C:\\x\\eventhelper-w\\src\\a.js" } }, { type: "tool_use", name: "Bash", input: { command: "npm   test" } }]),
            line([{ type: "text", text: "  zuletzt  " }]),
        ].join("\n");
        expect(ov.parseActivity(tail)).toEqual({ lastText: "zuletzt", actions: ["liest src/a.js", "führt aus: npm test"], lastAt: "t" });
        expect(ov.parseActivity("")).toEqual({ lastText: "", actions: [], lastAt: "" });
    });

    test("readTail drops the cut first line of a big file", () => {
        const file = tempStoreFile("tail.jsonl");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n");
        expect(ov.readTail(file, 16)).toBe("cccccccccc\n");
        expect(ov.readTail(file, 1000)).toBe("aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n");
        expect(ov.readTail(path.join(path.dirname(file), "nope"))).toBe("");
    });
});

describe("agent overview - refreshing", () => {
    test("cachedPulls asks once per ttl", () => {
        let t = 0;
        const fn = jest.fn(() => [1]);
        const cached = ov.cachedPulls(fn, 1000, () => t);
        t = 5000; cached("x"); cached("x");
        expect(fn).toHaveBeenCalledTimes(1);
        t = 7000; cached("x");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test("serve answers the page, the fragment and the data", async () => {
        const http = require("http");
        const get = (port, p) => new Promise((resolve, reject) => {
            http.get({ host: "127.0.0.1", port, path: p }, (res) => {
                let b = "";
                res.on("data", (c) => { b += c; });
                res.on("end", () => resolve({ status: res.statusCode, body: b }));
            }).on("error", reject);
        });
        const server = await ov.serve({}, { port: 0, log: () => {}, collectFn: async () => [] });
        const port = server.address().port;
        try {
            const page = await get(port, "/");
            expect(page.status).toBe(200);
            expect(page.body).toMatch(/setInterval/);
            expect((await get(port, "/fragment")).body).not.toMatch(/<html/);
            expect(Array.isArray(JSON.parse((await get(port, "/data.json")).body))).toBe(true);
            expect((await get(port, "/nope")).status).toBe(404);
        } finally {
            await new Promise((r) => server.close(r));
        }
    });
});
