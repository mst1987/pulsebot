// A sign-off is a hint for the orga's Vermerke (#982): every way through the
// service (one raid - web and bot alike -, several raids, the orga for somebody,
// a raid group) notes it, and the raider's answer stays exactly the same.
const fs = require("fs");

const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    listEvents: (guildId, opts = {}) => [...mockEvents.values()].filter((e) => opts.siblings === true || !(e.raidGroupId && e.raidGroupId !== e.id)),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventState: (id, patch) => ({ ...mockEvents.get(id), ...patch }),
    appendEventLog: jest.fn(),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => {
    const actual = jest.requireActual("../../../src/stores/signupStore");
    return {
        normalizeSignup: actual.normalizeSignup,
        getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
        listSignups: (eventId) => [...mockSignups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v),
        saveSignup: (eventId, userId, input, opts) => {
            const checked = actual.normalizeSignup(input, opts);
            if (checked.error) return { error: checked.error };
            const signup = { userId, ...checked.value, at: 1 };
            mockSignups.set(`${eventId}/${userId}`, signup);
            return { signup };
        },
    };
});
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => null),
    postNotice: jest.fn(async () => ({})),
    guildMembership: jest.fn(async () => ({ member: true })),
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const signals = require("../../../src/stores/userSignalsStore");
const service = require("../../../src/services/signups/signupService");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const NOW = 1_900_000_000_000;
const HOUR_S = 3600;
const placed = (...userIds) => ({ approved: { groups: [{ slots: userIds.map((userId) => ({ userId })) }] } });
const raid = (id, extra = {}) => ownEvent({
    id, title: `Raid ${id}`, guildId: "A", startTime: sec(NOW) + 3 * DAY, signupDeadline: sec(NOW) + 2 * DAY, size: 10, ...extra,
});
const signUp = (eventId, userId, character) => {
    mockSignups.set(`${eventId}/${userId}`, { userId, character, spec: "Mage-Fire", status: "signed", at: 1 });
};
const ABSENCE = { status: "absence" };
const hints = () => signals.eventsFor("A", { now: NOW });

beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => {
    profiles.useFile(null);
    signals.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    const file = tempStoreFile("user-signals.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    signals.useFile(file);
    mockEvents.clear();
    mockSignups.clear();
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(BERT, { name: "Bertor", className: "Mage", specs: ["Mage-Fire"] }, { name: "Bert" });
});

