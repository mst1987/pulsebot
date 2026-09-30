// The Kaderplaner's own data (docs/kaderplaner.md) and every rule for changing
// it. Pure: each mutator takes the planner state of one server and returns a new
// one, or throws an AppError the router answers with its status.
//
//   { accounts:    [{ userId, displayName, addedAt }]           added by hand
//     assignments: { [userId]: { characters: [...], activeCharacterId } }
//     rosters:     [{ id, name, size, targets, members: [{ userId, role }], bench: [userId] }]
//     setups:      { [rosterId]: { variants: [{ id, name, groups: [[userId|null x5] ...] }] } } }
//
// A character: { id, name, nameStyle, className, specs: [{ spec, main, gear }],
// canTank, canHeal, onlineKey? } — nameStyle "forever" (Vorname Nachname) or
// "nick" (one free nickname) — keys in the code's own vocabulary ("Warrior",
// "Warrior-Protection", gear none|usable|ready). The planner's assignment wins
// inside the planner; it is never written back to the raider profile.
const { AppError } = require("../../web/http/apiResult");
const { isProfane, validateCharacterName } = require("../../utils/signup/characterNames");
const { newId } = require("../../utils/ids");
const { GROUP_SIZE, autoAssign } = require("./kaderAutoAssign");

const ROLES = ["tank", "healer", "melee", "ranged"];
const NAME_STYLES = ["forever", "nick"];
// A nickname: letters (umlauts too), digits, space, hyphen, apostrophe.
const NICK = /^[\p{L}\p{N}' -]+$/u;
const NICK_MIN = 2;
const NICK_MAX = 24;
const GEAR_LEVELS = ["none", "usable", "ready"];
const LIMITS = { accounts: 300, rosters: 30, variants: 6, characters: 8, name: 40 };
const SIZE_MIN = 5;
const SIZE_MAX = 40;
// An id typed by hand must look like a real Discord user id; one from the member list is taken as it is.
const DISCORD_ID = /^\d{17,20}$/;

const clone = (v) => JSON.parse(JSON.stringify(v));
const invalid = (message) => new AppError("invalid", 400, message);
const notFound = (message) => new AppError("not_found", 404, message);
const conflict = (message) => new AppError("conflict", 409, message);

function emptyPlanner() {
    return { accounts: [], assignments: {}, rosters: [], setups: {} };
}

/** Sensible role targets for a raid size (they add up to the size). */
function defaultTargets(size) {
    const presets = {
        10: { tank: 2, healer: 3, melee: 2, ranged: 3 },
        20: { tank: 2, healer: 5, melee: 7, ranged: 6 },
        25: { tank: 3, healer: 6, melee: 8, ranged: 8 },
        40: { tank: 4, healer: 10, melee: 14, ranged: 12 },
    };
    if (presets[size]) return { ...presets[size] };
    const tank = Math.max(1, Math.round(size / 10));
    const healer = Math.max(1, Math.round(size / 4));
    const melee = Math.round((size - tank - healer) / 2);
    return { tank, healer, melee, ranged: Math.max(0, size - tank - healer - melee) };
}

const groupCount = (size) => Math.max(1, Math.ceil(size / GROUP_SIZE));
const emptyGroups = (size) => Array.from({ length: groupCount(size) }, () => Array(GROUP_SIZE).fill(null));
const newSetup = (size) => ({ variants: [{ id: newId(), name: "Variante A", groups: emptyGroups(size) }] });

/** Groups of exactly size/5 x 5 slots holding only roster members, each at most once. */
function sanitizeGroups(groups, roster) {
    const allowed = new Set(roster.members.map((m) => m.userId));
    const used = new Set();
    return Array.from({ length: groupCount(roster.size) }, (_, gi) => Array.from({ length: GROUP_SIZE }, (_, si) => {
        const id = Array.isArray(groups) && Array.isArray(groups[gi]) ? groups[gi][si] : null;
        if (typeof id !== "string" || !allowed.has(id) || used.has(id)) return null;
        used.add(id);
        return id;
    }));
}

/** The stored style, else what the name looks like: two parts are a Forever name, anything else a nickname. */
function nameStyleOf(c) {
    if (NAME_STYLES.includes(c.nameStyle)) return c.nameStyle;
    return String(c.name || "").trim().split(/\s+/).length === 2 ? "forever" : "nick";
}

function normalizeCharacter(c) {
    if (!c || typeof c !== "object" || !c.id || !c.name) return null;
    const specs = (Array.isArray(c.specs) ? c.specs : [])
        .filter((s) => s && typeof s.spec === "string" && s.spec)
        .map((s) => ({ spec: s.spec, main: s.main === true, gear: GEAR_LEVELS.includes(s.gear) ? s.gear : "none" }));
    return {
        id: String(c.id),
        name: String(c.name),
        nameStyle: nameStyleOf(c),
        className: String(c.className || ""),
        specs,
        canTank: c.canTank === true,
        canHeal: c.canHeal === true,
        ...(c.onlineKey ? { onlineKey: String(c.onlineKey) } : {}),
    };
}

function normalizeRoster(r) {
    const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(Number(r.size)) || 20));
    const targets = { ...defaultTargets(size) };
    if (r.targets && typeof r.targets === "object") {
        for (const role of ROLES) if (Number.isInteger(r.targets[role]) && r.targets[role] >= 0) targets[role] = r.targets[role];
    }
    const seen = new Set();
    const members = (Array.isArray(r.members) ? r.members : [])
        .filter((m) => m && typeof m.userId === "string" && ROLES.includes(m.role) && !seen.has(m.userId) && seen.add(m.userId))
        .map((m) => ({ userId: m.userId, role: m.role }));
    const bench = (Array.isArray(r.bench) ? r.bench : []).filter((id) => typeof id === "string" && !seen.has(id) && seen.add(id));
    // an old roster's instanceId is dropped here: a roster is a name and a size (#566)
    return { id: String(r.id), name: String(r.name || "Kader"), size, targets, members, bench };
}

