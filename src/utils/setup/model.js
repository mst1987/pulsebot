// The setup proposal's input, brought into one indexed shape the search can
// score quickly: events with their role limits, candidates (one per raider,
// across every event of the run) with the options they can be placed as, and
// the party/raid buffs of the game version as small integer tables.
//
// Pure: no store, no clock, no randomness. Everything the proposal needs comes
// in through `input`; setupInput.js is what reads it from the stores.

const { rulesFor, DEFAULT_VERSION, ROLES } = require("../../config/gameVersions");
const { characterKeyOf } = require("../lootImport");
const { str } = require("../text");

const GROUP_SIZE = 5;
// How many earlier raid nights fairness looks back over, per raider.
const HISTORY_WINDOW = 10;
// Statuses a raider can be placed with, and how much each is worth.
const STATUS_FACTOR = { signed: 1, late: 0.5, tentative: 0.3, bench: 0 };
const GEAR_FACTOR = { ready: 1, "": 0.5, usable: 0 };


/** A composition entry as `{ min, max }` — max null = no upper bound. */
function limitFor(role, raw) {
    if (raw && typeof raw === "object") {
        const min = Math.max(0, Math.floor(Number(raw.min) || 0));
        const max = raw.max === null || raw.max === undefined || raw.max === "" ? null : Math.max(0, Math.floor(Number(raw.max) || 0));
        return { min, max: max === null ? null : Math.max(min, max) };
    }
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    // Tanks and healers are exact targets; a melee/ranged number is a minimum —
    // the damage dealers fill whatever is left (0 = no target).
    if (role === "tank" || role === "healer") return { min: n, max: n };
    return { min: n, max: null };
}

