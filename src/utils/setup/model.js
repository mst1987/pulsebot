// The setup proposal's input, brought into one indexed shape the search can
// score quickly: events with their role limits, candidates (one per raider,
// across every event of the run) with the options they can be placed as, and
// the party/raid buffs of the game version as small integer tables.
//
// Pure: no store, no clock, no randomness. Everything the proposal needs comes
// in through `input`; setupInput.js is what reads it from the stores.

const { rulesFor, DEFAULT_VERSION, ROLES } = require("../../config/gameVersions");
const { characterKey: lootCharacterKey, splitPlayer } = require("../lootImport");

const GROUP_SIZE = 5;
// How many earlier raid nights fairness looks back over, per raider.
const HISTORY_WINDOW = 10;
// Statuses a raider can be placed with, and how much each is worth.
const STATUS_FACTOR = { signed: 1, late: 0.5, tentative: 0.3, bench: 0 };
const GEAR_FACTOR = { ready: 1, "": 0.5, usable: 0 };

function charKey(name) {
    return lootCharacterKey(splitPlayer(name).character);
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

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
    const key = charKey(character);
    if (key) {
        const hit = chars.find((c) => (c.key || charKey(c.name)) === key);
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

/**
 * Build the model. `warnings` collects what the input asked for but a hard rule
 * refuses (a fixed slot for a raider who signed off, …) — never an exception.
 */
function buildModel(input = {}, weights) {
    const versionId = str(input.versionId) || DEFAULT_VERSION;
    const rules = rulesFor(versionId) || rulesFor(DEFAULT_VERSION);
    const warnings = [];
    const events = normalizeEvents(input);
    const eventByid = new Map(events.map((e) => [e.id, e]));
    const profiles = profileMap(input.profiles);
    const specInfo = new Map();
    const classInfo = new Map();
    for (const c of rules.classes) {
        classInfo.set(c.id, c);
        for (const s of c.specs) specInfo.set(s.key, s);
    }

    // buff tables
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

    const specCache = new Map();
    function specData(key) {
        if (specCache.has(key)) return specCache.get(key);
        const d = {
            party: partyBuffs.filter((b) => !b.slot && b.providerSet.has(key)).map((b) => b.idx),
            slotted: partyBuffs.filter((b) => b.slot && b.providerSet.has(key)).map((b) => b.idx),
            raid: raidBuffs.filter((b) => b.providerSet.has(key)).map((b) => b.idx),
            benefits: Uint8Array.from(partyBuffs.map((b) => (b.beneficiarySet.has(key) ? 1 : 0))),
        };
        specCache.set(key, d);
        return d;
    }

    // signups by user, in the order they came in
    const rawSignups = Array.isArray(input.signups) ? input.signups : [];
    const byUser = new Map();
    for (const s of rawSignups) {
        if (!s || !str(s.userId)) continue;
        const eventId = str(s.eventId) || (events.length === 1 ? events[0].id : "");
        const event = eventByid.get(eventId);
        if (!event) continue;
        const userId = str(s.userId);
        if (!byUser.has(userId)) byUser.set(userId, []);
        byUser.get(userId).push({ ...s, userId, eventIdx: event.idx, status: str(s.status) || "signed" });
    }
    const fixedList = (Array.isArray(input.fixed) ? input.fixed : []).filter((f) => f && str(f.userId));
    for (const f of fixedList) {
        if (!byUser.has(str(f.userId))) byUser.set(str(f.userId), []);
    }

    const fairness = fairnessMap(input.history, new Set(events.map((e) => e.id)));
    const cands = [];
    const users = [...byUser.keys()].sort((a, b) => {
        const at = (u) => Math.min(Infinity, ...byUser.get(u).map((s) => Number(s.at) || Infinity));
        return at(a) - at(b) || a.localeCompare(b);
    });
    for (const userId of users) {
        // one signup per event, in event order — the input order must not matter
        const signups = byUser.get(userId)
            .sort((a, b) => a.eventIdx - b.eventIdx || (Number(b.updatedAt || b.at) || 0) - (Number(a.updatedAt || a.at) || 0))
            .filter((s, i, list) => i === 0 || list[i - 1].eventIdx !== s.eventIdx);
        const profile = profiles.get(userId) || null;
        const cand = {
            idx: cands.length,
            userId,
            name: str(profile && profile.name),
            options: [],
            absentIn: new Set(),
            signedIn: new Set(),
            fairness: fairness.get(userId) || { priority: 0, last: "", benchCount: 0, nights: 0 },
            attendance: attendanceOf(input.attendance, userId),
            wishes: profile && Array.isArray(profile.wishes) ? profile.wishes.map(str) : [],
            // "Nicht mit X raiden" — only while the raider has it switched on
            avoid: profile && profile.avoidEnabled === true && Array.isArray(profile.avoid) ? profile.avoid.map(str) : [],
            fixed: null,
            noGear: [],
            // eventIdx → the first choice of a raider who named alternates
            // (#293), with its own status (#320)
            preferred: new Map(),
        };
        for (const s of signups) {
            cand.signedIn.add(s.eventIdx);
            if (s.status === "absence") {
                cand.absentIn.add(s.eventIdx);
                continue;
            }
            if (!(s.status in STATUS_FACTOR)) continue;
            // Several own characters (#293): every one is an option, in priority
            // order; the first is the preferred one. Off-spec roles ("kann auch")
            // belong to the preferred character only.
            const entries = signupCharacters(s);
            entries.forEach((entry, priority) => {
                const main = specInfo.get(str(entry.spec));
                if (!main) return;
                const cls = classInfo.get(main.classId);
                const pChar = profileCharacter(profile, entry.character, main.classId);
                const character = str(entry.character) || (pChar && pChar.name) || cand.name || userId;
                // This character's own status (#320), not the signup's: a first
                // character on "Spät" beside a second on "Dabei" makes the second
                // the better option — and only the option actually placed carries
                // "Kommt später" into its reason.
                const base = { eventIdx: s.eventIdx, status: characterStatus(entry, s.status), character, comment: str(s.comment), priority };
                if (priority === 0 && entries.length > 1) cand.preferred.set(s.eventIdx, { character, role: main.role, status: base.status });
                const mainGear = gearOf(pChar, main.key);
                if (mainGear === "none") cand.noGear.push(main.key);
                else cand.options.push({ ...base, spec: main.key, role: main.role, main: true, gear: mainGear });
                if (priority > 0) return;
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
            });
        }
        cands.push(cand);
    }

    // fixed slots of the orga
    const candByUser = new Map(cands.map((c) => [c.userId, c]));
    const lockedPerGroup = new Map();
    const lockedPerEvent = new Map();
    for (const f of fixedList) {
        const cand = candByUser.get(str(f.userId));
        if (!cand || cand.fixed) continue;
        if (f.bench === true) {
            cand.fixed = { bench: true };
            continue;
        }
        const event = f.eventId ? eventByid.get(str(f.eventId)) : (events.length === 1 ? events[0] : null);
        if (!event) {
            warnings.push(`Fixierung für ${cand.userId}: unbekanntes Event.`);
            continue;
        }
        if (cand.absentIn.has(event.idx)) {
            warnings.push(`${cand.name || cand.userId} ist abgemeldet – die Fixierung wird ignoriert.`);
            continue;
        }
        const wanted = str(f.spec);
        const wantedChar = charKey(f.character);
        const sameChar = (o) => !wantedChar || charKey(o.character) === wantedChar;
        let optIdx = cand.options.findIndex((o) => o.eventIdx === event.idx && (!wanted || o.spec === wanted) && (!f.role || o.role === f.role) && sameChar(o));
        if (optIdx < 0 && wantedChar) {
            optIdx = cand.options.findIndex((o) => o.eventIdx === event.idx && (!wanted || o.spec === wanted) && (!f.role || o.role === f.role));
        }
        if (optIdx < 0 && wanted && specInfo.get(wanted)) {
            // The orga places somebody on a spec without a signup for it, or on
            // one the profile calls ungeared: the orga knows, the check says so.
            const info = specInfo.get(wanted);
            const signup = byUser.get(cand.userId).find((s) => s.eventIdx === event.idx);
            // the named character of that class (#293), else the signup's own
            const entry = signup && signupCharacters(signup).find((c) => (specInfo.get(str(c.spec)) || {}).classId === info.classId);
            const pChar = profileCharacter(profiles.get(cand.userId), (entry && entry.character) || (signup && signup.character), info.classId);
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
            optIdx = cand.options.length - 1;
        }
        if (optIdx < 0) {
            warnings.push(`Fixierung für ${cand.name || cand.userId}: keine Anmeldung und keine Spec angegeben.`);
            continue;
        }
        const evCount = lockedPerEvent.get(event.idx) || 0;
        if (evCount >= event.size) {
            warnings.push(`Mehr fixierte Plätze als der Raid ${event.title || event.id} fasst.`);
            continue;
        }
        let group = Number(f.group) > 0 ? Math.floor(Number(f.group)) - 1 : -1;
        if (group >= event.groupCount) group = -1;
        if (group >= 0) {
            const key = `${event.idx}:${group}`;
            if ((lockedPerGroup.get(key) || 0) >= GROUP_SIZE) {
                warnings.push(`Gruppe ${group + 1} hat mehr als ${GROUP_SIZE} fixierte Plätze.`);
                group = -1;
            } else {
                lockedPerGroup.set(key, (lockedPerGroup.get(key) || 0) + 1);
            }
        }
        lockedPerEvent.set(event.idx, evCount + 1);
        cand.fixed = { bench: false, option: optIdx, group };
    }

    // Fixed raiders beyond a role's maximum widen it: the orga decided, the check turns red.
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

    // wishes: unordered pairs of raiders who both signed up, mutual or not
    const pairs = [];
    const wishOn = events.some((e) => e.wishes);
    for (const a of cands) {
        for (const bId of a.wishes) {
            const b = candByUser.get(bId);
            if (!b || b === a) continue;
            const mutual = b.wishes.includes(a.userId);
            if (mutual && b.idx < a.idx) continue;
            pairs.push({ a: a.idx, b: b.idx, mutual, factor: mutual ? 1 : 0.5 });
        }
    }

    // "nicht zusammen": unordered pairs, one entry even when both named each other
    const avoidPairs = [];
    for (const a of cands) {
        for (const bId of a.avoid) {
            const b = candByUser.get(bId);
            if (!b || b === a) continue;
            const mutual = b.avoid.includes(a.userId);
            if (mutual && b.idx < a.idx) continue;
            avoidPairs.push({ a: a.idx, b: b.idx, mutual });
        }
    }

    for (const c of cands) {
        c.options.forEach((o, i) => {
            o.idx = i;
            o.roleIdx = ROLES.indexOf(o.role);
            o.data = specData(o.spec);
            o.classId = (specInfo.get(o.spec) || {}).classId || "";
        });
    }

    return {
        versionId: rules.id,
        rules,
        events,
        cands,
        pairs,
        wishOn,
        avoidPairs,
        partyBuffs,
        raidBuffs,
        warnings,
        specInfo,
        weights,
    };
}

module.exports = { buildModel, limitFor, fairnessMap, signupCharacters, characterStatus, characterFlags, GROUP_SIZE, HISTORY_WINDOW, STATUS_FACTOR, GEAR_FACTOR, charKey };
