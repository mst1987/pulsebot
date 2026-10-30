jest.mock("../../../src/services/characters/userCharacters", () => ({ myCharacters: jest.fn() }));
jest.mock("../../../src/services/characters/attendanceLookup", () => {
    const actual = jest.requireActual("../../../src/services/characters/attendanceLookup");
    return { ...actual, characterAttendance: jest.fn(), knownCharacterNames: jest.fn() };
});
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: jest.fn(() => ({ ctx: 1 })) }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ serverIds: jest.fn(() => ["event-guild"]) }));

const { MessageFlags } = require("discord.js");
const own = require("../../../src/commands/lookup/anwesenheit");
const other = require("../../../src/commands/lookup/anwesenheitRaider");
const { myCharacters: charactersForUser } = require("../../../src/services/characters/userCharacters");
const { characterAttendance, knownCharacterNames } = require("../../../src/services/characters/attendanceLookup");
const { buildAttendanceContext } = require("../../../src/services/characters/rosterAttendance");
const configStore = require("../../../src/stores/settings/configStore");
const { versionNote } = require("../../../src/services/versions/commandVersion");
const { EMBED_LIMITS } = require("../../../src/utils/discord/botLookup");
const { embedSize } = require("../../helpers/embed");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const category = (over = {}) => ({ id: "mon", name: "Montag", attended: 8, total: 10, pct: 80, missed: [], ...over });
const embed = (i) => i.reply.mock.calls[0][0].embeds[0];
const buttons = (i) => i.reply.mock.calls[0][0].components[0].components;

let configSpy;
beforeEach(() => {
    jest.clearAllMocks();
    charactersForUser.mockReturnValue([]);
    knownCharacterNames.mockReturnValue([]);
    configSpy = jest.spyOn(configStore, "getConfig").mockReturnValue({});
});
afterEach(() => configSpy.mockRestore());

describe("/anwesenheit and /anwesenheit-raider count within one game version (#740)", () => {
    const forever = { parentId: "fcat", messages: { fetch: jest.fn() } };

    it("take the version of the channel's category, a thread its channel's", async () => {
        configSpy.mockReturnValue({ categoryVersion: { fcat: "forever" } });
        charactersForUser.mockReturnValue([{ character: "Elesham", categoryIds: ["fcat"] }]);
        characterAttendance.mockReturnValue({ character: "Elesham", categories: [category()] });
        const i = mockInteraction({ channel: forever });
        await own.execute(i);
        expect(buildAttendanceContext).toHaveBeenCalledWith("event-guild", { versionId: "forever" });
        expect(embed(i).title).toBe("Deine Anwesenheit");
        expect(embed(i).footer.text).toBe(versionNote("forever"));

        const thread = { isThread: () => true, parent: forever, parentId: "text-channel" };
        expect(own.versionOfInteraction(mockInteraction({ channel: thread }))).toBe("forever");
        // no category: the main version
        expect(own.versionOfInteraction(mockInteraction({ channel: { id: "x" } }))).toBe("tbc");
    });

    it("count, name and link only the characters that play the version (#741)", async () => {
        configSpy.mockReturnValue({ categoryVersion: { fcat: "forever" } });
        charactersForUser.mockReturnValue([{ character: "Anna", categoryIds: ["tcat"] }, { character: "Elesham", categoryIds: ["fcat"] }]);
        characterAttendance.mockReturnValue({ character: "Elesham", categories: [category()] });
        const i = mockInteraction({ channel: forever });
        await own.execute(i);
        expect(characterAttendance).toHaveBeenCalledTimes(1);
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "Elesham", expect.anything());
        expect(buttons(i)).toHaveLength(1);

        const none = mockInteraction({ options: { version: "forever" }, channel: { id: "x" } });
        charactersForUser.mockReturnValue([{ character: "Anna", categoryIds: ["tcat"] }]);
        await own.execute(none);
        expect(embed(none).description).toContain("kein Charakter zugeordnet");
        expect(embed(none).footer.text).toBe(versionNote("forever"));
    });

    it("let the `version` option pick another version", async () => {
        configSpy.mockReturnValue({ categoryVersion: { fcat: "forever" } });
        characterAttendance.mockReturnValue({ character: "Dorn", categories: [category()] });
        const i = mockInteraction({ channel: forever, options: { raider: "dorn", version: "tbc" } });
        await other.execute(i);
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "dorn", { versionId: "tbc" });
        // an unknown value falls back to the channel's
        expect(own.versionOfInteraction(mockInteraction({ channel: forever, options: { version: "nope" } }))).toBe("forever");
    });

    it("offer the version as an optional choice after the required options", () => {
        for (const cmd of [own, other]) {
            const json = cmd.data.toJSON();
            const version = json.options.find((o) => o.name === "version");
            expect(version).toMatchObject({ required: false });
            expect(version.choices.map((c) => c.value)).toEqual(expect.arrayContaining(["tbc", "forever"]));
            expect(json.options[json.options.length - 1].name).toBe("version");
        }
    });
});

