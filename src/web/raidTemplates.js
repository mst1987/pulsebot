// Raid templates (#266): what an evening looks like — which instance(s) of which
// game version, how many players, how many of them tanks and healers, plus the
// optional rest (melee/ranged ranges, required buffs, signup deadline, fairness,
// wishes, the linked Raid-Helper template).
//
// Pure functions only; settingsStore.js keeps them on disk. The instances come
// from the rule set (config/gameVersions) and nowhere else — there are no custom
// raids, so a template naming an instance the rule set does not know is refused.
//
// Before #266 a "raid template" was just a Raid-Helper template `{ id, name }`.
// Such an entry is migrated on read: it becomes a template with
// `raidhelperTemplateId` set, no size and no instance, and the menu badges it
// "Größe ergänzen" until someone fills it in.

const {
    DEFAULT_VERSION, rulesFor, instance, compositionFor, defaultComposition,
} = require("../config/gameVersions");

const MAX_SIZE = 40;
// A signup deadline further out than two weeks before the raid is a typo.
const MAX_DEADLINE_HOURS = 336;
// How long an evening of this kind takes (#305) — the event inherits it.
// null = not set, then the event falls back to eventStore's default.
const MIN_DURATION = 30;
const MAX_DURATION = 600;

/** The id a legacy Raid-Helper entry gets — deterministic, so a re-read never changes it. */
function legacyId(raidhelperId) {
    return `rh-${raidhelperId}`;
}

/** Whether a stored entry is still the pre-#266 `{ id, name }` shape. */
function isLegacy(entry) {
    return !!entry && typeof entry === "object" && entry.versionId === undefined && entry.raidhelperTemplateId === undefined;
}

/** A legacy `{ id, name }` Raid-Helper entry as a template without size. */
function migrateLegacy(entry) {
    const rhId = String(entry.id || "").trim();
    return {
        id: legacyId(rhId),
        name: String(entry.name || "").trim() || `Raid-Helper ${rhId}`,
        versionId: DEFAULT_VERSION,
        instanceIds: [],
        size: null,
        composition: { tank: 0, healer: 0, melee: null, ranged: null },
        requiredBuffs: [],
        signupDeadline: null,
        durationMinutes: null,
        fairness: false,
        wishes: false,
        overflow: "bench",
        lockAtLimit: false,
        raidhelperTemplateId: rhId,
        createdAt: entry.createdAt || Date.now(),
        updatedAt: entry.updatedAt || Date.now(),
    };
}

const int = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : NaN;
};

function normalizeRange(raw) {
    if (!raw || typeof raw !== "object") return null;
    const min = int(raw.min);
    const max = int(raw.max);
    if (min === null && max === null) return null;
    return { min: min === null ? 0 : min, max };
}

/**
 * Bring a body (from the API or the file) into the stored shape, without
 * judging it — validateTemplate() does that. Unknown fields are dropped.
 */
function normalizeTemplate(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const comp = src.composition && typeof src.composition === "object" ? src.composition : {};
    const deadline = src.signupDeadline && typeof src.signupDeadline === "object" ? int(src.signupDeadline.hoursBefore) : null;
    const buffs = Array.isArray(src.requiredBuffs) ? src.requiredBuffs.map((b) => String(b).trim()).filter(Boolean) : [];
    const instances = Array.isArray(src.instanceIds) ? src.instanceIds.map((i) => String(i).trim()).filter(Boolean) : [];
    return {
        id: String(src.id || "").trim(),
        name: String(src.name || "").trim(),
        versionId: String(src.versionId || DEFAULT_VERSION).trim(),
        instanceIds: [...new Set(instances)],
        size: int(src.size),
        composition: {
            tank: int(comp.tank) ?? 0,
            healer: int(comp.healer) ?? 0,
            melee: normalizeRange(comp.melee),
            ranged: normalizeRange(comp.ranged),
        },
        requiredBuffs: [...new Set(buffs)],
        signupDeadline: deadline === null ? null : { hoursBefore: deadline },
        durationMinutes: int(src.durationMinutes),
        fairness: src.fairness === true,
        wishes: src.wishes === true,
        // What a full raid does with a new "Dabei", and whether it closes its
        // own signup then (#306) — the event copies both on creation.
        overflow: src.overflow === "off" ? "off" : "bench",
        lockAtLimit: src.lockAtLimit === true,
        raidhelperTemplateId: String(src.raidhelperTemplateId || "").trim(),
    };
}

/**
 * Check a normalized template against the rule set. Returns the first problem
 * as a German sentence, or "" when it is fine.
 *
 * A template without size is allowed — that is exactly the migrated state —
 * but once a size is set, tanks + healers (and the minimums of the ranges)
 * must fit into it.
 */
