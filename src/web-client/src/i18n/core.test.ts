// The web client's translations (German / English): the core run for real and
// both dictionaries held to the same keys (#435: formerly test/web-client/i18n.test.js).
import { describe, expect, it } from "vitest";
import * as core from "./core";
import { t } from ".";
import { inLang } from "../test/i18n";

// The namespace files as i18n/index.ts finds them: ./locales/<lang>/<ns>.json
const files = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" });
const FILE_RE = /\.\/locales\/(\w+)\/([\w-]+)\.json$/;

function namespaces(lang: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [file, tree] of Object.entries(files)) {
        const m = file.match(FILE_RE);
        if (m && m[1] === lang) out[m[2]] = tree;
    }
    return out;
}

function flatDict(lang: string): core.FlatDict {
    const dict: core.FlatDict = {};
    for (const [ns, tree] of Object.entries(namespaces(lang))) core.flatten(tree, ns, dict);
    return dict;
}

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
        const missing: string[] = [];
        const report = (lang: string, key: string) => missing.push(`${lang}:${key}`);
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
    const de = flatDict("de");
    const en = flatDict("en");

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

    // A German word left in the English file would show up on the English page
    // without any fallback warning. Proper names that need an umlaut go here.
    const ENGLISH_UMLAUT_OK = new Set<string>([]);

    it("have no German umlaut in the English texts", () => {
        const texts = (v: core.FlatDict[string]) => (typeof v === "string" ? [v] : Object.values(v));
        const german = Object.entries(en)
            .filter(([k, v]) => !ENGLISH_UMLAUT_OK.has(k) && texts(v).some((s) => /[äöüÄÖÜß]/.test(String(s))))
            .map(([k]) => k);
        expect(german).toEqual([]);
    });

    it("name the WoW roles and classes with the game's English terms", async () => {
        await inLang("en", () => {
            expect(["tank", "healer", "melee", "ranged"].map((r) => t(`wow.role.${r}`))).toEqual(["Tank", "Healer", "Melee", "Ranged"]);
            expect(t("wow.class.Priest")).toBe("Priest");
            expect(t("wow.class.Warrior")).toBe("Warrior");
            expect(t("wow.spec.BeastMastery")).toBe("Beast Mastery");
        });
        expect(t("wow.class.Priest")).toBe("Priester");
    });
});

// Every text a page asks for by a literal key must exist: a typo would show
// the raw key on the page, and in German there is no fallback to hide it.
describe("keys used in the client", () => {
    // i18n/ itself only names example keys in its comments; tests are not the app
    const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../i18n/**", "!../**/*.test.{ts,tsx}", "!../test/**"], { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

    it("exist in the German dictionary", () => {
        const de = flatDict("de");
        expect(Object.keys(sources).length).toBeGreaterThan(100);
        const unknown: string[] = [];
        for (const [file, src] of Object.entries(sources)) {
            for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z][\w-]*(?:\.[\w-]+)+)"/g)) {
                if (de[m[1]] === undefined) unknown.push(`${file}: ${m[1]}`);
            }
        }
        expect(unknown).toEqual([]);
    });
});
