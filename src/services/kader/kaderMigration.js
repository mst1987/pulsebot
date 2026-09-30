// The Kaderplaner of #566 (rosters with a size, role targets, members, bench and
// setups per roster) becomes the planner of Kader with persistent player states
// (docs/kaderplaner.md, "Umstellung"). Pure; settingsMigration.js runs it once
// at start with the profiles as a second source of character data, and
// kaderModel.normalizePlanner falls back to it for a file the start did not
// migrate.
//
//   old roster        → a Kader (same id and name, no leads yet)
//   old member        → state "roster", decision = the spec of the account's
//                       character that fits the old role slot, else its main spec
//   old bench         → state "bench"
//   every player      → wishes = [its main spec] (the decision first when it has one)
//   old setup variant → an example setup: size 20 when the roster had 15 or
//                       more places, else 10; the first four groups are kept
//   accounts, assignments stay as they are (known accounts, character data per server)
const { rulesFor } = require("../../config/gameVersions");
const { buildClasses } = require("../../config/gameVersions/classes");

const PLANNER_VERSION = "forever";
const GROUPS = 4;
const SLOTS = 5;

let roleIndex = null;
/** The role of a spec key of the planner's rule set ("Warrior-Protection" → "tank"). */
function defaultRoleOf(specKey) {
    if (!roleIndex) {
        roleIndex = new Map();
        const rules = rulesFor(PLANNER_VERSION);
        for (const c of rules ? buildClasses(rules.classes) : []) for (const s of c.specs) roleIndex.set(s.key, s.role);
    }
    return roleIndex.get(specKey) || "";
}

const str = (v) => (v === null || v === undefined ? "" : String(v));

/**
 * What the planner's own character data says about an account:
 * `{ className, specs: [specKey], mainSpec }` of its active character, or null.
 */
function charOfAssignments(raw) {
    const assignments = raw && raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {};
    return (userId) => {
        const a = assignments[userId];
        if (!a || !Array.isArray(a.characters) || !a.characters.length) return null;
        const c = a.characters.find((x) => x && x.id === a.activeCharacterId) || a.characters[0];
        if (!c || !c.className) return null;
        const specs = (Array.isArray(c.specs) ? c.specs : []).map((s) => str(s && s.spec)).filter(Boolean);
        const main = (Array.isArray(c.specs) ? c.specs : []).find((s) => s && s.main);
        return { className: str(c.className), specs, mainSpec: main ? str(main.spec) : (specs[0] || "") };
    };
}

/** The spec an old member stood for: one of the character's specs that fits the old role, else the main one. */
function decisionFor(char, role, roleOf) {
    if (!char || !char.className) return null;
    const fitting = role ? char.specs.find((s) => roleOf(s) === role) : "";
    const spec = fitting || char.mainSpec || char.specs[0] || "";
    return spec ? { className: char.className, spec } : null;
}

function entryFor(state, decision, char, now) {
    const main = char && char.mainSpec ? { className: char.className, spec: char.mainSpec } : null;
    const wishes = [];
    if (decision) wishes.push(decision);
    if (main && (!decision || main.spec !== decision.spec)) wishes.push(main);
    return {
        state,
        since: now,
        by: "",
        addedAt: now,
        addedBy: "",
        history: [{ at: now, by: "", type: "migrated", to: state }],
        wishes,
        interview: {},
        votes: {},
        comments: [],
        decision: state === "roster" ? decision : null,
    };
}

function variantFrom(v, roster, players) {
    const size = Number(roster.size) >= 15 ? 20 : 10;
    const groups = Array.from({ length: GROUPS }, (_, gi) => Array.from({ length: SLOTS }, (_, si) => {
        const g = Array.isArray(v.groups) && Array.isArray(v.groups[gi]) ? v.groups[gi] : [];
        const userId = typeof g[si] === "string" ? g[si] : "";
        const entry = userId && players[userId];
        if (!entry) return null;
        const spec = entry.decision ? entry.decision.spec : (entry.wishes[0] ? entry.wishes[0].spec : "");
        return { userId, spec };
    }));
    return { id: str(v.id), name: str(v.name) || "Variante", size, groups };
}

/**
 * The #566 planner of one server in the Kader shape, or null when it is not an
 * old one (already migrated, or empty).
 * @param {object} raw     the stored planner of one server
 * @param {{ now?: string, charOf?: (userId: string) => ({ className, specs, mainSpec }|null), roleOf?: (spec: string) => string }} ctx
 */
function migrateLegacyPlanner(raw, { now = "", charOf = charOfAssignments(raw), roleOf = defaultRoleOf } = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw.kaders) || !Array.isArray(raw.rosters)) return null;
    const kaders = raw.rosters.filter((r) => r && r.id).map((r) => {
        const players = {};
        for (const m of Array.isArray(r.members) ? r.members : []) {
            const userId = str(m && m.userId);
            if (!userId || players[userId]) continue;
            const char = charOf(userId);
            players[userId] = entryFor("roster", decisionFor(char, str(m.role), roleOf), char, now);
        }
        for (const id of Array.isArray(r.bench) ? r.bench : []) {
            const userId = str(id);
            if (!userId || players[userId]) continue;
            const char = charOf(userId);
            players[userId] = entryFor("bench", decisionFor(char, "", roleOf), char, now);
        }
        const oldSetup = raw.setups && raw.setups[r.id];
        const setups = (oldSetup && Array.isArray(oldSetup.variants) ? oldSetup.variants : [])
            .filter((v) => v && v.id)
            .map((v) => variantFrom(v, r, players));
        return { id: str(r.id), name: str(r.name) || "Kader", leads: [], createdAt: now, createdBy: "", questions: [], players, setups };
    });
    return {
        v: 2,
        accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
        assignments: raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {},
        kaders,
    };
}

/** Counts for the migration's log line. */
function migrationSummary(planner) {
    const out = { kaders: 0, roster: 0, bench: 0, variants: 0 };
    for (const k of (planner && planner.kaders) || []) {
        out.kaders += 1;
        out.variants += k.setups.length;
        for (const e of Object.values(k.players)) {
            if (e.state === "roster") out.roster += 1;
            if (e.state === "bench") out.bench += 1;
        }
    }
    return out;
}

module.exports = { migrateLegacyPlanner, charOfAssignments, decisionFor, migrationSummary, defaultRoleOf };
