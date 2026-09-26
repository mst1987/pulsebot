jest.mock("../../../src/stores/lootStore", () => ({ listByCharacter: jest.fn() }));
jest.mock("../../../src/web/lootStats", () => ({ itemCatalog: jest.fn() }));
jest.mock("../../../src/web/characterInfo", () => ({ annotatedCharacters: jest.fn() }));
jest.mock("../../../src/web/userCharacters", () => ({ myCharacters: jest.fn() }));

const { MessageFlags } = require("discord.js");
const command = require("../../../src/commands/lookup/loot");
const { listByCharacter } = require("../../../src/stores/lootStore");
const { itemCatalog } = require("../../../src/web/lootStats");
const { annotatedCharacters } = require("../../../src/web/characterInfo");
const { myCharacters: charactersForUser } = require("../../../src/web/userCharacters");
const { EMBED_LIMITS, embedSize } = require("../../../src/utils/discord/botLookup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const award = (over = {}) => ({
    itemId: 30000, itemName: "Cowl of the Grand Engineer", character: "Elesham", reasonLabel: "BiS", awardedAt: 1726000000000, ...over,
});

const reply = (i) => i.reply.mock.calls[0][0];
const embed = (i) => reply(i).embeds[0];
const button = (i) => reply(i).components[0].components[0];

beforeEach(() => {
    jest.clearAllMocks();
    listByCharacter.mockReturnValue([]);
    itemCatalog.mockReturnValue([]);
    annotatedCharacters.mockReturnValue([]);
    charactersForUser.mockReturnValue([]);
});

describe("/loot", () => {
    it("is open to every member and belongs to the loot group", () => {
        expect(command.group).toBe("loot");
        expect(memberMayRun(command)).toBe(true);
        expect(memberMayRun(command, { botCommandAccess: { loot: { mode: "admins" } } })).toBe(false);
    });

    describe("ich", () => {
        it("lists the loot of the user's assigned characters with a link to the character page", async () => {
            charactersForUser.mockReturnValue([{ character: "Elesham", categoryIds: ["c1"] }]);
            listByCharacter.mockReturnValue([award(), award({ itemName: "Tier Token", reasonLabel: "Offspec", awardedAt: 1725000000000 })]);
            const i = mockInteraction({ userId: "u1", options: { __subcommand: "ich" } });
            await command.execute(i);
            expect(charactersForUser).toHaveBeenCalledWith("u1");
            expect(reply(i).flags).toBe(MessageFlags.Ephemeral);
            expect(embed(i).description).toContain("**2 Items**");
            expect(embed(i).description).toContain("1× BiS");
            expect(embed(i).fields[0].value).toContain("Cowl of the Grand Engineer");
            expect(button(i).label).toBe("Im Web öffnen");
            expect(button(i).url).toMatch(/\/history\/char\?name=Elesham$/);
        });

        it("explains what is missing when no character is assigned", async () => {
            const i = mockInteraction({ options: { __subcommand: "ich" } });
            await command.execute(i);
            expect(embed(i).description).toContain("kein Charakter zugeordnet");
            expect(listByCharacter).not.toHaveBeenCalled();
        });

        it("says so when the characters got nothing yet", async () => {
            charactersForUser.mockReturnValue([{ character: "Neu", categoryIds: [] }]);
            const i = mockInteraction({ options: { __subcommand: "ich" } });
            await command.execute(i);
            expect(embed(i).description).toContain("**0 Items**");
        });

        it("stays within the embed limits for a very long history", async () => {
            charactersForUser.mockReturnValue([{ character: "A".repeat(90), categoryIds: [] }, { character: "B".repeat(90), categoryIds: [] }]);
            listByCharacter.mockReturnValue(Array.from({ length: 500 }, (_, n) => award({ itemName: "X".repeat(300), reasonLabel: `Grund ${n}` })));
            const i = mockInteraction({ options: { __subcommand: "ich" } });
            await command.execute(i);
            const e = embed(i);
            expect(embedSize(e)).toBeLessThanOrEqual(EMBED_LIMITS.total);
            expect(e.description.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
            expect(e.fields[0].value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
        });
    });

    describe("item", () => {
        const catalogItem = {
            itemId: 30000, itemName: "Cowl of the Grand Engineer", itemLink: "https://www.wowhead.com/tbc/item=30000",
            count: 2, lastAwardedAt: 1726000000000, boss: "Void Reaver",
            awards: [{ character: "Elesham", reasonLabel: "BiS", awardedAt: 1726000000000 }, { character: "Dorn", reasonLabel: "Offspec", awardedAt: 1725000000000 }],
        };

        it("shows who got the item, found by the autocomplete id", async () => {
            itemCatalog.mockReturnValue([catalogItem]);
            const i = mockInteraction({ options: { __subcommand: "item", item: "30000" } });
            await command.execute(i);
            expect(embed(i).title).toBe("Cowl of the Grand Engineer");
            expect(embed(i).description).toContain("**2× vergeben**");
            expect(embed(i).fields[0].value).toContain("**Elesham** · BiS");
            expect(button(i).url).toMatch(/\/history\?tab=items$/);
        });

        it("finds an item by a typed name and reports an unknown one", async () => {
            itemCatalog.mockReturnValue([catalogItem]);
            const i = mockInteraction({ options: { __subcommand: "item", item: "grand engineer" } });
            await command.execute(i);
            expect(embed(i).title).toBe("Cowl of the Grand Engineer");

            const j = mockInteraction({ options: { __subcommand: "item", item: "Ashbringer" } });
            await command.execute(j);
            expect(embed(j).title).toBe("Item nicht gefunden");
        });
    });

    describe("raider", () => {
        it("shows a raider's loot with a link to their page", async () => {
            listByCharacter.mockReturnValue([award({ character: "Dorn" })]);
            const i = mockInteraction({ options: { __subcommand: "raider", name: "dorn" } });
            await command.execute(i);
            expect(listByCharacter).toHaveBeenCalledWith("dorn");
            expect(embed(i).title).toBe("Dorn");
            expect(embed(i).description).toContain("**1 Item**");
            expect(button(i).url).toMatch(/name=Dorn$/);
        });

        it("says when there is no loot", async () => {
            const i = mockInteraction({ options: { __subcommand: "raider", name: "Niemand" } });
            await command.execute(i);
            expect(embed(i).description).toBe("Kein Loot gefunden.");
        });
    });

    describe("autocomplete", () => {
        it("suggests looted items by id, capped at 25", async () => {
            itemCatalog.mockReturnValue(Array.from({ length: 40 }, (_, n) => ({ itemId: n + 1, itemName: `Cowl ${n}` })));
            const i = mockInteraction({ focused: { name: "item", value: "cowl" } });
            await command.autocomplete(i);
            const choices = i.respond.mock.calls[0][0];
            expect(choices).toHaveLength(25);
            expect(choices[0]).toEqual({ name: "Cowl 0", value: "1" });
        });

        it("suggests raiders for the name option", async () => {
            annotatedCharacters.mockReturnValue([{ character: "Dorn" }, { character: "Elesham" }]);
            const i = mockInteraction({ focused: { name: "name", value: "el" } });
            await command.autocomplete(i);
            expect(i.respond).toHaveBeenCalledWith([{ name: "Elesham", value: "Elesham" }]);
        });
    });
});
