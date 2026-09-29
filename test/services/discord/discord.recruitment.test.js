// The recruitment message's apply button carries the game version of its
// applications (#553): "apply:<versionId>", the bare "apply" of a message from
// before still counts, and a scan reads the version off the button.
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");

const BOT = "bot-1";
const msg = (customId, over = {}) => ({
    author: { id: BOT },
    content: "Wir suchen!",
    embeds: [],
    components: [{ components: [{ customId, label: "Bewerben" }] }],
    ...over,
});

beforeEach(() => discord.setClient({ user: { id: BOT } }));
afterAll(() => discord.setClient(null));

describe("services/discord/discord recruitment messages (#553)", () => {
    it("knows the bot's apply button with and without a version", () => {
        expect(discord.isRecruitmentMessage(msg("apply"))).toBe(true);
        expect(discord.isRecruitmentMessage(msg("apply:classic"))).toBe(true);
        expect(discord.isRecruitmentMessage(msg("apply-class"))).toBe(false);
        expect(discord.isRecruitmentMessage(msg("apply:classic", { author: { id: "someone" } }))).toBe(false);
    });

    it("reads the version off the button, TBC for the bare one", () => {
        expect(discord.extractTemplate(msg("apply:classic"))).toEqual({ content: "Wir suchen!", title: "", body: "", buttonLabel: "Bewerben", versionId: "classic" });
        expect(discord.extractTemplate(msg("apply")).versionId).toBe("tbc");
        expect(discord.extractTemplate(msg("other")).versionId).toBe("");
    });

    it("posts the button with the template's version, the bare one without", async () => {
        const channel = dc.makeChannel({ id: "c1" });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        await discord.postRecruitment("c1", { content: "Hi", buttonLabel: "Los", versionId: "classic" });
        await discord.postRecruitment("c1", { content: "Hi", buttonLabel: "Los" });
        const ids = channel.send.mock.calls.map((c) => c[0].components[0].components[0].data.custom_id);
        expect(ids).toEqual(["apply:classic", "apply"]);
    });
});
