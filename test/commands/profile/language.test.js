// /language: the raider's own bot language, or back to the server's.
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const { MessageFlags } = require("discord.js");
const userPrefs = require("../../../src/stores/userPrefsStore");
const command = require("../../../src/commands/profile/language");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { answerOf } = require("../../helpers/signupMocks");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const run = async (language, locale) => {
    const i = mockInteraction({ userId: ANNA, commandName: "language", options: { language } });
    if (locale) i.locale = locale;
    await command.execute(i);
    return { payload: i.reply.mock.calls[0][0], answer: answerOf(i.reply.mock.calls[0][0]) };
};

beforeAll(() => userPrefs.useFile(tempStoreFile("eh-cmd-language.json")));
afterAll(() => userPrefs.useFile(null));
beforeEach(() => {
    mockConfig = {};
    userPrefs.clearLang(ANNA);
});

describe("/language", () => {
    it("is a command for everybody, with German names in German clients", () => {
        expect(command).toMatchObject({ name: "language", group: "signup", defaultAccess: "everyone" });
        const data = command.data.toJSON();
        expect(data.name_localizations).toEqual({ de: "sprache" });
        expect(data.options[0].choices.map((c) => c.value)).toEqual(["de", "en", "auto"]);
    });

    it("switches to English and answers in English, only for the raider", async () => {
        const { payload, answer } = await run("en");
        expect(userPrefs.getLang(ANNA)).toBe("en");
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(answer.title).toBe("Bot language: English.");
        expect(answer.description).toContain("Messages in the channels are not personal: they are written in the language of the server or of the raid's category.");
    });

    it("switches to German and answers in German", async () => {
        mockConfig = { botLanguage: "en" };
        const { answer } = await run("de");
        expect(userPrefs.getLang(ANNA)).toBe("de");
        expect(answer.title).toBe("Bot-Sprache: Deutsch.");
    });

    it("automatic forgets the own choice and follows the Discord language", async () => {
        userPrefs.setLang(ANNA, "de");
        const { answer } = await run("auto", "en-GB");
        expect(userPrefs.getLang(ANNA)).toBe("");
        expect(answer.title).toBe("Bot language: automatic, it now follows your Discord language (English).");
    });

    it("automatic answers in German for a German Discord client", async () => {
        userPrefs.setLang(ANNA, "en");
        const { answer } = await run("auto", "de");
        expect(userPrefs.getLang(ANNA)).toBe("");
        expect(answer.title).toBe("Bot-Sprache: automatisch, der Bot folgt jetzt deiner Discord-Sprache (Deutsch).");
    });

    it("still accepts the old \"server\" value of commands registered before", async () => {
        userPrefs.setLang(ANNA, "en");
        await run("server");
        expect(userPrefs.getLang(ANNA)).toBe("");
    });
});
