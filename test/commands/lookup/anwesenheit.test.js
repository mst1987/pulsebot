jest.mock("../../../src/web/userCharacters", () => ({ myCharacters: jest.fn() }));
jest.mock("../../../src/web/attendanceLookup", () => {
    const actual = jest.requireActual("../../../src/web/attendanceLookup");
    return { ...actual, characterAttendance: jest.fn(), knownCharacterNames: jest.fn() };
});
jest.mock("../../../src/web/rosterAttendance", () => ({ buildAttendanceContext: jest.fn(() => ({ ctx: 1 })) }));
jest.mock("../../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));

const { MessageFlags } = require("discord.js");
const own = require("../../../src/commands/lookup/anwesenheit");
const other = require("../../../src/commands/lookup/anwesenheitRaider");
const { myCharacters: charactersForUser } = require("../../../src/web/userCharacters");
const { characterAttendance, knownCharacterNames } = require("../../../src/web/attendanceLookup");
const { EMBED_LIMITS, embedSize } = require("../../../src/utils/discord/botLookup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const category = (over = {}) => ({ id: "mon", name: "Montag", attended: 8, total: 10, pct: 80, missed: [], ...over });
const embed = (i) => i.reply.mock.calls[0][0].embeds[0];
const buttons = (i) => i.reply.mock.calls[0][0].components[0].components;

beforeEach(() => {
    jest.clearAllMocks();
    charactersForUser.mockReturnValue([]);
    knownCharacterNames.mockReturnValue([]);
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
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "Elesham", { ctx: { ctx: 1 } });
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
        expect(characterAttendance).toHaveBeenCalledWith("event-guild", "dorn");
        expect(embed(i).title).toBe("Anwesenheit Dorn");
        expect(embed(i).description).toBe("**80 %** · 8 von 10 Raids");
        expect(buttons(i)[0].url).toMatch(/name=Dorn$/);
    });

    it("suggests known characters, capped at 25", async () => {
        knownCharacterNames.mockReturnValue(Array.from({ length: 30 }, (_, n) => `Char${n}`));
        const i = mockInteraction({ focused: { name: "raider", value: "char" } });
        await other.autocomplete(i);
        expect(i.respond.mock.calls[0][0]).toHaveLength(25);
    });
});