/** Repairs whatever was read from disk into a valid planner state (never throws). */
function normalizePlanner(raw) {
    const out = emptyPlanner();
    if (!raw || typeof raw !== "object") return out;
    if (Array.isArray(raw.accounts)) {
        out.accounts = raw.accounts
            .filter((a) => a && typeof a.userId === "string" && a.userId)
            .map((a) => ({ userId: a.userId, displayName: String(a.displayName || a.userId), addedAt: String(a.addedAt || "") }));
    }
    if (raw.assignments && typeof raw.assignments === "object") {
        for (const [userId, a] of Object.entries(raw.assignments)) {
            if (!a || !Array.isArray(a.characters)) continue;
            const characters = a.characters.map(normalizeCharacter).filter(Boolean);
            out.assignments[userId] = {
                characters,
                activeCharacterId: characters.some((c) => c.id === a.activeCharacterId) ? a.activeCharacterId : (characters[0] ? characters[0].id : null),
            };
        }
    }
    if (Array.isArray(raw.rosters)) out.rosters = raw.rosters.filter((r) => r && r.id).map(normalizeRoster);
    for (const r of out.rosters) {
        const s = raw.setups && raw.setups[r.id];
        out.setups[r.id] = s && Array.isArray(s.variants) && s.variants.length
            ? { variants: s.variants.map((v) => ({ id: String(v.id || newId()), name: String(v.name || "Variante"), groups: sanitizeGroups(v.groups, r) })) }
            : newSetup(r.size);
    }
    return out;
}

function getRoster(planner, rosterId) {
    const roster = planner.rosters.find((r) => r.id === rosterId);
    if (!roster) throw notFound("Kader nicht gefunden.");
    return roster;
}

function cleanLabel(name, what) {
    const text = String(name || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > LIMITS.name) throw invalid(`${what} fehlt oder ist zu lang (höchstens ${LIMITS.name} Zeichen).`);
    return text;
}

/** Whether an account is in the planner's pool: a raider with a profile of the version, or added by hand. */
const inPool = (planner, ctx, userId) => ctx.poolIds.has(userId) || planner.accounts.some((a) => a.userId === userId);

// ---------------------------------------------------------------- accounts

/**
 * Adds a Discord account to the pool. `ctx.memberIds` are the ids of the
 * server's member list, `ctx.poolIds` the raiders with a profile.
 */
