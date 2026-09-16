// Die Raid-Auswahl unter der Übersicht auf dem Talk-Server (#258): eigene Events
// öffnen den Anmelde-Dialog, Raid-Helper-Events verlinken in ihren Event-Kanal.
const os = require("os");
const path = require("path");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/eventSources", () => ({ getStoredEvent: jest.fn() }));
jest.mock("../../../src/web/talkOverview", () => ({ SELECT_ID: "talk-signup" }));
jest.mock("../../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const { getStoredEvent } = require("../../../src/web/eventSources");
const command = require("../../../src/commands/signup/talkSignup");
const { mockInteraction } = require("../../helpers/mockInteraction");

beforeAll(() => profiles.useFile(path.join(os.tmpdir(), `eh-cmd-talk-signup-${process.pid}.json`)));
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
        expect(payload.ephemeral).toBe(true);
        expect(payload.embeds[0].title).toBe("Karazhan");
        expect(payload.embeds[0].description).toContain("Profil anlegen");
        expect(getStoredEvent).not.toHaveBeenCalled();
    });

    it("links a Raid-Helper event into its event channel", async () => {
        getStoredEvent.mockReturnValue({ id: "123456", title: "Gruul", guildId: "g-1", channelId: "c-1", source: "raidhelper" });
        const interaction = mockInteraction({ values: ["123456"] });
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.content).toBe("Die Anmeldung zu **Gruul** läuft über Raid-Helper – melde dich im Event-Kanal an.");
        expect(payload.ephemeral).toBe(true);
        expect(payload.components[0].components[0]).toMatchObject({ label: "Zum Event-Kanal", url: "https://discord.com/channels/g-1/c-1" });
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
        expect(payload.content).toContain("diesem Raid");
        expect(payload.components[0].components[0].url).toBe("https://eh.example/raids/detail?event=123456");
    });

    it("says so when nothing was chosen or the own event is gone", async () => {
        let interaction = mockInteraction({ values: [] });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "Kein Raid gewählt.", ephemeral: true });
        interaction = mockInteraction({ values: ["eh-gone"] });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "Dieses Event gibt es nicht mehr.", ephemeral: true });
    });
});
