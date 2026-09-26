// Der „Anmelden“-Button unter der Event-Nachricht öffnet den Anmelde-Dialog (#258).
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/services/events/eventMessage", () => ({ SIGNUP_BUTTON_PREFIX: "event-signup" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const command = require("../../../src/commands/signup/eventSignup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-event-signup.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
});

describe("commands/signup/eventSignup", () => {
    it("is routed by the button's customId prefix and open to every raider", () => {
        expect(command).toMatchObject({ name: "event-signup", group: "signup", defaultAccess: "everyone" });
    });

    it("opens the signup dialog only for the member", async () => {
        profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        const interaction = mockInteraction({ customId: "event-signup:eh-kara", userId: ANNA });
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].title).toBe("Karazhan");
        const ids = payload.components.flatMap((r) => r.components).map((c) => c.custom_id).filter(Boolean);
        expect(ids).toContain("signup-status:eh-kara:s:nerathil:Mage-Arcane:");
    });

    it("refuses a member without the category's raider role instead of opening the dialog", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat-kara", guildId: "g-event" }));
        mocks.access.config = { categoryRoles: { "cat-kara": ["role-kara"] } };
        mocks.access.roleIds = ["role-other"];
        let interaction = mockInteraction({ customId: "event-signup:eh-kara", userId: ANNA });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "You need a raider role for this raid.", flags: MessageFlags.Ephemeral });
        expect(mocks.memberRoleIds).toHaveBeenCalledWith("g-event", ANNA);

        // …an own signup from before may still be changed
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", status: "signed" });
        interaction = mockInteraction({ customId: "event-signup:eh-kara", userId: ANNA });
        await command.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].embeds[0].title).toBe("Karazhan");
    });

    it("says so when the event is gone", async () => {
        const interaction = mockInteraction({ customId: "event-signup:eh-9" });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "This event no longer exists.", flags: MessageFlags.Ephemeral });
    });
});