function addAccount(planner, input, ctx) {
    const userId = String(input.userId || "").trim();
    if (!userId) throw invalid("Discord-ID fehlt.");
    if (!ctx.memberIds.has(userId) && !DISCORD_ID.test(userId)) throw invalid("Das ist keine Discord-ID (17 bis 20 Ziffern).");
    if (inPool(planner, ctx, userId)) throw conflict("Dieser Account ist schon im Pool.");
    if (planner.accounts.length >= LIMITS.accounts) throw conflict(`Mehr als ${LIMITS.accounts} Accounts sind nicht vorgesehen.`);
    const next = clone(planner);
    next.accounts.push({ userId, displayName: cleanLabel(input.displayName, "Name"), addedAt: new Date().toISOString() });
    const c = input.character;
    if (c && (c.firstName || c.lastName || c.nickname || c.className)) {
        const nick = c.nameStyle === "nick";
        const name = nick ? c.nickname : `${c.firstName || ""} ${c.lastName || ""}`;
        const character = cleanCharacter({ name, nameStyle: nick ? "nick" : "forever", className: c.className, specs: [] }, ctx);
        next.assignments[userId] = { characters: [character], activeCharacterId: character.id };
    }
    return next;
}

/** Drops an account added by hand, with its assignment and every roster place. */
function removeAccount(planner, userId) {
    if (!planner.accounts.some((a) => a.userId === userId)) throw notFound("Nur selbst hinzugefügte Accounts lassen sich entfernen.");
    const next = clone(planner);
    next.accounts = next.accounts.filter((a) => a.userId !== userId);
    delete next.assignments[userId];
    for (const r of next.rosters) {
        r.members = r.members.filter((m) => m.userId !== userId);
        r.bench = r.bench.filter((id) => id !== userId);
        resanitize(next, r);
    }
    return next;
}

// ------------------------------------------------------------ assignments

function classOf(ctx, key) {
    const c = ctx.classes.get(key);
    if (!c) throw invalid(`Unbekannte Klasse: ${key || "keine"}.`);
    return c;
}

/** A Forever name is "Vorname Nachname", each 2 to 12 letters (utils/signup/characterNames.js). */
function cleanName(raw, style = "forever") {
    const text = String(raw || "").trim().replace(/\s+/g, " ");
    if (style === "nick") {
        const length = [...text].length;
        if (length < NICK_MIN || length > NICK_MAX) throw invalid(`Der Nickname braucht ${NICK_MIN} bis ${NICK_MAX} Zeichen.`);
        if (!NICK.test(text)) throw invalid("Der Nickname darf nur Buchstaben, Ziffern, Leerzeichen, Bindestrich und Apostroph haben.");
        if (isProfane(text)) throw invalid("Dieser Name ist nicht erlaubt – bitte einen anderen wählen.");
        return text;
    }
    if (text.split(" ").length !== 2) throw invalid("Der Name besteht aus Vorname und Nachname, je höchstens 12 Buchstaben.");
    const checked = validateCharacterName(text, { lastName: true });
    if (checked.error) throw invalid(checked.error);
    return checked.name;
}

function cleanCharacter(input, ctx) {
    const nameStyle = input.nameStyle === "nick" ? "nick" : "forever";
    const name = cleanName(input.name, nameStyle);
    const cls = classOf(ctx, String(input.className || ""));
    const seen = new Set();
    let specs = (Array.isArray(input.specs) ? input.specs : []).map((s) => ({
        spec: String((s && s.spec) || ""),
        main: !!s && s.main === true,
        gear: s && GEAR_LEVELS.includes(s.gear) ? s.gear : "none",
    })).filter((s) => {
        if (!s.spec || seen.has(s.spec)) return false;
        seen.add(s.spec);
        return true;
    });
    const unknown = specs.find((s) => !cls.specs.some((cs) => cs.key === s.spec));
    if (unknown) throw invalid(`Unbekannter Spec: ${unknown.spec}.`);
    const mainIndex = Math.max(0, specs.findIndex((s) => s.main));
    specs = specs.map((s, i) => ({ ...s, main: i === mainIndex }));
    return {
        id: String(input.id || newId()).slice(0, 40),
        name,
        nameStyle,
        className: cls.key,
        specs,
        canTank: input.canTank === true && !!cls.canTank,
        canHeal: input.canHeal === true && !!cls.canHeal,
        ...(input.onlineKey ? { onlineKey: String(input.onlineKey).slice(0, 80) } : {}),
    };
}

