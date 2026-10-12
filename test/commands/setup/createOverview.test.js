const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/utils/discord/reply.js");
jest.mock("../../../src/services/events/raidOverview.js");

const reply = require("../../../src/utils/discord/reply.js");
const raidOverview = require("../../../src/services/events/raidOverview.js");
const createOverview = require("../../../src/commands/setup/createOverview.js");

const ADMIN_ID = "233598324022837249";

describe("commands/setup/createOverview", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        raidOverview.postOverview.mockResolvedValue({ overview: {}, edited: false, url: "https://discord.com/channels/g/c/m" });
    });

    it("exports the correct command contract", () => {
        expect(createOverview.name).toBe("createoverview");
        expect(typeof createOverview.description).toBe("string");
        expect(typeof createOverview.execute).toBe("function");
    });

    it("is admin-only unless the Bot-Befehle settings say otherwise", () => {
        // The check itself runs centrally before execute (src/services/discord/botAccess.js).
        expect(createOverview.defaultAccess).toBe("admins");
        expect(typeof createOverview.group).toBe("string");
    });

    it("replies with an error when the channel has no parent category", async () => {
        const interaction = mockInteraction({
            userId: ADMIN_ID,
            channel: { id: "c1", parent: null },
        });

        await createOverview.execute(interaction, {});

        expect(reply.botReply).toHaveBeenCalledTimes(1);
        expect(reply.botReply.mock.calls[0][1]).toBe("Fehler");
        expect(raidOverview.postOverview).not.toHaveBeenCalled();
    });

    it("posts the self-updating overview of the channel's category and tells the admin where", async () => {
        const interaction = mockInteraction({
            userId: ADMIN_ID,
            channel: { id: "c1", parent: { id: "cat-1", name: "GDKP Raids" } },
        });

        await createOverview.execute(interaction, {});

        expect(raidOverview.postOverview).toHaveBeenCalledWith({ guildId: "guild-1", channelId: "c1", categoryId: "cat-1" });
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        const answer = interaction.editReply.mock.calls[0][0].content;
        expect(answer).toContain("gepostet");
        expect(answer).toContain("https://discord.com/channels/g/c/m");
    });

    it("says when it redrew the overview that was already there", async () => {
        raidOverview.postOverview.mockResolvedValue({ edited: true });
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1" } } });
        await createOverview.execute(interaction, {});
        expect(interaction.editReply.mock.calls[0][0].content).toContain("neu gezeichnet");
    });

    it("reports a failure instead of staying silent", async () => {
        raidOverview.postOverview.mockResolvedValue({ error: "Missing Access" });
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1" } } });
        await createOverview.execute(interaction, {});
        expect(interaction.editReply.mock.calls[0][0].content).toContain("Missing Access");
    });
});
