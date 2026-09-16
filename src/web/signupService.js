// Signing up for an EventHelper event (#256) — the rules, once, for every front
// end: the web's "Anmeldungen" page today, the Discord signup dialog (#258)
// tomorrow. Nothing in here knows about HTTP or Discord; a caller hands in who
// is acting and gets back either the stored signup or a German error with a
// machine-readable code.
//
// What is checked:
//   * only an own event takes signups — a Raid-Helper event keeps its signups at
//     Raid-Helper (`raidhelper`), and a raid that has begun takes none (`started`);
//   * the character is one of the raider's own profile characters and the spec
//     one of that character's specs (`character`, `spec`), and the spec exists in
//     the event's game version (signupStore.normalizeSignup);
//   * after the signup deadline a member can only sign off or say they come late,
//     or keep the status and spec they already had — the orga still can (`deadline`).
//
// Saving goes through signupStore.saveSignup, whose change event already edits
// the event message (eventMessage.js) and feeds every other listener.
const { getEvent, isOwnEventId } = require("./eventStore");
const signupStore = require("./signupStore");
const profiles = require("./raiderProfileStore");
const { SIGNUP_STATUSES } = require("../utils/attendance");
const { ROLES } = require("../config/gameVersions/classes");

// Statuses a member may still pick once the deadline has passed.
const AFTER_DEADLINE = ["absence", "late"];
// Who takes a seat in the raid (the fill bar and the role counts).
const ATTENDING = ["signed", "late"];

/**
 * How many are coming per role, and how many said otherwise.
 * @returns {{ tank: number, healer: number, dps: number, attending: number, tentative: number, bench: number, absence: number }}
 */
function rosterCounts(signups) {
    const out = { tank: 0, healer: 0, dps: 0, attending: 0, tentative: 0, bench: 0, absence: 0 };
    for (const s of signups || []) {
        const status = String((s && s.status) || "signed");
        if (ATTENDING.includes(status)) {
            out.attending += 1;
            if (s.role === "tank") out.tank += 1;
            else if (s.role === "healer") out.healer += 1;
            else out.dps += 1;
        } else if (out[status] !== undefined) {
            out[status] += 1;
        }
    }
    return out;
}

/**
 * The role counts against the event's plan: "Tank 1/2 · Heiler 1/3 · DPS 4/5".
 * DPS targets whatever the size leaves after tanks and healers.
 */
function roleCounts(event, signups) {
    const c = rosterCounts(signups);
    const comp = (event && event.composition) || {};
    const size = Number(event && event.size) || 0;
    const tank = Number(comp.tank) || 0;
    const healer = Number(comp.healer) || 0;
    return {
        tank: { n: c.tank, target: tank },
        healer: { n: c.healer, target: healer },
        dps: { n: c.dps, target: size ? Math.max(0, size - tank - healer) : 0 },
        attending: c.attending,
        tentative: c.tentative,
        bench: c.bench,
        absence: c.absence,
        size,
    };
}

/**
 * Where an event stands for signing up.
 * @returns {{ deadline: number, deadlinePassed: boolean, started: boolean }}
 */
function signupWindow(event, now = Date.now()) {
    const nowSec = Math.floor(now / 1000);
    const deadline = Number(event && event.signupDeadline) || 0;
    const start = Number(event && event.startTime) || 0;
    return {
        deadline,
        deadlinePassed: !!deadline && nowSec > deadline,
        started: !!start && nowSec >= start,
    };
}

/** The statuses a member may choose right now (all of them before the deadline). */
function allowedStatuses(event, { now = Date.now(), byOrga = false } = {}) {
    const w = signupWindow(event, now);
    if (w.started && !byOrga) return [];
    if (w.deadlinePassed && !byOrga) return AFTER_DEADLINE.slice();
    return SIGNUP_STATUSES.slice();
}

/** A profile character by key or name, or null. */
function findCharacter(profile, ref) {
    const key = profiles.characterKey(ref);
    if (!profile || !key) return null;
    return profile.characters.find((c) => c.key === key) || null;
}

/** The effective "kann Offtank / heilen" of a profile — the raider's word, else what the specs allow. */
function profileRoles(profile) {
    const specs = ((profile && profile.characters) || []).flatMap((c) => c.specs.map((s) => profiles.specInfo(s.key) || {}));
    const pick = (own, fallback) => (own === true || own === false ? own : fallback);
    return {
        canOfftank: pick(profile && profile.canOfftank, specs.some((s) => s.canTank)),
        canHeal: pick(profile && profile.canHeal, specs.some((s) => s.canHeal)),
    };
}

/**
 * "Ich kann auch", prefilled from the profile: off-tank and healing as the
 * raider set them, plus the roles of the character's other specs. Never the
 * role of the spec they sign up with.
 */
function defaultCanAlso(profile, characterRef, specKey) {
    const own = (profiles.specInfo(specKey) || {}).role || "";
    const roles = new Set();
    const eff = profileRoles(profile);
    if (eff.canOfftank) roles.add("tank");
    if (eff.canHeal) roles.add("healer");
    const character = findCharacter(profile, characterRef);
    for (const s of (character && character.specs) || []) {
        const role = (profiles.specInfo(s.key) || {}).role;
        if (role) roles.add(role);
    }
    return ROLES.filter((r) => roles.has(r) && r !== own);
}

