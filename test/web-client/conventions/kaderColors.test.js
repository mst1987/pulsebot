// The Kaderplaner's answer colours (docs/kaderplaner.md, "Answer colours"): the
// palette the client hands out (lib/kader/colors.ts) is the one the server
// accepts (kaderModel.js OPTION_COLORS), every colour has a token in the dark
// root and in both light blocks of tokens.css and a [data-opt] mapping in
// kader.css, and the weekday mapping is shared with the raider profile (one
// place, the values in tokens.css). How the page uses them is rendered in
// src/web-client/src/pages/kader/KaderPage.test.tsx.
const { read } = require("../clientSource");
const { OPTION_COLORS } = require("../../../src/services/kader/kaderModel");

const colors = read("lib", "kader", "colors.ts");
const tokens = read("styles", "tokens.css");
const kader = read("styles", "kader.css");
const shared = read("styles", "shared.css");

/** The three theme blocks of tokens.css: dark root, the OS light preference, the light toggle. */
function themeBlocks() {
    const lightOs = tokens.indexOf("@media (prefers-color-scheme: light)");
    const lightToggle = tokens.indexOf(":root[data-theme=\"light\"] {");
    return [tokens.slice(0, lightOs), tokens.slice(lightOs, lightToggle), tokens.slice(lightToggle)];
}

describe("Kaderplaner answer colours", () => {
    it("hands out exactly the palette the server accepts, in the same order", () => {
        const list = colors.match(/export const OPTION_COLORS = \[([^\]]+)\] as const;/);
        expect(list).not.toBeNull();
        expect(JSON.parse(`[${list[1]}]`)).toEqual(OPTION_COLORS);
    });

    it("has a token for every colour in dark and in both light blocks, and maps it in kader.css", () => {
        for (const block of themeBlocks()) {
            for (const c of OPTION_COLORS) expect(block).toMatch(new RegExp(`--opt-${c}: #[0-9a-f]{6};`));
        }
        for (const c of OPTION_COLORS) expect(kader).toContain(`[data-opt="${c}"] { --tone: var(--opt-${c}); }`);
    });

    it("takes the weekday colours from the one shared mapping, not a copy", () => {
        for (const day of ["mo", "di", "mi", "do", "fr", "sa", "so"]) {
            expect(shared).toContain(`[data-day="${day}"] { --day: var(--day-${day}); --day-dark: var(--day-${day}-dark); }`);
            expect(kader).not.toContain(`[data-day="${day}"]`);
            expect(read("styles", "profil.css")).not.toContain(`[data-day="${day}"]`);
        }
        expect(kader).toMatch(/\.kp-week i\[data-day\][^{]*\{ --tone: var\(--day\); \}/);
    });

    it("keeps the label's colour: chips and picked pills tint, the text stays --text", () => {
        expect(kader).toMatch(/\.kp-ochip \{[^}]*color: var\(--text\);/);
        expect(kader).toMatch(/\.kp-pill\.kp-on\[data-opt\], \.kp-pill\.kp-on\[data-day\] \{[^}]*color: var\(--text\);/);
    });
});