describe("signupService - sign-off hints (#982)", () => {
    it("notes a sign-off while placed in the approved setup, with the hours before the start", async () => {
        mockEvents.set("eh-1", raid("eh-1", { setup: placed(ANNA) }));
        signUp("eh-1", ANNA, "Nerathil");
        const res = await service.submitSignup("eh-1", ANNA, ABSENCE, { now: NOW, accountName: "Anna" });
        expect(res.error).toBeUndefined();
        expect(hints()[ANNA]).toEqual({
            name: "Anna",
            events: [expect.objectContaining({ kind: "signoff_after_setup", eventId: "eh-1", hoursBefore: 72, at: NOW })],
        });
        expect(hints()[ANNA].events[0].byOrga).toBeUndefined();
    });

    it("notes a late sign-off without a setup place, and nothing early or as a first answer", async () => {
        mockEvents.set("eh-late", raid("eh-late", { startTime: sec(NOW) + 5 * HOUR_S, signupDeadline: 0 }));
        mockEvents.set("eh-early", raid("eh-early"));
        signUp("eh-late", ANNA, "Nerathil");
        signUp("eh-early", ANNA, "Nerathil");
        await service.submitSignup("eh-late", ANNA, ABSENCE, { now: NOW, byOrga: true });
        await service.submitSignup("eh-early", ANNA, ABSENCE, { now: NOW });
        await service.submitSignup("eh-late", BERT, ABSENCE, { now: NOW, byOrga: true });
        expect(hints()).toEqual({
            [ANNA]: { name: "Nerathil", events: [expect.objectContaining({ kind: "late_signoff", eventId: "eh-late", byOrga: true })] },
        });
    });

    it("marks byOrga only when somebody else than the raider entered the sign-off", async () => {
        mockEvents.set("eh-self", raid("eh-self", { setup: placed(ANNA) }));
        mockEvents.set("eh-orga", raid("eh-orga", { setup: placed(BERT) }));
        signUp("eh-self", ANNA, "Nerathil");
        signUp("eh-orga", BERT, "Bertor");
        await service.submitSignup("eh-self", ANNA, ABSENCE, { now: NOW, byOrga: true, actorId: ANNA });
        await service.submitSignup("eh-orga", BERT, ABSENCE, { now: NOW, byOrga: true, actorId: "999000999000999000" });
        expect(hints()[ANNA].events[0].byOrga).toBeUndefined();
        expect(hints()[BERT].events[0].byOrga).toBe(true);
    });

    it("passes the actor on when signing off several raids at once", async () => {
        mockEvents.set("eh-a", raid("eh-a", { setup: placed(ANNA) }));
        signUp("eh-a", ANNA, "Nerathil");
        await service.submitSignups(ANNA, [{ eventId: "eh-a", status: "absence" }], { now: NOW, byOrga: true, actorId: ANNA });
        expect(hints()[ANNA].events[0].byOrga).toBeUndefined();
    });

    it("notes the sign-off of several raids at once, per raid", async () => {
        mockEvents.set("eh-a", raid("eh-a", { setup: placed(ANNA) }));
        mockEvents.set("eh-b", raid("eh-b", { setup: placed(ANNA), startTime: sec(NOW) + 4 * DAY }));
        signUp("eh-a", ANNA, "Nerathil");
        signUp("eh-b", ANNA, "Nerathil");
        const results = await service.submitSignups(ANNA, [{ eventId: "eh-a", status: "absence" }, { eventId: "eh-b", status: "absence" }], { now: NOW });
        expect(results.map((r) => r.ok)).toEqual([true, true]);
        expect(hints()[ANNA].events.map((e) => e.eventId).sort()).toEqual(["eh-a", "eh-b"]);
    });

    it("counts a place in a further raid of the raid group at the group's first raid", async () => {
        mockEvents.set("eh-za", raid("eh-za", { raidGroupId: "eh-za", raidGroupIndex: 1 }));
        mockEvents.set("eh-za2", raid("eh-za2", { raidGroupId: "eh-za", raidGroupIndex: 2, setup: placed(ANNA) }));
        signUp("eh-za", ANNA, "Nerathil");
        await service.submitSignup("eh-za2", ANNA, ABSENCE, { now: NOW });
        expect(hints()[ANNA].events).toEqual([expect.objectContaining({ kind: "signoff_after_setup", eventId: "eh-za" })]);
    });

    it("answers the raider exactly the same, hint or not", async () => {
        mockEvents.set("eh-1", raid("eh-1", { setup: placed(ANNA) }));
        signUp("eh-1", ANNA, "Nerathil");
        signUp("eh-1", BERT, "Bertor");
        const withHint = await service.submitSignup("eh-1", ANNA, ABSENCE, { now: NOW });
        const without = await service.submitSignup("eh-1", BERT, ABSENCE, { now: NOW });
        expect(hints()[ANNA]).toBeDefined();
        expect(hints()[BERT]).toBeUndefined();
        expect(Object.keys(withHint).sort()).toEqual(Object.keys(without).sort());
        expect(withHint.notice).toBe(without.notice);
        expect(JSON.stringify(withHint)).not.toMatch(/signoff_after_setup|late_signoff|hint|signal/i);
    });

    it("signs off even when noting the hint fails", async () => {
        mockEvents.set("eh-1", raid("eh-1", { setup: placed(ANNA) }));
        signUp("eh-1", ANNA, "Nerathil");
        const spy = jest.spyOn(signals, "recordEvent").mockImplementation(() => { throw new Error("disk full"); });
        try {
            const res = await service.submitSignup("eh-1", ANNA, ABSENCE, { now: NOW });
            expect(res.error).toBeUndefined();
            expect(res.signup.status).toBe("absence");
        } finally {
            spy.mockRestore();
        }
    });
});
