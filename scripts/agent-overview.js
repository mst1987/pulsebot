#!/usr/bin/env node
"use strict";

// Overview of the agents that are working on this repository: one block per
// feature worktree with the agents attached to it, what changed against `main`,
// where the local test instance is and what to click to check the change.
//
//   npm run agents                 text overview in the terminal
//   npm run agents -- --html       also write data/agent-overview.html (self-contained)
//   npm run agents -- --json       machine-readable output instead of text
//   npm run agents -- --all        include worktrees without changes or agents
//   npm run agents -- --no-pr      skip the `gh` lookup (offline)
//   npm run agents -- --hours 6    how far back agent transcripts count (default 24)
//
// Sources (all read-only): `git worktree list`, `git log/diff` against origin/main,
// `.env.dev` (WEB_PORT) plus `GET /health` of that port (which commit runs there),
// the Claude Code subagent transcripts under ~/.claude/projects/<repo>/<session>/subagents,
// and `gh pr list` (state + the test section of the PR body).

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const RUNNING_MS = 3 * 60 * 1000; // an agent that wrote to its transcript in the last 3 minutes is "running"
const HEAD_BYTES = 24 * 1024; // enough of a transcript to read the first prompt, never the 50 MB rest

// What a changed file means for the reviewer. First match wins per file; the
// hints of every matched area are listed once. Paths use forward slashes.
const AREAS = [
    { re: /^src\/web-client\/src\/.*\.(tsx?|css)$/, key: "web-ui", hint: "Web-Oberfläche: Client neu bauen (cd src/web-client && npm run build) und die betroffene Seite im Browser durchklicken, Light + Dark und schmales Fenster ansehen." },
    { re: /^src\/web-client\/src\/i18n\//, key: "i18n", hint: "Texte: Sprache Deutsch/Englisch umschalten und die neuen Texte prüfen." },
    { re: /^src\/web\/apiRoutes\/|^src\/web\/apiRouter\.js$|^src\/web\/apiAccess\.js$/, key: "api", hint: "API/Rechte: Aktion mit einem Konto mit und ohne Berechtigung ausführen (read vs. write)." },
    { re: /^src\/commands\//, key: "commands", hint: "Slash-Commands: `npm run register:dev` ausführen und den Befehl auf dem Dev-Testserver aufrufen." },
    { re: /^src\/utils\/logcheck\//, key: "logcheck", hint: "Logcheck: einen echten Report öffnen und alle Kämpfe/Tabs ansehen." },
    { re: /^src\/(web|utils|classes)\/.*\.js$/, key: "backend", hint: "Backend geändert: Instanz neu starten, damit die Änderung läuft (siehe Stand der Instanz)." },
    { re: /^scripts\//, key: "scripts", hint: "Skripte: einmal von Hand ausführen (Dry-Run, falls vorhanden)." },
    { re: /^docs\//, key: "docs", hint: "Nur Doku: nichts zu klicken, Text gegenlesen." },
    { re: /^test\//, key: "tests", hint: null },
];

function git(args, cwd) {
    try {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
    } catch {
        return null;
    }
}

/** `git worktree list --porcelain` into `[{ path, head, branch }]`; the primary checkout comes first. */
function parseWorktrees(raw) {
    const out = [];
    let cur = null;
    for (const line of String(raw || "").split(/\r?\n/)) {
        if (line.startsWith("worktree ")) {
            cur = { path: path.resolve(line.slice(9).trim()), head: "", branch: "" };
            out.push(cur);
        } else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
        else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    }
    return out;
}

/** `git status --porcelain` lines into `[{ code, file }]`. */
function parseStatusLines(raw) {
    return String(raw || "").split(/\r?\n/).filter((l) => l.length > 3).map((l) => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "") }));
}

/** `git diff --name-status` lines into `[{ status, file }]`; a rename counts as its target. */
function parseNameStatus(raw) {
    return String(raw || "").split(/\r?\n/).filter(Boolean).map((l) => {
        const parts = l.split("\t");
        return { status: parts[0][0], file: parts[parts.length - 1] };
    });
}

/** WEB_PORT out of an env file's text, or 0. */
function parsePort(envText) {
    const m = /^\s*WEB_PORT\s*=\s*"?(\d+)"?\s*$/m.exec(String(envText || ""));
    return m ? Number(m[1]) : 0;
}

/** The section of a PR body that tells how to test (heading or bold line containing "test"), as bullet strings. */
function testSectionFromBody(body) {
    const lines = String(body || "").split(/\r?\n/);
    const start = lines.findIndex((l) => /^\s*(#{1,6}\s+|\*\*)[^\n]*(test|prüf|verif)/i.test(l));
    if (start === -1) return [];
    const items = [];
    for (const l of lines.slice(start + 1)) {
        if (/^\s*#{1,6}\s+\S/.test(l)) break;
        const m = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(l);
        if (m) items.push(m[1].trim().slice(0, 160));
        else if (items.length && !l.trim()) break;
    }
    return items.slice(0, 12);
}

/** Hints of every area at least one changed file falls into, each once, in table order. */
function testHints(files) {
    return AREAS.filter((a) => a.hint && files.some((f) => a.re.test(f))).map((a) => a.hint);
}

/** The claude project directory of a repository: every non-alphanumeric character becomes "-". */
function projectSlug(repoPath) {
    return path.resolve(repoPath).replace(/[^A-Za-z0-9]/g, "-");
}

function normalize(s) {
    return String(s || "").replace(/\\/g, "/").toLowerCase();
}

/** First user prompt text out of the head of a transcript. */
function firstPrompt(headText) {
    for (const line of String(headText || "").split("\n")) {
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.type !== "user" || !j.message) continue;
        const c = j.message.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    }
    return "";
}

function readHead(file, bytes = HEAD_BYTES) {
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const buf = Buffer.alloc(bytes);
        const n = fs.readSync(fd, buf, 0, bytes, 0);
        return buf.toString("utf8", 0, n);
    } catch {
        return "";
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to close */ }
    }
}

/**
 * Subagents of every session of the repo whose transcript changed within `hours`.
 * @returns {Array<{ id, description, type, prompt, lastActivity: Date, running: boolean }>}
 */
function findAgents({ projectDir, hours = 24, now = Date.now() }) {
    const out = [];
    let sessions = [];
    try { sessions = fs.readdirSync(projectDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
    for (const s of sessions) {
        const dir = path.join(projectDir, s.name, "subagents");
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
        for (const f of files) {
            const full = path.join(dir, f);
            let mtime;
            try { mtime = fs.statSync(full).mtimeMs; } catch { continue; }
            if (now - mtime > hours * 3600 * 1000) continue;
            let meta = {};
            try { meta = JSON.parse(fs.readFileSync(full.replace(/\.jsonl$/, ".meta.json"), "utf8")); } catch { /* meta is optional */ }
            out.push({
                id: f.replace(/^agent-|\.jsonl$/g, ""),
                description: meta.description || "",
                type: meta.agentType || "",
                prompt: firstPrompt(readHead(full)),
                lastActivity: new Date(mtime),
                running: now - mtime < RUNNING_MS,
            });
        }
    }
    return out.sort((a, b) => b.lastActivity - a.lastActivity);
}

/** Which worktree an agent belongs to: the one whose path (or, failing that, branch) its prompt names. */
function assignAgent(agent, worktrees) {
    const p = normalize(agent.prompt);
    // Longest path first: eventhelper-raidplan-assign must win over eventhelper-raidplan.
    const byPath = [...worktrees].sort((a, b) => b.path.length - a.path.length).find((w) => p.includes(normalize(w.path)));
    if (byPath) return byPath;
    return worktrees.find((w) => w.branch && w.branch !== "main" && p.includes(normalize(w.branch)) && !worktrees.some((o) => o !== w && o.branch.length > w.branch.length && o.branch.startsWith(w.branch) && p.includes(normalize(o.branch)))) || null;
}

/** GET /health of a local instance: `{ commit, startedAt }` or null when nothing answers. */
function fetchHealth(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        if (!port) return resolve(null);
        const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (res) => {
            let body = "";
            res.on("data", (c) => { body += c; });
            res.on("end", () => {
                try { resolve({ up: true, ...JSON.parse(body) }); } catch { resolve({ up: true }); }
            });
        });
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
    });
}

function ghPullRequests(cwd) {
    try {
        const raw = execFileSync("gh", ["pr", "list", "--state", "all", "--limit", "60", "--json", "number,title,state,url,headRefName,body,mergedAt"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
        return JSON.parse(raw);
    } catch {
        return null; // gh missing, not logged in or offline
    }
}

/** Everything about one worktree except agents and the instance's health. */
function inspectWorktree(w, { gitFn = git, base = "origin/main", pulls = [] } = {}) {
    const ahead = parseCommitLines(gitFn(["log", `${base}..HEAD`, "--format=%h\t%s\t%cI"], w.path));
    const behind = Number((gitFn(["rev-list", "--count", `HEAD..${base}`], w.path) || "0").trim()) || 0;
    const committed = parseNameStatus(gitFn(["diff", "--name-status", `${base}...HEAD`], w.path));
    const dirty = parseStatusLines(gitFn(["status", "--porcelain"], w.path));
    const files = [...new Set([...committed.map((f) => f.file), ...dirty.map((f) => f.file)])];
    const pr = pulls.find((p) => p.headRefName === w.branch) || null;
    let port = 0;
    try { port = parsePort(fs.readFileSync(path.join(w.path, ".env.dev"), "utf8")); } catch { /* no env: no local instance */ }
    return {
        ...w,
        name: path.basename(w.path),
        ahead,
        behind,
        committed,
        dirty,
        files,
        pr: pr && { number: pr.number, title: pr.title, state: pr.mergedAt ? "MERGED" : pr.state, url: pr.url },
        prTests: pr ? testSectionFromBody(pr.body) : [],
        hints: testHints(files),
        port,
    };
}

function parseCommitLines(raw) {
    return String(raw || "").split(/\r?\n/).filter(Boolean).map((l) => {
        const [sha, subject, date] = l.split("\t");
        return { sha, subject, date };
    });
}

/** How the instance on a worktree's port relates to that worktree's HEAD. */
function instanceState(wt, health) {
    if (!wt.port) return { label: "keine Testinstanz konfiguriert (kein WEB_PORT in .env.dev)", up: false };
    if (!health) return { label: `Port ${wt.port}: nicht gestartet`, up: false, url: `http://localhost:${wt.port}/` };
    const url = `http://localhost:${wt.port}/`;
    if (health.commit && wt.head) {
        if (wt.head.startsWith(health.commit) || health.commit.startsWith(wt.head)) return { label: `Port ${wt.port}: läuft auf dem aktuellen Stand`, up: true, current: true, url };
        return { label: `Port ${wt.port}: läuft, aber auf ${String(health.commit).slice(0, 8)} - Branch steht auf ${wt.head.slice(0, 8)}, Instanz neu starten`, up: true, current: false, url };
    }
    return { label: `Port ${wt.port}: läuft (Stand unbekannt)`, up: true, url };
}

function ago(date, now = Date.now()) {
    const m = Math.round((now - new Date(date).getTime()) / 60000);
    if (m < 1) return "gerade eben";
    if (m < 60) return `vor ${m} Min`;
    if (m < 48 * 60) return `vor ${Math.round(m / 60)} Std`;
    return `vor ${Math.round(m / 1440)} Tagen`;
}

function taskOf(agent) {
    if (agent.description) return agent.description;
    return agent.prompt.split(/\r?\n/).find((l) => l.trim()) ? agent.prompt.split(/\r?\n/).find((l) => l.trim()).slice(0, 100) : "(ohne Beschreibung)";
}

/** Text report. */
function formatText(entries, { now = Date.now() } = {}) {
    if (!entries.length) return ["Keine Worktrees mit Änderungen oder Agenten gefunden (mit --all alle anzeigen)."];
    const out = [];
    for (const e of entries) {
        const running = e.agents.filter((a) => a.running).length;
        out.push("=".repeat(78));
        out.push(`${e.name}${e.branch ? `  [${e.branch}]` : ""}${e.pr ? `  PR #${e.pr.number} ${e.pr.state}` : ""}${running ? `  ** ${running} Agent(en) laufen **` : ""}`);
        if (e.pr) out.push(`  ${e.pr.title} - ${e.pr.url}`);
        if (e.pr && e.pr.state === "MERGED") out.push("  -> gemergt: Testinstanz stoppen und Worktree entfernen (siehe CLAUDE.md, Cleanup after merges)");
        out.push("Agenten:");
        if (!e.agents.length) out.push("  (keine in den letzten Stunden)");
        for (const a of e.agents) out.push(`  ${a.running ? "[läuft]  " : "[ruht]   "}${taskOf(a)}  (${ago(a.lastActivity, now)})`);
        if (!e.path) continue; // agents without a worktree have nothing else to show
        out.push(`Änderungen gegenüber main: ${e.ahead.length} Commit(s), ${e.files.length} Datei(en)${e.dirty.length ? `, ${e.dirty.length} uncommittet` : ""}${e.behind ? `, ${e.behind} Commit(s) hinter main` : ""}`);
        for (const c of e.ahead.slice(0, 8)) out.push(`  ${c.sha} ${c.subject}`);
        if (e.ahead.length > 8) out.push(`  ... und ${e.ahead.length - 8} weitere`);
        if (e.dirty.length) out.push(`  uncommittet: ${e.dirty.slice(0, 6).map((d) => d.file).join(", ")}${e.dirty.length > 6 ? ", ..." : ""}`);
        out.push(`Testinstanz: ${e.instance.label}${e.instance.url ? `  ->  ${e.instance.url}` : ""}`);
        const tests = [...e.prTests.map((t) => `${t} (laut PR)`), ...e.hints];
        out.push("Was testen:");
        if (!tests.length) out.push("  (nichts Testbares erkannt)");
        for (const t of tests) out.push(`  - ${t}`);
    }
    return out;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Self-contained HTML page of the same data. */
function formatHtml(entries, { now = Date.now() } = {}) {
    const cards = entries.map((e) => {
        const tests = [...e.prTests.map((t) => `${esc(t)} <em>(laut PR)</em>`), ...e.hints.map(esc)];
        return `<section>
<h2>${esc(e.name)} <small>${esc(e.branch)}</small>${e.pr ? ` <a class="pill" href="${esc(e.pr.url)}">PR #${e.pr.number} ${esc(e.pr.state)}</a>` : ""}</h2>
<h3>Agenten</h3><ul>${e.agents.map((a) => `<li class="${a.running ? "run" : "idle"}"><b>${a.running ? "läuft" : "ruht"}</b> ${esc(taskOf(a))} <em>${esc(ago(a.lastActivity, now))}</em></li>`).join("") || "<li class=\"idle\">keine in den letzten Stunden</li>"}</ul>
${!e.path ? "</section>" : `<h3>Geändert gegenüber main <small>${e.ahead.length} Commits · ${e.files.length} Dateien${e.dirty.length ? ` · ${e.dirty.length} uncommittet` : ""}${e.behind ? ` · ${e.behind} hinter main` : ""}</small></h3>
<ul>${e.ahead.slice(0, 10).map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.subject)}</li>`).join("")}</ul>
<h3>Testinstanz</h3><p class="${e.instance.up ? (e.instance.current === false ? "warn" : "ok") : "idle"}">${esc(e.instance.label)}${e.instance.url ? ` – <a href="${esc(e.instance.url)}">${esc(e.instance.url)}</a>` : ""}</p>
<h3>Was testen</h3><ul>${tests.map((t) => `<li>${t}</li>`).join("") || "<li class=\"idle\">nichts Testbares erkannt</li>"}</ul>
</section>`}`;
    });
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenten-Übersicht</title>
<style>:root{--bg:#f6f6fa;--fg:#1c1c28;--card:#fff;--mut:#666;--ok:#0a7d4b;--warn:#b45309;--run:#6d28d9;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--bg:#14141c;--fg:#e8e8f0;--card:#1e1e2a;--mut:#9a9ab0;--ok:#4ade80;--warn:#fbbf24;--run:#a78bfa}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:960px;margin:auto}
section{background:var(--card);border-radius:10px;padding:16px 20px;margin:0 0 16px}h1{font-size:1.4rem}h2{font-size:1.15rem;margin:0 0 8px}h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:14px 0 4px}
small,em{color:var(--mut);font-weight:400;font-style:normal}ul{margin:0;padding-left:20px}.pill{font-size:.75rem;border:1px solid currentColor;border-radius:99px;padding:1px 8px;text-decoration:none}
.run b{color:var(--run)}.idle{color:var(--mut)}.ok{color:var(--ok)}.warn{color:var(--warn)}p{margin:0}code{font-size:.85em}a{color:inherit}</style></head><body><main>
<h1>Agenten-Übersicht <small>Stand ${esc(new Date(now).toLocaleString("de-DE"))}</small></h1>
${cards.join("\n") || "<p>Keine Worktrees mit Änderungen oder Agenten.</p>"}</main></body></html>`;
}

/** Collects everything. Dependencies are injectable for tests. */
async function collect({ cwd = __dirname, hours = 24, all = false, usePr = true, now = Date.now(), gitFn = git, healthFn = fetchHealth, pullsFn = ghPullRequests, claudeDir = path.join(os.homedir(), ".claude", "projects") } = {}) {
    const worktrees = parseWorktrees(gitFn(["worktree", "list", "--porcelain"], cwd));
    if (!worktrees.length) return [];
    const primary = worktrees[0];
    const pulls = usePr ? pullsFn(primary.path) || [] : [];
    const agents = findAgents({ projectDir: path.join(claudeDir, projectSlug(primary.path)), hours, now });
    const entries = worktrees.map((w) => ({ ...inspectWorktree(w, { gitFn, pulls }), agents: [] }));
    const orphans = [];
    for (const a of agents) {
        const target = assignAgent(a, worktrees);
        const entry = target && entries.find((e) => e.path === target.path);
        (entry ? entry.agents : orphans).push(a);
    }
    if (orphans.length) entries.push({ path: "", name: "(ohne Worktree)", branch: "", head: "", ahead: [], behind: 0, committed: [], dirty: [], files: [], pr: null, prTests: [], hints: [], port: 0, agents: orphans, primary: false });
    await Promise.all(entries.map(async (e) => { e.instance = instanceState(e, await healthFn(e.port)); }));
    entries.forEach((e, i) => { e.primary = i === 0; });
    return entries.filter((e) => !e.primary || all).filter((e) => all || e.agents.length || e.ahead.length || e.dirty.length);
}

function parseArgs(argv) {
    const o = { hours: 24, all: false, usePr: true, json: false, html: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--all") o.all = true;
        else if (a === "--no-pr") o.usePr = false;
        else if (a === "--json") o.json = true;
        else if (a === "--html") o.html = true;
        else if (a === "--hours") o.hours = Number(argv[++i]) || 24;
    }
    return o;
}

async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
    const opts = parseArgs(argv);
    const entries = await collect(opts);
    if (opts.json) log(JSON.stringify(entries, null, 2));
    else formatText(entries).forEach((l) => log(l));
    if (opts.html) {
        const primary = (parseWorktrees(git(["worktree", "list", "--porcelain"], __dirname))[0] || { path: process.cwd() }).path;
        const file = path.join(primary, "data", "agent-overview.html");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, formatHtml(entries));
        log(`HTML: ${file}`);
    }
    return 0;
}

if (require.main === module) {
    main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}

module.exports = {
    parseWorktrees, parseStatusLines, parseNameStatus, parsePort, testSectionFromBody, testHints, projectSlug,
    firstPrompt, findAgents, assignAgent, inspectWorktree, instanceState, formatText, formatHtml, collect, parseArgs, main, taskOf, ago,
};