/**
 * The raiders this user wished for who already signed up for the event — the
 * dialog's "Ysolde ist auch angemeldet". Only the user's own wishes, which the
 * profile page shows them anyway; nobody else's.
 */
function wishPartnersSignedUp(profile, signups) {
    const wishes = new Set(((profile && profile.wishes) || []).map(String));
    if (!wishes.size) return [];
    const byId = new Map(profiles.listProfiles().map((p) => [p.userId, p]));
    return (signups || [])
        .filter((s) => wishes.has(String(s.userId)) && s.status !== "absence")
        .map((s) => {
            const other = byId.get(String(s.userId));
            return { userId: String(s.userId), name: s.character || (other && profiles.raiderRef(other).name) || "" };
        });
}

const fail = (code, error) => ({ code, error });

/**
 * Check a signup without saving it.
 * @param {object} event   an eventStore event (source "eventhelper")
 * @param {object} input   { character, spec, status, canAlso?, comment }
 * @param {object} ctx     { profile, previous?, byOrga?, now? }
 * @returns {{ value?: object, error?: string, code?: string }}
 */
function validateSignup(event, input = {}, { profile, previous = null, byOrga = false, now = Date.now() } = {}) {
    if (!event) return fail("not_found", "Event nicht gefunden.");
    if (event.source !== "eventhelper" || !isOwnEventId(event.id)) {
        return fail("raidhelper", "Für dieses Event meldest du dich über Raid-Helper im Discord an.");
    }
    const status = String(input.status || "signed").trim();
    if (!SIGNUP_STATUSES.includes(status)) return fail("status", `Unbekannter Anmeldestatus „${status}“.`);

    const w = signupWindow(event, now);
    if (w.started && !byOrga) return fail("started", "Der Raid hat schon begonnen – Anmeldungen sind geschlossen.");
    if (w.deadlinePassed && !byOrga && !AFTER_DEADLINE.includes(status)) {
        const unchanged = previous && previous.status === status && previous.spec === String(input.spec || "").trim();
        if (!unchanged) {
            return fail("deadline", "Der Anmeldeschluss ist vorbei – du kannst dich nur noch abmelden oder „Spät“ angeben.");
        }
    }

    let character = null;
    let specKey = String(input.spec || "").trim();
    if (status !== "absence" || input.character) {
        character = findCharacter(profile, input.character);
        if (!character) {
            if (status === "absence") specKey = "";
            else return fail("character", "Dieser Charakter steht nicht in deinem Profil.");
        }
    }
    if (character && status !== "absence") {
        if (!specKey) return fail("spec", "Bitte eine Spezialisierung wählen.");
        if (!character.specs.some((s) => s.key === specKey)) {
            return fail("spec", `Diese Spezialisierung ist für ${character.name} nicht im Profil hinterlegt.`);
        }
    }
    if (character && specKey && !character.specs.some((s) => s.key === specKey)) specKey = "";

    const canAlso = Array.isArray(input.canAlso)
        ? input.canAlso
        : (character && specKey ? defaultCanAlso(profile, character.name, specKey) : []);
    const checked = signupStore.normalizeSignup({
        character: character ? character.name : "",
        spec: specKey,
        status,
        canAlso,
        comment: input.comment,
    }, { versionId: event.versionId });
    if (checked.error) return fail("spec", checked.error);
    return { value: checked.value };
}

/**
 * Sign a user up for an own event (or change / withdraw their signup).
 * `userId` is who the signup belongs to; `byOrga` lifts the deadline and the
 * start for the orga entering somebody. The change event fires in the store.
 * @returns {{ signup?: object, event?: object, error?: string, code?: string }}
 */
function submitSignup(eventId, userId, input = {}, { byOrga = false, now = Date.now() } = {}) {
    const uid = String(userId || "").trim();
    if (!uid) return fail("bad_request", "Kein Nutzer.");
    if (!isOwnEventId(eventId)) {
        return fail("raidhelper", "Für dieses Event meldest du dich über Raid-Helper im Discord an.");
    }
    const event = getEvent(eventId);
    if (!event) return fail("not_found", "Event nicht gefunden.");
    const profile = profiles.getProfile(uid);
    const previous = signupStore.getSignup(event.id, uid);
    const checked = validateSignup(event, input, { profile, previous, byOrga, now });
    if (checked.error) return checked;
    const saved = signupStore.saveSignup(event.id, uid, checked.value, { versionId: event.versionId });
    if (saved.error) return fail("bad_request", saved.error);
    return { signup: saved.signup, event };
}

/** HTTP status for a service error code. */
function httpStatusFor(code) {
    if (code === "not_found") return 404;
    if (code === "deadline" || code === "started" || code === "raidhelper") return 409;
    return 400;
}

module.exports = {
    AFTER_DEADLINE, ATTENDING,
    rosterCounts, roleCounts, signupWindow, allowedStatuses,
    findCharacter, profileRoles, defaultCanAlso, wishPartnersSignedUp,
    validateSignup, submitSignup, httpStatusFor,
};
