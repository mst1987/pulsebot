// /bestzeiten [dungeon]: the card for one dungeon or the overall ranking, and
// the autocomplete of the stored dungeon names — per game version.
jest.mock("../../../src/services/discord/botLanguage", () => ({ langOfInteraction: jest.fn(() => "de") }));
jest.mock("../../../src/stores/configStore", () => ({
    ...jest.requireActual("../../../src/stores/configStore"),
    getConfig: jest.fn(() => ({ mainVersion: "forever" })),
}));

const { MessageFlags } = require("discord.js");
const command = require("../../../src/commands/lookup/bestzeiten");
const { langOfInteraction } = require("../../../src/services/discord/botLanguage");
const store = require("../../../src/stores/dungeonRunStore");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");
const { cardText } = require("../../helpers/cardText");
const { tempStoreFile } = require("../../helpers/tempStore");

const run = (over) => ({
    id: "dr_1", versionId: "forever", dungeon: "The Deadmines", seconds: 1902, start: 1791700000, at: 1791702000, medal: "gold",
    members: [{ guid: "1", name: "Devira", class: "PALADIN" }, { guid: "2", name: "Thalor", class: "WARRIOR" }], addonIds: ["a"], ...over,
});
const reply = (i) => i.reply.mock.calls[0][0];

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    langOfInteraction.mockReturnValue("de");
    store.update(() => ({
        runs: [
            run(),
            run({ id: "dr_2", seconds: 2100, medal: "silver" }),
            run({ id: "dr_3", dungeon: "Wailing Caverns", seconds: 2500 }),
            run({ id: "dr_4", versionId: "tbc", dungeon: "Shadow Labyrinth" }),
        ],
        characters: [],
    }));
});

describe("/bestzeiten", () => {
    it("is open to every member and carries the dungeon option with autocomplete, then the version choice", () => {
        expect(memberMayRun(command)).toBe(true);
        const json = command.data.toJSON();
        expect(json.name).toBe("bestzeiten");
        expect(json.options.map((o) => o.name)).toEqual(["dungeon", "version"]);
        expect(json.options[0]).toMatchObject({ autocomplete: true, required: false });
    });

    it("answers the dungeon's fastest runs as an ephemeral card", async () => {
        const i = mockInteraction({ options: { dungeon: "the deadmines" } });
        await command.execute(i);
        const text = cardText(reply(i));
        expect(reply(i).flags & MessageFlags.Ephemeral).toBeTruthy();
        expect(text).toContain("## The Deadmines");
        expect(text).toContain("**1.** `31:42` · 🟨 Gold · Devira, Thalor");
        expect(text).toContain("**2.** `35:00` · ⬜ Silber");
    });

    it("finds a dungeon by part of its name and says when there is none", async () => {
        let i = mockInteraction({ options: { dungeon: "wailing" } });
        await command.execute(i);
        expect(cardText(reply(i))).toContain("## Wailing Caverns");
        i = mockInteraction({ options: { dungeon: "Shadow Labyrinth" } });
        await command.execute(i);
        // a TBC dungeon is not in the Forever answer
        expect(cardText(reply(i))).toContain("noch kein Gruppenlauf gespeichert");
    });

    it("answers the overall ranking without a dungeon, in the reader's language", async () => {
        langOfInteraction.mockReturnValue("en");
        const i = mockInteraction({ options: {} });
        await command.execute(i);
        const text = cardText(reply(i));
        expect(text).toContain("## Overall ranking");
        expect(text).toMatch(/\*\*1\.\*\* \*\*(Devira|Thalor)\*\* · 🟨 2 gold · ⬜ 1 silver · gold in 2 dungeons/);
        expect(text).toContain("**Dungeons** 2");
    });

    it("answers for the version picked in the command", async () => {
        const i = mockInteraction({ options: { version: "tbc" } });
        await command.execute(i);
        expect(cardText(reply(i))).toContain("TBC");
        expect(cardText(reply(i))).toContain("**Dungeons** 1");
    });

    it("completes the stored dungeon names of the version", async () => {
        let i = mockInteraction({ focused: { name: "dungeon", value: "" } });
        await command.autocomplete(i);
        expect(i.respond).toHaveBeenCalledWith([
            { name: "The Deadmines", value: "The Deadmines" },
            { name: "Wailing Caverns", value: "Wailing Caverns" },
        ]);
        i = mockInteraction({ focused: { name: "dungeon", value: "wail" } });
        await command.autocomplete(i);
        expect(i.respond).toHaveBeenCalledWith([{ name: "Wailing Caverns", value: "Wailing Caverns" }]);
    });

    it("finds a table by its exact name first", () => {
        const tables = [{ dungeon: "Scarlet Monastery Armory" }, { dungeon: "Scarlet Monastery" }];
        expect(command.findDungeon(tables, "scarlet monastery")).toBe(tables[1]);
        expect(command.findDungeon(tables, "")).toBeNull();
    });
});
