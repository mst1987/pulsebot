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

/** settingsStore stand-in: `access.config` is what getConfig() returns. */
function settingsStore() {
    return { getConfig: () => access.config };
}

/** discord stand-in: `access.roleIds` are the member's roles (null = unreadable). */
function discord() {
    return { memberRoleIds };
}

function eventStore() {
    return {
        getEvent: (id) => events.get(id) || null,
        isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    };
}

function signupStore() {
    const actual = jest.requireActual("../../src/web/signupStore");
    const list = (eventId) => [...signups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v);
    return {
        normalizeSignup: actual.normalizeSignup,
        onSignupsChanged: () => () => {},
        getSignup: (eventId, userId) => signups.get(`${eventId}/${userId}`) || null,
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

const sec = (ms) => Math.floor(ms / 1000);

/** An own event three days ahead, deadline in two. */
function ownEvent(over = {}) {
    const now = Date.now();
    return {
        id: "eh-kara", source: "eventhelper", title: "Karazhan", versionId: "tbc",
        startTime: sec(now) + 3 * 86400, signupDeadline: sec(now) + 2 * 86400,
        size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, ...over,
    };
}

function reset() {
    events.clear();
    signups.clear();
    changed.mockClear();
    access.config = {};
    access.roleIds = null;
    memberRoleIds.mockClear();
}

module.exports = { events, signups, changed, access, memberRoleIds, settingsStore, discord, eventStore, signupStore, ownEvent, reset };
