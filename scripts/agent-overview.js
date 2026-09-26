#!/usr/bin/env node
"use strict";

// Overview of the agents that are working on this repository: one block per
// feature worktree with the agents attached to it, what changed against `main`,
// where the local test instance is and what to click to check the change.
//
//   npm run agents                 text overview in the terminal
//   npm run agents -- --html       also write eventhelper-agent-overview.html (self-contained) to the
//                                  temp directory - not into data/, which holds the bot's runtime data
//   npm run agents -- --watch [s]  redraw the terminal every s seconds (default 10)
//   npm run agents -- --serve [p]  local page on http://localhost:p/ (default 3099) that refreshes itself
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
const TAIL_BYTES = 512 * 1024; // enough of the end to hold the last few messages even after a big tool result

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
            cur = { path: line.slice(9).trim(), head: "", branch: "" };
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
    return String(repoPath).replace(/[^A-Za-z0-9]/g, "-");
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

/** The last `bytes` of a file without its (probably cut) first line. Transcripts reach 50 MB; only the end tells what an agent does now. */
function readTail(file, bytes = TAIL_BYTES) {
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, bytes);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        const text = buf.toString("utf8");
        return len < size ? text.slice(text.indexOf("\n") + 1) : text;
    } catch {
        return "";
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to close */ }
    }
}

const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const relFile = (f) => String(f || "").replace(/\\/g, "/").replace(/^.*\/eventhelper[^/]*\//i, "");

/** One tool call as a short German sentence. */
function describeToolUse(block) {
    const i = block.input || {};
    switch (block.name) {
        case "Edit": case "MultiEdit": return `bearbeitet ${relFile(i.file_path)}`;
        case "Write": return `schreibt ${relFile(i.file_path)}`;
        case "Read": return `liest ${relFile(i.file_path)}`;
        case "Bash": case "PowerShell": return `führt aus: ${short(String(i.command || "").replace(/\s+/g, " "), 90)}`;
        case "Grep": case "Glob": return `sucht ${short(i.pattern || "", 60)}`;
        case "Agent": return `startet Agent: ${short(i.description || "", 60)}`;
        default: return block.name || "";
    }
}

/**
 * What an agent said and did last, out of the tail of its transcript.
 * @returns {{ lastText: string, actions: string[], lastAt: string }}
 */
function parseActivity(tailText) {
    let lastText = "";
    let lastAt = "";
    const actions = [];
    for (const line of String(tailText || "").split("\n")) {
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.timestamp) lastAt = j.timestamp;
        if (j.type !== "assistant" || !j.message || !Array.isArray(j.message.content)) continue;
        for (const b of j.message.content) {
            if (b.type === "text" && b.text && b.text.trim()) lastText = b.text.trim();
            else if (b.type === "tool_use") {
                const d = describeToolUse(b);
                if (d && d !== actions[actions.length - 1]) actions.push(d);
            }
        }
    }
    return { lastText: short(lastText, 900), actions: actions.slice(-6), lastAt };
}

/**
 * Subagents of every session of the repo whose transcript changed within `hours`.
 * @returns {Array<{ id, description, type, prompt, lastActivity: Date, running: boolean, lastText: string, actions: string[] }>}
 */
