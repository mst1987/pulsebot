// Reminders skip the raids of a hidden game version (#743).
const { tempStoreFile } = require("../../helpers/tempStore");

jest.mock("../../../src/services/discord/discord", () => ({ listMembersWithRoles: jest.fn(), listHumanMembers: jest.fn() }));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
jest.mock("../../../src/services/discord/pingDelivery", () => ({ deliverUserPing: jest.fn() }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["100000"]) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []), saveSetupDraft: jest.fn() }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { deliverUserPing } = require("../../../src/services/discord/pingDelivery");
const reminderStore = require("../../../src/stores/reminderStore");
const reminders = require("../../../src/web/events/reminders");

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const sec = (ms) => Math.floor(ms / 1000);

beforeEach(() => {
    jest.resetAllMocks();
    reminderStore.useFile(tempStoreFile("reminders-versions.json"));
    reminders._resetForTests();
    require("../../../src/services/discord/guildRoles").eventGuildIds.mockReturnValue(["100000"]);
    deliverUserPing.mockResolvedValue({});
});

describe("runReminders and game versions (#743)", () => {
    const base = { categoryRoles: { 900000: ["500000"] }, categoryReminders: { 900000: { missingHours: 0, signedHours: 2, target: "talk" } } };
    const raid = (id, versionId) => ({ id, title: id, versionId, startTime: sec(NOW + HOUR), signUps: [{ userId: "1", status: "signed" }] });
    const groups = (events) => ({ groups: [{ categoryId: "900000", events }], error: null });

    it("reminds the raids of every version while none is hidden", async () => {
        loadEventGroups.mockResolvedValue(groups([raid("tbc-raid", "tbc"), raid("forever-raid", "forever")]));
        const r = await reminders.runReminders({ now: NOW, config: base });
        expect(r.sent).toBe(2);
    });

    it("leaves out the raids of a hidden version", async () => {
        loadEventGroups.mockResolvedValue(groups([raid("tbc-raid", "tbc"), raid("forever-raid", "forever")]));
        const r = await reminders.runReminders({ now: NOW, config: { ...base, hideOtherVersions: true, mainVersion: "tbc" } });
        expect(r.sent).toBe(1);
        expect(deliverUserPing.mock.calls[0][0].event.id).toBe("tbc-raid");
        expect(reminderStore.getSent("forever-raid")).toEqual({});
    });
});
