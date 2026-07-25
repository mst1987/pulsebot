// Class + spec per raider, read out of a Warcraft-Logs (v1) report.
//
// The loot exports only sometimes carry a class (RCLootcouncil does, Gargul does
// not) and never a spec, so the raid's log is the fallback source. WCL v1 hands
// the same information back in different shapes depending on the endpoint and on
// how much the report knows about a player:
//   - report/fights   -> friendlies: { name, type: "Warrior", icon: "Warrior-Fury" }
//   - report/tables/*  -> entries:   { name, type, icon, specs: [{spec, role}],
//                                      talents: [{name, points}] }
// Everything here is pure parsing over those payloads: whatever the report does
// not know simply stays empty (a class without a spec is still worth showing).

const { VALID_CLASSES } = require("./logcheck/common");

const CLASS_SET = new Set(VALID_CLASSES);

/** The class part of a WCL entry ("Warrior" / "Warrior-Fury" / entry.type). */
function classOf(entry) {
    const type = String((entry && entry.type) || "").trim();
    if (CLASS_SET.has(type)) return type;
    const iconClass = String((entry && entry.icon) || "").split("-")[0].trim();
    return CLASS_SET.has(iconClass) ? iconClass : "";
}

/** "Warrior-Fury" -> "Fury". Icons without a spec suffix yield "". */
function specFromIcon(icon) {
    const parts = String(icon || "").split("-");
    if (parts.length < 2) return "";
    const spec = parts.slice(1).join("-").trim();
    // Some icons carry a size/style suffix instead of a spec (e.g. "Warrior-bw").
    return /^[A-Z][A-Za-z ]+$/.test(spec) ? spec : "";
}

/** WCL's `specs: [{ spec: "Fury", role: "dps" }]` (first entry wins). */
function specFromSpecs(specs) {
    if (!Array.isArray(specs)) return "";
    for (const s of specs) {
        const name = typeof s === "string" ? s : (s && s.spec);
        const clean = String(name || "").trim();
        if (clean) return clean;
    }
    return "";
}

/**
 * Talent trees as WCL reports them for Classic: `[{ name: "Arms", points: 17 },
 * …]`. The tree with the most points is the spec; without point counts a single
 * named tree is still unambiguous, anything else stays empty rather than guessed.
 */
function specFromTalents(talents) {
    if (!Array.isArray(talents) || !talents.length) return "";
    const named = talents
        .map((t) => ({ name: String((t && t.name) || "").trim(), points: Number(t && t.points) }))
        .filter((t) => t.name);
    if (!named.length) return "";
    const withPoints = named.filter((t) => Number.isFinite(t.points));
    if (withPoints.length) {
        const best = withPoints.reduce((a, b) => (b.points > a.points ? b : a));
        return best.points > 0 ? best.name : "";
    }
    return named.length === 1 ? named[0].name : "";
}

/** The spec of one WCL entry, from whichever field the report carries. */
function specOf(entry) {
    if (!entry) return "";
    return specFromSpecs(entry.specs)
        || specFromTalents(entry.talents)
        || specFromIcon(entry.icon);
}

function toRosterEntry(entry) {
    const name = String((entry && entry.name) || "").trim();
    if (!name) return null;
    const className = classOf(entry);
    if (!className) return null; // NPCs / pets / unknown types
    return { name, className, spec: specOf(entry) };
}

/** Roster from a report/fights payload (its `friendlies`). */
function rosterFromFights(fights) {
    return ((fights && fights.friendlies) || []).map(toRosterEntry).filter(Boolean);
}

/** Roster from a report/tables/* payload (its `entries`). */
function rosterFromTable(table) {
    return ((table && table.entries) || []).map(toRosterEntry).filter(Boolean);
}

/**
 * Merge several rosters into one list, deduplicated by name (case-insensitively).
 * A later entry only overwrites an earlier one where it actually knows more — so
 * a spec-carrying table entry beats a bare `friendlies` entry, never the reverse.
 */
function mergeRosters(...rosters) {
    const byName = new Map();
    for (const roster of rosters) {
        for (const entry of roster || []) {
            if (!entry || !entry.name) continue;
            const key = entry.name.toLowerCase();
            const prev = byName.get(key);
            if (!prev) {
                byName.set(key, { ...entry });
                continue;
            }
            if (!prev.spec && entry.spec) prev.spec = entry.spec;
            if (!prev.className && entry.className) prev.className = entry.className;
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
    classOf, specOf, specFromIcon, specFromSpecs, specFromTalents,
    rosterFromFights, rosterFromTable, mergeRosters,
};
