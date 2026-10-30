// The old button "Für alle Raids anmelden" (removed in #904): a click on an overview posted
// before only says the button is gone - in the member's language, ephemeral, nothing signed up.
const { MessageFlags } = require("discord.js");
const { answerOf } = require("../../helpers/signupMocks");

jest.mock("../../../src/stores/settings/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const command = require("../../../src/commands/signup/talkSignupAll");
const { mockInteraction } = require("../../helpers/mockInteraction");

beforeEach(() => mocks.reset());

describe("talk-signup-all (gone since #904)", () => {
    it("routes the old button ids, with and without version", () => {
        expect(command.name).toBe("talk-signup-all");
        expect(command.accessOf).toBe("talk-signup");
    });

    it.each(["talk-signup-all", "talk-signup-all:v:tbc"])("answers %s ephemerally that the button is gone", async (customId) => {
        mocks.access.config = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } } };
        const i = mockInteraction({ customId, userId: "200000000000000001" });
        await command.execute(i);
        expect(i.reply).toHaveBeenCalledTimes(1);
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
        expect(answerOf(payload).text).toContain("This button no longer exists – use “Pick several raids …”.");
    });

    it("speaks German by default", () => {
        expect(answerOf(command.goneReply("de")).text).toContain("Diesen Knopf gibt es nicht mehr – nutze „Mehrere Raids wählen …“.");
    });
});
