// Guards for "Mein Profil" (#255). The client is TSX without a React test
// renderer, so these are source scans of the invariants that break silently:
// the page stays calm (folded parts, one head action), the three ways to add a
// character sit in one dialog, the wishes are marked as orga-only, and the
// route is open to the "signup" area only.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "ProfilePage.tsx");
const dialog = read("components", "profile", "AddCharacterDialog.tsx");
const app = read("App.tsx");
const api = read("api.ts");
const roster = read("pages", "RosterPage.tsx");
const css = read("styles", "profil.css");

describe("ProfilePage", () => {
    it("is routed under /profile for the signup area and listed in the menu", () => {
        expect(app).toMatch(/<Route path="profile" element=\{<Guard user=\{user\} areas=\{\["signup"\]\}><ProfilePage \/><\/Guard>\} \/>/);
        const { MENU } = require("../../src/config/menu");
        expect(MENU.find((e) => e.id === "profile")).toMatchObject({ href: "/profile", areas: ["signup"] });
    });

    it("uses the shared building blocks and its own stylesheet", () => {
        expect(page).toMatch(/<PageHead[\s\S]*tone="profile"/);
        expect(page).toContain("import \"../styles/profil.css\";");
        expect(page).not.toContain("<div className=\"empty\">Lade");
        for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || []) {
            expect(sel).toMatch(/^\.(pf-|wi$|kicker$|part-head$|ph-act$|field$|is-|switch)/);
        }
    });

    it("folds availability, raids, wishes and note so only one part is open at a time", () => {
        const folds = [...page.matchAll(/<FoldPart\s+id="(\w+)"/g)].map((m) => m[1]);
        expect(folds).toEqual(["days", "raids", "wishes", "note"]);
        expect(page).toMatch(/const isOpen = open === id;/);
        expect(page).toMatch(/\{isOpen && <div className="pf-fold-body">/);
    });

    it("shows the gear level as a segment and the log evidence as a badge with a tooltip", () => {
        expect(page).toMatch(/<Segment<GearLevel>[\s\S]*data\.gearLevels\.map/);
        expect(page).toMatch(/<Badge tone=\{logs\.tone\} tip=\{logs\.label\} tipSub=/);
        expect(page).toContain("laut Logs");
    });

    it("marks the wishes as visible to the orga only and never shows whether one is mutual", () => {
        expect(page).toContain("nur Orga");
        expect(page).not.toMatch(/mutual|gegenseitig/);
    });

    it("warns about a character another account claimed instead of hiding it", () => {
        expect(page).toContain("claimedBy.length > 0");
        expect(page).toContain("vergeben an");
    });

    it("offers the three ways in one dialog", () => {
        expect(dialog).toMatch(/value: "log"[\s\S]*value: "armory"[\s\S]*value: "manual"/);
        expect(dialog).toContain("Das bin ich");
        expect(dialog).toContain("class_required");
        expect(page).toContain("<AddCharacterDialog");
    });

    it("talks to the profile endpoints only", () => {
        for (const p of ["/api/profile\"", "/api/profile/log-characters", "/api/profile/characters", "/api/profile/raiders", "/api/roster/character-claims"]) {
            expect(api).toContain(p);
        }
        expect(api).toMatch(/send\("PUT", "\/api\/profile"/);
    });
});

describe("Roster hint", () => {
    it("shows double-claimed characters as one badge with the list in its tooltip", () => {
        expect(roster).toContain("getCharacterClaims()");
        expect(roster).toMatch(/function ClaimsBadge[\s\S]*<Badge[\s\S]*tone="mid"[\s\S]*tipSub=/);
        expect(roster).toContain("{claims.length > 0 && <div className=\"ph-meta\"><ClaimsBadge claims={claims} /></div>}");
    });
});
