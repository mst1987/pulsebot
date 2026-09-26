// The web menu in two languages (docs/web-admin.md, "Sprache (i18n)"):
//   * where the language switch is wired (#435: the structural half of the
//     former test/web-client/i18n.test.js);
//   * one locale and one time zone, both only in lib/format.ts (#440);
//   * no hard-coded German text in ANY source file of the client (#440, the
//     former i18n-phase1.test.js, which only knew a list of phase-1 files).
// The core, the dictionaries and the keys the client asks for are tested in
// Vitest (src/web-client/src/i18n/core.test.ts), the switch itself in
// components/LangToggle.test.tsx.
//
// The text scan is deliberately small and quiet rather than clever:
//   * no string literal and no JSX text carries an umlaut or ß — English and
//     the brand/game names never need one, German nearly always does;
//   * no JSX text between two tags reads like a German phrase (two or more
//     words with a German marker word).
// Comments are stripped first, so a comment may quote the old German text.
// Anything that is really meant to stay goes into ALLOWED (one literal) or
// ALLOWED_FILES (a file that parses German input) with the reason next to it.
const { read, clientSources, stripComments } = require("../clientSource");

describe("the language switch", () => {
    const shell = read("components/Shell.tsx");
    const app = read("App.tsx");

    it("lets the account's saved language win when the session loads", () => {
        expect(app).toMatch(/const saved = session\.user && session\.user\.lang;\s*\n\s*if \(saved && saved !== getLang\(\)\) setLang\(saved\);/);
    });

    it("sits in the top bar, and before login on the sign-in screen", () => {
        expect(shell).toMatch(/<div className="top-actions">[\s\S]*<LangToggle account \/>[\s\S]*<ThemeToggle \/>/);
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

    // #440: one time zone constant and one locale for the whole client — a
    // page formats through lib/format.ts, never with its own "de-DE" or zone.
    it("names the locale and the time zone only in lib/format.ts and i18n/", () => {
        const found = clientSources()
            .filter(([rel]) => rel !== "lib/format.ts" && !rel.startsWith("i18n/"))
            .filter(([, src]) => /"de-DE"|"Europe\/Berlin"|toLocale\w*String\(\s*(\[\]|undefined)/.test(stripComments(src)))
            .map(([rel]) => rel);
        expect(found).toEqual([]);
        expect(read("lib/format.ts")).toContain("export const DISPLAY_TZ = \"Europe/Berlin\";");
    });
});

// Literals that may keep an umlaut: "file: text" and why.
const ALLOWED = new Set([
    // the confirmation word of a bulk delete: the server checks exactly this
    // word (BULK_DELETE_WORD in the channels service), in every language
    "lib/channels.ts: LÖSCHEN",
]);

// Files whose German literals are data the code reads, not texts it shows.
const ALLOWED_FILES = {
    // German verb forms: the plan's "du" rewrite of a German task sentence
    "lib/raidplan/steps.ts": "parses German input",
    // German spell names (Fluch der Elemente, Tollkühnheit …) that pick a task's icon
    "lib/raidplan/assign.ts": "parses German input",
};

const GERMAN_WORD = /\b(und|nicht|der|die|das|ist|mit|für|oder|kein|keine|noch|wird|werden|auf|zum|zur|dem|den|ein|eine|einen|bitte|wählen|hinzufügen|entfernen|speichern|abbrechen|löschen|schließen)\b/i;

/** Every app source of the client: no tests, no test fixtures, not the dictionaries themselves. */
function files() {
    return clientSources()
        .filter(([rel]) => !rel.startsWith("i18n/") && !/\.fixture\.tsx?$/.test(rel) && !ALLOWED_FILES[rel]);
}

/** String literals ("…", `…` without their ${} parts) and JSX text of one source, comments stripped. */
function texts(src) {
    const code = stripComments(src.replace(/\r\n/g, "\n"))
        // translation keys are not texts
        .replace(/\bt(Or|Parts)?\(\s*"[^"]*"/g, "t(");
    const out = [];
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)) {
        out.push({ kind: "string", text: (m[1] !== undefined ? m[1] : m[2].replace(/\$\{[^}]*\}/g, " ")) });
    }
    const noStrings = code.replace(/"(?:[^"\\\n]|\\.)*"|`[^`]*`/g, "\"\"");
    for (const m of noStrings.matchAll(/>([^<>{}=;()]*[A-Za-zÄÖÜäöüß][^<>{}=;()]*)</g)) {
        out.push({ kind: "jsx", text: m[1].trim() });
    }
    return out;
}

