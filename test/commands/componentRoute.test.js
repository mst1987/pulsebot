// src/commands/componentRoute.js (#413): the thin component modules are built
// from name, description, accessOf and a handler.
const mockGuildFor = jest.fn();
jest.mock("../../src/web/eventDraft", () => ({ guildFor: (...args) => mockGuildFor(...args) }));

const { componentRoute } = require("../../src/commands/componentRoute");

const interaction = () => ({ reply: jest.fn(async () => "replied"), update: jest.fn(async () => "updated") });

describe("commands/componentRoute", () => {
    beforeEach(() => mockGuildFor.mockReset());

    it("builds a component module that inherits access", () => {
        const route = componentRoute({ name: "x-btn", description: "Knopf", accessOf: "event", handler: jest.fn() });
        expect(route).toMatchObject({ name: "x-btn", description: "Knopf", accessOf: "event" });
        expect(route.data).toBeUndefined();
        expect(route.group).toBeUndefined();
    });

    it("hands the interaction and the event server to the handler", async () => {
        mockGuildFor.mockReturnValue({ guildId: "g1" });
        const handler = jest.fn(async () => "done");
        const i = interaction();
        await expect(componentRoute({ name: "x", accessOf: "event", handler }).execute(i)).resolves.toBe("done");
        expect(handler).toHaveBeenCalledWith(i, "g1");
    });

    it("answers the server error ephemerally and skips the handler", async () => {
        mockGuildFor.mockReturnValue({ error: "Nicht hier." });
        const handler = jest.fn();
        const i = interaction();
        await componentRoute({ name: "x", accessOf: "event", handler }).execute(i);
        expect(handler).not.toHaveBeenCalled();
        expect(i.reply).toHaveBeenCalledWith({ content: "Nicht hier.", flags: expect.any(Number) });
    });

    it("can answer the server error by replacing the message", async () => {
        mockGuildFor.mockReturnValue({ error: "Nicht hier." });
        const i = interaction();
        await componentRoute({ name: "x", accessOf: "event", handler: jest.fn(), onGuildError: "update" }).execute(i);
        expect(i.update).toHaveBeenCalledWith({ content: "Nicht hier.", embeds: [], components: [] });
        expect(i.reply).not.toHaveBeenCalled();
    });

    it("skips the server check with guild: false", async () => {
        const handler = jest.fn(async () => "ok");
        const i = interaction();
        await componentRoute({ name: "x", accessOf: "event-signup", handler, guild: false }).execute(i);
        expect(mockGuildFor).not.toHaveBeenCalled();
        expect(handler).toHaveBeenCalledWith(i);
    });

    it("builds the five event components with it", () => {
        for (const file of ["eventManageForm", "eventManageStep", "setupPingButton", "inviteCallButton", "setupConfirmButton"]) {
            const mod = require(`../../src/commands/event/${file}`);
            expect({ file, execute: typeof mod.execute, accessOf: typeof mod.accessOf }).toEqual({ file, execute: "function", accessOf: "string" });
        }
    });
});