function normalizeEvents(input) {
    const raw = Array.isArray(input.events) ? input.events : (input.event ? [input.event] : []);
    const seen = new Set();
    const events = [];
    for (const e of raw) {
        if (!e) continue;
        const id = str(e.id) || `event-${events.length + 1}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const size = Math.max(0, Math.min(40, Math.floor(Number(e.size) || 0)));
        const comp = e.composition || {};
        events.push({
            idx: events.length,
            id,
            title: str(e.title),
            size,
            groupCount: Math.max(1, Math.ceil(size / GROUP_SIZE)),
            limits: Object.fromEntries(ROLES.map((r) => [r, limitFor(r, comp[r])])),
            requiredBuffs: [...new Set((Array.isArray(e.requiredBuffs) ? e.requiredBuffs : []).map(str).filter(Boolean))],
            fairness: e.fairness === true,
            wishes: e.wishes === true,
        });
    }
    return events;
}

function profileMap(raw) {
    const map = new Map();
    const list = Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([userId, p]) => ({ userId, ...p }));
    for (const p of list) {
        if (p && str(p.userId)) map.set(str(p.userId), p);
    }
    return map;
}

/** The profile character a signup names — by name, else the main of that class. */
function profileCharacter(profile, character, classId) {
    const chars = (profile && Array.isArray(profile.characters)) ? profile.characters : [];
    const key = characterKeyOf(character);
    if (key) {
        const hit = chars.find((c) => (c.key || characterKeyOf(c.name)) === key);
        if (hit) return hit;
        return null;
    }
    return chars.find((c) => c.main && c.className === classId) || chars.find((c) => c.className === classId) || null;
}

/**
 * "Kann offtanken / heilen" as the raider *said* it for this character: its own
 * switch, else the old profile-wide one; `null` when nobody said anything.
 */
function characterFlags(profile, character) {
    const said = (v) => (v === true || v === false ? v : null);
    const pick = (field) => {
        const own = said(character && character[field]);
        return own !== null ? own : said(profile && profile[field]);
    };
    return { canOfftank: pick("canOfftank"), canHeal: pick("canHeal") };
}

/**
 * The characters of a signup in priority order (#293): `characters` when the
 * signup has them, else its single character/spec.
 */
function signupCharacters(s) {
    const list = Array.isArray(s.characters) ? s.characters.filter((c) => c && str(c.spec)) : [];
    return list.length ? list : [{ character: s.character, spec: s.spec }];
}

/**
 * A named character's own status (#320): every character of a signup carries
 * one since #302 — "Spät" on the first character leaves the others "Dabei" —
 * and the proposal weighs each option with the status of the character it would
 * place, not with the signup's. A character without one (or with something the
 * scorer does not know) falls back to the signup's status.
 */
function characterStatus(entry, signupStatus) {
    const own = str(entry && entry.status);
    return own && own in STATUS_FACTOR ? own : signupStatus;
}

/** "ready" | "usable" | "none" as the profile says, "" when it says nothing. */
function gearOf(profileChar, specKey) {
    const entry = profileChar && Array.isArray(profileChar.specs) ? profileChar.specs.find((s) => s && s.key === specKey) : null;
    return entry ? (["ready", "usable", "none"].includes(entry.gear) ? entry.gear : "usable") : "";
}

/**
 * Fairness per raider from earlier nights: whether they sat on the bench the
 * last time they were in a setup, and how often in the window.
 * @returns {Map<string, { priority: number, last: "bench"|"placed"|"", benchCount: number, nights: number }>}
 */
function fairnessMap(history, currentIds) {
    const nights = (Array.isArray(history) ? history : [])
        .filter((h) => h && !currentIds.has(str(h.eventId)))
        .map((h) => ({
            startTime: Number(h.startTime) || 0,
            eventId: str(h.eventId),
            placed: new Set((h.placed || []).map(str)),
            bench: new Set((h.bench || []).map(str)),
        }))
        .sort((a, b) => b.startTime - a.startTime || a.eventId.localeCompare(b.eventId));
    const out = new Map();
    const users = new Set();
    for (const n of nights) for (const u of [...n.placed, ...n.bench]) users.add(u);
    for (const u of users) {
        const states = [];
        for (const n of nights) {
            if (states.length >= HISTORY_WINDOW) break;
            if (n.placed.has(u)) states.push("placed");
            else if (n.bench.has(u)) states.push("bench");
        }
        const benchCount = states.filter((s) => s === "bench").length;
        const last = states[0] || "";
        const priority = (last === "bench" ? 0.6 : 0) + 0.4 * Math.min(1, benchCount / 3);
        out.set(u, { priority, last, benchCount, nights: states.length });
    }
    return out;
}

function attendanceOf(raw, userId) {
    const v = raw && raw[userId];
    if (v === null || v === undefined) return null;
    const pct = typeof v === "object" ? v.pct : v;
    return pct === null || pct === undefined || !Number.isFinite(Number(pct)) ? null : Math.max(0, Math.min(100, Number(pct)));
}

/** The class's spec to play a role as, preferring what the profile says the raider has geared. */
function specForRole(classInfo, role, profileChar) {
    const fits = classInfo.specs.filter((s) => (role === "tank" ? s.canTank : role === "healer" ? s.canHeal : s.role === role));
    // A spec whose own role it is before one that merely can (bear before cat).
    fits.sort((a, b) => (a.role === role ? 0 : 1) - (b.role === role ? 0 : 1));
    const rank = { ready: 0, usable: 1, "": 2, none: 3 };
    const ranked = fits
        .map((s, i) => ({ s, gear: gearOf(profileChar, s.key), i }))
        .filter((x) => x.gear !== "none")
        .sort((a, b) => rank[a.gear] - rank[b.gear] || a.i - b.i);
    return ranked[0] || null;
}

// ---------------------------------------------------------------------------
// buildModel in phases (#431): lookup tables → signups per raider → candidates
// with their options → the orga's fixed places → role maxima → wish/avoid
// pairs → option indexes. Each phase reads what the earlier ones produced;
// `ctx` carries the shared lookups, `warnings` collects what a hard rule refuses.
// ---------------------------------------------------------------------------

/** Class and spec lookups of the rule set. */
function specTables(rules) {
    const specInfo = new Map();
    const classInfo = new Map();
    for (const c of rules.classes) {
        classInfo.set(c.id, c);
        for (const s of c.specs) specInfo.set(s.key, s);
    }
    return { specInfo, classInfo };
}

/**
 * Party and raid buffs as indexed tables. Also resolves every event's required
 * buffs into `requiredParty` / `requiredRaid` indexes.
 */
function buffTables(rules, specInfo, events, warnings) {
    const specCount = specInfo.size;
    // `universal`: everybody wants it (Blood Pact), so it says nothing about *which* group.
    const partyBuffs = rules.partyBuffs.map((b, i) => ({
        ...b, idx: i, providerSet: new Set(b.providers), beneficiarySet: new Set(b.beneficiaries), universal: b.beneficiaries.length >= specCount,
    }));
    const raidBuffs = rules.raidBuffs.map((b, i) => ({ ...b, idx: i, providerSet: new Set(b.providers) }));
    const partyByKey = new Map(partyBuffs.map((b) => [b.key, b]));
    const raidByKey = new Map(raidBuffs.map((b) => [b.key, b]));
    for (const e of events) {
        e.requiredParty = [];
        e.requiredRaid = [];
        for (const key of e.requiredBuffs) {
            if (partyByKey.has(key)) e.requiredParty.push(partyByKey.get(key).idx);
            else if (raidByKey.has(key)) e.requiredRaid.push(raidByKey.get(key).idx);
            else warnings.push(`Pflicht-Buff „${key}“ gibt es in ${rules.label} nicht.`);
        }
    }
    return { partyBuffs, raidBuffs };
}

/** Per spec (cached): the buffs it brings and the party buffs it profits from. */
function specDataCache(partyBuffs, raidBuffs) {
    const cache = new Map();
    return function specData(key) {
        if (cache.has(key)) return cache.get(key);
        const d = {
            party: partyBuffs.filter((b) => !b.slot && b.providerSet.has(key)).map((b) => b.idx),
            slotted: partyBuffs.filter((b) => b.slot && b.providerSet.has(key)).map((b) => b.idx),
            raid: raidBuffs.filter((b) => b.providerSet.has(key)).map((b) => b.idx),
            benefits: Uint8Array.from(partyBuffs.map((b) => (b.beneficiarySet.has(key) ? 1 : 0))),
        };
        cache.set(key, d);
        return d;
    };
}

/**
 * Signups by user, in the order they came in, each tied to its event. A raider
 * the orga fixed without a signup gets an empty list.
 */
function signupsByUser(input, events, eventById) {
    const rawSignups = Array.isArray(input.signups) ? input.signups : [];
    const byUser = new Map();
    for (const s of rawSignups) {
        if (!s || !str(s.userId)) continue;
        const eventId = str(s.eventId) || (events.length === 1 ? events[0].id : "");
        const event = eventById.get(eventId);
        if (!event) continue;
        const userId = str(s.userId);
        if (!byUser.has(userId)) byUser.set(userId, []);
        byUser.get(userId).push({ ...s, userId, eventIdx: event.idx, status: str(s.status) || "signed" });
    }
    const fixedList = (Array.isArray(input.fixed) ? input.fixed : []).filter((f) => f && str(f.userId));
    for (const f of fixedList) {
        if (!byUser.has(str(f.userId))) byUser.set(str(f.userId), []);
    }
    return { byUser, fixedList };
}

/** Raiders by their earliest signup, then by user id. */
function candidateOrder(byUser) {
    const at = (u) => Math.min(Infinity, ...byUser.get(u).map((s) => Number(s.at) || Infinity));
    return [...byUser.keys()].sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}

/**
 * One signup per event, in event order — the input order must not matter.
 * Sorts `list` in place on purpose: the fixed-place phase later looks up a
 * raider's signup for an event in this same list and must find the latest one.
 */
function latestSignupPerEvent(list) {
    return list
        .sort((a, b) => a.eventIdx - b.eventIdx || (Number(b.updatedAt || b.at) || 0) - (Number(a.updatedAt || a.at) || 0))
        .filter((s, i, sorted) => i === 0 || sorted[i - 1].eventIdx !== s.eventIdx);
}

function newCandidate(idx, userId, profile, fairness, attendance) {
    return {
        idx,
        userId,
        name: str(profile && profile.name),
        options: [],
        absentIn: new Set(),
        signedIn: new Set(),
        fairness: fairness || { priority: 0, last: "", benchCount: 0, nights: 0 },
        attendance,
        wishes: profile && Array.isArray(profile.wishes) ? profile.wishes.map(str) : [],
        // "Nicht mit X raiden" — only while the raider has it switched on
        avoid: profile && profile.avoidEnabled === true && Array.isArray(profile.avoid) ? profile.avoid.map(str) : [],
        fixed: null,
        noGear: [],
        // eventIdx → the first choice of a raider who named alternates
        // (#293), with its own status (#320)
        preferred: new Map(),
    };
}

/** Off-spec roles ("kann auch", can offtank/heal) of the preferred character. */
function addOffSpecOptions(cand, s, base, main, cls, pChar, profile) {
    const extra = new Set((Array.isArray(s.canAlso) ? s.canAlso : []).map(str));
    // only a stated word — this character's switch, else the old profile-wide one
    const said = characterFlags(profile, pChar);
    if (said.canOfftank === true) extra.add("tank");
    if (said.canHeal === true) extra.add("healer");
    for (const role of ROLES) {
        if (!extra.has(role) || role === main.role) continue;
        const pick = specForRole(cls, role, pChar);
        if (!pick) continue;
        cand.options.push({ ...base, spec: pick.s.key, role, main: false, gear: pick.gear });
    }
}

/** The options one character of a signup gives (its main spec, and off specs for the first). */
function addCharacterOptions(cand, s, entry, priority, entryCount, profile, ctx) {
    const main = ctx.specInfo.get(str(entry.spec));
    if (!main) return;
    const cls = ctx.classInfo.get(main.classId);
    const pChar = profileCharacter(profile, entry.character, main.classId);
    const character = str(entry.character) || (pChar && pChar.name) || cand.name || cand.userId;
    // This character's own status (#320), not the signup's: a first
    // character on "Spät" beside a second on "Dabei" makes the second
    // the better option — and only the option actually placed carries
    // "Kommt später" into its reason.
    const base = { eventIdx: s.eventIdx, status: characterStatus(entry, s.status), character, comment: str(s.comment), priority };
    if (priority === 0 && entryCount > 1) cand.preferred.set(s.eventIdx, { character, role: main.role, status: base.status });
    const mainGear = gearOf(pChar, main.key);
    if (mainGear === "none") cand.noGear.push(main.key);
    else cand.options.push({ ...base, spec: main.key, role: main.role, main: true, gear: mainGear });
    if (priority > 0) return;
    addOffSpecOptions(cand, s, base, main, cls, pChar, profile);
}

function addSignupOptions(cand, s, profile, ctx) {
    cand.signedIn.add(s.eventIdx);
    if (s.status === "absence") {
        cand.absentIn.add(s.eventIdx);
        return;
    }
    if (!(s.status in STATUS_FACTOR)) return;
    // Several own characters (#293): every one is an option, in priority
    // order; the first is the preferred one. Off-spec roles ("kann auch")
    // belong to the preferred character only.
    const entries = signupCharacters(s);
    entries.forEach((entry, priority) => addCharacterOptions(cand, s, entry, priority, entries.length, profile, ctx));
}

/** One candidate per raider, with every option they can be placed as. */
function buildCandidates(input, ctx) {
    const fairness = fairnessMap(input.history, new Set(ctx.events.map((e) => e.id)));
    const cands = [];
    for (const userId of candidateOrder(ctx.byUser)) {
        const signups = latestSignupPerEvent(ctx.byUser.get(userId));
        const profile = ctx.profiles.get(userId) || null;
        const cand = newCandidate(cands.length, userId, profile, fairness.get(userId), attendanceOf(input.attendance, userId));
        for (const s of signups) addSignupOptions(cand, s, profile, ctx);
        cands.push(cand);
    }
    return cands;
}

/**
 * The option the orga fixed somebody on, when the signup has no such option:
 * a spec without a signup for it, or one the profile calls ungeared — the orga
 * knows, the check says so. Returns its index, or -1.
 */
function addFixedSpecOption(f, cand, event, ctx, warnings) {
    const wanted = str(f.spec);
    const info = ctx.specInfo.get(wanted);
    const signup = ctx.byUser.get(cand.userId).find((s) => s.eventIdx === event.idx);
    // the named character of that class (#293), else the signup's own
    const entry = signup && signupCharacters(signup).find((c) => (ctx.specInfo.get(str(c.spec)) || {}).classId === info.classId);
    const pChar = profileCharacter(ctx.profiles.get(cand.userId), (entry && entry.character) || (signup && signup.character), info.classId);
    const gear = gearOf(pChar, wanted);
    if (gear === "none") warnings.push(`${cand.name || cand.userId}: ${info.label} laut Profil ohne brauchbares Gear, aber fixiert.`);
    cand.options.push({
        eventIdx: event.idx,
        // the named character's own status (#320), else the signup's
        status: signup ? characterStatus(entry, signup.status) : "signed",
        character: str(f.character) || (entry && str(entry.character)) || (signup && str(signup.character)) || (pChar && pChar.name) || cand.name || cand.userId,
        comment: "",
        spec: wanted,
        role: f.role && ROLES.includes(f.role) ? f.role : info.role,
        main: !!(signup && signupCharacters(signup).some((c) => c.spec === wanted)),
        priority: entry && signup ? Math.max(0, signupCharacters(signup).indexOf(entry)) : 0,
        gear,
        fromFixed: true,
    });
    return cand.options.length - 1;
}

/** Index of the option a fixed place means — the named character first, then any; -1 when none. */
function fixedOption(f, cand, event, ctx, warnings) {
    const wanted = str(f.spec);
    const wantedChar = characterKeyOf(f.character);
    const fits = (o) => o.eventIdx === event.idx && (!wanted || o.spec === wanted) && (!f.role || o.role === f.role);
    let optIdx = cand.options.findIndex((o) => fits(o) && (!wantedChar || characterKeyOf(o.character) === wantedChar));
    if (optIdx < 0 && wantedChar) optIdx = cand.options.findIndex(fits);
    if (optIdx < 0 && wanted && ctx.specInfo.get(wanted)) optIdx = addFixedSpecOption(f, cand, event, ctx, warnings);
    return optIdx;
}

/** The 0-based group of a fixed place, -1 to let the search pick one. */
function fixedGroup(f, event, lockedPerGroup, warnings) {
    let group = Number(f.group) > 0 ? Math.floor(Number(f.group)) - 1 : -1;
    if (group >= event.groupCount) group = -1;
    if (group < 0) return group;
    const key = `${event.idx}:${group}`;
    if ((lockedPerGroup.get(key) || 0) >= GROUP_SIZE) {
        warnings.push(`Gruppe ${group + 1} hat mehr als ${GROUP_SIZE} fixierte Plätze.`);
        return -1;
    }
    lockedPerGroup.set(key, (lockedPerGroup.get(key) || 0) + 1);
    return group;
}

/** A candidate's `fixed` state for one fixed place, or null when a hard rule refuses it. */
function fixedPlace(f, cand, ctx, locked, warnings) {
    if (f.bench === true) return { bench: true };
    const events = ctx.events;
    const event = f.eventId ? ctx.eventById.get(str(f.eventId)) : (events.length === 1 ? events[0] : null);
    if (!event) {
        warnings.push(`Fixierung für ${cand.userId}: unbekanntes Event.`);
        return null;
    }
    if (cand.absentIn.has(event.idx)) {
        warnings.push(`${cand.name || cand.userId} ist abgemeldet – die Fixierung wird ignoriert.`);
        return null;
    }
    const optIdx = fixedOption(f, cand, event, ctx, warnings);
    if (optIdx < 0) {
        warnings.push(`Fixierung für ${cand.name || cand.userId}: keine Anmeldung und keine Spec angegeben.`);
        return null;
    }
    const evCount = locked.perEvent.get(event.idx) || 0;
    if (evCount >= event.size) {
        warnings.push(`Mehr fixierte Plätze als der Raid ${event.title || event.id} fasst.`);
        return null;
    }
    const group = fixedGroup(f, event, locked.perGroup, warnings);
    locked.perEvent.set(event.idx, evCount + 1);
    return { bench: false, option: optIdx, group };
}

/** The orga's fixed slots; the first fixation of a raider wins. */
function applyFixed(fixedList, candByUser, ctx, warnings) {
    const locked = { perGroup: new Map(), perEvent: new Map() };
    for (const f of fixedList) {
        const cand = candByUser.get(str(f.userId));
        if (!cand || cand.fixed) continue;
        const fixed = fixedPlace(f, cand, ctx, locked, warnings);
        if (fixed) cand.fixed = fixed;
    }
}

/** Fixed raiders beyond a role's maximum widen it: the orga decided, the check turns red. */
function widenHardMax(events, cands) {
    for (const e of events) {
        const counts = Object.fromEntries(ROLES.map((r) => [r, 0]));
        for (const c of cands) {
            if (c.fixed && !c.fixed.bench && c.options[c.fixed.option].eventIdx === e.idx) counts[c.options[c.fixed.option].role]++;
        }
        e.hardMax = {};
        for (const r of ROLES) {
            const max = e.limits[r].max;
            e.hardMax[r] = max === null ? Infinity : Math.max(max, counts[r]);
        }
    }
}

/**
 * Unordered pairs of raiders who both signed up and one named the other in
 * `field` ("wishes" / "avoid") — one entry even when both named each other.
 */
function namedPairs(cands, candByUser, field) {
    const pairs = [];
    for (const a of cands) {
        for (const bId of a[field]) {
            const b = candByUser.get(bId);
            if (!b || b === a) continue;
            const mutual = b[field].includes(a.userId);
            if (mutual && b.idx < a.idx) continue;
            pairs.push({ a: a.idx, b: b.idx, mutual });
        }
    }
    return pairs;
}

function indexOptions(cands, specInfo, specData) {
    for (const c of cands) {
        c.options.forEach((o, i) => {
            o.idx = i;
            o.roleIdx = ROLES.indexOf(o.role);
            o.data = specData(o.spec);
            o.classId = (specInfo.get(o.spec) || {}).classId || "";
        });
    }
}

/**
 * Build the model. `warnings` collects what the input asked for but a hard rule
 * refuses (a fixed slot for a raider who signed off, …) — never an exception.
 */
function buildModel(input = {}, weights) {
    const versionId = str(input.versionId) || DEFAULT_VERSION;
    const rules = rulesFor(versionId) || rulesFor(DEFAULT_VERSION);
    const warnings = [];
    const events = normalizeEvents(input);
    const eventById = new Map(events.map((e) => [e.id, e]));
    const { specInfo, classInfo } = specTables(rules);
    const { partyBuffs, raidBuffs } = buffTables(rules, specInfo, events, warnings);
    const { byUser, fixedList } = signupsByUser(input, events, eventById);
    const ctx = { events, eventById, profiles: profileMap(input.profiles), specInfo, classInfo, byUser };

    const cands = buildCandidates(input, ctx);
    const candByUser = new Map(cands.map((c) => [c.userId, c]));
    applyFixed(fixedList, candByUser, ctx, warnings);
    widenHardMax(events, cands);
    // wishes: mutual or not, a one-sided wish counts half
    const pairs = namedPairs(cands, candByUser, "wishes").map((p) => ({ ...p, factor: p.mutual ? 1 : 0.5 }));
    const avoidPairs = namedPairs(cands, candByUser, "avoid");
    indexOptions(cands, specInfo, specDataCache(partyBuffs, raidBuffs));

    return {
        versionId: rules.id,
        rules,
        events,
        cands,
        pairs,
        wishOn: events.some((e) => e.wishes),
        avoidPairs,
        partyBuffs,
        raidBuffs,
        warnings,
        specInfo,
        weights,
    };
}

module.exports = { buildModel, limitFor, fairnessMap, signupCharacters, characterStatus, characterFlags, GROUP_SIZE, HISTORY_WINDOW, STATUS_FACTOR, GEAR_FACTOR, charKey: characterKeyOf };
