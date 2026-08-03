// Guards for the signup-status display in the Anwesenheit tab
// (src/web-client/src/pages/RaidDetailPage.tsx: SIGNUP_META/StatusIcon/NameList,
// components/icons.tsx, index.css).
//
// The TSX cannot be rendered here (no React test renderer in this project), so
// what is protected are the invariants behind the design decision:
//   * every status the backend can produce has a label, an icon and a colour —
//     a new status must not fall through to an unlabelled blank,
//   * the status is coded by an ICON, never by a tinted row background: the row
//     colour belongs to the WoW class and two colour systems would fight,
//   * every theme carries the status colours, so the light theme does not fall
//     back to grey icons,
//   * the "Reagiert" list stays grouped and both lists stay sorted.
const fs = require("fs");
const path = require("path");
const { SIGNUP_STATUSES } = require("../../src/utils/attendance");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...p) => fs.readFileSync(path.join(CLIENT, ...p), "utf8");
const page = read("pages", "RaidDetailPage.tsx");
const icons = read("components", "icons.tsx");
const css = read("index.css");

describe("signup status display", () => {
    it("knows every status the backend can send", () => {
        for (const status of SIGNUP_STATUSES) {
            expect(page).toMatch(new RegExp(`\\b${status}:\\s*\\{ label:`));
        }
        // ... and the client's own union type lists exactly those.
        const union = read("api.ts").match(/export type SignupStatus =([^;]+);/);
        expect(union).toBeTruthy();
        const declared = [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
        expect(declared.sort()).toEqual([...SIGNUP_STATUSES].sort());
    });

    it("renders each status through its own icon component", () => {
        for (const icon of ["SignedIcon", "TentativeIcon", "LateIcon", "BenchIcon", "AbsenceIcon"]) {
            expect(icons).toMatch(new RegExp(`export function ${icon}\\(`));
            expect(page).toContain(icon);
        }
    });

    it("gives every status a colour in every theme", () => {
        // The three palette blocks: :root (dark), the prefers-color-scheme one
        // and the explicit [data-theme="light"] — same split controls.test.js uses.
        const blocks = css.split(/\n(?=:root|@media|\S)/).filter((b) => b.includes("--accent:"));
        expect(blocks.length).toBe(3);
        for (const block of blocks) {
            for (const status of SIGNUP_STATUSES) {
                expect(block).toContain(`--sig-${status}:`);
            }
        }
    });

    it("codes the status by icon colour, not by a row background", () => {
        // .sig-<status> may only set the icon's colour variable.
        for (const status of SIGNUP_STATUSES) {
            const rule = css.match(new RegExp(`\\.sig-${status}\\s*\\{([^}]*)\\}`));
            expect(rule).toBeTruthy();
            expect(rule[1]).toMatch(/--sig-fg:/);
            expect(rule[1]).not.toMatch(/background/);
        }
    });

    it("groups the reacted list and sorts both lists", () => {
        expect(page).toMatch(/<NameList people=\{attendance\.responded\} grouped \/>/);
        expect(page).toMatch(/<NameList people=\{attendance\.missing\} \/>/);
        expect(page).toMatch(/function byLabel\(/);
        // Both the flat and the grouped branch run through the comparator.
        expect((page.match(/\.sort\(byLabel\)/g) || []).length).toBe(2);
    });

    it("orders the groups from attending to absent", () => {
        const order = page.match(/const SIGNUP_ORDER: SignupStatus\[\] = \[([^\]]+)\]/);
        expect(order).toBeTruthy();
        expect([...order[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]))
            .toEqual(["signed", "tentative", "late", "bench", "absence"]);
    });

    it("treats a person without a status as signed up, so nobody drops out", () => {
        expect(page).toMatch(/\(p\.status \|\| "signed"\)/);
    });
});
