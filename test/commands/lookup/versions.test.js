// The lookup commands answer for one game version (#743): the option, else the channel's category, else the main version.
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 0) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ serverIds: jest.fn(() => ["event-guild"]) }));
jest.mock("../../../src/stores/lootStore", () => ({ listByCharacter: jest.fn(() => []), listAll: jest.fn(() => []) }));
jest.mock("../../../src/services/loot/lootServer", () => ({
    serverContext: () => ({}),
    lootOfGuild: jest.fn((rows, guildId) => (rows || []).filter((r) => !r.guildId || r.guildId === guildId)),
    serverOfInteraction: jest.fn((i) => i.guildId || (i.guild && i.guild.id) || "first"),
}));
jest.mock("../../../src/services/loot/lootStats", () => ({ itemCatalog: jest.fn(() => []) }));
jest.mock("../../../src/services/characters/userCharacters", () => ({ myCharacters: jest.fn(() => []) }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: jest.fn(() => []) }));
jest.mock("../../../src/services/events/storedVersion", () => ({ storedVersionOf: (id) => (String(id).startsWith("f") ? "forever" : "tbc") }));
jest.mock("../../../src/stores/configStore", () => ({ getConfig: jest.fn(() => ({ categoryVersion: { catF: "forever" } })) }));

const raids = require("../../../src/commands/lookup/raids");
const raid = require("../../../src/commands/lookup/raid");
const loot = require("../../../src/commands/lookup/loot");
const report = require("../../../src/commands/lookup/report");
const council = require("../../../src/commands/lookup/council");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { listByCharacter } = require("../../../src/stores/lootStore");
const { itemCatalog } = require("../../../src/services/loot/lootStats");
const { myCharacters } = require("../../../src/services/characters/userCharacters");
const { listReports } = require("../../../src/stores/reportStore");
const { mockInteraction } = require("../../helpers/mockInteraction");

const now = Math.floor(Date.now() / 1000);
const ev = (id, title, versionId) => ({ id, title, versionId, startTime: now + 86400, signUps: [] });
const inForever = { id: "c1", parentId: "catF" };
const inTbc = { id: "c2", parentId: "catT" };
const sent = (i) => (i.editReply.mock.calls[0] || i.reply.mock.calls[0])[0].embeds[0];
const footer = (i) => sent(i).footer.text;

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue({ groups: [{ categoryName: "Raids", events: [ev("t1", "SSC", "tbc"), ev("f1", "Barrow", "forever")] }], error: null });
});

describe("the version option of every lookup command", () => {
    it.each([[raids], [raid], [report], [council], [loot]])("%# has an optional version choice", (command) => {
        const json = command.data.toJSON();
        const holders = json.options.some((o) => o.type === 1) ? json.options.filter((o) => o.type === 1) : [json];
        for (const holder of holders) {
            const opt = holder.options.find((o) => o.name === "version");
            expect(opt && opt.choices.map((c) => c.value)).toEqual(expect.arrayContaining(["tbc", "forever"]));
            expect(opt.required).toBeFalsy();
        }
    });
});

describe("/raids", () => {
    it("lists the version of the channel's category and names it", async () => {
        const i = mockInteraction({ channel: inForever });
        await raids.execute(i);
        expect(sent(i).description).toContain("Barrow");
        expect(sent(i).description).not.toContain("SSC");
        expect(footer(i)).toBe("Version: WoW Forever");
    });

    it("uses the main version outside a raid category", async () => {
        const i = mockInteraction({ channel: inTbc });
        await raids.execute(i);
        expect(sent(i).description).toContain("SSC");
        expect(footer(i)).toContain("TBC");
    });

    it("lets the version option decide", async () => {
        const i = mockInteraction({ channel: inForever, options: { version: "tbc" } });
        await raids.execute(i);
        expect(sent(i).description).toContain("SSC");
        expect(sent(i).description).not.toContain("Barrow");
    });
});

