// Signing up for a raid group (#811): the raiders sign up once, at the group's
// first raid — a signup that names a further raid lands there — and the waiting
// list counts the places of every raid of the group.
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    listEvents: (guildId, opts = {}) => [...mockEvents.values()].filter((e) => opts.siblings === true || !(e.raidGroupId && e.raidGroupId !== e.id)),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventState: (id, patch) => ({ ...mockEvents.get(id), ...patch }),
    appendEventLog: jest.fn(),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/events/signupStore", () => {
    const actual = jest.requireActual("../../../src/stores/events/signupStore");
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
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => null), postNotice: jest.fn(async () => ({})) }));

const profiles = require("../../../src/stores/roster/raiderProfileStore");
const service = require("../../../src/services/signups/signupService");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const NOW = 1_900_000_000_000;
const base = { startTime: sec(NOW) + 3 * DAY, signupDeadline: sec(NOW) + 2 * DAY, size: 2 };

beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => profiles.useFile(null));
beforeEach(() => {
    profiles.reset();
    mockEvents.clear();
    mockSignups.clear();
    mockEvents.set("eh-za", ownEvent({ ...base, id: "eh-za", title: "Zul'Aman", raidGroupId: "eh-za", raidGroupIndex: 1, overflow: "refuse" }));
    mockEvents.set("eh-za2", ownEvent({ ...base, id: "eh-za2", title: "Zul'Aman 2", raidGroupId: "eh-za", raidGroupIndex: 2, overflow: "refuse" }));
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Fire"] }, { name: "Anna" });
});

describe("signing up for a raid group", () => {
    it("stores a signup that names the further raid at the group's first raid", async () => {
        const res = await service.submitSignup("eh-za2", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.event.id).toBe("eh-za");
        expect(mockSignups.has(`eh-za/${ANNA}`)).toBe(true);
        expect(mockSignups.has(`eh-za2/${ANNA}`)).toBe(false);
    });

    it("measures the waiting list against every place of the group (2 + 2), not the first raid's 2", async () => {
        mockSignups.set("eh-za/a", { userId: "a", status: "signed" });
        mockSignups.set("eh-za/b", { userId: "b", status: "signed" });
        const res = await service.submitSignup("eh-za", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: NOW });
        expect(res.error).toBeUndefined();
        mockSignups.set("eh-za/c", { userId: "c", status: "signed" });
        profiles.addCharacter("d", { name: "Dora", className: "Mage", specs: ["Mage-Fire"] }, { name: "D" });
        const full = await service.submitSignup("eh-za", "d", { character: "Dora", spec: "Mage-Fire", status: "signed" }, { now: NOW });
        expect(full.code).toBe("full");
    });
});
