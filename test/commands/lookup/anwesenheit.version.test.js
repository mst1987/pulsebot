// /anwesenheit end to end through the real attendance rules (#740): in a channel
// of a Forever category only the Forever raids count - the TBC nights the same
// category ran before it was switched stay under TBC. Only the stores are mocked.
const mockListRaidEvents = jest.fn(() => []);
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: (...a) => mockListRaidEvents(...a) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: () => [], getEvent: jest.fn(), isOwnEventId: () => false }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    ...jest.requireActual("../../../src/stores/raiderCharactersStore"),
    listAllAssignments: () => ({ fcat: { u1: "Elesham" } }),
}));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: () => [] }));
jest.mock("../../../src/services/discord/categoryNames", () => ({ listKnownCategories: () => [{ id: "fcat", name: "Donnerstag" }] }));
// loot in a raid nobody stored a version for is TBC: the character raided TBC before the category was switched
jest.mock("../../../src/stores/lootStore", () => ({ listByCharacter: () => [{ eventId: "t1" }], listAll: () => [] }));
jest.mock("../../../src/services/characters/userCharacters", () => ({ myCharacters: () => [{ character: "Elesham", categoryIds: ["fcat"] }] }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ serverIds: () => ["g1"] }));

const configStore = require("../../../src/stores/configStore");
const own = require("../../../src/commands/lookup/anwesenheit");
const { versionNote } = require("../../../src/services/events/commandVersion");
const { mockInteraction } = require("../../helpers/mockInteraction");

const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
const night = (id, daysAgo, versionId, status = "signed") => ({
    id, guildId: "g1", categoryId: "fcat", title: `Raid ${id}`, startTime: nowSec - daysAgo * DAY, versionId,
    signUps: [{ userId: "u1", status }],
});
const embed = (i) => i.reply.mock.calls[0][0].embeds[0];

let configSpy;
beforeEach(() => {
    // three TBC nights, then the category was switched to Forever and ran two Forever nights
    mockListRaidEvents.mockReturnValue([
        night("f1", 7, "forever"), night("f2", 14, "forever", "absence"),
        night("t1", 28, "tbc"), night("t2", 35, "tbc"), night("t3", 42, "tbc"),
    ]);
    configSpy = jest.spyOn(configStore, "getConfig").mockReturnValue({ categoryVersion: { fcat: "forever" } });
});
afterEach(() => configSpy.mockRestore());

describe("/anwesenheit in a channel of a Forever category (#740)", () => {
    it("counts only the Forever raids", async () => {
        const i = mockInteraction({ userId: "u1", channel: { id: "c1", parentId: "fcat" } });
        await own.execute(i);
        expect(embed(i).footer.text).toBe(versionNote("forever"));
        expect(embed(i).description).toBe("**50 %** · 1 von 2 Raids");
    });

    it("counts the TBC nights under TBC (the `version` option)", async () => {
        const i = mockInteraction({ userId: "u1", channel: { id: "c1", parentId: "fcat" }, options: { version: "tbc" } });
        await own.execute(i);
        expect(embed(i).footer.text).toBe(versionNote("tbc"));
        expect(embed(i).description).toBe("**100 %** · 3 von 3 Raids");
    });

    it("says \"keine gezählten Raids\" for a category switched to Forever before its first Forever raid, never 0 %", async () => {
        mockListRaidEvents.mockReturnValue([night("t1", 28, "tbc")]);
        const i = mockInteraction({ userId: "u1", channel: { id: "c1", parentId: "fcat" } });
        await own.execute(i);
        expect(embed(i).description).toBe("Noch keine Raids gezählt.");
        expect(embed(i).fields).toEqual([expect.objectContaining({ name: "Donnerstag", value: "keine gezählten Raids" })]);
    });
});