describe("/raid", () => {
    it("finds a raid of the channel's version only", async () => {
        const i = mockInteraction({ channel: inForever, options: { event: "SSC" } });
        await raid.execute(i);
        expect(sent(i).title).toBe("Raid nicht gefunden");
        const j = mockInteraction({ channel: inForever, options: { event: "Barrow" } });
        await raid.execute(j);
        expect(sent(j).title).toBe("Barrow");
        expect(footer(j)).toBe("Version: WoW Forever");
    });

    it("offers only raids of the version in the autocomplete", async () => {
        const i = mockInteraction({ channel: inForever, options: {} });
        i.options.getFocused = jest.fn(() => "");
        await raid.autocomplete(i);
        expect(i.respond.mock.calls[0][0].map((c) => c.value)).toEqual(["f1"]);
    });
});

describe("/loot", () => {
    const award = (character, eventId) => ({ itemId: 1, itemName: "Item", character, eventId, reasonLabel: "BiS", awardedAt: 1726000000000 });

    it("counts the awards of the raids of one version", async () => {
        myCharacters.mockReturnValue([{ character: "Elesham" }]);
        listByCharacter.mockReturnValue([award("Elesham", "t1"), award("Elesham", "f1"), award("Elesham", "f2")]);
        const i = mockInteraction({ channel: inForever, options: { __sub: "ich" } });
        i.options.getSubcommand = () => "ich";
        await loot.execute(i);
        expect(sent(i).description).toContain("2 Items");
        expect(footer(i)).toBe("Version: WoW Forever");
        const j = mockInteraction({ channel: inForever, options: { version: "tbc" } });
        j.options.getSubcommand = () => "ich";
        await loot.execute(j);
        expect(sent(j).description).toContain("1 Item");
    });

    it("looks an item up among the awards of one version", async () => {
        itemCatalog.mockReturnValue([{ itemId: 7, itemName: "Blade", count: 2, awards: [
            { character: "A", versionId: "tbc", awardedAt: 1 }, { character: "B", versionId: "forever", awardedAt: 2 },
        ] }]);
        const i = mockInteraction({ channel: inForever, options: { item: "7" } });
        i.options.getSubcommand = () => "item";
        await loot.execute(i);
        expect(sent(i).description).toContain("1× vergeben");
        expect(sent(i).fields[0].value).toContain("B");
        expect(sent(i).fields[0].value).not.toContain("**A**");
    });
});

describe("/report", () => {
    it("lists the reports of the version only", async () => {
        listReports.mockReturnValue([
            { id: "r1", title: "TBC Log", generatedAt: 5, versionId: "tbc" },
            { id: "r2", title: "Forever Log", generatedAt: 6, versionId: "forever" },
            { id: "r3", title: "Old Log", generatedAt: 4 },
        ]);
        const i = mockInteraction({ channel: inForever });
        await report.execute(i);
        expect(sent(i).description).toContain("Forever Log");
        expect(sent(i).description).not.toContain("TBC Log");
        expect(footer(i)).toBe("Version: WoW Forever");
        const j = mockInteraction({ channel: inTbc });
        await report.execute(j);
        expect(sent(j).description).toContain("TBC Log");
        expect(sent(j).description).toContain("Old Log");
    });
});

describe("/council", () => {
    it("links the Wowhead section of the version and names it", async () => {
        const i = mockInteraction({ channel: inTbc, options: { item: "32837", version: "forever" } });
        await council.execute(i);
        expect(sent(i).url).toBe("https://www.wowhead.com/forever/item=32837");
        expect(footer(i)).toBe("Version: WoW Forever");
    });

    // #919: how often an item went out - and the suggestions - from this server's loot only.
    it("counts and suggests from the loot of the server it was used on", async () => {
        const { listAll } = require("../../../src/stores/lootStore");
        listAll.mockReturnValue([{ itemId: 7, guildId: "guild-1" }, { itemId: 8, guildId: "guild-2" }]);
        await council.execute(mockInteraction({ channel: inTbc, options: { item: "7", version: "tbc" } }));
        expect(itemCatalog).toHaveBeenLastCalledWith([{ itemId: 7, guildId: "guild-1" }]);
        itemCatalog.mockClear();
        await council.autocomplete(mockInteraction({ channel: inTbc, focused: { name: "item", value: "" }, options: { version: "tbc" } }));
        expect(itemCatalog).toHaveBeenCalledWith([{ itemId: 7, guildId: "guild-1" }]);
        listAll.mockReturnValue([]);
    });
});
