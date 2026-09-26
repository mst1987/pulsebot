// Die Raid-Auswahl unter der Übersicht auf dem Talk-Server (#258): eigene Events
// öffnen den Anmelde-Dialog, Raid-Helper-Events verlinken in ihren Event-Kanal.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/services/events/eventSources", () => ({ getStoredEvent: jest.fn() }));
jest.mock("../../../src/web/talkOverview", () => ({ SELECT_ID: "talk-signup" }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const { getStoredEvent } = require("../../../src/services/events/eventSources");
const command = require("../../../src/commands/signup/talkSignup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-talk-signup.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
});

describe("commands/signup/talkSignup", () => {
    it("is routed by the select's customId and open to every raider", () => {
        expect(command).toMatchObject({ name: "talk-signup", group: "signup", defaultAccess: "everyone" });
    });

    it("opens the signup dialog for an own event, here on the talk server", async () => {
        const interaction = mockInteraction({ customId: "talk-signup", values: ["eh-kara"], userId: "200000000000000009" });
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].title).toBe("Karazhan");
        expect(payload.embeds[0].description).toContain("create a profile");
        expect(getStoredEvent).not.toHaveBeenCalled();
    });

    it("refuses to open an own event of a category whose raider role the member lacks", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat-kara" }));
        mocks.access.config = { guildId: "event-guild", categoryRoles: { "cat-kara": ["role-kara"] } };
        mocks.access.roleIds = [];
        const interaction = mockInteraction({ customId: "talk-signup", values: ["eh-kara"], userId: "200000000000000009" });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "You need a raider role for this raid.", flags: MessageFlags.Ephemeral });
        // no event guild on the event → the configured (event) server
        expect(mocks.memberRoleIds).toHaveBeenCalledWith("event-guild", "200000000000000009");
    });

    it("links a Raid-Helper event into its event channel", async () => {
        getStoredEvent.mockReturnValue({ id: "123456", title: "Gruul", guildId: "g-1", channelId: "c-1", source: "raidhelper" });
        const interaction = mockInteraction({ values: ["123456"] });
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.content).toBe("Signups for **Gruul** run through Raid-Helper – sign up in the event channel.");
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.components[0].components[0]).toMatchObject({ label: "Go to the event channel", url: "https://discord.com/channels/g-1/c-1" });
    });

    it("falls back to the event server and then to the web when the channel is unknown", async () => {
        getStoredEvent.mockReturnValue({ id: "123456", title: "Gruul", channelId: "c-2" });
        let interaction = mockInteraction({ values: ["123456"] });
        await command.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].components[0].components[0].url).toBe("https://discord.com/channels/event-guild/c-2");

        getStoredEvent.mockReturnValue(null);
        interaction = mockInteraction({ values: ["123456"] });
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.content).toContain("this raid");
        expect(payload.components[0].components[0].url).toBe("https://eh.example/raids/detail?event=123456");
    });

    it("says so when nothing was chosen or the own event is gone", async () => {
        let interaction = mockInteraction({ values: [] });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "No raid picked.", flags: MessageFlags.Ephemeral });
        interaction = mockInteraction({ values: ["eh-gone"] });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "This event no longer exists.", flags: MessageFlags.Ephemeral });
    });
});
