// The example setups of one Kader (docs/kaderplaner.md, "Beispiel-Setups"):
// variants to play through in the leads' meeting. A setup never changes a
// player's state. Pure mutators like kaderModel.js.
//
//   { id, name, size: 10 | 20, groups: [[{ userId, spec } | null x5] x4] }
//
// The size is only a view: a 10er shows groups 1–2, and whoever stands in
// groups 3–4 counts as unplaced until the variant is a 20er again — switching
// never throws anybody out. The spec of a slot is one of the player's wishes
// (or their decision); the store's normalisation drops players who may not
// stand in a setup (pool, Vorauswahl) and places a player at most once.
const { newId } = require("../../utils/ids");
const {
    SETUP_STATES, SETUP_SIZES, GROUP_COUNT, GROUP_SIZE, LIMITS, str, invalid, notFound, conflict,
    withKader, cleanLabel, emptyGroups,
} = require("./kaderModel");
const { autoAssign } = require("./kaderAutoAssign");

/** The specs a player can stand for in a setup: their decision and their wishes. */
function specsOf(entry) {
    const out = [];
    if (entry.decision) out.push(entry.decision.spec);
    for (const w of entry.wishes) if (!out.includes(w.spec)) out.push(w.spec);
    return out;
}

/** The spec a player stands for by default: the decision in the roster, else the first wish. */
function defaultSpec(entry) {
    if (entry.state === "roster" && entry.decision) return entry.decision.spec;
    return entry.wishes[0] ? entry.wishes[0].spec : (entry.decision ? entry.decision.spec : "");
}

function getVariant(kader, variantId) {
    const variant = kader.setups.find((v) => v.id === str(variantId));
    if (!variant) throw notFound("Variante nicht gefunden.");
    return variant;
}

function cleanSize(raw) {
    const size = Number(raw);
    if (!SETUP_SIZES.includes(size)) throw invalid("Ein Beispiel-Setup ist ein 10er oder ein 20er.");
    return size;
}

/** The groups as given, with a spec each player can stand for. Players the normalisation drops later need no check here. */
function cleanGroups(raw, kader) {
    if (!Array.isArray(raw)) throw invalid("Gruppen fehlen.");
    return Array.from({ length: GROUP_COUNT }, (_, gi) => Array.from({ length: GROUP_SIZE }, (_, si) => {
        const slot = Array.isArray(raw[gi]) ? raw[gi][si] : null;
        if (!slot || typeof slot !== "object") return null;
        const userId = str(slot.userId);
        const entry = kader.players[userId];
        if (!entry || !SETUP_STATES.includes(entry.state)) return null;
        const allowed = specsOf(entry);
        const spec = allowed.includes(str(slot.spec)) ? str(slot.spec) : defaultSpec(entry);
        return { userId, spec };
    }));
}

function addVariant(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        if (kader.setups.length >= LIMITS.variants) throw conflict(`Mehr als ${LIMITS.variants} Varianten sind nicht vorgesehen.`);
        const source = input.copyFrom ? kader.setups.find((v) => v.id === str(input.copyFrom)) : null;
        if (input.copyFrom && !source) throw notFound("Variante nicht gefunden.");
        const variant = {
            id: newId(),
            name: input.name ? cleanLabel(input.name, "Name") : `Variante ${String.fromCharCode(65 + kader.setups.length)}`,
            size: source ? source.size : 20,
            groups: source ? JSON.parse(JSON.stringify(source.groups)) : emptyGroups(),
        };
        kader.setups.push(variant);
        return { variantId: variant.id };
    });
}

function saveVariant(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        const variant = getVariant(kader, input.variantId);
        if (input.name !== undefined) variant.name = cleanLabel(input.name, "Name");
        if (input.size !== undefined) variant.size = cleanSize(input.size);
        if (input.groups !== undefined) variant.groups = cleanGroups(input.groups, kader);
    });
}

function deleteVariant(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        getVariant(kader, input.variantId);
        if (kader.setups.length <= 1) throw conflict("Die letzte Variante bleibt.");
        kader.setups = kader.setups.filter((v) => v.id !== str(input.variantId));
    });
}

const STATE_ORDER = { roster: 0, provisional: 1, bench: 2, tentative: 3 };

/**
 * "Automatisch verteilen": the players of the chosen states (`sources`, default
 * roster + Vorläufig) spread over the groups the size shows; the groups a 10er
 * hides are emptied. `ctx.classes` gives each spec's class and role,
 * `ctx.rateOf(userId, categoryIds)` the attendance (0–1) over the Kader's raid
 * categories, which the heuristic places first.
 */
function autoVariant(planner, input, ctx) {
    const sources = (Array.isArray(input.sources) && input.sources.length ? input.sources : ["roster", "provisional"]).map(str);
    if (sources.some((s) => !SETUP_STATES.includes(s))) throw invalid("Diese Spieler können nicht in einem Setup stehen.");
    const roleOf = new Map();
    const classOf = new Map();
    for (const c of ctx.classes.values()) for (const s of c.specs) {
        roleOf.set(s.key, s.role);
        classOf.set(s.key, c.key);
    }
    return withKader(planner, input.kaderId, (kader) => {
        const variant = getVariant(kader, input.variantId);
        const members = Object.entries(kader.players)
            .filter(([, e]) => sources.includes(e.state))
            .sort(([a, ea], [b, eb]) => STATE_ORDER[ea.state] - STATE_ORDER[eb.state] || a.localeCompare(b))
            .map(([userId, e]) => {
                const spec = defaultSpec(e);
                const rate = ctx.rateOf ? ctx.rateOf(userId, kader.attendanceCategories || []) : 0;
                return { userId, spec, role: roleOf.get(spec) || "melee", classKey: classOf.get(spec) || "", rate: rate + (e.state === "roster" ? 2 : e.state === "provisional" ? 1 : 0) };
            });
        const visible = variant.size / GROUP_SIZE;
        const { groups } = autoAssign(members, visible);
        const specOf = new Map(members.map((m) => [m.userId, m.spec]));
        variant.groups = emptyGroups().map((g, gi) => g.map((_, si) => {
            const id = gi < visible && groups[gi] ? groups[gi][si] : null;
            return id ? { userId: id, spec: specOf.get(id) } : null;
        }));
    });
}

module.exports = { specsOf, defaultSpec, addVariant, saveVariant, deleteVariant, autoVariant };
