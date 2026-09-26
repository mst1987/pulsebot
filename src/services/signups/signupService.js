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
//   * a full raid (#306) takes no new signup that would take a seat ("Dabei" and
//     "Spät" alike — rosterCounts counts them alike): with `event.overflow === "bench"`
//     (the default) the signup becomes the waiting list — status "bench", and the
//     raider is told so in the same breath — with `"off"` it is refused (`full`).
//     Whoever already holds a seat keeps it (so signed → late stays possible), and
//     the orga is bound by neither; with `event.lockAtLimit` a raid that just
//     filled up closes its signup;
//   * a category with raider roles (`config.categoryRoles`) takes new signups only
//     from holders of one of them (`raider_role`) — the rule that also hides such
//     events on the page (categoryVisible). Roles that cannot be read let the
//     signup through, an existing own signup may still be changed or withdrawn,
//     the orga is exempt.
//
// Saving goes through signupStore.saveSignup, whose change event already edits
// the event message (eventMessage.js) and feeds every other listener.
const { getEvent, isOwnEventId, setEventState, appendEventLog } = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const { MAX_CHARACTERS, migrateSignup, characterStatus } = require("./signupCharacters");
const profiles = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const signupNotes = require("./signupNotes");
const { SIGNUP_STATUSES } = require("../../utils/attendance");
const { ROLES } = require("../../config/gameVersions/classes");
const { spec: specOf } = require("../../config/gameVersions");

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

/**
 * The effective "kann Offtank / heilen" of one character (raiderProfileStore's
 * characterRoles: its own word, else the old profile-wide one, else its specs).
 * Without a character reference: true when any character may.
 */
function profileRoles(profile, characterRef) {
    const characters = (profile && profile.characters) || [];
    if (characterRef !== undefined) {
        const r = profiles.characterRoles(profile, findCharacter(profile, characterRef));
        return { canOfftank: r.canOfftank, canHeal: r.canHeal };
    }
    const per = characters.map((c) => profiles.characterRoles(profile, c));
    const any = (field) => (per.length ? per.some((r) => r[field]) : !!(profile && profile[field] === true));
    return { canOfftank: any("canOfftank"), canHeal: any("canHeal") };
}

/**
 * "Ich kann auch", prefilled from the profile: off-tank and healing as the
 * raider set them for this character, plus the roles of its other specs.
 * Never the role of the spec they sign up with.
 */
