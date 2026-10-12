// "Raid anlegen" on the Orga-Zentrale (services/events/orgaHubBot.js and the thin
// commands/event/orgaHubButton.js): the create flow with the category chosen, for
// the orga of that category only.
const mockStepMessage = jest.fn(async (guildId, state) => ({ state, payload: { embeds: [{ title: "Neues Event" }], components: [] } }));
jest.mock("../../../src/services/events/eventDraft", () => ({
    guildFor: (i) => (i.guildId === "g1" ? { guildId: "g1" } : { error: "Events legst du auf dem Event-Server an." }),
    initialState: (guildId, categoryId) => ({ cat: categoryId }),
    stepMessage: (...args) => mockStepMessage(...args),
    clearNamePattern: jest.fn(),
}));
jest.mock("../../../src/services/discord/userAccess", () => ({ resolveAccess: jest.fn() }));
jest.mock("../../../src/services/roster/categoryRoster", () => ({ currentRoster: jest.fn((cat) => (cat === "cat1" ? { id: "r1", guildId: "g1", managers: { userIds: ["mgr"], roleIds: [] } } : null)) }));

const { MessageFlags } = require("discord.js");
const { resolveAccess } = require("../../../src/services/discord/userAccess");
const bot = require("../../../src/services/events/orgaHubBot");
const button = require("../../../src/commands/event/orgaHubButton");
const { cardText } = require("../../helpers/cardText");

const interaction = (customId, userId = "u1", guildId = "g1") => ({
    customId, guildId, user: { id: userId },
    reply: jest.fn(async () => {}),
    deferReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
});

beforeEach(() => {
    jest.clearAllMocks();
    resolveAccess.mockResolvedValue({ isAdmin: false, access: {} });
});

describe("services/events/orgaHubBot", () => {
    it("reads the customId", () => {
        expect(bot.parseCustomId("orga:new:cat1")).toEqual({ action: "new", categoryId: "cat1" });
        expect(bot.parseCustomId(undefined)).toEqual({ action: "", categoryId: "" });
    });

    it("lets the global orga and the roster's managers in, nobody else", async () => {
        resolveAccess.mockResolvedValueOnce({ isAdmin: false, isOrga: true, access: {} });
        expect(await bot.isCategoryOrga("u1", "cat2")).toBe(true);
        expect(await bot.isCategoryOrga("mgr", "cat1")).toBe(true);
        expect(await bot.isCategoryOrga("u1", "cat1")).toBe(false);
        expect(await bot.isCategoryOrga("mgr", "cat2")).toBe(false);
    });

    it("opens the create flow with the hub's category chosen", async () => {
        resolveAccess.mockResolvedValue({ isAdmin: true, access: {} });
        const i = interaction("orga:new:cat1");
        await button.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(mockStepMessage).toHaveBeenCalledWith("g1", { cat: "cat1" }, { userId: "u1" });
        expect(i.editReply).toHaveBeenCalledWith({ embeds: [{ title: "Neues Event" }], components: [] });
    });

    it("refuses who is not the orga of the category", async () => {
        const i = interaction("orga:new:cat1", "u1");
        await button.execute(i);
        expect(mockStepMessage).not.toHaveBeenCalled();
        expect(cardText(i.editReply.mock.calls[0][0])).toContain(bot.DENIED);
    });

    it("answers an unknown action and another server ephemerally", async () => {
        const unknown = interaction("orga:x:cat1");
        await button.execute(unknown);
        expect(unknown.reply.mock.calls[0][0].flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(unknown.deferReply).not.toHaveBeenCalled();

        const elsewhere = interaction("orga:new:cat1", "u1", "g2");
        await button.execute(elsewhere);
        expect(cardText(elsewhere.reply.mock.calls[0][0])).toContain("Event-Server");
    });

    it("is the component `orga` with the access of /event", () => {
        expect(button).toMatchObject({ name: "orga", accessOf: "event" });
        expect(button.data).toBeUndefined();
    });
});
