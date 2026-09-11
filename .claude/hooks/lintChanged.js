#!/usr/bin/env node
"use strict";

/**
 * PostToolUse hook (Edit / Write / MultiEdit).
 *
 * Runs ESLint on the file that was just written so style errors (double
 * quotes, semicolons, eqeqeq, ...) reach Claude immediately instead of at
 * `npm run lint` before the PR. Two toolchains, picked by path:
 *
 *  - bot code (src/, test/, .claude/hooks/, jest.config.js): the root
 *    eslint.config.mjs
 *  - the React client (src/web-client/): its own eslint.config.js, run from
 *    that directory
 *
 * Anything else (docs, JSON, data files) is skipped. A missing ESLint install
 * (fresh worktree before `npm ci`) skips silently as well - the hook must never
 * become the reason an edit "fails".
 *
 * Exit code 2 feeds stderr back to Claude; the edit itself already happened.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WEB_CLIENT = "src/web-client";
const BOT_FILE = /^(src|test|\.claude\/hooks)\/.*\.js$|^jest\.config\.js$/;
const CLIENT_FILE = /\.(js|jsx|ts|tsx)$/;

function toPosix(p) {
    return p.split(path.sep).join("/");
}

/**
 * Where and how to lint a file, or null when it is not a lint target.
 * @returns {{ cwd: string, file: string } | null}
 */
function lintTarget(filePath, projectDir) {
    if (!filePath) return null;
    const abs = path.resolve(filePath);
    const rel = toPosix(path.relative(projectDir, abs));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // outside the project

    if (rel.startsWith(WEB_CLIENT + "/")) {
        if (rel.startsWith(WEB_CLIENT + "/dist/") || rel.startsWith(WEB_CLIENT + "/node_modules/")) return null;
        if (!CLIENT_FILE.test(rel)) return null;
        return { cwd: path.join(projectDir, WEB_CLIENT), file: abs };
    }
    if (BOT_FILE.test(rel)) return { cwd: projectDir, file: abs };
    return null;
}

/**
 * Path of the ESLint CLI installed for `cwd`, or null. ESLint's package
 * `exports` map does not expose `bin/`, so it is located next to package.json.
 */
function eslintBin(cwd) {
    try {
        const pkg = require.resolve("eslint/package.json", { paths: [cwd] });
        const bin = path.join(path.dirname(pkg), "bin", "eslint.js");
        return fs.existsSync(bin) ? bin : null;
    } catch {
        return null;
    }
}

function targetPath(input) {
    const ti = (input && input.tool_input) || {};
    return ti.file_path || null;
}

/**
 * @param {object} input  hook payload from stdin
 * @param {object} opts   { projectDir, spawn, resolveBin } - injectable for tests
 * @returns {{ status: number, output: string }}
 */
function run(input, opts = {}) {
    const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
    const spawn = opts.spawn || spawnSync;
    const resolveBin = opts.resolveBin || eslintBin;

    const target = lintTarget(targetPath(input), projectDir);
    if (!target || !fs.existsSync(target.file)) return { status: 0, output: "" };

    const bin = resolveBin(target.cwd);
    if (!bin) return { status: 0, output: "" };

    const result = spawn(process.execPath, [bin, "--no-warn-ignored", "--", target.file], {
        cwd: target.cwd,
        encoding: "utf8",
    });
    if (result.error) return { status: 0, output: "" }; // could not start ESLint: not the edit's fault
    if (result.status === 0) return { status: 0, output: "" };

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return {
        status: 2,
        output: `ESLint reports problems in ${path.relative(projectDir, target.file)} - fix them before moving on:\n${output}`,
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
    const { status, output } = run(readStdin());
    if (output) process.stderr.write(output + "\n");
    return status;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { run, lintTarget, eslintBin, targetPath };
