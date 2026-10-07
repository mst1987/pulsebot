// The account's menu language (German / English) — what makes the choice
// follow a user from one device to the next.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/userPrefsStore");

const FILE = tempStoreFile("user-prefs.json");

beforeEach(() => {
    store.useFile(FILE);
    try {
        fs.unlinkSync(FILE);
    } catch {
        // the first run has no file yet
    }
});

afterAll(() => store.useFile(null));

describe("stores/userPrefsStore", () => {
    it("has no language for an account that never chose one", () => {
        expect(store.getLang("42")).toBe("");
        expect(store.getLang("")).toBe("");
    });

    it("stores and returns the language per account", () => {
        expect(store.setLang("42", "en")).toEqual({ lang: "en" });
        expect(store.setLang("7", "de")).toEqual({ lang: "de" });
        expect(store.getLang("42")).toBe("en");
        expect(store.getLang("7")).toBe("de");
        expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ users: { 42: { lang: "en" }, 7: { lang: "de" } } });
    });

    it("normalises the spelling and refuses what the menu does not speak", () => {
        expect(store.setLang("42", " EN ")).toEqual({ lang: "en" });
        expect(store.setLang("42", "fr")).toEqual({ code: "unknown_lang" });
        expect(store.setLang("", "en")).toEqual({ code: "no_user" });
        expect(store.getLang("42")).toBe("en");
    });

    it("maps a Discord locale to a bot language", () => {
        expect(store.localeToLang("de")).toBe("de");
        expect(store.localeToLang("DE-AT")).toBe("de");
        expect(store.localeToLang("en-US")).toBe("en");
        expect(store.localeToLang("fr")).toBe("en");
        expect(store.localeToLang("")).toBe("");
        expect(store.localeToLang(undefined)).toBe("");
    });

    it("notes the client language apart from the chosen one and writes only on change", () => {
        expect(store.getClientLang("42")).toBe("");
        expect(store.noteClientLang("42", "de")).toBe(true);
        expect(store.getClientLang("42")).toBe("de");
        expect(store.getLang("42")).toBe("");
        const before = fs.statSync(FILE).mtimeMs;
        const spy = jest.spyOn(fs, "writeFileSync");
        expect(store.noteClientLang("42", "de-CH")).toBe(false);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        expect(fs.statSync(FILE).mtimeMs).toBe(before);
        expect(store.noteClientLang("42", "en-GB")).toBe(true);
        expect(store.getClientLang("42")).toBe("en");
        expect(store.noteClientLang("42", "")).toBe(false);
        expect(store.noteClientLang("", "de")).toBe(false);
        expect(store.getClientLang("")).toBe("");
    });

    it("clearLang keeps the client language, and an entry with only that stays", () => {
        store.setLang("42", "en");
        store.noteClientLang("42", "de");
        expect(store.clearLang("42")).toBe(true);
        expect(store.getLang("42")).toBe("");
        expect(store.getClientLang("42")).toBe("de");
        expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual({ users: { 42: { clientLang: "de" } } });
    });

    it("survives a broken file", () => {
        fs.writeFileSync(FILE, "{nope");
        expect(store.getLang("42")).toBe("");
        expect(store.setLang("42", "de")).toEqual({ lang: "de" });
        expect(store.getLang("42")).toBe("de");
    });
});
