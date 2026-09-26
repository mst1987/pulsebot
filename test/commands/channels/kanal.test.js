jest.mock("../../../src/services/discord/discord", () => ({ listAllChannels: jest.fn() }));
jest.mock("../../../src/services/discord/discordChannels", () => {
    const actual = jest.requireActual("../../../src/services/discord/discordChannels");
    return {
        discordErrorText: actual.discordErrorText,
        editChannel: jest.fn(), archiveChannel: jest.fn(), createFromTemplate: jest.fn(), deleteChannel: jest.fn(),
    };
});
jest.mock("../../../src/stores/channelArchiveStore", () => ({ getChannelConfig: jest.fn(), recordArchived: jest.fn() }));
jest.mock("../../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: [] })), eventLookbackSince: jest.fn(() => 1) }));

const { MessageFlags } = require("discord.js");
const command = require("../../../src/commands/channels/kanal");
const discord = require("../../../src/services/discord/discord");
const discordChannels = require("../../../src/services/discord/discordChannels");
const archiveStore = require("../../../src/stores/channelArchiveStore");
const { loadEventGroups } = require("../../../src/web/raidEventGroups");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const channel = (over = {}) => ({ id: "ch1", name: "mi-24-09-ssc", guildId: "guild-1", parentId: "cat-events", type: 0, ...over });
const category = (over = {}) => ({ id: "cat-events", name: "Events", guildId: "guild-1", type: 4, ...over });
const embed = (i) => {
    const call = i.editReply.mock.calls[0] || i.reply.mock.calls[0];
    return call[0].embeds[0];
};

beforeEach(() => {
    jest.clearAllMocks();
    discord.listAllChannels.mockReturnValue([]);
    archiveStore.getChannelConfig.mockReturnValue({ archiveCategoryId: "cat-archive", schemas: {} });
});

describe("/kanal", () => {
    it("is for admins by default and never deletes", () => {
        expect(command.group).toBe("channels");
        expect(memberMayRun(command)).toBe(false);
        const source = require("fs").readFileSync(require.resolve("../../../src/commands/channels/kanal"), "utf8");
        expect(source).not.toMatch(/deleteChannel\(/);
    });

    describe("umbenennen", () => {
        it("renames through the channel module and shows old and new name", async () => {
            discordChannels.editChannel.mockResolvedValue({ id: "ch1", name: "do-25-09-ssc", changed: ["name"] });
            const i = mockInteraction({ options: { __subcommand: "umbenennen", kanal: channel(), name: "Do 25 09 SSC" } });
            await command.execute(i);
            expect(discordChannels.editChannel).toHaveBeenCalledWith("ch1", { name: "Do 25 09 SSC" });
            expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
            expect(embed(i).title).toBe("Kanal umbenannt");
            expect(embed(i).description).toContain("**mi-24-09-ssc** → **do-25-09-ssc**");
        });

        it("says when nothing changed and when Discord refused", async () => {
            discordChannels.editChannel.mockResolvedValue({ id: "ch1", name: "mi-24-09-ssc", changed: [] });
            const i = mockInteraction({ options: { __subcommand: "umbenennen", kanal: channel(), name: "mi-24-09-ssc" } });
            await command.execute(i);
            expect(embed(i).title).toBe("Nichts geändert");

            discordChannels.editChannel.mockRejectedValue(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
            const j = mockInteraction({ options: { __subcommand: "umbenennen", kanal: channel(), name: "x" } });
            await command.execute(j);
            expect(embed(j).description).toBe("fehlende Rechte");
        });

        it("refuses a channel of another server", async () => {
            const i = mockInteraction({ options: { __subcommand: "umbenennen", kanal: channel({ guildId: "other" }), name: "x" } });
            await command.execute(i);
            expect(discordChannels.editChannel).not.toHaveBeenCalled();
            expect(embed(i).description).toContain("nicht auf diesem Server");
        });
    });

    describe("archivieren", () => {
        it("archives into the server's archive category and logs who did it", async () => {
            discordChannels.archiveChannel.mockResolvedValue({ id: "ch1", name: "mi-24-09-ssc", fromParentId: "cat-events", fromCategory: "Events", guildId: "guild-1" });
            const i = mockInteraction({ userId: "u9", options: { __subcommand: "archivieren", kanal: channel() } });
            await command.execute(i);
            expect(archiveStore.getChannelConfig).toHaveBeenCalledWith("guild-1");
            expect(discordChannels.archiveChannel).toHaveBeenCalledWith("ch1", "cat-archive");
            expect(archiveStore.recordArchived).toHaveBeenCalledWith(expect.objectContaining({ channelId: "ch1", guildId: "guild-1", by: "u9", byName: "tester", fromCategory: "Events" }));
            expect(embed(i).title).toBe("Kanal archiviert");
        });

        it("needs an archive category, and leaves a channel already in the archive alone", async () => {
            archiveStore.getChannelConfig.mockReturnValue({ archiveCategoryId: "", schemas: {} });
            const i = mockInteraction({ options: { __subcommand: "archivieren", kanal: channel() } });
            await command.execute(i);
            expect(embed(i).description).toContain("keine Archiv-Kategorie");

            archiveStore.getChannelConfig.mockReturnValue({ archiveCategoryId: "cat-archive", schemas: {} });
            const j = mockInteraction({ options: { __subcommand: "archivieren", kanal: channel({ parentId: "cat-archive" }) } });
            await command.execute(j);
            expect(embed(j).title).toBe("Schon im Archiv");
            expect(discordChannels.archiveChannel).not.toHaveBeenCalled();
        });
    });

    describe("anlegen", () => {
        it("creates a channel from a typed name, normalised by Discord's rules", async () => {
            discordChannels.createFromTemplate.mockResolvedValue({ id: "new1", name: "twink-raid" });
            const i = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category(), name: "Twink Raid!" } });
            await command.execute(i);
            expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("guild-1", { name: "twink-raid", parentId: "cat-events", templateChannelId: "" });
            expect(embed(i).description).toContain("<#new1> in **Events**");
        });

        it("fills the category's stored schema with the date and uses its template", async () => {
            archiveStore.getChannelConfig.mockReturnValue({
                archiveCategoryId: "", schemas: { "cat-events": { schema: "{tag}-{dd}-{mm}-{raid}", raid: "ssc-tk", templateChannelId: "tpl" } },
            });
            discordChannels.createFromTemplate.mockResolvedValue({ id: "new2", name: "mi-24-09-ssc-tk" });
            const i = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category(), datum: "24.09.2025" } });
            await command.execute(i);
            expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("guild-1", { name: "mi-24-09-ssc-tk", parentId: "cat-events", templateChannelId: "tpl" });
            expect(embed(i).description).toContain("Vorlage");
        });

        it("asks for a date the schema needs, refuses a bad date and an existing name", async () => {
            const i = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category() } });
            await command.execute(i);
            expect(embed(i).description).toContain("braucht ein Datum");

            const j = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category(), name: "x", datum: "31.02." } });
            await command.execute(j);
            expect(embed(j).description).toContain("ist kein Datum");

            discord.listAllChannels.mockReturnValue([{ id: "c", name: "twink-raid" }]);
            const k = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category(), name: "Twink Raid" } });
            await command.execute(k);
            expect(embed(k).description).toContain("gibt es schon");
            expect(discordChannels.createFromTemplate).not.toHaveBeenCalled();
        });

        it("without a name: like the category's previous event channel, a copy of it, sorted in (#285)", async () => {
            discord.listAllChannels.mockReturnValue([{ id: "prev", name: "⚔┃mi-16-09-ssc-tk", parentId: "cat-events" }]);
            loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat-events", events: [
                { id: "e1", title: "SSC + TK", channelId: "prev", startTime: Date.UTC(2026, 8, 16, 17, 30) / 1000 },
            ] }] });
            discordChannels.createFromTemplate.mockImplementation(async (g, { name }) => ({ id: "new3", name }));
            const i = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category(), datum: "2026-09-23" } });
            await command.execute(i);
            expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("guild-1", {
                name: "⚔┃mi-23-09-ssc-tk", parentId: "cat-events", templateChannelId: "prev", afterChannelId: "prev",
            });
            expect(embed(i).description).toContain("Name: `⚔┃mi-23-09-ssc-tk` · abgeleitet aus #⚔┃mi-16-09-ssc-tk (Datum 16-09 → 23-09)");
            expect(embed(i).description).toContain("Rechte und Thema von #⚔┃mi-16-09-ssc-tk");

            const j = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category() } });
            await command.execute(j);
            expect(embed(j).description).toBe("Der Name wird aus #⚔┃mi-16-09-ssc-tk abgeleitet und braucht ein Datum (Option „datum“).");
            loadEventGroups.mockResolvedValue({ groups: [] });
        });

        it("refuses something that is no category", async () => {
            const i = mockInteraction({ options: { __subcommand: "anlegen", kategorie: category({ type: 0 }), name: "x" } });
            await command.execute(i);
            expect(embed(i).description).toBe("Bitte eine Kategorie wählen.");
        });
    });

    it("reads dates the way raid leads write them", () => {
        const now = new Date("2026-03-01T12:00:00Z");
        expect(command.parseDate("2026-09-24", now)).toBe("2026-09-24");
        expect(command.parseDate("24.09.", now)).toBe("2026-09-24");
        expect(command.parseDate("4.9.26", now)).toBe("2026-09-04");
        expect(command.parseDate("morgen", now)).toBe("");
        expect(command.parseDate("", now)).toBe("");
    });
});
