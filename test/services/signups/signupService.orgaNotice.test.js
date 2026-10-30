// The orga's hint at signup (#983) is queued on every own way through the
// service - one raid, several raids, a raid group night - only for a first
// signup, never for an entry by the orga, and the raider's answer stays the same.
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
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => null),
    postNotice: jest.fn(async () => ({})),
    postPayload: jest.fn(async () => ({})),
    guildMembership: jest.fn(async () => ({ member: true })),
}));

const discord = require("../../../src/services/discord/discord");
const profiles = require("../../../src/stores/raiderProfileStore");
const marks = require("../../../src/stores/orgaSignupNoticeStore");
const queue = require("../../../src/services/vermerke/orgaSignupQueue");
const service = require("../../../src/services/signups/signupService");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const NOW = 1_900_000_000_000;
const SWITCH_ON = { serverSettings: { A: { vermerkeOrgaNotice: { enabled: true, level: "warning" } } } };
const raid = (id, extra = {}) => ownEvent({
    id, title: `Raid ${id}`, guildId: "A", startTime: sec(NOW) + 3 * DAY, signupDeadline: sec(NOW) + 2 * DAY, size: 10, ...extra,
});
const SIGN = { character: "Nerathil", spec: "Mage-Fire" };
const queued = () => (queue.pendingCounts().A || 0);

let handler;
beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => {
    profiles.useFile(null);
    marks.useFile(null);
    queue.setFlushHandler(null);
});
beforeEach(() => {
    profiles.reset();
    const file = tempStoreFile("orga-signup-notices.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    marks.useFile(file);
    queue.clearPending();
    handler = jest.fn(async () => {});
    queue.setFlushHandler(handler);
    mockConfig = SWITCH_ON;
    mockEvents.clear();
    mockSignups.clear();
    discord.postNotice.mockClear();
    discord.postPayload.mockClear();
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(BERT, { name: "Bertor", className: "Mage", specs: ["Mage-Fire"] }, { name: "Bert" });
});
afterEach(() => queue.clearPending());

describe("signupService - orga's hint at signup (#983)", () => {
    it("queues a first signup with the raid and the character (not the account name)", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        const res = await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW, accountName: "Anna" });
        expect(res.error).toBeUndefined();
        expect(queued()).toBe(1);
        await queue.flush("A");
        expect(handler).toHaveBeenCalledWith("A", [expect.objectContaining({ eventId: "eh-1", userId: ANNA, name: "Nerathil", title: "Raid eh-1" })]);
    });

    it("queues once per raid: not on a change, a sign-off or signing up again", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        await service.submitSignup("eh-1", ANNA, { ...SIGN, status: "tentative" }, { now: NOW });
        await service.submitSignup("eh-1", ANNA, { status: "absence" }, { now: NOW });
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        expect(queued()).toBe(1);
    });

    it("queues nothing with the switch off or for a first answer that is a sign-off", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        await service.submitSignup("eh-1", BERT, { status: "absence" }, { now: NOW });
        mockConfig = {};
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        expect(queued()).toBe(0);
        // the first signup is still marked: switching on later never makes it a first one again
        expect(marks.hasMark("eh-1", ANNA)).toBe(true);
        expect(marks.hasMark("eh-1", BERT)).toBe(false);
    });

    it("A: switch on only after the first signup - signing off and up again gives no line", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        mockConfig = {};
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        mockConfig = SWITCH_ON;
        await service.submitSignup("eh-1", ANNA, { status: "absence" }, { now: NOW });
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        expect(queued()).toBe(0);
        await queue.flush("A");
        expect(handler).not.toHaveBeenCalled();
    });

    it("B: entered by the orga, then signed off and up again by the person - no line", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW, byOrga: true, actorId: "999000999000999000" });
        expect(marks.hasMark("eh-1", ANNA)).toBe(true);
        await service.submitSignup("eh-1", ANNA, { status: "absence" }, { now: NOW });
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        expect(queued()).toBe(0);
    });

    it("skips an entry by the orga for somebody else, but not the orga signing up itself", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW, byOrga: true, actorId: "999000999000999000" });
        expect(queued()).toBe(0);
        await service.submitSignup("eh-1", BERT, { character: "Bertor", spec: "Mage-Fire" }, { now: NOW, byOrga: true, actorId: BERT });
        expect(queued()).toBe(1);
    });

    it("queues several raids at once, per raid", async () => {
        mockEvents.set("eh-a", raid("eh-a"));
        mockEvents.set("eh-b", raid("eh-b", { startTime: sec(NOW) + 4 * DAY }));
        const results = await service.submitSignups(ANNA, [{ eventId: "eh-a", characters: [SIGN] }, { eventId: "eh-b", characters: [SIGN] }], { now: NOW });
        expect(results.map((r) => r.ok)).toEqual([true, true]);
        expect(queued()).toBe(2);
    });

    it("answers the raider exactly the same and posts nothing on the way", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        const withSwitch = await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
        mockConfig = {};
        const without = await service.submitSignup("eh-1", BERT, { character: "Bertor", spec: "Mage-Fire" }, { now: NOW });
        expect(Object.keys(withSwitch).sort()).toEqual(Object.keys(without).sort());
        expect(withSwitch.notice).toBe(without.notice);
        expect(JSON.stringify(withSwitch)).not.toMatch(/vermerk|shadowban|warning|orga/i);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("signs up even when queueing the hint fails", async () => {
        mockEvents.set("eh-1", raid("eh-1"));
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const spy = jest.spyOn(marks, "markOnce").mockImplementation(() => { throw new Error("disk full"); });
        try {
            const res = await service.submitSignup("eh-1", ANNA, SIGN, { now: NOW });
            expect(res.error).toBeUndefined();
            expect(res.signup.character).toBe("Nerathil");
        } finally {
            spy.mockRestore();
            warn.mockRestore();
        }
    });
});
