// A whole message with buttons that pings nobody (the panel of absences and
// attendances), posted and edited in place.
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");

const BOT = "bot-1";

afterAll(() => discord.setClient(null));

describe("services/discord/discord postPayload / editPayload", () => {
    it("posts the payload without pings and answers where it landed", async () => {
        const channel = dc.makeChannel({ id: "c1", guildId: "g1" });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        const res = await discord.postPayload("c1", { embeds: [{ title: "Panel" }], components: [] });
        expect(channel.send).toHaveBeenCalledWith({ embeds: [{ title: "Panel" }], components: [], allowedMentions: { parse: [] } });
        expect(res).toMatchObject({ guildId: "g1", channelId: "c1", messageId: "m-new" });
    });

    it("edits only the bot's own message", async () => {
        const own = { id: "m1", author: { id: BOT }, url: "u1", edit: jest.fn(async () => {}) };
        const foreign = { id: "m2", author: { id: "someone" }, edit: jest.fn() };
        const channel = dc.makeChannel({ id: "c1", messages: [own, foreign] });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        const res = await discord.editPayload("c1", "m1", { content: "neu" });
        expect(own.edit).toHaveBeenCalledWith({ content: "neu", allowedMentions: { parse: [] } });
        expect(res).toMatchObject({ channelId: "c1", messageId: "m1", url: "u1" });
        await expect(discord.editPayload("c1", "m2", { content: "x" })).rejects.toThrow("Diese Nachricht stammt nicht vom Bot.");
        expect(foreign.edit).not.toHaveBeenCalled();
    });

    it("refuses to edit without a connected bot", async () => {
        discord.setClient(null);
        await expect(discord.editPayload("c1", "m1", {})).rejects.toThrow("Bot nicht verbunden.");
    });
});

describe("services/discord/discord postRolePing", () => {
    it("posts plain text that pings exactly the given role and shows no link previews", async () => {
        const channel = dc.makeChannel({ id: "c1", guildId: "g1" });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        const res = await discord.postRolePing("c1", "123456789012345678", "<@&123456789012345678> **X 1.0** ist da.");
        const sent = channel.send.mock.calls[0][0];
        expect(sent.content).toBe("<@&123456789012345678> **X 1.0** ist da.");
        expect(sent.allowedMentions).toEqual({ parse: [], roles: ["123456789012345678"] });
        expect(sent.flags).toBeTruthy();
        expect(res).toMatchObject({ guildId: "g1", channelId: "c1", messageId: "m-new" });
    });
});