function findAgents({ projectDir, hours = 24, now = Date.now() }) {
    const out = [];
    let sessions;
    try { sessions = fs.readdirSync(projectDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
    for (const s of sessions) {
        const dir = path.join(projectDir, s.name, "subagents");
        let files;
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
                ...(({ lastText, actions }) => ({ lastText, actions }))(parseActivity(readTail(full))),
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
    const ahead = parseCommitLines(gitFn(["log", `${base}..HEAD`, "--format=%h%x1f%s%x1f%cI%x1f%b%x1e"], w.path));
    const behind = Number((gitFn(["rev-list", "--count", `HEAD..${base}`], w.path) || "0").trim()) || 0;
    const committed = parseNameStatus(gitFn(["diff", "--name-status", `${base}...HEAD`], w.path));
    const dirty = parseStatusLines(gitFn(["status", "--porcelain"], w.path));
    const fileStats = mergeFileStats(
        parseNumstat(gitFn(["diff", "--numstat", `${base}...HEAD`], w.path)),
        parseNumstat(gitFn(["diff", "--numstat", "HEAD"], w.path)),
        dirty.filter((d) => d.code === "??").map((d) => d.file),
    );
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
        fileStats,
        pr: pr && { number: pr.number, title: pr.title, state: pr.mergedAt ? "MERGED" : pr.state, url: pr.url, summary: summaryFromBody(pr.body) },
        prTests: pr ? testSectionFromBody(pr.body) : [],
        hints: testHints(files),
        port,
    };
}

/** Records of `--format=%h%x1f%s%x1f%cI%x1f%b%x1e`: subject plus the first lines of the commit message body. */
function parseCommitLines(raw) {
    return String(raw || "").split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
        const [sha, subject, date, body] = r.split("\x1f");
        const lines = String(body || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Co-Authored-By:/i.test(l));
        return { sha, subject, date, body: short(lines.slice(0, 4).join(" "), 400) };
    });
}

/** `git diff --numstat` into `[{ file, added, removed }]`; binary files count 0/0. */
function parseNumstat(raw) {
    return String(raw || "").split(/\r?\n/).filter(Boolean).map((l) => {
        const [a, r, ...rest] = l.split("\t");
        return { file: rest.join("\t").replace(/^.*=> /, "").replace(/[{}]/g, ""), added: Number(a) || 0, removed: Number(r) || 0 };
    });
}

/** Committed and uncommitted numstat plus untracked names in one list, biggest change first. */
function mergeFileStats(committed, uncommitted, untracked) {
    const map = new Map();
    const add = (file, added, removed, flag) => {
        const cur = map.get(file) || { file, added: 0, removed: 0, uncommitted: false, isNew: false };
        cur.added += added;
        cur.removed += removed;
        if (flag === "uncommitted") cur.uncommitted = true;
        if (flag === "new") { cur.uncommitted = true; cur.isNew = true; }
        map.set(file, cur);
    };
    committed.forEach((f) => add(f.file, f.added, f.removed));
    uncommitted.forEach((f) => add(f.file, f.added, f.removed, "uncommitted"));
    untracked.forEach((f) => add(f, 0, 0, "new"));
    return [...map.values()].sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.file.localeCompare(b.file));
}

