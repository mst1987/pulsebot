// Where the language switch is wired (#435: the structural half of the former
// test/web-client/i18n.test.js). The core, the dictionaries and the keys the
// client asks for are tested in Vitest (src/web-client/src/i18n/core.test.ts),
// the switch itself in components/LangToggle.test.tsx.
const { read } = require("../clientSource");

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
});
