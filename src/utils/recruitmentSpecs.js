// Detects and rewrites the "which classes/specs are wanted" block inside a
// recruitment template's free-text body, so the admin menu can offer an
// icon-based add/remove picker instead of hand-typing the block.
//
// Deliberately dependency-free (no Node/DOM APIs) — this whole module is
// embedded verbatim (via Function#toString) into the admin page's inline
// client script, so the exact same parsing logic runs server-side (initial
// pill state at render time) and client-side (live re-parse on add/remove).
// Keep every exported function pure and self-contained for that to keep working.

const extendedClassList = require("../config/classlist.js");

// One entry per distinct spec (aliases in classlist.js like "Holy1"/"HolyPala"
// share the same `spec` key and collapse into a single catalog entry).
const SPEC_CATALOG = (() => {
    const bySpec = new Map();
    for (const entry of Object.values(extendedClassList)) {
        if (!bySpec.has(entry.spec)) {
            bySpec.set(entry.spec, { key: entry.spec, name: entry.name, icon: entry.icon, sodclazz: entry.sodclazz || "" });
        }
    }
    return [...bySpec.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

// A "## <emoji> Label" (or "## Label") heading line.
const SPEC_LINE_RE = /^##\s+(?:<a?:([A-Za-z0-9_~]+):(\d+)>\s*)?(.+?)\s*$/;

/** Find the catalog entry for a detected icon name and/or label text. */
function resolveSpec(iconName, label) {
    const icon = (iconName || "").toLowerCase();
    const text = (label || "").trim().toLowerCase();
    if (icon) {
        const byIcon = SPEC_CATALOG.find((s) => s.icon.toLowerCase() === icon);
        if (byIcon) return byIcon;
        // Guild-uploaded emoji names don't always match classlist.js exactly
        // (e.g. a guild's "beastmastery" emoji vs. classlist's "beastmaster" icon
        // key) — a same-prefix fallback catches these common near-misses.
        const byIconPrefix = SPEC_CATALOG.find((s) => {
            const si = s.icon.toLowerCase();
            return si.length > 3 && icon.length > 3 && (si.startsWith(icon) || icon.startsWith(si));
        });
        if (byIconPrefix) return byIconPrefix;
    }
    if (text) {
        const byName = SPEC_CATALOG.find((s) => s.name.toLowerCase() === text);
        if (byName) return byName;
    }
    return null;
}

/**
 * Scan a template body for the contiguous run of "## …" heading lines that
 * make up the wanted-specs block: the longest consecutive run of heading
 * lines containing at least one line that resolves to a known spec. Returns
 * line indices (into body.split("\n")) so callers can splice the block.
 */
function parseWantedBlock(body) {
    const lines = String(body || "").split("\n");
    const runs = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const m = SPEC_LINE_RE.exec(lines[i]);
        if (m) {
            const spec = resolveSpec(m[1], m[3]);
            const entry = { index: i, raw: lines[i], iconName: m[1] || "", iconId: m[2] || "", label: m[3], spec };
            if (!current) { current = { start: i, entries: [entry] }; } else { current.entries.push(entry); }
        } else if (current) {
            runs.push(current);
            current = null;
        }
    }
    if (current) runs.push(current);

    const block = runs.find((r) => r.entries.some((e) => e.spec)) || null;
    return {
        lines,
        blockStart: block ? block.start : -1,
        blockEnd: block ? block.start + block.entries.length - 1 : -1,
        entries: block ? block.entries : [],
    };
}

/** Render a single "## <emoji> Name" line for a catalog spec. */
function buildSpecLine(spec, emojiCode) {
    return emojiCode ? `## ${emojiCode} ${spec.name}` : `## ${spec.name}`;
}

/**
 * Append `spec` to the body's wanted-specs block, creating the block if none
 * exists yet — right after a line that looks like a "Gesucht"/"wanted"
 * heading, or at the end of the body as a last resort. Never touches
 * unrelated lines.
 */
function insertSpecLine(body, spec, emojiCode) {
    const parsed = parseWantedBlock(body);
    const { lines } = parsed;
    const newLine = buildSpecLine(spec, emojiCode);

    if (parsed.blockEnd >= 0) {
        lines.splice(parsed.blockEnd + 1, 0, newLine);
        return lines.join("\n");
    }

    const headingIdx = lines.findIndex((l) => /gesucht|wanted|looking for/i.test(l.replace(/^#+\s*/, "").replace(/<a?:\w+:\d+>/g, "")));
    if (headingIdx >= 0) {
        lines.splice(headingIdx + 1, 0, newLine);
        return lines.join("\n");
    }

    const prefix = lines.length && lines.some((l) => l.trim()) ? [...lines, "", "## Gesucht", newLine] : ["## Gesucht", newLine];
    return prefix.join("\n");
}

/** Remove the block line at `lineIndex` (as returned in parseWantedBlock entries) verbatim. */
function removeSpecLine(body, lineIndex) {
    const lines = String(body || "").split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return body;
    lines.splice(lineIndex, 1);
    return lines.join("\n");
}

module.exports = {
    SPEC_CATALOG, SPEC_LINE_RE, resolveSpec, parseWantedBlock, buildSpecLine, insertSpecLine, removeSpecLine,
};
