#!/usr/bin/env node
"use strict";

// Moves source files into other folders and rewrites every path that points at
// them (#1006). The plan comes from scripts/lib/moveFiles.js; this file reads the
// checkout, moves the files and writes the changed ones.
//
//   node scripts/move-files.js <mapping.json> [--mirror-tests] [--dry]
//
// mapping.json: { "<from>": "<to>" } - a file or a whole folder; a target ending
// in "/" keeps the file name ("src/stores/eventStore.js": "src/stores/events/").
// --mirror-tests: the Jest tests of moved backend modules move along (test/ mirrors src/).
// --dry: only print what would happen.
//
// Nothing is staged; check with `git status` (renames show once added), then run
// the tests - paths built from pieces are not followed.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { planMove } = require("./lib/moveFiles");

// text files that may hold a path; images, fonts and the big generated tables are left out
const TEXT = /\.(c|m)?[jt]sx?$|\.(json|md|css|ya?ml|html)$/;
const SKIP = [/^assets\//, /^src\/web-client\/public\//, /\/i18n\/locales\//, /(^|\/)package-lock\.json$/];
const MAX_BYTES = 1024 * 1024;

function trackedFiles(root) {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
        .filter((file) => fs.existsSync(path.join(root, file)));
}

function readContents(root, files) {
    const contents = new Map();
    for (const file of files) {
        if (!TEXT.test(file) || SKIP.some((re) => re.test(file))) continue;
        const full = path.join(root, file);
        if (fs.statSync(full).size > MAX_BYTES) continue;
        contents.set(file, fs.readFileSync(full, "utf8"));
    }
    return contents;
}

function removeEmptyDirs(root, dir) {
    let current = dir;
    while (current && current !== ".") {
        const full = path.join(root, current);
        if (!fs.existsSync(full) || fs.readdirSync(full).length) return;
        fs.rmdirSync(full);
        current = path.posix.dirname(current);
    }
}

function run(argv, root = process.cwd(), log = console.log) {
    const mappingFile = argv.find((a) => !a.startsWith("--"));
    if (!mappingFile) throw new Error("Aufruf: node scripts/move-files.js <mapping.json> [--mirror-tests] [--dry]");
    const mapping = JSON.parse(fs.readFileSync(path.resolve(root, mappingFile), "utf8"));
    const files = trackedFiles(root);
    const plan = planMove(files, readContents(root, files), mapping, { mirrorTests: argv.includes("--mirror-tests") });

    for (const [from, to] of plan.moves) log(`${from} -> ${to}`);
    log(`${plan.moves.length} Dateien verschoben, ${plan.writes.size} Dateien angepasst`);
    for (const warning of plan.warnings) log(`Achtung: ${warning}`);
    if (argv.includes("--dry")) return plan;

    for (const [from, to] of plan.moves) {
        fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
        fs.renameSync(path.join(root, from), path.join(root, to));
    }
    for (const [file, content] of plan.writes) fs.writeFileSync(path.join(root, file), content, "utf8");
    for (const [from] of plan.moves) removeEmptyDirs(root, path.posix.dirname(from));
    return plan;
}

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}

module.exports = { run };
