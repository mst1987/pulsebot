#!/usr/bin/env node
"use strict";

/**
 * Stop / SubagentStop hook (#315).
 *
 * Runs scripts/check-main-clean.js when an agent is about to finish and refuses
 * the stop while the primary checkout holds anything that does not belong there
 * - an empty file a shell redirection left behind, a stray edit. The Edit guard
 * (guardMainCheckout.js) cannot see those; this one finds them at the moment
 * somebody would otherwise walk away from them.
 *
 * Never loops: Claude Code sets `stop_hook_active` on the second round, and the
 * hook then lets the stop through (the report has been shown once, the agent
 * either fixed it or cannot). A repository the script cannot read, a missing
 * git, an override of EVENTHELPER_ALLOW_MAIN_EDITS=1: all silent and allowing.
 *
 * Exit code 2 blocks the stop and shows stderr to Claude.
 */

const fs = require("fs");
const path = require("path");
const { OVERRIDE_ENV } = require("./guardMainCheckout");

const check = require(path.resolve(__dirname, "..", "..", "scripts", "check-main-clean.js"));

/**
 * @param {object} input hook payload from stdin
 * @param {object} opts  { env, findings } - injectable for tests
 * @returns {{ block: boolean, message: string }}
 */
function decide(input, opts = {}) {
    const env = opts.env || process.env;
    if (input && input.stop_hook_active) return { block: false, message: "" };
    if (env[OVERRIDE_ENV] === "1") return { block: false, message: "" };

    // No cwd: the script anchors on the repository it belongs to, so a session
    // that wandered into another directory still checks this checkout.
    const findings = opts.findings || check.findings;
    let result;
    try {
        result = findings({});
    } catch {
        return { block: false, message: "" }; // a guard that throws is worse than no guard
    }
    const lines = check.format(result);
    if (!lines.length) return { block: false, message: "" };
    return { block: true, message: lines.join("\n") };
}

function readStdin() {
    try {
        return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    } catch {
        return {};
    }
}

function main() {
    const { block, message } = decide(readStdin());
    if (!block) return 0;
    process.stderr.write(message + "\n");
    return 2;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { decide };
