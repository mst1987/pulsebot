#!/usr/bin/env node
"use strict";

/**
 * PreToolUse hook (Bash / PowerShell) - #315.
 *
 * guardMainCheckout.js stops Edit/Write/MultiEdit from touching the primary
 * checkout, but a shell writes past it: twice an empty file landed in
 * D:/programming/eventhelper that way, once through a PowerShell redirection
 * with a relative path, once through [IO.File]::WriteAllText.
 *
 * This guard is deliberately a *prefilter*, not a shell parser. It looks for
 * write targets it can read with certainty and refuses only when the resolved
 * path lies in the primary checkout of this repository and is not git-ignored.
 * Everything it cannot read with certainty passes - a guard that cries wolf
 * gets switched off, and the Stop hook (mainCheckoutClean.js) is the net that
 * catches whatever slips through here.
 *
 * What it reads:
 *   - `>` / `>>` redirection targets (bash and PowerShell alike)
 *   - Out-File / Set-Content / Add-Content / New-Item / Tee-Object / tee
 *   - [IO.File]::WriteAllText(…) and its siblings
 *
 * What it never judges (silence over false alarms):
 *   - anything inside quotes, a heredoc body, `[[ … ]]` or `(( … ))`
 *   - a target with a variable or a glob in it ($VAR, %TEMP%, *)
 *   - /dev/null, NUL and friends, and `2>&1`-style descriptor duplications
 *   - a *relative* target when the command changes directory itself (cd,
 *     Set-Location, pushd) - the base directory is then anybody's guess
 *   - paths outside the primary checkout, git-ignored ones (data/, .env.dev),
 *     and everything when EVENTHELPER_ALLOW_MAIN_EDITS=1 is set
 *
 * Exit code 2 blocks the tool call and shows stderr to Claude.
 */

const fs = require("fs");
const path = require("path");
const { primaryCheckoutOf, refusalText, OVERRIDE_ENV } = require("./guardMainCheckout");

// Sinks that are not files of ours.
const SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "con", "out-null", "$null"]);
// Commands whose target is a file they write.
const WRITERS = new Set(["out-file", "set-content", "add-content", "new-item", "tee-object", "tee"]);
// PowerShell parameters that name the file.
const PATH_FLAGS = new Set(["-path", "-filepath", "-literalpath", "-destination"]);
// PowerShell switches that take no value (anything else is assumed to take one).
const SWITCHES = new Set(["-force", "-recurse", "-append", "-nonewline", "-passthru", "-whatif", "-confirm", "-noclobber", "-verbose", "-wait"]);
// A command that moves itself somewhere else: relative targets stop being readable.
const CHANGES_DIR = /(^|[;&|(\n])\s*(cd|chdir|pushd|set-location)\s/i;
// [IO.File]::WriteAllText("…"), [System.IO.File]::AppendAllLines("…"), …
const DOTNET_WRITE = /\[(?:system\.)?io\.(?:file|directory)\]::(?:writeall\w+|appendall\w+|appendtext|createtext|create|openwrite|createdirectory)\s*\(\s*(['"])([^'"]+)\1/gi;

/** Index just past `close`, or the end of the string. */
function skipTo(src, from, close) {
    const at = src.indexOf(close, from);
    return at < 0 ? src.length : at + close.length;
}

/**
 * Drops the *body* of every heredoc (`<<EOF` … a line that is only `EOF`) and
 * keeps the line that opens it, because that line carries the redirection:
 * `cat <<'EOF' > src/x.js` is exactly the write this guard is here for, while
 * the body is text that regularly holds `>` of its own (JSX, HTML, a diff).
 */
function stripHeredocs(command) {
    const src = String(command || "");
    const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
    let out = "";
    let from = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        const lineEnd = src.indexOf("\n", m.index + m[0].length);
        if (lineEnd < 0) break; // a heredoc without a body: nothing to drop
        const end = new RegExp(`\\n[ \\t]*${m[2]}[ \\t]*(\\n|$)`).exec(src.slice(lineEnd));
        const stop = end ? lineEnd + end.index + end[0].length : src.length;
        out += src.slice(from, lineEnd);
        from = stop;
        re.lastIndex = stop;
    }
    return out + src.slice(from);
}

/**
 * The command as words and operators, quotes resolved. `quoted` marks a word
 * that came out of quotes, so it is never taken for a command name.
 * @returns {Array<{ kind: "word"|"redir"|"sep", text: string, quoted?: boolean }>}
 */
function scan(command) {
    const src = stripHeredocs(command);
    const out = [];
    let cur = "";
    let quoted = false;
    let started = false;
    const push = () => {
        if (started) out.push({ kind: "word", text: cur, quoted });
        cur = "";
        quoted = false;
        started = false;
    };
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "'") {
            const end = src.indexOf("'", i + 1);
            cur += end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
            i = end < 0 ? src.length : end + 1;
            quoted = true;
            started = true;
            continue;
        }
        if (ch === "\"") {
            let j = i + 1;
            while (j < src.length && src[j] !== "\"") {
                if (src[j] === "\\" && j + 1 < src.length) {
                    cur += src[j + 1];
                    j += 2;
                    continue;
                }
                cur += src[j];
                j++;
            }
            i = j + 1;
            quoted = true;
            started = true;
            continue;
        }
        if (ch === "(" && src[i + 1] === "(") { push(); i = skipTo(src, i + 2, "))"); continue; }
        if (ch === "[" && src[i + 1] === "[") { push(); i = skipTo(src, i + 2, "]]"); continue; }
        if (ch === ">") {
            push();
            const op = src[i + 1] === ">" ? ">>" : ">";
            out.push({ kind: "redir", text: op });
            i += op.length;
            continue;
        }
        if (/\s/.test(ch)) { push(); i++; continue; }
        if (ch === "|" || ch === ";" || ch === "&" || ch === "(" || ch === ")") {
            push();
            out.push({ kind: "sep", text: ch });
            i++;
            continue;
        }
        cur += ch;
        started = true;
        i++;
    }
    push();
    return out;
}

/** The raw targets a command names, before any path resolution. */
function rawTargets(command) {
    const tokens = scan(command);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === "redir") {
            const next = tokens[i + 1];
            if (next && next.kind === "word") out.push(next.text);
            continue;
        }
        if (t.kind !== "word" || t.quoted) continue;
        const name = t.text.toLowerCase().replace(/\.exe$/, "");
        if (!WRITERS.has(name)) continue;
        // Walk this command's own arguments: an explicit -Path wins, else the
        // first token that is neither a flag nor a flag's value.
        for (let j = i + 1; j < tokens.length; j++) {
            const a = tokens[j];
            if (a.kind !== "word") break; // a pipe or `;` ends the command
            const flag = a.text.toLowerCase();
            if (a.text.startsWith("-")) {
                if (PATH_FLAGS.has(flag)) {
                    const value = tokens[j + 1];
                    if (value && value.kind === "word") out.push(value.text);
                    break;
                }
                if (!SWITCHES.has(flag)) j++; // an unknown parameter is assumed to take a value
                continue;
            }
            out.push(a.text);
            break;
        }
    }
    let m;
    DOTNET_WRITE.lastIndex = 0;
    while ((m = DOTNET_WRITE.exec(String(command || ""))) !== null) out.push(m[2]);
    return out;
}

