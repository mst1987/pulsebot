// Guards for the signup-status display in the Raid-Detail roster
// (src/web-client/src/pages/raid-detail/meta.ts SIGNUP_META, RosterTab.tsx,
// styles/raid-detail.css, index.css).
//
// The TSX cannot be rendered here (no React test renderer in this project), so
// what is protected are the invariants behind the design decision (#219):
//   * every status the backend can produce has a label and a tone — a new
//     status must not fall through to an unlabelled blank,
//   * the status is a Badge (ok / mid / bad), no longer a line icon, and in the
//     raid groups a small dot — the tile and the name belong to the WoW class,
//   * every theme carries the status colours the dot uses,
//   * both lists stay sorted, and a person without a status counts as signed.
const fs = require("fs");
const path = require("path");
const { SIGNUP_STATUSES } = require("../../src/utils/attendance");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...p) => fs.readFileSync(path.join(CLIENT, ...p), "utf8");
const meta = read("pages", "raid-detail", "meta.ts");
const roster = read("pages", "raid-detail", "RosterTab.tsx");
const css = read("index.css");
const pageCss = read("styles", "raid-detail.css");

describe("signup status display", () => {
    it("knows every status the backend can send", () => {
        for (const status of SIGNUP_STATUSES) {
            expect(meta).toMatch(new RegExp(`\\b${status}:\\s*\\{ label:`));
        }
        // ... and the client's own union type lists exactly those.
        const union = read("api.ts").match(/export type SignupStatus =([^;]+);/);
        expect(union).toBeTruthy();
        const declared = [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
        expect(declared.sort()).toEqual([...SIGNUP_STATUSES].sort());
    });

    it("gives signed, maybe and absent their badge tone", () => {
        expect(meta).toContain("signed: { label: \"Angemeldet\", tone: \"ok\" }");
        expect(meta).toContain("tentative: { label: \"Unsicher\", tone: \"mid\" }");
        expect(meta).toContain("late: { label: \"Kommt später\", tone: \"mid\" }");
        expect(meta).toContain("absence: { label: \"Abgemeldet\", tone: \"bad\" }");
    });

    it("shows the status as a badge instead of a line icon", () => {
        for (const icon of ["SignedIcon", "TentativeIcon", "LateIcon", "BenchIcon", "AbsenceIcon"]) {
            expect(roster).not.toContain(icon);
        }
        expect(roster).toContain("<Badge tone={SIGNUP_META[status].tone}>{SIGNUP_META[status].label}</Badge>");
        expect(roster).toContain("<Badge tone=\"bad\">{missing.length} ohne Reaktion</Badge>");
    });

    it("marks a maybe in the raid groups with a dot in every theme's status colour", () => {
        expect(roster).toContain("className={`rd-sig rd-sig-${status}`}");
        for (const status of ["tentative", "late", "bench", "absence"]) {
            expect(pageCss).toMatch(new RegExp(`\\.rd-sig-${status} \\{ background: var\\(--sig-${status}\\); \\}`));
        }
        // The three palette blocks: :root (dark), the prefers-color-scheme one
        // and the explicit [data-theme="light"].
        const blocks = css.split(/\n(?=:root|@media|\S)/).filter((b) => b.includes("--accent:"));
        expect(blocks.length).toBe(3);
        for (const block of blocks) {
            for (const status of SIGNUP_STATUSES) expect(block).toContain(`--sig-${status}:`);
        }
    });

    it("sorts both lists and orders the statuses from attending to absent", () => {
        expect(roster).toContain("[...attendance.missing].sort(byLabel)");
        expect(roster).toMatch(/notInSetup = responded\.filter\([\s\S]*?\.sort\(byLabel\)/);
        const order = meta.match(/export const SIGNUP_ORDER: SignupStatus\[\] = \[([^\]]+)\]/);
        expect(order).toBeTruthy();
        expect([...order[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]))
            .toEqual(["signed", "tentative", "late", "bench", "absence"]);
    });

    it("treats a person without a status as signed up, so nobody drops out", () => {
        expect(roster).toMatch(/\(p\.status \|\| "signed"\)/);
    });
});
