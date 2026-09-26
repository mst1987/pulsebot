// In-memory stand-ins for eventStore and signupStore, for the signup dialog's
// tests (commands/signup/*, utils/signupDialog.js). The real signupService runs
// on top of them, so the rules under test are the real ones. Use from a
// jest.mock factory:
//
//   jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
//
// The raider profiles use the real store on a temp file (raiderProfileStore.useFile).
const events = new Map();
const signups = new Map();
const changed = jest.fn();
// The raider-role rule (signupService.checkRaiderRole): config and the member's roles.
const access = { config: {}, roleIds: null };
const memberRoleIds = jest.fn(async () => access.roleIds);
// What eventStore.appendEventLog was called with (#306: the automatic close).
const eventLog = jest.fn();
// The message of "Vielleicht" / "Absagen" posted to the orga's channel (signupNotes.js).
const postNotice = jest.fn(async () => ({ channelId: "c", messageId: "m", url: "" }));

/** settingsStore stand-in: `access.config` is what getConfig() returns. */
function settingsStore() {
    return { getConfig: () => access.config };
}

/** discord stand-in: `access.roleIds` are the member's roles (null = unreadable). */
function discord() {
    return { memberRoleIds, postNotice };
}

function eventStore() {
    return {
        getEvent: (id) => events.get(id) || null,
        isOwnEventId: (id) => String(id || "").startsWith("eh-"),
        // The real store's filter: guild (when given) and start time from `sinceSeconds`, newest first.
        listEvents: (guildId, { sinceSeconds = 0 } = {}) => [...events.values()]
            .filter((e) => (!guildId || e.guildId === guildId) && (!sinceSeconds || (e.startTime || 0) >= sinceSeconds))
            .sort((a, b) => b.startTime - a.startTime),
        // #306: signupService closes a full event's signup through these two.
        setEventState: (id, patch) => {
            const ev = events.get(id);
            if (!ev) return null;
            const next = { ...ev, ...patch };
            events.set(id, next);
            return next;
        },
        appendEventLog: (id, entry) => eventLog(id, entry),
    };
}

function signupStore() {
    const actual = jest.requireActual("../../src/web/signupStore");
    const list = (eventId) => [...signups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v);
    return {
        normalizeSignup: actual.normalizeSignup,
        onSignupsChanged: () => () => {},
        getSignup: (eventId, userId) => signups.get(`${eventId}/${userId}`) || null,
        // The newest signup with a spec over every event (updatedAt, else at, decides).
        lastSignupOf: (userId) => {
            const own = [...signups.entries()]
                .filter(([k, v]) => k.endsWith(`/${userId}`) && v.spec && v.status !== "absence")
                .sort((a, b) => (b[1].updatedAt || b[1].at || 0) - (a[1].updatedAt || a[1].at || 0));
            if (!own.length) return null;
            const [key, s] = own[0];
            return { eventId: key.split("/")[0], character: s.character, spec: s.spec };
        },
        listSignups: list,
        saveSignup: jest.fn((eventId, userId, input, opts) => {
            const checked = actual.normalizeSignup(input, opts);
            if (checked.error) return { error: checked.error };
            const signup = { userId: String(userId), ...checked.value, at: 1 };
            signups.set(`${eventId}/${userId}`, signup);
            changed(eventId);
            return { signup };
        }),
    };
}

/** An own event three days ahead, deadline in two (the shared factory, #433). */
const { ownEvent } = require("../factories/events");

function reset() {
    events.clear();
    signups.clear();
    changed.mockClear();
    access.config = {};
    access.roleIds = null;
    memberRoleIds.mockClear();
    eventLog.mockClear();
    postNotice.mockClear();
}

module.exports = { events, signups, changed, access, memberRoleIds, eventLog, postNotice, settingsStore, discord, eventStore, signupStore, ownEvent, reset };
