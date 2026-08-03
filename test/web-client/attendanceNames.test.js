// Guards for the Anwesenheit name lists (src/web-client/src/pages/RaidDetailPage.tsx,
// NameList).
//
// NameList is TSX and there is no React test renderer in this project, so what
// is checked here is the invariant that regressed once and reads as a cosmetic
// detail in a diff: the list used to render "DiscordName (Charname)", which is
// noise as soon as the character is known. The character name must win the
// label outright, with the Discord name demoted to the tooltip.
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(
    __dirname, "..", "..", "src", "web-client", "src", "pages", "RaidDetailPage.tsx",
);
const src = fs.readFileSync(SOURCE, "utf8");

/** The body of a component, up to the next top-level declaration. */
function componentBody(name) {
    const start = src.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const end = rest.indexOf("\nfunction ");
    return end === -1 ? rest : rest.slice(0, end);
}

describe("attendance name lists", () => {
    // The naming lives in PersonBox, the one chip both lists render through.
    const body = componentBody("PersonBox");

    it("labels a person by their character name when one is known", () => {
        expect(body).toMatch(/const label = p\.character \|\| discordName;/);
    });

    it("never appends the character to the Discord name again", () => {
        expect(body).not.toMatch(/\(\$\{p\.character\}\)/);
        expect(body).not.toMatch(/displayName \|\| p\.id\) \+/);
    });

    it("keeps the Discord name reachable in the tooltip", () => {
        expect(body).toMatch(/const title = \[[\s\S]*?p\.character \? discordName/);
        // Both branches (with and without a class/spec profile) carry it.
        expect(body.match(/title=\{title\}/g) || []).toHaveLength(2);
    });

    it("falls back to the Discord name when no character is assigned", () => {
        expect(body).toMatch(/const discordName = p\.displayName \|\| p\.id;/);
    });
});