/** Replaces the planner's characters of one account; the profile is never touched. */
function setAssignment(planner, userId, input, ctx) {
    if (!inPool(planner, ctx, userId)) throw notFound("Account nicht im Pool.");
    const list = Array.isArray(input.characters) ? input.characters : [];
    if (list.length > LIMITS.characters) throw invalid(`Höchstens ${LIMITS.characters} Charaktere je Account.`);
    const characters = list.map((c) => cleanCharacter(c || {}, ctx));
    const ids = new Set(characters.map((c) => c.id));
    if (ids.size !== characters.length) throw invalid("Doppelte Charakter-ID.");
    const next = clone(planner);
    next.assignments[userId] = {
        characters,
        activeCharacterId: ids.has(input.activeCharacterId) ? input.activeCharacterId : (characters[0] ? characters[0].id : null),
    };
    return next;
}

/** Drops the planner's characters of an account: the profile shows again. */
function resetAssignment(planner, userId) {
    if (!planner.assignments[userId]) throw notFound("Für diesen Account gibt es keine eigene Zuweisung.");
    const next = clone(planner);
    delete next.assignments[userId];
    return next;
}

// ----------------------------------------------------------------- rosters

function cleanSize(value) {
    const size = Number(value);
    if (!Number.isInteger(size) || size < SIZE_MIN || size > SIZE_MAX) {
        throw invalid(`Die Kadergröße muss eine ganze Zahl von ${SIZE_MIN} bis ${SIZE_MAX} sein.`);
    }
    return size;
}

function cleanTargets(input, size, fallback) {
    const base = fallback || defaultTargets(size);
    const out = {};
    for (const role of ROLES) {
        const v = input && input[role] !== undefined ? Number(input[role]) : base[role];
        if (!Number.isInteger(v) || v < 0 || v > SIZE_MAX) throw invalid(`Die Zielzahlen müssen ganze Zahlen zwischen 0 und ${SIZE_MAX} sein.`);
        out[role] = v;
    }
    return out;
}

function resanitize(planner, roster) {
    for (const v of planner.setups[roster.id].variants) v.groups = sanitizeGroups(v.groups, roster);
}

/** A new roster: a name (required) and a size (5 to 40); the role targets follow from the size. */
function createRoster(planner, input) {
    if (planner.rosters.length >= LIMITS.rosters) throw conflict(`Mehr als ${LIMITS.rosters} Kader sind nicht vorgesehen.`);
    const size = cleanSize(input.size === undefined || input.size === "" ? 20 : input.size);
    const roster = {
        id: newId(),
        name: cleanLabel(input.name, "Name"),
        size,
        targets: cleanTargets(input.targets, size),
        members: [],
        bench: [],
    };
    const next = clone(planner);
    next.rosters.push(roster);
    next.setups[roster.id] = newSetup(size);
    return { planner: next, rosterId: roster.id };
}

function updateRoster(planner, rosterId, input) {
    const next = clone(planner);
    const roster = getRoster(next, rosterId);
    if (input.name !== undefined) roster.name = cleanLabel(input.name, "Name");
    const size = input.size !== undefined ? cleanSize(input.size) : roster.size;
    const sizeChanged = size !== roster.size;
    roster.size = size;
    if (input.targets !== undefined || sizeChanged) {
        roster.targets = cleanTargets(input.targets, size, input.targets ? roster.targets : null);
    }
    if (roster.members.length > size) {
        const dropped = roster.members.splice(size);
        roster.bench.push(...dropped.map((m) => m.userId));
    }
    if (sizeChanged) {
        for (const v of next.setups[roster.id].variants) v.groups = emptyGroups(size).map((g, gi) => g.map((_, si) => (v.groups[gi] ? v.groups[gi][si] : null)));
    }
    resanitize(next, roster);
    return next;
}

function deleteRoster(planner, rosterId) {
    getRoster(planner, rosterId);
    const next = clone(planner);
    next.rosters = next.rosters.filter((r) => r.id !== rosterId);
    delete next.setups[rosterId];
    return next;
}

