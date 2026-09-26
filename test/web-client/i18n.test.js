// The web client's translations (German / English): the core run for real,
// both dictionaries held to the same keys, every key a page asks for present,
// and the language switch wired the way the docs promise — kept in the browser,
// saved for the account, applied to <html lang> and to dates.
const fs = require("fs");
const path = require("path");
const { CLIENT, loadCore, namespaces, allDicts, makeT, read } = require("./i18nHelper");

const core = loadCore();

describe("i18n core", () => {
    const dicts = {
        de: { "a.hello": "Hallo {name}", "a.only": "nur deutsch", "a.n": { one: "{count} Raid", other: "{count} Raids" } },
        en: { "a.hello": "Hello {name}", "a.n": { one: "{count} raid", other: "{count} raids", zero: "no raids" } },
    };

    it("interpolates params and leaves unknown ones visible", () => {
        expect(core.translate(dicts, "en", "a.hello", { name: "Ann" })).toBe("Hello Ann");
        expect(core.translate(dicts, "en", "a.hello")).toBe("Hello {name}");
        expect(core.interpolate("{a} + {b}", { a: 1, b: null })).toBe("1 + {b}");
    });

    it("picks the plural form by count, with an optional zero form", () => {
        expect(core.translate(dicts, "en", "a.n", { count: 1 })).toBe("1 raid");
        expect(core.translate(dicts, "en", "a.n", { count: 4 })).toBe("4 raids");
        expect(core.translate(dicts, "en", "a.n", { count: 0 })).toBe("no raids");
        expect(core.translate(dicts, "de", "a.n", { count: 0 })).toBe("0 Raids");
        expect(core.translate(dicts, "de", "a.n", { count: 1 })).toBe("1 Raid");
    });

    it("falls back to German, then to the key, and reports what is missing", () => {
        const missing = [];
        const report = (lang, key) => missing.push(`${lang}:${key}`);
        expect(core.translate(dicts, "en", "a.only", undefined, report)).toBe("nur deutsch");
        expect(core.translate(dicts, "en", "a.nothing", undefined, report)).toBe("a.nothing");
        expect(missing).toEqual(["en:a.only", "en:a.nothing"]);
    });

    it("flattens namespaces to dotted keys and keeps plural objects whole", () => {
        expect(core.flatten({ list: { title: "Raids", n: { one: "x", other: "y" } } }, "raids")).toEqual({
            "raids.list.title": "Raids",
            "raids.list.n": { one: "x", other: "y" },
        });
    });

    it("accepts only the two languages", () => {
        expect(core.normalizeLang("EN")).toBe("en");
        expect(core.normalizeLang("de-AT")).toBe("de");
        expect(core.normalizeLang("fr")).toBeNull();
        expect(core.normalizeLang(null)).toBeNull();
        expect(core.DEFAULT_LANG).toBe("de");
        expect(core.LOCALES).toEqual({ de: "de-DE", en: "en-GB" });
    });
});

describe("the dictionaries", () => {
    const { de, en } = allDicts();

    it("have the same namespace files in both languages", () => {
        expect(Object.keys(namespaces("en")).sort()).toEqual(Object.keys(namespaces("de")).sort());
    });

    it("hold exactly the same keys in German and English", () => {
        const diff = core.keyDiff(de, en);
        expect({ onlyGerman: diff.onlyA, onlyEnglish: diff.onlyB }).toEqual({ onlyGerman: [], onlyEnglish: [] });
    });

    it("use the same {params} in both languages", () => {
        const wrong = Object.keys(de).filter((k) => en[k] !== undefined
            && core.placeholders(de[k]).join() !== core.placeholders(en[k]).join());
        expect(wrong).toEqual([]);
    });

    it("have no empty texts, and plural objects on the same keys", () => {
        const empty = Object.entries({ ...de, ...en }).filter(([, v]) => typeof v === "string" && !v.trim()).map(([k]) => k);
        expect(empty).toEqual([]);
        const shape = Object.keys(de).filter((k) => en[k] !== undefined && typeof de[k] !== typeof en[k]);
        expect(shape).toEqual([]);
    });

    it("name the WoW roles and classes with the game's English terms", () => {
        const t = makeT("en");
        expect(["tank", "healer", "melee", "ranged"].map((r) => t(`wow.role.${r}`))).toEqual(["Tank", "Healer", "Melee", "Ranged"]);
        expect(t("wow.class.Priest")).toBe("Priest");
        expect(t("wow.class.Warrior")).toBe("Warrior");
        expect(t("wow.spec.BeastMastery")).toBe("Beast Mastery");
        expect(makeT("de")("wow.class.Priest")).toBe("Priester");
    });
});

// Every text a page asks for by a literal key must exist — a typo would show
// the raw key on the page, and in German there is no fallback to hide it.
describe("keys used in the client", () => {
    function sources(dir, out = []) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            // i18n/ itself only names example keys in its comments
            if (entry.isDirectory()) { if (entry.name !== "i18n") sources(full, out); }
            else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
        }
        return out;
    }

    it("exist in the German dictionary", () => {
        const { de } = allDicts();
        const unknown = [];
        for (const file of sources(CLIENT)) {
            const src = fs.readFileSync(file, "utf8");
            for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z][\w-]*(?:\.[\w-]+)+)"/g)) {
                if (de[m[1]] === undefined) unknown.push(`${path.relative(CLIENT, file)}: ${m[1]}`);
            }
        }
        expect(unknown).toEqual([]);
    });
});

describe("the language switch", () => {
    const index = read("i18n/index.ts");
    const toggle = read("components/LangToggle.tsx");
    const shell = read("components/Shell.tsx");
    const app = read("App.tsx");

    it("remembers the choice in the browser and labels the document", () => {
        expect(index).toContain("const STORAGE_KEY = \"eh-lang\";");
        expect(index).toMatch(/localStorage\.setItem\(STORAGE_KEY, lang\)/);
        expect(index).toMatch(/localStorage\.getItem\(STORAGE_KEY\)/);
        expect(index).toMatch(/setAttribute\("lang", lang\)/);
    });

    it("saves it for the account too, and a failed save changes nothing", () => {
        expect(toggle).toMatch(/setLang\(next\);\s*\n\s*if \(csrfToken\) saveLang\(csrfToken, next\)\.catch\(\(\) => \{\}\);/);
        expect(read("api/session.ts")).toMatch(/send\("POST", "\/api\/session\/lang", csrfToken, \{ lang \}\)/);
    });

    it("lets the account's saved language win when the session loads", () => {
        expect(app).toMatch(/const saved = session\.user && session\.user\.lang;\s*\n\s*if \(saved && saved !== getLang\(\)\) setLang\(saved\);/);
    });

    it("sits in the top bar, and before login on the sign-in screen", () => {
        expect(shell).toMatch(/<div className="top-actions">[\s\S]*<LangToggle csrfToken=\{csrfToken\} \/>[\s\S]*<ThemeToggle \/>/);
        expect(app).toMatch(/loginButton[\s\S]*<LangToggle \/>/);
    });

    it("redraws the page in the new language", () => {
        expect(shell).toContain("<div className=\"content\" key={lang}>");
    });

    it("formats dates with the active locale instead of a fixed de-DE", () => {
        const format = read("lib/format.ts");
        expect(format).not.toContain("\"de-DE\"");
        expect(format).toContain("locale()");
    });
});
