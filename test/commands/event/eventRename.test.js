jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(), listAllChannels: jest.fn() }));
jest.mock("../../../src/services/discord/discordChannels", () => ({ editChannel: jest.fn(), discordErrorText: (e) => (e && e.message) || "Fehler" }));
jest.mock("../../../src/services/discord/userAccess", () => ({ userMayAny: jest.fn() }));
jest.mock("../../../src/stores/channelArchiveStore", () => ({ getChannelConfig: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(), listRaidTemplates: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({ signupSourceFor: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ serverIds: jest.fn(() => []) }));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const discord = require("../../../src/services/discord/discord");
const discordChannels = require("../../../src/services/discord/discordChannels");
const { userMayAny } = require("../../../src/services/discord/userAccess");
const settings = require("../../../src/stores/settingsStore");
const renameCommand = require("../../../src/commands/event/eventRename");
const { channelIdOf, renameModal } = require("../../../src/services/events/eventChannelRename");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { cardText } = require("../../helpers/cardText");

const CAT = "100000000000000001";
const CH = "555000000000000001";
const OTHER = "555000000000000002";
const ELSEWHERE = "555000000000000003";
const ID = `event-rename:${CH}`;
const run = (over = {}) => {
    const i = mockInteraction({ customId: ID, ...over });
    i.guild.id = "g1";
    return i;
};

beforeEach(() => {
    jest.clearAllMocks();
    discord.listCategories.mockReturnValue([{ id: CAT, name: "Mittwoch-Raid" }, { id: "100000000000000009", name: "Orga" }]);
    discord.listAllChannels.mockReturnValue([
        { id: CH, name: "🔥・mi-23-09-ssc-tk", parentId: CAT },
        { id: OTHER, name: "do-24-09-bt", parentId: CAT },
        { id: ELSEWHERE, name: "orga-intern", parentId: "100000000000000009" },
    ]);
    settings.getConfig.mockReturnValue({ categoryIds: [CAT] });
    userMayAny.mockResolvedValue(true);
    discordChannels.editChannel.mockImplementation(async (id, changes) => ({ id, name: changes.name }));
});

describe("event-rename — Kanal umbenennen", () => {
    it("inherits the access of /event and reads only a channel id out of the customId", () => {
        expect(renameCommand).toMatchObject({ name: "event-rename", accessOf: "event" });
        expect(channelIdOf(ID)).toBe(CH);
        expect(channelIdOf("event-rename:../x")).toBe("");
        expect(channelIdOf("event-form:555000000000000001")).toBe("");
    });

    it("the button opens a modal with one field, prefilled with the actual channel name", async () => {
        const i = run();
        await renameCommand.execute(i);
        // nothing is looked up before the modal: it has to be the first answer (the submit checks the right)
        expect(userMayAny).not.toHaveBeenCalled();
        const json = i.showModal.mock.calls[0][0].toJSON();
        expect(json.custom_id).toBe(ID);
        expect(json.components).toHaveLength(1);
        expect(json.components[0].components[0]).toMatchObject({ custom_id: "name", value: "🔥・mi-23-09-ssc-tk", max_length: 100 });
        expect(renameModal({ id: CH, name: "x" }).toJSON().components[0].components[0].value).toBe("x");
    });

    it("the submit renames the channel with the name normalised", async () => {
        const i = run({ modal: true, options: { name: "  🐍・Mi 23.09 SSC  " } });
        await renameCommand.execute(i);
        expect(discordChannels.editChannel).toHaveBeenCalledWith(CH, { name: "🐍・mi-2309-ssc" });
        expect(cardText(i.editReply.mock.calls[0][0])).toContain("Kanal umbenannt");
        expect(cardText(i.editReply.mock.calls[0][0])).toContain(`<#${CH}>`);
    });

    it("refuses a name another channel already has, an empty name and the unchanged one", async () => {
        for (const [name, text] of [["DO-24-09-BT", "gibt es schon"], ["!!!", "kein gültiger"], ["🔥・mi-23-09-ssc-tk", "heißt schon so"]]) {
            const i = run({ modal: true, options: { name } });
            await renameCommand.execute(i);
            expect(cardText(i.editReply.mock.calls[0][0])).toContain(text);
        }
        expect(discordChannels.editChannel).not.toHaveBeenCalled();
    });

    it("needs the channels area (write) on top of the /event rule", async () => {
        userMayAny.mockResolvedValue(false);
        // the button only opens the modal (no lookup before it); the submit is where the right is checked
        const button = run();
        await renameCommand.execute(button);
        expect(button.showModal).toHaveBeenCalled();
        const i = run({ modal: true, options: { name: "neuer-name" } });
        await renameCommand.execute(i);
        expect(i.deferReply).toHaveBeenCalled();
        expect(cardText(i.editReply.mock.calls[0][0])).toContain("Kanäle");
        expect(i.showModal).not.toHaveBeenCalled();
        expect(discordChannels.editChannel).not.toHaveBeenCalled();
    });

    it("renames only a channel of an event category that exists", async () => {
        for (const customId of [`event-rename:${ELSEWHERE}`, "event-rename:999000000000000009", "event-rename:abc"]) {
            const i = run({ customId, modal: true, options: { name: "neuer-name" } });
            await renameCommand.execute(i);
            expect(i.editReply).toHaveBeenCalled();
            expect(i.showModal).not.toHaveBeenCalled();
            const b = run({ customId });
            await renameCommand.execute(b);
            expect(b.reply).toHaveBeenCalled();
            expect(b.showModal).not.toHaveBeenCalled();
        }
        expect(discordChannels.editChannel).not.toHaveBeenCalled();
    });

    it("says why when Discord refuses", async () => {
        discordChannels.editChannel.mockRejectedValue(Object.assign(new Error("fehlende Rechte"), { code: 50013 }));
        const i = run({ modal: true, options: { name: "neuer-name" } });
        await renameCommand.execute(i);
        expect(cardText(i.editReply.mock.calls[0][0])).toContain("Nicht umbenannt");
    });

    it("refuses another server than the event server", async () => {
        const i = mockInteraction({ customId: ID });
        i.guild = null;
        await renameCommand.execute(i);
        expect(cardText(i.reply.mock.calls[0][0])).toContain("Raid-Server");
    });
});