function defaultCanAlso(profile, characterRef, specKey) {
    const own = (profiles.specInfo(specKey) || {}).role || "";
    const roles = new Set();
    const eff = profileRoles(profile, characterRef);
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

/** An event's overflow rule, "bench" unless it says otherwise (#306). */
function overflowOf(event) {
    return event && event.overflow === "off" ? "off" : "bench";
}

/** Whether a stored signup already holds a seat — such a raider keeps it (#306). */
function holdsSeat(signup) {
    return !!signup && ATTENDING.includes(String(signup.status || "signed"));
}

/** How many seats are taken, leaving out one user's own signup. */
function seatsTaken(signups, exceptUserId = "") {
    const uid = String(exceptUserId || "");
    return rosterCounts((signups || []).filter((s) => !uid || String(s.userId) !== uid)).attending;
}

/** The same signup, every character on the bench. */
function benched(value) {
    return {
        ...value,
        status: "bench",
        characters: (value.characters || []).map((c) => ({ ...c, status: "bench" })),
    };
}

/**
 * The waiting list (#306). A raid that is full takes no NEW signup that would
 * take a seat: with `overflow: "bench"` it is stored as the bench and the
 * raider is told in the same answer, with `"off"` it is refused. Nobody is
 * pushed off a seat they already hold, the orga (`byOrga`) is not bound, and an
 * event without a size has no limit to be full against.
 *
 * ⚠️ **Both seat-taking statuses are caught, "Dabei" and "Spät"** — `rosterCounts`
 * counts them alike, so catching only "Dabei" would let anyone walk past a full
 * waiting list by picking "Spät", and the message would read 3/2. "Vielleicht",
 * "Bank" and an absence take no seat and are never touched.
 *
 * @returns {{ value: object, waitlisted: boolean, notice: string } | { code: "full", error: string }}
 */
function applyOverflow(event, value, { previous = null, byOrga = false, signups = null, userId = "" } = {}) {
    const keep = { value, waitlisted: false, notice: "" };
    const size = Number(event && event.size) || 0;
    if (byOrga || !size || !ATTENDING.includes(String(value.status)) || holdsSeat(previous)) return keep;
    const taken = seatsTaken(signups || signupStore.listSignups(event.id), userId);
    if (taken < size) return keep;
    if (overflowOf(event) === "off") {
        return fail("full", `Der Raid ist voll (${taken}/${size}) – es geht keine Anmeldung mehr. Frag die Raidleitung.`);
    }
    return {
        value: benched(value),
        waitlisted: true,
        notice: `Der Raid ist voll (${taken}/${size}) – du stehst auf der Warteliste (Bank). Ob jemand nachrückt, entscheidet die Raidleitung.`,
    };
}

/**
 * `lockAtLimit` (#306): a raid that has just filled up closes its own signup,
 * exactly like the orga's "Anmeldung schließen" (#288) and logged the same way.
 * Only ever closes — signing off later never opens it again.
 * @returns {{ locked: boolean, event: object }}
 */
function lockIfFull(event, { now = Date.now() } = {}) {
    const size = Number(event && event.size) || 0;
    if (!event || !event.lockAtLimit || event.signupsClosed || isCancelled(event) || !size) return { locked: false, event };
    const taken = rosterCounts(signupStore.listSignups(event.id)).attending;
    if (taken < size) return { locked: false, event };
    const next = setEventState(event.id, { signupsClosed: true });
    appendEventLog(event.id, { action: "lock", detail: `Raid voll (${taken}/${size})`, at: now });
    return { locked: true, event: next || event };
}

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
    const prev = previous ? migrateSignup(previous) : null;
    const entries = withStatuses(requestedCharacters(input, prev), status, prev);
    // Per character: a status the phase still allows, or the one it already had
    // (same character and spec) — keeping a signup to edit the comment, or moving
    // only the first character to "Spät", never trips over the others.
    const keptFromBefore = (entry) => {
        const had = prevCharacter(prev, entry);
        return !!had && had.status === entry.status;
    };
    if (isSignupClosed(event) && !byOrga && status !== "absence") {
        if (!entries.length || entries.some((e) => !WHEN_CLOSED.includes(e.status) && !keptFromBefore(e))) {
            return fail("closed", "Die Anmeldung ist geschlossen – du kannst dich nur noch abmelden.");
        }
    }
    if (w.deadlinePassed && !byOrga && status !== "absence") {
        const refused = entries.length
            ? entries.some((e) => !AFTER_DEADLINE.includes(e.status) && !keptFromBefore(e))
            : !AFTER_DEADLINE.includes(status);
        if (refused) return fail("deadline", "Der Anmeldeschluss ist vorbei – du kannst dich nur noch abmelden oder „Spät“ angeben.");
    }
    if (entries.length > MAX_CHARACTERS) {
        return fail("characters", `Höchstens ${MAX_CHARACTERS} Charaktere je Anmeldung.`);
    }
    const resolved = [];
    const seen = new Set();
    for (const [i, entry] of entries.entries()) {
        const specKey = String(entry.spec || "").trim();
        if (status === "absence") {
            // Signing off keeps whatever still fits the profile, nothing is refused.
            const character = findCharacter(profile, entry.character);
            if (i === 0 && character && !specKey) resolved.push({ character, spec: "" });
            else if (character && character.specs.some((s) => s.key === specKey) && !seen.has(character.key)) resolved.push({ character, spec: specKey });
            if (character) seen.add(character.key);
            continue;
        }
        const character = findCharacter(profile, entry.character);
        if (!character) {
            return fail("character", i === 0 || !entry.character
                ? "Dieser Charakter steht nicht in deinem Profil."
                : `${entry.character} steht nicht in deinem Profil.`);
        }
        if (seen.has(character.key)) continue;
        seen.add(character.key);
        if (!specKey) return fail("spec", "Bitte eine Spezialisierung wählen.");
        if (!character.specs.some((s) => s.key === specKey)) {
            return fail("spec", `Diese Spezialisierung ist für ${character.name} nicht im Profil hinterlegt.`);
        }
        resolved.push({ character, spec: specKey, status: entry.status });
    }
    if (status !== "absence" && !resolved.length) return fail("character", "Dieser Charakter steht nicht in deinem Profil.");

    const first = resolved[0] || null;
    const canAlso = Array.isArray(input.canAlso)
        ? input.canAlso
        : (first && first.spec ? defaultCanAlso(profile, first.character.name, first.spec) : []);
    const checked = signupStore.normalizeSignup({
        characters: resolved.map((c) => ({ character: c.character.name, spec: c.spec, status: c.status })),
        character: first ? first.character.name : "",
        status,
        canAlso,
        comment: input.comment,
    }, { versionId: event.versionId });
    if (checked.error) return fail("spec", checked.error);
    return { value: checked.value };
}