describe("/anwesenheit", () => {
    it("is open to every member — it only ever shows the user's own characters", () => {
        expect(own.group).toBe("raids");
        expect(memberMayRun(own)).toBe(true);
        expect(own.options).toBeUndefined();
    });

    it("leads with the overall share and lists the categories", async () => {
        charactersForUser.mockReturnValue([{ character: "Elesham", categoryIds: ["mon"] }]);
        characterAttendance.mockReturnValue({ character: "Elesham", categories: [category(), category({ id: "thu", name: "Donnerstag", attended: 1, total: 2, pct: 50 })] });
        const i = mockInteraction({ userId: "u1" });
        await own.execute(i);
        expect(buildAttendanceContext).toHaveBeenCalledWith("event-guild", { versionId: "tbc" });
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "Elesham", { ctx: { ctx: 1 }, versionId: "tbc" });
        expect(embed(i).title).toBe("Deine Anwesenheit");
        expect(embed(i).footer.text).toBe(versionNote("tbc"));
        expect(i.reply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
        expect(embed(i).description).toBe("**75 %** · 9 von 12 Raids");
        expect(embed(i).fields.map((f) => f.name)).toEqual(["Montag", "Donnerstag"]);
        expect(buttons(i)[0].url).toMatch(/\/roster\/char\?name=Elesham$/);
    });

    it("names the character per category when the user plays several", async () => {
        charactersForUser.mockReturnValue([{ character: "Elesham" }, { character: "Dorn" }]);
        characterAttendance.mockImplementation((g, name) => ({ character: name, categories: [category()] }));
        const i = mockInteraction();
        await own.execute(i);
        expect(embed(i).fields.map((f) => f.name)).toEqual(["Elesham · Montag", "Dorn · Montag"]);
        expect(buttons(i).map((b) => b.label)).toEqual(["Elesham", "Dorn"]);
    });

    it("explains a missing assignment and an empty history", async () => {
        const i = mockInteraction();
        await own.execute(i);
        expect(embed(i).description).toContain("kein Charakter zugeordnet");

        charactersForUser.mockReturnValue([{ character: "Neu" }]);
        characterAttendance.mockReturnValue({ character: "Neu", categories: [] });
        const j = mockInteraction();
        await own.execute(j);
        expect(embed(j).description).toContain("Noch keine Raids gezählt");
    });

    it("stays within the embed limits", async () => {
        charactersForUser.mockReturnValue(Array.from({ length: 10 }, (_, n) => ({ character: `C${n}` })));
        characterAttendance.mockImplementation((g, name) => ({
            character: name,
            categories: Array.from({ length: 10 }, () => category({ name: "N".repeat(400), missed: Array.from({ length: 20 }, () => ({ startTime: 1, reason: "R".repeat(500) })) })),
        }));
        const i = mockInteraction();
        await own.execute(i);
        expect(embedSize(embed(i))).toBeLessThanOrEqual(EMBED_LIMITS.total);
        expect(buttons(i).length).toBeLessThanOrEqual(5);
    });
});

describe("/anwesenheit-raider", () => {
    it("is for admins by default (other raiders' attendance)", () => {
        expect(other.group).toBe("raids");
        expect(memberMayRun(other)).toBe(false);
        expect(memberMayRun(other, { botCommandAccess: { "anwesenheit-raider": { mode: "everyone" } } })).toBe(true);
    });

    it("shows one raider's attendance", async () => {
        characterAttendance.mockReturnValue({ character: "Dorn", categories: [category()] });
        const i = mockInteraction({ options: { raider: "dorn" } });
        await other.execute(i);
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "dorn", { versionId: "tbc" });
        expect(embed(i).title).toBe("Anwesenheit Dorn");
        expect(embed(i).footer.text).toBe(versionNote("tbc"));
        expect(embed(i).description).toBe("**80 %** · 8 von 10 Raids");
        expect(buttons(i)[0].url).toMatch(/name=Dorn$/);
    });

    it("suggests known characters, capped at 25", async () => {
        knownCharacterNames.mockReturnValue(Array.from({ length: 30 }, (_, n) => `Char${n}`));
        const i = mockInteraction({ focused: { name: "raider", value: "char" } });
        await other.autocomplete(i);
        expect(i.respond.mock.calls[0][0]).toHaveLength(25);
        // only those of the command's version (#741)
        expect(knownCharacterNames).toHaveBeenCalledWith({ versionId: "tbc", guildId: "event-guild" });
    });

    // #919: on a Discord server the command answers for that server; in a DM for the first one.
    it("answers for the server the command was used on", async () => {
        characterAttendance.mockReturnValue({ character: "Dorn", categories: [category()] });
        const i = mockInteraction({ options: { raider: "dorn" } });
        i.guildId = "guild-b";
        await other.execute(i);
        expect(characterAttendance).toHaveBeenCalledWith("guild-b", "dorn", { versionId: "tbc" });
        const ac = mockInteraction({ focused: { name: "raider", value: "" } });
        ac.guildId = "guild-b";
        await other.autocomplete(ac);
        expect(knownCharacterNames).toHaveBeenLastCalledWith({ versionId: "tbc", guildId: "guild-b" });
    });
});
