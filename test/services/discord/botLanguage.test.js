// Which language the bot writes in: the raider's own choice, else the server's, else German.
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const userPrefs = require("../../../src/stores/userPrefsStore");
const botLanguage = require("../../../src/services/discord/botLanguage");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
// #924: the language is per server; without a server named the first one counts
const MAIN = "100000000000000001";
const PUGS = "100000000000000002";
const lang = (code) => ({ guildId: MAIN, serverSettings: { [MAIN]: { botLanguage: code } } });

beforeAll(() => userPrefs.useFile(tempStoreFile("eh-bot-language.json")));
afterAll(() => userPrefs.useFile(null));
beforeEach(() => {
    mockConfig = {};
    userPrefs.clearLang(ANNA);
    userPrefs.useFile(tempStoreFile("eh-bot-language-" + Math.random().toString(36).slice(2) + ".json"));
});

describe("services/discord/botLanguage", () => {
    it("speaks German on the server unless English is set", () => {
        expect(botLanguage.serverLang()).toBe("de");
        mockConfig = lang("en");
        expect(botLanguage.serverLang()).toBe("en");
        expect(botLanguage.serverLang(lang("xx"))).toBe("de");
    });

    it("posts an event in its category's language — PuGs in English beside German guild raids — else the server's", () => {
        mockConfig = { ...lang("de"), categoryLanguage: { pug: "en", guild: "de" } };
        expect(botLanguage.categoryLang("pug")).toBe("en");
        expect(botLanguage.eventLang({ id: "eh-1", categoryId: "pug" })).toBe("en");
        expect(botLanguage.eventLang({ id: "eh-2", categoryId: "guild" })).toBe("de");
        // a category without its own, an event without a category, nothing at all: the server language
        expect(botLanguage.eventLang({ id: "eh-3", categoryId: "other" })).toBe("de");
        expect(botLanguage.eventLang({ id: "eh-4" })).toBe("de");
        expect(botLanguage.eventLang(null)).toBe("de");
        expect(botLanguage.eventLang({ categoryId: "x" }, { ...lang("en"), categoryLanguage: { x: "fr" } })).toBe("en");
        // the config handed in wins over the stored one
        expect(botLanguage.eventLang({ categoryId: "pug" }, { ...lang("de"), categoryLanguage: {} })).toBe("de");
    });

    it("a raider without a choice gets the server language, with one their own", () => {
        expect(botLanguage.langOf(ANNA)).toBe("de");
        mockConfig = lang("en");
        expect(botLanguage.langOf(ANNA)).toBe("en");
        userPrefs.setLang(ANNA, "de");
        expect(botLanguage.langOf(ANNA)).toBe("de");
        expect(botLanguage.langOfInteraction({ user: { id: ANNA } })).toBe("de");
        expect(botLanguage.langOfInteraction(null)).toBe("en");
    });
});

describe("services/discord/botLanguage — Sprache je Server (#924)", () => {
    const TWO = {
        discordServers: { servers: [{ guildId: MAIN }, { guildId: PUGS }] },
        serverSettings: { [MAIN]: { botLanguage: "de" }, [PUGS]: { botLanguage: "en" } },
    };

    it("reads the language of the server named, else of the first server", () => {
        expect(botLanguage.serverLang(TWO, PUGS)).toBe("en");
        expect(botLanguage.serverLang(TWO, MAIN)).toBe("de");
        expect(botLanguage.serverLang(TWO)).toBe("de");
        // a server without its own setting speaks German
        expect(botLanguage.serverLang(TWO, "100000000000000009")).toBe("de");
    });

    it("ignores the old global field once the language moved to the servers", () => {
        expect(botLanguage.serverLang({ botLanguage: "en", guildId: MAIN })).toBe("de");
    });

    it("posts an event in the language of its server when its category has none", () => {
        expect(botLanguage.eventLang({ guildId: PUGS }, TWO)).toBe("en");
        expect(botLanguage.eventLang({ guildId: MAIN }, TWO)).toBe("de");
        expect(botLanguage.eventLang({ guildId: PUGS, categoryId: "c" }, { ...TWO, categoryLanguage: { c: "de" } })).toBe("de");
    });

    it("answers a raider without a choice in the language of the server clicked on", () => {
        mockConfig = TWO;
        expect(botLanguage.langOfInteraction({ user: { id: ANNA }, guildId: PUGS })).toBe("en");
        expect(botLanguage.langOfInteraction({ user: { id: ANNA }, guildId: MAIN })).toBe("de");
        expect(botLanguage.langOfInteraction({ user: { id: ANNA }, guildId: MAIN }, { guildId: PUGS })).toBe("en");
        expect(botLanguage.langOf(ANNA, { guildId: PUGS })).toBe("en");
        // the own choice still comes first
        userPrefs.setLang(ANNA, "de");
        expect(botLanguage.langOfInteraction({ user: { id: ANNA }, guildId: PUGS })).toBe("de");
    });
});

describe("client language", () => {
    const withLocale = (locale) => ({ user: { id: ANNA }, locale });

    it("langOf: own choice > stored Discord language > server language", () => {
        mockConfig = lang("en");
        expect(botLanguage.langOf(ANNA)).toBe("en");
        userPrefs.noteClientLang(ANNA, "de");
        expect(botLanguage.langOf(ANNA)).toBe("de");
        userPrefs.setLang(ANNA, "en");
        expect(botLanguage.langOf(ANNA)).toBe("en");
        userPrefs.clearLang(ANNA);
        expect(botLanguage.langOf(ANNA)).toBe("de");
    });

    it("langOfInteraction: own choice > this interaction's locale > stored language > server language", () => {
        mockConfig = lang("en");
        expect(botLanguage.langOfInteraction(withLocale(undefined))).toBe("en");
        expect(botLanguage.langOfInteraction(withLocale("de"))).toBe("de");
        userPrefs.noteClientLang(ANNA, "de");
        expect(botLanguage.langOfInteraction(withLocale(undefined))).toBe("de");
        expect(botLanguage.langOfInteraction(withLocale("fr"))).toBe("en");
        userPrefs.setLang(ANNA, "de");
        expect(botLanguage.langOfInteraction(withLocale("en-US"))).toBe("de");
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
