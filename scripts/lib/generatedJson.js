// Where the generators write, and how: every generated data file of the bot
// lives in src/config/generated/ as plain JSON (see the README there). No
// generator writes JavaScript or splices a block into a hand-written module any
// more — the modules that use the data load the JSON.
//
// formatJson() keeps the files diffable: anything that fits on one line of
// MAX_WIDTH characters stays on one line (an item row, a boss's drop list, a
// spell entry), everything else is broken up one entry per line.

const fs = require("fs");
const path = require("path");

const GENERATED_DIR = path.join(__dirname, "..", "..", "src", "config", "generated");
const MAX_WIDTH = 120;
const INDENT = "  ";

function inline(value) {
    if (Array.isArray(value)) return `[${value.map((v) => inline(v === undefined ? null : v)).join(", ")}]`;
    if (value && typeof value === "object") {
        const parts = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
        return `{${parts.join(", ")}}`;
    }
    const json = JSON.stringify(value);
    return json === undefined ? "null" : json;
}

/**
 * JSON text of `value`: parses back to exactly what JSON.stringify would give,
 * laid out for a readable diff.
 * @param {*} value
 * @param {string} [indent] the indentation the value starts at
 * @returns {string}
 */
function formatJson(value, indent = "") {
    const flat = inline(value);
    const isContainer = value && typeof value === "object";
    if (!isContainer || indent.length + flat.length <= MAX_WIDTH) return flat;
    const inner = indent + INDENT;
    if (Array.isArray(value)) {
        if (!value.length) return "[]";
        return `[\n${value.map((v) => inner + formatJson(v === undefined ? null : v, inner)).join(",\n")}\n${indent}]`;
    }
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
}

/**
 * Write `value` to src/config/generated/<relPath> (directories are created).
 * `dir` replaces the target directory (tests).
 * @returns {string} the absolute path written
 */
function writeGeneratedJson(relPath, value, dir = GENERATED_DIR) {
    const target = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${formatJson(value)}\n`);
    return target;
}

module.exports = { GENERATED_DIR, MAX_WIDTH, formatJson, writeGeneratedJson };
