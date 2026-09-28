// The orga changes a raider's signup from the setup editor (#521): status
// ("Bank" → "Dabei", "Spät", signed off), character and spec — without going to
// the signup page. One path for everything else that follows a signup:
//
//   * the signup is saved through signupService.submitSignup with `byOrga`
//     (deadline, closed signup, raider role and the waiting list do not bind
//     the orga) and `offProfile` (a spec of the character's class the raider's
//     profile lacks is taken, and a raider without a profile keeps the
//     characters they signed up with) — so the signup message, the talk
//     overview and every other listener of signupStore follow as always;
//   * the event log gets one entry ("Anmeldung geändert (Orga)": who, before → after);
//   * a stored setup is saved again with the raider where they stood: a placed
//     raider keeps their place and shows the new character/spec (the role
//     follows the spec — a role that no longer fits is the checks' business,
//     never a refusal), a raider signed off leaves groups and bench (an absence
//     is in no part of the setup, not even "Angemeldet"). The save goes through
//     setupEditor.saveEventSetup, so checks, reasons, the pool and the version
//     (a changed lineup turns an approval back into a draft) follow its rules.
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const signupService = require("../signups/signupService");
const { STATUS_LABELS } = require("../events/eventManage");
const setupEditor = require("./setupEditor");
const { benchAndPool } = require("./setupCore");
const { rulesFor, DEFAULT_VERSION } = require("../../config/gameVersions");
const { signupCharacters } = require("../../utils/setup/model");
const { SIGNUP_STATUSES } = require("../../utils/attendance");
const { str } = require("../../utils/text");

const fail = (status, code, error) => ({ status, code, error });

const keyOf = (name) => profiles.characterKey(name) || str(name).toLowerCase();

function rulesOf(event) {
    return rulesFor((event && event.versionId) || DEFAULT_VERSION) || rulesFor(DEFAULT_VERSION);
}

/** The own event and the raider's signup, or a failure. */
function signupOf(eventId, userId) {
    const id = str(eventId);
    if (!eventStore.isOwnEventId(id)) return { failed: fail(409, "raidhelper", "Das Setup dieses Events liegt bei Raid-Helper.") };
    const event = eventStore.getEvent(id);
    if (!event) return { failed: fail(404, "not_found", "Event nicht gefunden.") };
    const signup = signupStore.getSignup(event.id, str(userId));
    if (!signup) return { failed: fail(404, "not_signed_up", "Dieser Raider ist nicht angemeldet.") };
    return { event, signup };
}

/**
 * What the dialog offers for one raider: the signup as it stands and every
 * character to choose from — the profile's characters, then the signup's own
 * ones the profile lacks — each with every spec of its class in the event's
 * rule set, the profile's specs first and the others marked `inProfile: false`.
 * @returns {{ failed?: object, view?: object }}
 */
function signupEditView(eventId, userId) {
    const { event, signup, failed } = signupOf(eventId, userId);
    if (failed) return { failed };
    const rules = rulesOf(event);
    const classes = new Map(rules.classes.map((c) => [c.id, c]));
    const specClass = new Map();
    for (const c of rules.classes) for (const s of c.specs) specClass.set(s.key, c.id);
    const profile = profiles.getProfile(signup.userId);
    const options = [];
    const seen = new Set();
    const add = (name, classId, profileSpecs, inProfile) => {
        const cls = classes.get(classId);
        const key = keyOf(name);
        if (!cls || !key || seen.has(key)) return;
        seen.add(key);
        const own = new Map((profileSpecs || []).map((s) => [s.key, s]));
        const specs = cls.specs
            .map((s) => ({ key: s.key, label: s.label, icon: s.icon || "", role: s.role, inProfile: own.has(s.key), gear: (own.get(s.key) || {}).gear || "" }))
            .sort((a, b) => Number(b.inProfile) - Number(a.inProfile));
        options.push({ character: name, key, classId: cls.id, classLabel: cls.label, classColor: cls.color || "", classIcon: cls.icon || "", inProfile, specs });
    };
    for (const c of (profile && profile.characters) || []) add(c.name, c.className, c.specs, true);
    for (const c of signupCharacters(signup)) add(str(c.character), specClass.get(str(c.spec)), [], false);
    return {
        view: {
            userId: signup.userId,
            status: signup.status,
            characters: signupCharacters(signup).map((c) => ({ character: str(c.character), spec: str(c.spec), status: str(c.status) })),
            statuses: SIGNUP_STATUSES.slice(),
            options,
        },
    };
}

/** "Brokk · Bank → Dabei · Verstärkung → Elementar" — the log line of one change. */
function changeLine(before, after, beforeEntry, afterEntry) {
    const specText = (key) => (profiles.specInfo(key) || {}).label || key || "–";
    const parts = [afterEntry.character || beforeEntry.character || ""];
    if (before.status !== after.status) parts.push(`${STATUS_LABELS[before.status] || before.status} → ${STATUS_LABELS[after.status] || after.status}`);
    if (keyOf(beforeEntry.character) !== keyOf(afterEntry.character)) parts.push(`${beforeEntry.character} → ${afterEntry.character}`);
    if (beforeEntry.spec !== afterEntry.spec && after.status !== "absence") parts.push(`${specText(beforeEntry.spec)} → ${specText(afterEntry.spec)}`);
    if (parts.length === 1) parts.push("unverändert");
    return parts.filter(Boolean).join(" · ");
}

