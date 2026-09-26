#!/usr/bin/env node
"use strict";

// Reports anything that dirties the *primary* checkout of this repository
// (#315). CLAUDE.md: every change happens in a feature worktree and the primary
// checkout stays on `main` with a clean working tree - but the Edit guard
// (.claude/hooks/guardMainCheckout.js) only sees the Edit/Write tools. A shell
// redirection walks past it, and twice that left an empty file behind in the
// primary checkout without anybody noticing.
//
//   node scripts/check-main-clean.js         one line per finding, exit 1; silent and 0 when clean
//   node scripts/check-main-clean.js <dir>   look at the repository <dir> belongs to instead
//
// Runs from any worktree: the primary checkout is looked up through
// `git worktree list`, not through the current directory. Also used by the Stop
// hook (.claude/hooks/mainCheckoutClean.js), which turns a finding into a
// message to the agent that is about to call it a day.

const path = require("path");
const { execFileSync } = require("child_process");

// What lives in the primary checkout on purpose (.env, .env.dev, data/, ...)
// is git-ignored, and git status leaves an ignored file out on its own. There
// is no list of excused names here: a stray file is a finding until
// .gitignore says otherwise (#416).

const LABELS = {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    T: "typechange",
    U: "conflicted",
};

function git(args, cwd, { trim = true } = {}) {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return trim ? out.trim() : out;
}

function tryGit(gitFn, args, cwd, opts) {
    try {
        return gitFn(args, cwd, opts);
    } catch {
        return null;
    }
}

/**
 * The primary (non-linked) worktree of the repository `cwd` belongs to, or "".
 * `git worktree list` always names it first.
 */
function mainWorktree(cwd, gitFn = git) {
    const out = tryGit(gitFn, ["worktree", "list", "--porcelain"], cwd);
    if (!out) return "";
    const line = out.split(/\r?\n/).find((l) => l.startsWith("worktree "));
    return line ? path.resolve(line.slice("worktree ".length).trim()) : "";
}

/**
 * `git status --porcelain -z` into `[{ code, file }]`. The NUL format is used
 * because it needs no unquoting: a path with a space, an umlaut or a quote in it
 * arrives exactly as it is on disk. A rename carries its source as a second
 * entry, which is skipped.
 */
function parseStatus(raw) {
    const parts = String(raw || "").split("\0").filter((s) => s !== "");
    const out = [];
    for (let i = 0; i < parts.length; i++) {
        const item = parts[i];
        if (item.length < 4) continue;
        const code = item.slice(0, 2);
        out.push({ code, file: item.slice(3) });
        if (code[0] === "R" || code[0] === "C") i++; // the rename's source follows
    }
    return out;
}

/** "??" -> "untracked", " M" -> "modified", "MM" -> "modified". */
function label(code) {
    if (code === "??") return "untracked";
    if (code === "!!") return "ignored";
    return LABELS[code[0] !== " " ? code[0] : code[1]] || "changed";
}

/**
 * Everything that dirties the primary checkout.
 * @param {object} opts { cwd, gitFn } - injectable for tests
 * @returns {{ main: string, entries: Array<{ code: string, file: string, label: string }> }}
 */
function findings(opts = {}) {
    // Anchored on the script's own directory, not on where it was called from:
    // the repository to guard is the one this file belongs to.
    const cwd = opts.cwd || __dirname;
    const gitFn = opts.gitFn || git;
    const main = mainWorktree(cwd, gitFn);
    if (!main) return { main: "", entries: [] }; // not a git repository: nothing to guard

    // -uall lists every untracked file by name; the default would collapse a new
    // directory into "test/" and say nothing about what is in it. --ignored=no
    // spells out that a git-ignored file is never a finding.
    const raw = tryGit(gitFn, ["-C", main, "status", "--porcelain", "-z", "-uall", "--ignored=no"], cwd, { trim: false });
    if (raw === null) return { main, entries: [] };
    const entries = parseStatus(raw).map((e) => ({ ...e, label: label(e.code) }));
    return { main, entries };
}

/** The report, one line per finding; `[]` when the primary checkout is clean. */
function format({ main, entries }) {
    if (!entries.length) return [];
    const width = Math.max(...entries.map((e) => e.label.length));
    return [
        `The primary checkout is not clean: ${main}`,
        ...entries.map((e) => `  ${e.label.padEnd(width)}  ${e.file}`),
        "CLAUDE.md: the primary checkout stays on `main` with a clean working tree. Move these",
        "changes into a feature worktree (git worktree add ../eventhelper-<name> -b feature/<name> main)",
        "or remove them - an empty file a shell redirection left behind is the usual culprit.",
    ];
}

function main({ log = console.log, cwd } = {}) {
    const lines = format(findings({ cwd }));
    for (const line of lines) log(line);
    return lines.length ? 1 : 0;
}

if (require.main === module) {
    // An optional directory says which repository to look at; without one it is
    // the repository this script belongs to.
    process.exit(main({ cwd: process.argv[2] }));
}

module.exports = { findings, format, main, mainWorktree, parseStatus, label };