function validateTemplate(t) {
    if (!t.name) return "Name fehlt.";
    const rules = rulesFor(t.versionId);
    if (!rules) return `Unbekannte Spielversion „${t.versionId}“.`;
    for (const id of t.instanceIds) {
        if (!instance(t.versionId, id)) return `Instanz „${id}“ gibt es in ${rules.label} nicht.`;
    }
    const { tank, healer, melee, ranged } = t.composition;
    if (Number.isNaN(t.size)) return "Größe ist keine Zahl.";
    if (t.size !== null && (t.size < 1 || t.size > MAX_SIZE)) return `Größe muss zwischen 1 und ${MAX_SIZE} liegen.`;
    for (const [label, n] of [["Tanks", tank], ["Heiler", healer]]) {
        if (Number.isNaN(n) || n < 0) return `${label}: keine gültige Anzahl.`;
    }
    const limit = t.size === null ? MAX_SIZE : t.size;
    if (tank + healer > limit) return `Tanks + Heiler (${tank + healer}) passen nicht in die Größe ${limit}.`;
    let minimums = tank + healer;
    for (const [label, range] of [["Nahkampf", melee], ["Fernkampf", ranged]]) {
        if (!range) continue;
        if (Number.isNaN(range.min) || Number.isNaN(range.max) || range.min < 0 || (range.max !== null && range.max < 0)) {
            return `${label}: keine gültige Anzahl.`;
        }
        if (range.max !== null && range.min > range.max) return `${label}: Minimum ist größer als Maximum.`;
        if (range.max !== null && range.max > limit) return `${label}: Maximum ist größer als die Größe ${limit}.`;
        minimums += range.min;
    }
    if (minimums > limit) return `Tanks, Heiler und die Nah-/Fernkampf-Minima (${minimums}) passen nicht in die Größe ${limit}.`;
    const buffKeys = new Set([...rules.partyBuffs, ...rules.raidBuffs].map((b) => b.key));
    const unknown = t.requiredBuffs.find((b) => !buffKeys.has(b));
    if (unknown) return `Buff „${unknown}“ gibt es in ${rules.label} nicht.`;
    if (t.signupDeadline) {
        const h = t.signupDeadline.hoursBefore;
        if (Number.isNaN(h) || h < 0 || h > MAX_DEADLINE_HOURS) return `Anmeldeschluss: 0 bis ${MAX_DEADLINE_HOURS} Stunden vor Start.`;
    }
    if (t.durationMinutes !== null) {
        const d = t.durationMinutes;
        if (Number.isNaN(d) || d < MIN_DURATION || d > MAX_DURATION) return `Dauer: ${MIN_DURATION} bis ${MAX_DURATION} Minuten.`;
    }
    return "";
}

/**
 * The tanks and healers a template should propose for a size — the largest
 * suggestion over its instances (SSC + TK at 25 → the stricter of the two),
 * or defaultComposition() when it names none.
 * @returns {{ tank: number, healer: number }}
 */
function proposeComposition(versionId, instanceIds, size) {
    const insts = (instanceIds || []).map((id) => instance(versionId, id)).filter(Boolean);
    if (!insts.length) {
        const d = defaultComposition(size, versionId);
        return { tank: d.tanks, healer: d.healers };
    }
    let tank = 0;
    let healer = 0;
    for (const inst of insts) {
        const c = compositionFor({ ...inst, versionId }, size);
        tank = Math.max(tank, c.tanks);
        healer = Math.max(healer, c.healers);
    }
    return { tank, healer };
}

/**
 * A template as the API serves it: the stored fields plus what the list needs
 * to badge it — `needsSize` (migrated, "Größe ergänzen"), `incomplete` (an
 * instance with "Infos fehlen") and `defaultFor` (the categories that use it
 * as their default).
 */
function decorateTemplate(t, categoryDefaults = {}) {
    const incomplete = t.instanceIds.some((id) => {
        const inst = instance(t.versionId, id);
        return inst && inst.status === "incomplete";
    });
    return {
        ...t,
        needsSize: t.size === null,
        incomplete,
        defaultFor: Object.entries(categoryDefaults || {}).filter(([, tplId]) => tplId === t.id).map(([catId]) => catId),
    };
}

module.exports = {
    MAX_SIZE, MAX_DEADLINE_HOURS, MIN_DURATION, MAX_DURATION,
    legacyId, isLegacy, migrateLegacy, normalizeTemplate, validateTemplate, proposeComposition, decorateTemplate,
};
