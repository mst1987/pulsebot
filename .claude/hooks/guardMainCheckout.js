#!/usr/bin/env node
"use strict";

/**
 * PreToolUse hook (Edit / Write / MultiEdit / NotebookEdit).
 *
 * CLAUDE.md: every code change happens in a feature worktree; the primary
 * checkout stays on `main` with a clean working tree. This hook turns that
 * rule into a hard stop: an edit whose target lies in the *main* worktree of
 * this repository is refused with a hint to create a worktree first.
 *
 * What passes:
 *  - files in any linked worktree (../eventhelper-<name>)
 *  - files outside a git repository (scratchpad, memory dir, ...)
 *  - files in a *different* repository
 *  - git-ignored files (.env.dev, data/, coverage/) - they never dirty the tree
 *  - everything when EVENTHELPER_ALLOW_MAIN_EDITS=1 is set (deliberate override)
 *
 * Exit code 2 blocks the tool call and shows stderr to Claude.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OVERRIDE_ENV = "EVENTHELPER_ALLOW_MAIN_EDITS";

function git(args, cwd) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
}

function tryGit(gitFn, args, cwd) {
    try {
        return gitFn(args, cwd);
    } catch {
        return null;
    }
}

/** Nearest existing ancestor directory of a (possibly not yet created) file. */
function existingDir(filePath) {
    let dir = path.dirname(path.resolve(filePath));
    while (!fs.existsSync(dir)) {
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
    return dir;
}

/** `{ gitDir, commonDir }` resolved to absolute paths, or null outside a repo. */
function repoDirs(dir, gitFn) {
    const gitDir = tryGit(gitFn, ["rev-parse", "--git-dir"], dir);
    const commonDir = tryGit(gitFn, ["rev-parse", "--git-common-dir"], dir);
    if (!gitDir || !commonDir) return null;
    return {
        gitDir: path.resolve(dir, gitDir),
        commonDir: path.resolve(dir, commonDir),
    };
}

function isIgnored(filePath, dir, gitFn) {
    return tryGit(gitFn, ["check-ignore", "-q", "--", path.resolve(filePath)], dir) !== null;
}

function targetPath(input) {
    const ti = (input && input.tool_input) || {};
    return ti.file_path || ti.notebook_path || null;
}

/**
 * Decide whether the edit may go ahead.
 * @param {object} input  hook payload from stdin
 * @param {object} opts   { projectDir, env, gitFn } - injectable for tests
 * @returns {{ allow: boolean, reason?: string }}
 */
function decide(input, opts = {}) {
    const env = opts.env || process.env;
    const gitFn = opts.gitFn || git;
    const projectDir = opts.projectDir || env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

    const filePath = targetPath(input);
    if (!filePath) return { allow: true };
    if (env[OVERRIDE_ENV] === "1") return { allow: true, reason: `${OVERRIDE_ENV}=1` };

    const dir = existingDir(filePath);
    if (!dir) return { allow: true };

    const target = repoDirs(dir, gitFn);
    if (!target) return { allow: true }; // not inside a git repository
    if (target.gitDir !== target.commonDir) return { allow: true }; // a linked worktree

    const project = repoDirs(projectDir, gitFn);
    if (!project || project.commonDir !== target.commonDir) return { allow: true }; // another repo

    if (isIgnored(filePath, dir, gitFn)) return { allow: true };

    const top = tryGit(gitFn, ["rev-parse", "--show-toplevel"], dir) || path.dirname(target.commonDir);
    return {
        allow: false,
        reason: [
            `Edit refused: ${path.resolve(filePath)} lies in the primary checkout (${top}).`,
            "CLAUDE.md: the primary checkout stays on `main` with a clean working tree - every change,",
            "however small, is made in a feature worktree:",
            "    git fetch origin && git checkout main && git pull --ff-only origin main",
            "    git worktree add ../eventhelper-<name> -b feature/<name> main",
            "then edit the file under ../eventhelper-<name>/ instead.",
            `(Deliberate override for a one-off: set ${OVERRIDE_ENV}=1.)`,
        ].join("\n"),
    };
}

function readStdin() {
    try {
        return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    } catch {
        return {};
    }
}

function main() {
    const verdict = decide(readStdin());
    if (verdict.allow) return 0;
    process.stderr.write(verdict.reason + "\n");
    return 2;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { decide, existingDir, repoDirs, targetPath, OVERRIDE_ENV };