/** The descriptive part of a PR body: everything before the test section, headings dropped. */
function summaryFromBody(body) {
    const lines = String(body || "").split(/\r?\n/);
    const testAt = lines.findIndex((l) => /^\s*(#{1,6}\s+|\*\*)[^\n]*(test|prüf|verif)/i.test(l));
    const part = (testAt === -1 ? lines : lines.slice(0, testAt)).filter((l) => l.trim() && !/^\s*#{1,6}\s/.test(l) && !/Generated with/i.test(l));
    return short(part.join(" ").replace(/\s+/g, " ").trim(), 600);
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

/** "+120  -3" padded so a column lines up. */
function fileStat(f) {
    return `${("+" + f.added).padStart(5)} ${("-" + f.removed).padStart(5)}`;
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
        for (const a of e.agents) {
            out.push(`  ${a.running ? "[läuft]  " : "[ruht]   "}${taskOf(a)}  (${ago(a.lastActivity, now)})`);
            if (a.running && a.actions.length) out.push(`      Zuletzt getan: ${a.actions.slice(-3).join(" | ")}`);
            if (a.lastText) out.push(`      ${a.running ? "Zuletzt geschrieben" : "Ergebnis"}: ${short(a.lastText.replace(/\s+/g, " "), 320)}`);
        }
        if (!e.path) continue; // agents without a worktree have nothing else to show
        if (e.pr && e.pr.summary) out.push(`Beschreibung (PR): ${short(e.pr.summary, 320)}`);
        out.push(`Änderungen gegenüber main: ${e.ahead.length} Commit(s), ${e.files.length} Datei(en)${e.dirty.length ? `, ${e.dirty.length} uncommittet` : ""}${e.behind ? `, ${e.behind} Commit(s) hinter main` : ""}`);
        for (const c of e.ahead.slice(0, 8)) {
            out.push(`  ${c.sha} ${c.subject}`);
            if (c.body) out.push(`         ${short(c.body, 200)}`);
        }
        if (e.ahead.length > 8) out.push(`  ... und ${e.ahead.length - 8} weitere`);
        for (const f of e.fileStats.slice(0, 12)) out.push(`  ${fileStat(f)}  ${f.file}${f.isNew ? "  (neu, uncommittet)" : f.uncommitted ? "  (uncommittet)" : ""}`);
        if (e.fileStats.length > 12) out.push(`  ... und ${e.fileStats.length - 12} weitere Dateien`);
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

/** The cards alone (no page around them); the served page swaps this fragment in on every refresh. */
function renderCards(entries, { now = Date.now() } = {}) {
    const cards = entries.map((e, n) => {
        const k = `${n}-${e.name}`;
        const tests = [...e.prTests.map((t) => `${esc(t)} <em>(laut PR)</em>`), ...e.hints.map(esc)];
        const agents = e.agents.map((a, i) => `<li class="${a.running ? "run" : "idle"}"><b>${a.running ? "läuft" : "ruht"}</b> ${esc(taskOf(a))} <em>${esc(ago(a.lastActivity, now))}</em>
${a.running && a.actions.length ? `<div class="sub">Zuletzt getan: ${a.actions.slice(-4).map(esc).join(" · ")}</div>` : ""}
${a.lastText ? `<details data-k="${k}-a${i}"><summary>${a.running ? "Zuletzt geschrieben" : "Ergebnis"}</summary><div class="sub pre">${esc(a.lastText)}</div></details>` : ""}</li>`).join("") || "<li class=\"idle\">keine in den letzten Stunden</li>";
        const head = `<h2>${esc(e.name)} <small>${esc(e.branch)}</small>${e.pr ? ` <a class="pill" href="${esc(e.pr.url)}">PR #${e.pr.number} ${esc(e.pr.state)}</a>` : ""}</h2>
${e.pr && e.pr.summary ? `<p class="sub">${esc(e.pr.summary)}</p>` : ""}
<h3>Agenten</h3><ul>${agents}</ul>`;
        if (!e.path) return `<section>${head}</section>`;
        const commits = e.ahead.slice(0, 10).map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.subject)}${c.body ? `<div class="sub">${esc(c.body)}</div>` : ""}</li>`).join("");
        const files = e.fileStats.slice(0, 40).map((f) => `<tr><td class="add">+${f.added}</td><td class="del">-${f.removed}</td><td><code>${esc(f.file)}</code>${f.isNew ? " <em>neu, uncommittet</em>" : f.uncommitted ? " <em>uncommittet</em>" : ""}</td></tr>`).join("");
        return `<section>${head}
<h3>Geändert gegenüber main <small>${e.ahead.length} Commits · ${e.files.length} Dateien${e.dirty.length ? ` · ${e.dirty.length} uncommittet` : ""}${e.behind ? ` · ${e.behind} hinter main` : ""}</small></h3>
<ul>${commits}</ul>
${files ? `<details data-k="${k}-f"><summary>${e.fileStats.length} Dateien mit Zeilen</summary><table>${files}</table></details>` : ""}
<h3>Testinstanz</h3><p class="${e.instance.up ? (e.instance.current === false ? "warn" : "ok") : "idle"}">${esc(e.instance.label)}${e.instance.url ? ` – <a href="${esc(e.instance.url)}">${esc(e.instance.url)}</a>` : ""}</p>
<h3>Was testen</h3><ul>${tests.map((t) => `<li>${t}</li>`).join("") || "<li class=\"idle\">nichts Testbares erkannt</li>"}</ul>
</section>`;
    });
    return cards.join("\n") || "<p>Keine Worktrees mit Änderungen oder Agenten.</p>";
}

const PAGE_CSS = `:root{--bg:#f6f6fa;--fg:#1c1c28;--card:#fff;--mut:#666;--ok:#0a7d4b;--warn:#b45309;--run:#6d28d9;--add:#0a7d4b;--del:#b91c1c;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--bg:#14141c;--fg:#e8e8f0;--card:#1e1e2a;--mut:#9a9ab0;--ok:#4ade80;--warn:#fbbf24;--run:#a78bfa;--add:#4ade80;--del:#f87171}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:960px;margin:auto}
section{background:var(--card);border-radius:10px;padding:16px 20px;margin:0 0 16px}h1{font-size:1.4rem}h2{font-size:1.15rem;margin:0 0 8px}h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:14px 0 4px}
small,em{color:var(--mut);font-weight:400;font-style:normal}ul{margin:0;padding-left:20px}.pill{font-size:.75rem;border:1px solid currentColor;border-radius:99px;padding:1px 8px;text-decoration:none}
.run b{color:var(--run)}.idle{color:var(--mut)}.ok{color:var(--ok)}.warn{color:var(--warn)}p{margin:0}code{font-size:.85em}a{color:inherit}
.sub{color:var(--mut);font-size:.88rem}.pre{white-space:pre-wrap}details{margin:2px 0}summary{cursor:pointer;color:var(--mut);font-size:.88rem}
table{border-collapse:collapse;font-size:.85rem}td{padding:1px 8px 1px 0}.add{color:var(--add);text-align:right}.del{color:var(--del);text-align:right}`;

/** Self-contained HTML page. With `refreshSeconds` the page fetches `/fragment` itself and keeps opened details open. */
function formatHtml(entries, { now = Date.now(), refreshSeconds = 0 } = {}) {
    const script = refreshSeconds ? `<script>
const root = document.getElementById("root"), stamp = document.getElementById("stamp");
async function tick() {
    try {
        const open = new Set([...root.querySelectorAll("details[open]")].map((d) => d.dataset.k));
        const res = await fetch("/fragment", { cache: "no-store" });
        if (!res.ok) throw new Error(res.status);
        root.innerHTML = await res.text();
        root.querySelectorAll("details").forEach((d) => { if (open.has(d.dataset.k)) d.open = true; });
        stamp.textContent = "aktualisiert " + new Date().toLocaleTimeString("de-DE");
    } catch (e) { stamp.textContent = "keine Verbindung zum Skript"; }
}
setInterval(tick, ${refreshSeconds * 1000});
</script>` : "";
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenten-Übersicht</title>
<style>${PAGE_CSS}</style></head><body><main>
<h1>Agenten-Übersicht <small id="stamp">Stand ${esc(new Date(now).toLocaleString("de-DE"))}</small></h1>
<div id="root">${renderCards(entries, { now })}</div></main>${script}</body></html>`;
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
    if (orphans.length) entries.push({ path: "", name: "(ohne Worktree)", branch: "", head: "", ahead: [], behind: 0, committed: [], dirty: [], files: [], fileStats: [], pr: null, prTests: [], hints: [], port: 0, agents: orphans, primary: false });
    await Promise.all(entries.map(async (e) => { e.instance = instanceState(e, await healthFn(e.port)); }));
    entries.forEach((e, i) => { e.primary = i === 0; });
    return entries.filter((e) => !e.primary || all).filter((e) => all || e.agents.length || e.ahead.length || e.dirty.length);
}

function parseArgs(argv) {
    const o = { hours: 24, all: false, usePr: true, json: false, html: false, watch: 0, serve: 0 };
    // An optional number right behind a flag, else the flag's default.
    const numberAfter = (i, fallback) => (/^\d+$/.test(argv[i + 1] || "") ? Number(argv[i + 1]) : fallback);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--all") o.all = true;
        else if (a === "--no-pr") o.usePr = false;
        else if (a === "--json") o.json = true;
        else if (a === "--html") o.html = true;
        else if (a === "--hours") o.hours = Number(argv[++i]) || 24;
        else if (a === "--watch") o.watch = Math.max(2, numberAfter(i, 10));
        else if (a === "--serve") o.serve = numberAfter(i, 3099);
    }
    return o;
}

/** `gh pr list` is slow and rate limited; a refreshing view asks it at most once per `ttlMs`. */
function cachedPulls(fn, ttlMs = 60000, clock = Date.now) {
    let at = 0;
    let value = null;
    return (cwd) => {
        if (clock() - at > ttlMs) { value = fn(cwd); at = clock(); }
        return value;
    };
}

/** Local page on 127.0.0.1 that refreshes itself; `/data.json` has the raw data. Returns the listening server. */
function serve(opts, { port = opts.serve, refreshSeconds = 10, log = console.log, collectFn = collect } = {}) {
    const pullsFn = cachedPulls(ghPullRequests);
    const server = http.createServer(async (req, res) => {
        try {
            const entries = await collectFn({ ...opts, pullsFn });
            const url = String(req.url || "/").split("?")[0];
            if (url === "/fragment") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(renderCards(entries));
            else if (url === "/data.json") res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(entries));
            else if (url === "/") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(formatHtml(entries, { refreshSeconds }));
            else res.writeHead(404).end("not found");
        } catch (err) {
            res.writeHead(500).end(String(err && err.message));
        }
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            log(`Agenten-Übersicht: http://localhost:${server.address().port}/  (aktualisiert sich alle ${refreshSeconds} s, Strg+C beendet)`);
            resolve(server);
        });
    });
}

