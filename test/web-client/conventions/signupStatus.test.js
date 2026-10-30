// The colours behind the signup-status word of the Raid-Detail roster (#219,
// design pilot C: a word instead of a dot): every status has its rule in
// styles/raid-detail.css, and every theme carries the colours the word uses
// (#435: the CSS half of the former
// test/web-client/signupStatus.test.js; the display itself is tested in
// src/web-client/src/pages/raid-detail/__tests__/RosterTab.test.tsx and meta.test.ts).
const { read } = require("../clientSource");
const { SIGNUP_STATUSES } = require("../../../src/utils/attendance");

describe("signup status colours", () => {
    it("names a maybe in the raid groups as a word in every theme's status colour", () => {
        const css = read("index.css");
        const pageCss = read("styles/raid-detail.css");
        for (const status of ["tentative", "late", "bench", "absence"]) {
            expect(pageCss).toMatch(new RegExp(`\\.rd-pstat-${status} \\{ color: var\\(--sig-${status}\\); \\}`));
        }
        // The three palette blocks: :root (dark), the prefers-color-scheme one
        // and the explicit [data-theme="light"].
        const blocks = css.split(/\n(?=:root|@media|\S)/).filter((b) => b.includes("--accent:") && !b.includes("data-version"));
        expect(blocks.length).toBe(3);
        for (const block of blocks) {
            for (const status of SIGNUP_STATUSES) expect(block).toContain(`--sig-${status}:`);
        }
    });
});