/**
 * An absolute path for a raw target, or "" when it cannot be read with certainty.
 * @param {object} opts { cwd, win32, relativeOk }
 */
function resolveTarget(raw, opts) {
    let p = String(raw || "").trim();
    if (!p || p.startsWith("&")) return ""; // `>&2`: a descriptor, not a file
    if (/[$%`*?]/.test(p)) return ""; // a variable or a glob: unknowable
    if (SINKS.has(p.toLowerCase())) return "";
    if (opts.win32) {
        const m = /^\/([A-Za-z])\/(.*)$/.exec(p); // Git-Bash: /d/programming/… is D:/programming/…
        if (m) p = `${m[1]}:/${m[2]}`;
    }
    const absolute = /^[A-Za-z]:[\\/]/.test(p) || (!opts.win32 && p.startsWith("/")) || (opts.win32 && /^[\\/]/.test(p));
    if (!absolute && !opts.relativeOk) return "";
    return path.resolve(opts.cwd, p);
}

/** Every write target of a command that can be read with certainty, absolute and deduped. */
function writeTargets(command, opts = {}) {
    const cwd = opts.cwd || process.cwd();
    const win32 = opts.win32 === undefined ? process.platform === "win32" : opts.win32;
    const relativeOk = !CHANGES_DIR.test(String(command || ""));
    const out = [];
    for (const raw of rawTargets(command)) {
        const abs = resolveTarget(raw, { cwd, win32, relativeOk });
        if (abs && !out.includes(abs)) out.push(abs);
    }
    return out;
}

/**
 * @param {object} input hook payload from stdin
 * @param {object} opts  { env, cwd, win32, projectDir, gitFn } - injectable for tests
 * @returns {{ allow: boolean, reason?: string }}
 */
function decide(input, opts = {}) {
    const env = opts.env || process.env;
    if (env[OVERRIDE_ENV] === "1") return { allow: true };

    const command = ((input && input.tool_input) || {}).command;
    if (!command) return { allow: true };

    const cwd = opts.cwd || (input && input.cwd) || process.cwd();
    const projectDir = opts.projectDir || env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
    for (const target of writeTargets(command, { cwd, win32: opts.win32 })) {
        const top = primaryCheckoutOf(target, { projectDir, gitFn: opts.gitFn });
        if (!top) continue;
        return {
            allow: false,
            reason: [
                refusalText("Shell write", target, top),
                "(This guard only reads obvious write targets - `>`, `>>`, Out-File, Set-Content,",
                "[IO.File]::WriteAll*. Run the command from the worktree instead.)",
            ].join("\n"),
        };
    }
    return { allow: true };
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

module.exports = { decide, writeTargets, rawTargets, resolveTarget, scan, stripHeredocs, OVERRIDE_ENV };