/** The previous signup's entry for the same character and spec, or null. */
function prevCharacter(prev, entry) {
    if (!prev || prev.status === "absence") return null;
    const key = profiles.characterKey(entry.character);
    return (prev.characters || []).find((c) => profiles.characterKey(c.character) === key && c.spec === entry.spec) || null;
}

/**
 * Each requested character's status: its own when the request names one, else
 * — while the signup's status stays what it was — the status it already had
 * (the web page saving a comment keeps "Spät" on the first character only),
 * else the request's status. An absence has none.
 */
function withStatuses(entries, status, prev) {
    if (status === "absence") return entries.map(({ character, spec }) => ({ character, spec }));
    return entries.map((e) => {
        const own = characterStatus(e.status);
        if (own) return { ...e, status: own };
        const had = prev && prev.status === status ? prevCharacter(prev, e) : null;
        return { ...e, status: had ? had.status : status };
    });
}

/**
 * The characters a request names, in priority order: `input.characters` when
 * given (#293), else the single `character`/`spec` — which keeps the previous
 * signup's alternates (with their own status), so a front end that only knows
 * one character (the Discord status buttons, the comment modal) never drops the
 * "kann auch mit".
 */
function requestedCharacters(input, previous) {
    if (Array.isArray(input.characters)) {
        return input.characters
            .filter((c) => c && (c.character || c.spec))
            .map((c) => ({ character: String(c.character || "").trim(), spec: String(c.spec || "").trim(), status: String(c.status || "").trim() }));
    }
    const single = { character: String(input.character || "").trim(), spec: String(input.spec || "").trim(), status: "" };
    const key = profiles.characterKey(single.character);
    const alternates = ((previous && previous.characters) || [])
        .slice(1)
        .filter((c) => profiles.characterKey(c.character) !== key)
        .map((c) => ({ character: c.character, spec: c.spec, status: previous.status === "absence" ? "" : String(c.status || "") }));
    return single.character || single.spec ? [single, ...alternates] : [];
}

/**
 * Sign a user up for an own event (or change / withdraw their signup).
 * `userId` is who the signup belongs to; `byOrga` lifts the deadline and the
 * start for the orga entering somebody, the raider-role rule (checkRaiderRole;
 * `roleIds` / `config` are optional, it reads them otherwise) and the waiting
 * list. The change event fires in the store.
 *
 * `waitlisted` says the "Dabei" became a bench seat because the raid is full,
 * `locked` that this signup closed the signup (`lockAtLimit`), and `notice` is
 * the German sentence every front end puts under its confirmation — the raider
 * learns it right there, not from the roster.
 * @returns {Promise<{ signup?: object, event?: object, waitlisted?: boolean, locked?: boolean, notice?: string, error?: string, code?: string }>}
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
    const overflow = applyOverflow(event, checked.value, { previous, byOrga, userId: uid });
    if (overflow.error) return overflow;
    const saved = signupStore.saveSignup(event.id, uid, overflow.value, { versionId: event.versionId });
    if (saved.error) return fail("bad_request", saved.error);
    const lock = lockIfFull(event, { now });
    const notice = [overflow.notice, lock.locked ? "Der Raid ist damit voll – die Anmeldung ist jetzt geschlossen." : ""]
        .filter(Boolean).join(" ");
    // The note of "Vielleicht" / "Absagen" goes to the orga's channel — not
    // awaited: a slow or refused post never holds up or fails the signup.
    signupNotes.postSignupNote(event, saved.signup, previous, { config: config || settingsStore.getConfig(), byOrga });
    return { signup: saved.signup, event: lock.event, waitlisted: overflow.waitlisted, locked: lock.locked, notice };
}

/**
 * Which of the requested characters can go into this raid, and why the others
 * cannot — for signing up to several raids with one choice (#293). A spec the
 * event's game version does not have ("Klasse passt nicht") and a spec the
 * profile marks without usable gear are skipped for that raid, never refused.
 * @returns {{ characters: { character: string, spec: string }[], skipped: { character: string, spec: string, reason: string }[] }}
 */
