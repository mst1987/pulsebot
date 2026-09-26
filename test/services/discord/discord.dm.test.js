// discord.sendDirectMessage / embed: the DM path the recommendations use.
jest.mock("../../../src/config/variables.js", () => ({ embedAccentColor: 0x8a7cff }));

const discord = require("../../../src/services/discord/discord.js");

function clientWith(user) {
    return { users: { fetch: jest.fn(async (id) => (typeof user === "function" ? user(id) : user)) } };
}

afterEach(() => discord.setClient(null));

describe("services/discord/discord — sendDirectMessage", () => {
    it("throws without a client", async () => {
        await expect(discord.sendDirectMessage("u1", { content: "x" })).rejects.toThrow("Bot nicht verbunden.");
    });

    it("fetches the user and sends the payload, returning the message id", async () => {
        const send = jest.fn(async () => ({ id: "m1" }));
        const client = clientWith({ send });
        discord.setClient(client);
        const res = await discord.sendDirectMessage(42, { content: "hi", embeds: [] });
        expect(client.users.fetch).toHaveBeenCalledWith("42");
        expect(send).toHaveBeenCalledWith({ content: "hi", embeds: [] });
        expect(res).toEqual({ ok: true, messageId: "m1" });
    });

    it("reports a closed DM or an unknown user instead of throwing", async () => {
        discord.setClient(clientWith({ send: async () => { throw new Error("Cannot send messages to this user"); } }));
        expect(await discord.sendDirectMessage("u1", {})).toEqual({ ok: false, error: "Cannot send messages to this user" });
        discord.setClient(clientWith(() => { throw new Error("Unknown User"); }));
        expect(await discord.sendDirectMessage("u2", {})).toEqual({ ok: false, error: "Unknown User" });
        discord.setClient(clientWith(null));
        expect(await discord.sendDirectMessage("u3", {})).toEqual({ ok: false, error: "Nutzer nicht gefunden." });
    });
});

describe("services/discord/discord — embed", () => {
    it("builds an embed in the bot's colour", () => {
        const e = discord.embed().setTitle("T");
        expect(e.data.color).toBe(0x8a7cff);
        expect(e.data.title).toBe("T");
    });
});