/** Redraws the text report every `seconds` until the process is stopped. */
async function watch(opts, { seconds = opts.watch, write = (s) => process.stdout.write(s) } = {}) {
    const pullsFn = cachedPulls(ghPullRequests);
    for (;;) {
        const entries = await collect({ ...opts, pullsFn });
        write("\x1b[2J\x1b[H" + formatText(entries).join("\n") + `\n\nStand ${new Date().toLocaleTimeString("de-DE")} - alle ${seconds} s neu, Strg+C beendet\n`);
        await new Promise((r) => setTimeout(r, seconds * 1000));
    }
}

/** Where `--html` writes the page: the temp directory, a scratch file outside every checkout (#418). */
function htmlFile(tmpdir = os.tmpdir()) {
    return path.join(tmpdir, "eventhelper-agent-overview.html");
}

async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
    const opts = parseArgs(argv);
    if (opts.serve) { await serve(opts, { log }); return null; } // keeps running: the listening server holds the process
    if (opts.watch) return watch(opts);
    const entries = await collect(opts);
    if (opts.json) log(JSON.stringify(entries, null, 2));
    else formatText(entries).forEach((l) => log(l));
    if (opts.html) {
        const file = htmlFile();
        fs.writeFileSync(file, formatHtml(entries));
        log(`HTML: ${file}`);
    }
    return 0;
}

if (require.main === module) {
    main().then((code) => { if (code !== null) process.exit(code); }, (err) => { console.error(err); process.exit(1); });
}

module.exports = {
    parseWorktrees, parseStatusLines, parseNameStatus, parsePort, testSectionFromBody, testHints, projectSlug,
    firstPrompt, findAgents, assignAgent, inspectWorktree, instanceState, formatText, formatHtml, renderCards, collect, parseArgs, main, taskOf, ago,
    parseNumstat, mergeFileStats, summaryFromBody, parseCommitLines, parseActivity, describeToolUse, readTail, cachedPulls, serve,
    htmlFile,
};
