// Signing up for an EventHelper event (#256) — the rules, once, for every front
// end: the web's "Anmeldungen" page today, the Discord signup dialog (#258)
// tomorrow. Nothing in here knows about HTTP or Discord messages (only the
// member's roles are read, for the raider-role rule); a caller hands in who
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
//     or keep the status and spec they already had — the orga still can (`deadline`);
//   * a category with raider roles (`config.categoryRoles`) takes new signups only
//     from holders of one of them (`raider_role`) — the rule that also hides such
//     events on the page (categoryVisible). Roles that cannot be read let the
//     signup through, an existing own signup may still be changed or withdrawn,
//     the orga is exempt.
//
// Saving goes through signupStore.saveSignup, whose change event already edits
// the event message (eventMessage.js) and feeds every other listener.
const { getEvent, isOwnEventId } = require("./eventStore");
const signupStore = require("./signupStore");
const profiles = require("./raiderProfileStore");
const settingsStore = require("./settingsStore");
const discord = require("./discord");
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

/** Whether the event was cancelled (#288) — it takes no signup at all, not even from the orga. */
function isCancelled(event) {
    return !!event && event.status === "cancelled";
}

/** Whether the orga closed the signup (#288) — members may still sign off. */
function isSignupClosed(event) {
    return !!event && event.signupsClosed === true;
}

/** Statuses a member may still pick once the orga closed the signup. */
const WHEN_CLOSED = ["absence"];

/** The statuses a member may choose right now (all of them before the deadline). */
function allowedStatuses(event, { now = Date.now(), byOrga = false } = {}) {
    const w = signupWindow(event, now);
    if (isCancelled(event)) return [];
    if (w.started && !byOrga) return [];
    if (isSignupClosed(event) && !byOrga) return WHEN_CLOSED.slice();
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

const RAIDER_ROLE_ERROR = "Für diesen Raid brauchst du eine Raider-Rolle.";

/**
 * Whether a member's roles let them into a category with raider roles
 * (`config.categoryRoles`). No roles on the category, or roles that cannot be
 * read (`roleIds` null/undefined), let everyone in — an event post in Discord is
 * no secret, a missing raid is a real loss.
 */
function categoryRoleAllowed(categoryId, { config = {}, roleIds = null } = {}) {
    const roles = ((config.categoryRoles || {})[String(categoryId || "")] || []).map(String);
    if (!roles.length || !Array.isArray(roleIds)) return true;
    return roles.some((r) => roleIds.map(String).includes(r));
}

/**
 * Whether a member sees a category's events on the "Anmeldungen" page. Only the
 * event categories count (`config.categoryIds`, when any are set); a category
 * with raider roles is for the holders of one of them (categoryRoleAllowed).
 * The orga sees everything.
 */
function categoryVisible(categoryId, { config = {}, roleIds = null, orga = false } = {}) {
    if (orga) return true;
    const cats = Array.isArray(config.categoryIds) ? config.categoryIds.map(String) : [];
    if (cats.length && !cats.includes(String(categoryId || ""))) return false;
    return categoryRoleAllowed(categoryId, { config, roleIds });
}

/**
 * The raider-role rule for one member and one own event. Reads the config and
 * the member's roles on the event's server (discord.memberRoleIds: one member
 * fetch, no privileged intent) unless the caller hands them in. The orga
 * (`byOrga`) and a member who already has a signup for the event always pass.
 * @returns {Promise<{ ok: true } | { code: "raider_role", error: string }>}
 */
async function checkRaiderRole(event, userId, { byOrga = false, previous, roleIds, config } = {}) {
    if (byOrga || !event) return { ok: true };
    const cfg = config || settingsStore.getConfig();
    const roles = (cfg.categoryRoles || {})[String(event.categoryId || "")] || [];
    if (!roles.length) return { ok: true };
    const uid = String(userId || "");
    const prev = previous === undefined ? signupStore.getSignup(event.id, uid) : previous;
    if (prev) return { ok: true };
    const ids = roleIds !== undefined ? roleIds : await discord.memberRoleIds(event.guildId || cfg.guildId, uid);
    return categoryRoleAllowed(event.categoryId, { config: cfg, roleIds: ids }) ? { ok: true } : fail("raider_role", RAIDER_ROLE_ERROR);
}

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
    if (isCancelled(event)) return fail("cancelled", "Das Event wurde abgesagt – Anmeldungen sind nicht mehr möglich.");
    if (w.started && !byOrga) return fail("started", "Der Raid hat schon begonnen – Anmeldungen sind geschlossen.");
    if (isSignupClosed(event) && !byOrga && !WHEN_CLOSED.includes(status)) {
        const unchanged = previous && previous.status === status && previous.spec === String(input.spec || "").trim();
        if (!unchanged) return fail("closed", "Die Anmeldung ist geschlossen – du kannst dich nur noch abmelden.");
    }
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
 * start for the orga entering somebody, and the raider-role rule (checkRaiderRole;
 * `roleIds` / `config` are optional, it reads them otherwise). The change event
 * fires in the store.
 * @returns {Promise<{ signup?: object, event?: object, error?: string, code?: string }>}
 */
async function submitSignup(eventId, userId, input = {}, { byOrga = false, now = Date.now(), roleIds, config } = {}) {
    const uid = String(userId || "").trim();
    if (!uid) return fail("bad_request", "Kein Nutzer.");
    if (!isOwnEventId(eventId)) {
        return fail("raidhelper", "Für dieses Event meldest du dich über Raid-Helper im Discord an.");
    }
    const event = getEvent(eventId);
    if (!event) return fail("not_found", "Event nicht gefunden.");
    const profile = profiles.getProfile(uid);
    const previous = signupStore.getSignup(event.id, uid);
    const access = await checkRaiderRole(event, uid, { byOrga, previous, roleIds, config });
    if (access.error) return access;
    const checked = validateSignup(event, input, { profile, previous, byOrga, now });
    if (checked.error) return checked;
    const saved = signupStore.saveSignup(event.id, uid, checked.value, { versionId: event.versionId });
    if (saved.error) return fail("bad_request", saved.error);
    return { signup: saved.signup, event };
}

/** HTTP status for a service error code. */
function httpStatusFor(code) {
    if (code === "not_found") return 404;
    if (code === "raider_role") return 403;
    if (code === "deadline" || code === "started" || code === "raidhelper" || code === "closed" || code === "cancelled") return 409;
    return 400;
}

module.exports = {
    AFTER_DEADLINE, ATTENDING, RAIDER_ROLE_ERROR,
    categoryRoleAllowed, categoryVisible, checkRaiderRole, isCancelled, isSignupClosed, WHEN_CLOSED,
    rosterCounts, roleCounts, signupWindow, allowedStatuses,
    findCharacter, profileRoles, defaultCanAlso, wishPartnersSignedUp,
    validateSignup, submitSignup, httpStatusFor,
};