function fitCharactersToEvent(event, characters, profile) {
    const out = { characters: [], skipped: [] };
    for (const c of characters || []) {
        const entry = { character: String((c && c.character) || ""), spec: String((c && c.spec) || "") };
        if (!specOf(entry.spec, event && event.versionId)) {
            out.skipped.push({ ...entry, reason: "Klasse passt nicht zu diesem Raid" });
            continue;
        }
        const character = findCharacter(profile, entry.character);
        const spec = character && character.specs.find((s) => s.key === entry.spec);
        if (spec && spec.gear === "none") {
            out.skipped.push({ ...entry, reason: "laut Profil ohne brauchbares Gear" });
            continue;
        }
        out.characters.push(entry);
    }
    return out;
}

/**
 * Sign one user up for several own events at once (#293) — the bot's
 * "Für alle Raids" / "Mehrere Raids" and the web's "Für alle gewählten". Every
 * event runs the full submitSignup (raider role, deadline, start, profile), so
 * one refused raid never stops the others. Characters that do not fit a raid
 * are skipped there with a reason; a raid left without any is skipped as a
 * whole. The comment and "kann auch" of an existing signup are kept.
 *
 * @param {string} userId
 * @param {{ eventId: string, characters: { character, spec }[], status?: string }[]} entries
 * @returns {Promise<{ eventId: string, title: string, startTime: number, ok: boolean, signup?: object, skipped: object[], error?: string, code?: string }[]>}
 */
async function submitSignups(userId, entries, { byOrga = false, now = Date.now(), config } = {}) {
    const uid = String(userId || "").trim();
    const cfg = config || settingsStore.getConfig();
    const profile = profiles.getProfile(uid);
    const roleCache = new Map();
    const results = [];
    const seen = new Set();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const eventId = String((entry && entry.eventId) || "").trim();
        if (!eventId || seen.has(eventId)) continue;
        seen.add(eventId);
        const event = isOwnEventId(eventId) ? getEvent(eventId) : null;
        const base = { eventId, title: (event && event.title) || eventId, startTime: (event && event.startTime) || 0 };
        if (!event) {
            const why = isOwnEventId(eventId)
                ? fail("not_found", "Event nicht gefunden.")
                : fail("raidhelper", "Anmeldung läuft über Raid-Helper.");
            results.push({ ...base, ok: false, skipped: [], ...why });
            continue;
        }
        const status = String(entry.status || "signed");
        const fit = status === "absence"
            ? { characters: Array.isArray(entry.characters) ? entry.characters : [], skipped: [] }
            : fitCharactersToEvent(event, entry.characters, profile);
        if (status !== "absence" && !fit.characters.length) {
            const error = fit.skipped.length ? "Keiner der gewählten Charaktere passt" : "Kein Charakter gewählt";
            results.push({ ...base, ok: false, skipped: fit.skipped, code: "no_character", error });
            continue;
        }
        let roleIds;
        const needsRoles = ((cfg.categoryRoles || {})[String(event.categoryId || "")] || []).length > 0;
        if (needsRoles && !byOrga) {
            const guild = event.guildId || cfg.guildId || "";
            if (!roleCache.has(guild)) roleCache.set(guild, await discord.memberRoleIds(guild, uid));
            roleIds = roleCache.get(guild);
        }
        const previous = signupStore.getSignup(event.id, uid);
        const result = await submitSignup(event.id, uid, {
            characters: fit.characters,
            status,
            canAlso: previous ? previous.canAlso : undefined,
            comment: previous ? previous.comment : "",
        }, { byOrga, now, roleIds, config: cfg });
        if (result.error) results.push({ ...base, ok: false, skipped: fit.skipped, code: result.code, error: result.error });
        else {
            results.push({
                ...base, ok: true, signup: result.signup, skipped: fit.skipped,
                waitlisted: !!result.waitlisted, locked: !!result.locked, notice: result.notice || "",
            });
        }
    }
    return results;
}

/** HTTP status for a service error code. */
function httpStatusFor(code) {
    if (code === "not_found") return 404;
    if (code === "raider_role") return 403;
    if (code === "deadline" || code === "started" || code === "raidhelper" || code === "closed" || code === "cancelled" || code === "full") return 409;
    return 400;
}

module.exports = {
    categoryVisible, checkRaiderRole, rosterCounts, roleCounts, signupWindow, allowedStatuses, findCharacter, profileRoles, defaultCanAlso,
    wishPartnersSignedUp, submitSignup, submitSignups, httpStatusFor, MAX_CHARACTERS,
    // only for the tests (#424): not part of the module's API
    _internal: {
        categoryRoleAllowed, validateSignup,
    },
};
