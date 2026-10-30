// "Fehlende pingen" refuses a raid of a hidden game version (#743).
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 0) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => ({ listMembersWithRoles: jest.fn(), listHumanMembers: jest.fn(), postMissingPing: jest.fn() }));
jest.mock("../../../src/stores/roster/rosterStore", () => ({ rosterForCategory: jest.fn(() => null) }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { findMissingRaiders } = require("../../../src/services/events/missingPing");

const future = Math.floor(Date.now() / 1000) + 3600;
const raid = (versionId) => ({ id: "eh-1", title: "Kara", versionId, startTime: future, signUps: [{ userId: "1", status: "signed" }] });

beforeEach(() => {
    jest.clearAllMocks();
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "A" }, { id: "2", displayName: "B" }], error: null });
});

describe("findMissingRaiders and game versions", () => {
    it("works for any version while none is hidden", async () => {
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["500000"] } });
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [raid("forever")] }], error: null });
        expect((await findMissingRaiders({ guildId: "g", eventId: "eh-1" })).missing).toHaveLength(1);
    });

    it("refuses a raid of a hidden version", async () => {
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["500000"] }, hideOtherVersions: true, mainVersion: "tbc" });
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [raid("forever")] }], error: null });
        const r = await findMissingRaiders({ guildId: "g", eventId: "eh-1" });
        expect(r.error.code).toBe("version_hidden");
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
    });
});