/**
 * Moves an account inside a roster: into a role slot (`to: "role"`), onto the
 * bench (`"bench"`) or out again (`"free"`). `ctx.naturalRole(userId)` is the
 * role used when none is given.
 */
function placeInRoster(planner, rosterId, input, ctx) {
    const userId = String(input.userId || "");
    if (!inPool(planner, ctx, userId)) throw notFound("Account nicht im Pool.");
    if (!["role", "bench", "free"].includes(input.to)) throw invalid("Ziel muss role, bench oder free sein.");
    const next = clone(planner);
    const roster = getRoster(next, rosterId);
    const wasMember = roster.members.some((m) => m.userId === userId);
    roster.members = roster.members.filter((m) => m.userId !== userId);
    roster.bench = roster.bench.filter((id) => id !== userId);
    if (input.to === "role") {
        const role = input.role || (ctx.naturalRole ? ctx.naturalRole(userId) : null) || "melee";
        if (!ROLES.includes(role)) throw invalid("Unbekannte Rolle.");
        if (!wasMember && roster.members.length >= roster.size) throw conflict(`Der Kader ist voll (${roster.size}/${roster.size}).`);
        roster.members.push({ userId, role });
    } else if (input.to === "bench") {
        roster.bench.push(userId);
    }
    resanitize(next, roster);
    return next;
}

// ------------------------------------------------------------------ setups

function getVariant(planner, rosterId, variantId) {
    const roster = getRoster(planner, rosterId);
    const variant = planner.setups[rosterId].variants.find((v) => v.id === variantId);
    if (!variant) throw notFound("Variante nicht gefunden.");
    return { roster, variant };
}

function saveVariant(planner, rosterId, variantId, input) {
    const next = clone(planner);
    const { roster, variant } = getVariant(next, rosterId, variantId);
    if (input.name !== undefined) variant.name = cleanLabel(input.name, "Name");
    if (input.groups !== undefined) variant.groups = sanitizeGroups(input.groups, roster);
    return next;
}

function addVariant(planner, rosterId, input = {}) {
    const next = clone(planner);
    const roster = getRoster(next, rosterId);
    const setup = next.setups[rosterId];
    if (setup.variants.length >= LIMITS.variants) throw conflict(`Mehr als ${LIMITS.variants} Varianten sind nicht vorgesehen.`);
    const source = input.copyFrom ? setup.variants.find((v) => v.id === input.copyFrom) : null;
    if (input.copyFrom && !source) throw notFound("Variante nicht gefunden.");
    const variant = {
        id: newId(),
        name: input.name ? cleanLabel(input.name, "Name") : `Variante ${String.fromCharCode(65 + setup.variants.length)}`,
        groups: source ? sanitizeGroups(source.groups, roster) : emptyGroups(roster.size),
    };
    setup.variants.push(variant);
    return { planner: next, variantId: variant.id };
}

function deleteVariant(planner, rosterId, variantId) {
    const next = clone(planner);
    getVariant(next, rosterId, variantId);
    const setup = next.setups[rosterId];
    if (setup.variants.length <= 1) throw conflict("Die letzte Variante bleibt.");
    setup.variants = setup.variants.filter((v) => v.id !== variantId);
    return next;
}

/** Spreads the roster over the groups; `ctx.playerInfo(userId)` gives class and attendance rate. */
function autoAssignVariant(planner, rosterId, variantId, ctx) {
    const next = clone(planner);
    const { roster, variant } = getVariant(next, rosterId, variantId);
    const members = roster.members.map((m) => {
        const info = ctx.playerInfo(m.userId) || {};
        return { userId: m.userId, role: m.role, classKey: info.classKey || "", rate: info.rate || 0 };
    });
    variant.groups = sanitizeGroups(autoAssign(members, groupCount(roster.size)).groups, roster);
    return next;
}

module.exports = {
    ROLES, GEAR_LEVELS, NAME_STYLES, LIMITS,
    emptyPlanner, normalizePlanner, defaultTargets, sanitizeGroups,
    addAccount, removeAccount, setAssignment, resetAssignment,
    createRoster, updateRoster, deleteRoster, placeInRoster,
    saveVariant, addVariant, deleteVariant, autoAssignVariant,
};
