// Which language the bot writes in: the raider's own choice, else the server's, else German.
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const userPrefs = require("../../../src/stores/userPrefsStore");
const botLanguage = require("../../../src/services/discord/botLanguage");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";

beforeAll(() => userPrefs.useFile(tempStoreFile("eh-bot-language.json")));
afterAll(() => userPrefs.useFile(null));
beforeEach(() => {
    mockConfig = {};
    userPrefs.clearLang(ANNA);
});

describe("services/discord/botLanguage", () => {
    it("speaks German on the server unless English is set", () => {
        expect(botLanguage.serverLang()).toBe("de");
        mockConfig = { botLanguage: "en" };
        expect(botLanguage.serverLang()).toBe("en");
        expect(botLanguage.serverLang({ botLanguage: "xx" })).toBe("de");
    });

    it("posts an event in its category's language — PuGs in English beside German guild raids — else the server's", () => {
        mockConfig = { botLanguage: "de", categoryLanguage: { pug: "en", guild: "de" } };
        expect(botLanguage.categoryLang("pug")).toBe("en");
        expect(botLanguage.eventLang({ id: "eh-1", categoryId: "pug" })).toBe("en");
        expect(botLanguage.eventLang({ id: "eh-2", categoryId: "guild" })).toBe("de");
        // a category without its own, an event without a category, nothing at all: the server language
        expect(botLanguage.eventLang({ id: "eh-3", categoryId: "other" })).toBe("de");
        expect(botLanguage.eventLang({ id: "eh-4" })).toBe("de");
        expect(botLanguage.eventLang(null)).toBe("de");
        expect(botLanguage.eventLang({ categoryId: "x" }, { botLanguage: "en", categoryLanguage: { x: "fr" } })).toBe("en");
        // the config handed in wins over the stored one
        expect(botLanguage.eventLang({ categoryId: "pug" }, { botLanguage: "de", categoryLanguage: {} })).toBe("de");
    });

    it("a raider without a choice gets the server language, with one their own", () => {
        expect(botLanguage.langOf(ANNA)).toBe("de");
        mockConfig = { botLanguage: "en" };
        expect(botLanguage.langOf(ANNA)).toBe("en");
        userPrefs.setLang(ANNA, "de");
        expect(botLanguage.langOf(ANNA)).toBe("de");
        expect(botLanguage.langOfInteraction({ user: { id: ANNA } })).toBe("de");
        expect(botLanguage.langOfInteraction(null)).toBe("en");
    });
});

describe("stores/userPrefsStore clearLang", () => {
    it("forgets the language and keeps the rest of the entry", () => {
        expect(userPrefs.clearLang(ANNA)).toBe(false);
        userPrefs.setLang(ANNA, "en");
        expect(userPrefs.clearLang(ANNA)).toBe(true);
        expect(userPrefs.getLang(ANNA)).toBe("");
        expect(userPrefs.clearLang("")).toBe(false);
    });
});