/**
 * The stored setup again, with the changed raider where they stood: the shown
 * character/spec follows the change (a status alone leaves an "im Setup als"
 * spec alone), an absence leaves groups and bench. Raiders who signed off or
 * whose signup is gone are left out too — the save would refuse them, and a
 * proposal ignores them the same way.
 */
function placementAfter(setup, uid, { absent, from, to, playChanged }) {
    const signups = new Map(signupStore.listSignups(setup.eventId || "").map((s) => [s.userId, s]));
    const keep = (id) => !(absent && id === uid);
    const groups = (setup.groups || []).map((g) => ({
        index: g.index,
        slots: (g.slots || []).filter((s) => keep(str(s.userId))).map((s) => {
            const slot = { userId: str(s.userId), character: s.character || "", spec: s.spec || "", role: s.role || "", locked: s.locked === true, pos: s.pos };
            if (slot.userId === uid && playChanged && keyOf(slot.character) === keyOf(from.character)) {
                slot.character = to.character;
                slot.spec = to.spec;
                slot.role = (profiles.specInfo(to.spec) || {}).role || "";
            }
            return slot;
        }),
    }));
    const bench = benchAndPool(setup).bench.filter((b) => keep(str(b.userId))).map((b) => ({ userId: str(b.userId), locked: b.locked === true }));
    return { groups, bench, signups };
}

function withoutGone(placement) {
    const present = (id) => {
        const s = placement.signups.get(id);
        return !!s && s.status !== "absence";
    };
    return {
        groups: placement.groups.map((g) => ({ ...g, slots: g.slots.filter((s) => present(s.userId)) })),
        bench: placement.bench.filter((b) => present(b.userId)),
    };
}

/**
 * Change one raider's signup as the orga. Body: `{ status, character?, spec?, from? }` —
 * `from` is the character the setup shows (one of the signup's, #293), the one
 * `character`/`spec` replace; the signup's other characters stay.
 * @returns {Promise<{ status?: number, code?: string, error?: string, event?: object, signup?: object, message?: string, warning?: string }>}
 */
async function changeSignupFromSetup(eventId, userId, body = {}, { user = null, byName = "", now = Date.now() } = {}) {
    const uid = str(userId);
    const { event, signup: before, failed } = signupOf(eventId, uid);
    if (failed) return failed;
    const status = str(body.status) || before.status;
    if (!SIGNUP_STATUSES.includes(status)) return fail(400, "status", `Unbekannter Anmeldestatus „${status}“.`);

    const entries = signupCharacters(before).map((c) => ({ character: str(c.character), spec: str(c.spec) }));
    const fromKey = keyOf(body.from || before.character);
    let at = entries.findIndex((c) => keyOf(c.character) === fromKey);
    if (at < 0) at = 0;
    const from = entries[at] || { character: before.character || "", spec: before.spec || "" };
    const to = { character: str(body.character) || from.character, spec: str(body.spec) || from.spec };
    const list = entries.slice();
    list[at] = to;
    // the same character twice would count once anyway — keep the changed one where it stands
    const characters = list.filter((c, i) => i === at || keyOf(c.character) !== keyOf(to.character));

    const result = await signupService.submitSignup(event.id, uid, {
        characters,
        status,
        canAlso: Array.isArray(before.canAlso) ? before.canAlso : undefined,
        comment: before.comment || "",
    }, { byOrga: true, offProfile: true, now });
    if (result.error) return fail(signupService.httpStatusFor(result.code), result.code, result.error);
    const after = result.signup;

    eventStore.appendEventLog(event.id, {
        action: "signupEdit",
        by: str(user && user.id),
        byName: str(byName || (user && (user.name || user.username))),
        detail: changeLine(before, after, from, to),
        at: now,
    });

    let warning = "";
    const fresh = eventStore.getEvent(event.id) || event;
    if (fresh.setup) {
        const playChanged = keyOf(from.character) !== keyOf(to.character) || from.spec !== to.spec;
        const placement = withoutGone(placementAfter({ ...fresh.setup, eventId: fresh.id }, uid, { absent: after.status === "absence", from, to, playChanged }));
        const saved = setupEditor.saveEventSetup(fresh.id, placement, { userId: str(user && user.id), now });
        if (saved.error) warning = `Setup nicht angepasst: ${saved.error}`;
    }
    const who = after.character || to.character || uid;
    return {
        event: eventStore.getEvent(event.id) || fresh,
        signup: after,
        message: `Anmeldung von ${who} geändert.${warning ? ` ${warning}` : ""}`,
        warning,
    };
}

module.exports = { signupEditView, changeSignupFromSetup };