describe("i18n: no hard-coded German left in the client", () => {
    const list = files();

    it("scans every page and component", () => {
        const names = list.map(([rel]) => rel);
        expect(names.length).toBeGreaterThan(300);
        expect(names).toEqual(expect.arrayContaining([
            "App.tsx", "pages/ChannelsPage.tsx", "pages/settings/SettingsPage.tsx", "pages/history/HistoryPage.tsx",
            "pages/lootcouncil/LootCouncilPage.tsx", "pages/cla/ClaPage.tsx", "pages/recruitment/RecruitmentPage.tsx",
            "pages/roster/RosterPage.tsx", "pages/EventSeriesPage.tsx", "lib/format.ts",
        ]));
        expect(names.some((rel) => /\.test\.tsx?$/.test(rel))).toBe(false);
        // every .tsx of the app is scanned
        const tsx = clientSources("", /\.tsx$/).map(([rel]) => rel).filter((rel) => !rel.startsWith("test/"));
        expect(tsx.filter((rel) => !names.includes(rel))).toEqual([]);
    });

    it("has no umlaut or ß in a string or JSX text", () => {
        const found = [];
        for (const [rel, src] of list) {
            for (const { text } of texts(src)) {
                if (/[äöüÄÖÜß]/.test(text) && !ALLOWED.has(`${rel}: ${text}`)) found.push(`${rel}: ${text.slice(0, 80)}`);
            }
        }
        expect(found).toEqual([]);
    });

    it("has no German phrase as JSX text", () => {
        const found = [];
        for (const [rel, src] of list) {
            for (const { kind, text } of texts(src)) {
                if (kind === "jsx" && text.split(/\s+/).length >= 2 && GERMAN_WORD.test(text)) found.push(`${rel}: ${text.slice(0, 80)}`);
            }
        }
        expect(found).toEqual([]);
    });

    it("keeps its exceptions few and still needed", () => {
        const sources = Object.fromEntries(clientSources());
        for (const entry of ALLOWED) {
            const [rel, text] = entry.split(": ");
            expect({ entry, used: texts(sources[rel] || "").some((x) => x.text === text) }).toEqual({ entry, used: true });
        }
        for (const rel of Object.keys(ALLOWED_FILES)) {
            expect({ rel, umlauts: texts(sources[rel] || "").some((x) => /[äöüÄÖÜß]/.test(x.text)) }).toEqual({ rel, umlauts: true });
        }
    });

    // The scan itself must see what it is meant to catch.
    it("would catch a German label, a German sentence in JSX and ignores comments", () => {
        const sample = [
            "// Früher stand hier „Schließen“",
            "const a = <p>Das ist nicht übersetzt</p>;",
            "const b = <Button label=\"Löschen\" />;",
            "const c = t(\"common.close\");",
        ].join("\n");
        const got = texts(sample);
        expect(got.some((x) => x.kind === "jsx" && GERMAN_WORD.test(x.text))).toBe(true);
        expect(got.some((x) => x.text === "Löschen")).toBe(true);
        expect(got.some((x) => /Früher|Schließen/.test(x.text))).toBe(false);
        expect(got.some((x) => x.text === "common.close")).toBe(false);
    });
});
