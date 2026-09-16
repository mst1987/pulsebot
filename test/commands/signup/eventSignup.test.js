// Der „Anmelden“-Button unter der Event-Nachricht öffnet den Anmelde-Dialog (#258).
const os = require("os");
const path = require("path");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/eventMessage", () => ({ SIGNUP_BUTTON_PREFIX: "event-signup" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/signup/eventSignup");
const { mockInteraction } = require("../../helpers/mockInteraction");

const ANNA = "200000000000000001";

beforeAll(() => profiles.useFile(path.join(os.tmpdir(), `eh-cmd-event-signup-${process.pid}.json`)));
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
        expect(payload.ephemeral).toBe(true);
        expect(payload.embeds[0].title).toBe("Karazhan");
        const ids = payload.components.flatMap((r) => r.components).map((c) => c.custom_id).filter(Boolean);
        expect(ids).toContain("signup-status:eh-kara:s:nerathil:Mage-Arcane:");
    });

    it("says so when the event is gone", async () => {
        const interaction = mockInteraction({ customId: "event-signup:eh-9" });
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "Dieses Event gibt es nicht mehr.", ephemeral: true });
    });
});
