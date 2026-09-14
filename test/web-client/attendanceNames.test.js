// Guards for the names in the Raid-Detail roster (src/web-client/src/pages/raid-detail/
// meta.ts personLabel/personRef, RosterTab.tsx PersonChip).
//
// There is no React test renderer in this project, so what is checked is the
// invariant that regressed once and reads as a cosmetic detail in a diff: the
// list used to render "DiscordName (Charname)", which is noise as soon as the
// character is known. The character name must win the label outright, with the
// Discord name demoted to the tooltip and the player dialog.
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "src", "web-client", "src", "pages", "raid-detail");
const meta = fs.readFileSync(path.join(DIR, "meta.ts"), "utf8");
const roster = fs.readFileSync(path.join(DIR, "RosterTab.tsx"), "utf8");

/** The body of a function, up to the next top-level declaration. */
function fnBody(src, name) {
    const start = src.search(new RegExp(`function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const end = rest.search(/\n(export )?(default )?function /);
    return end === -1 ? rest : rest.slice(0, end);
}

describe("attendance names", () => {
    it("labels a person by their character name when one is known", () => {
        expect(fnBody(meta, "personLabel")).toContain("return p.character || p.displayName || p.id;");
    });

    it("never appends the character to the Discord name again", () => {
        for (const src of [meta, roster]) {
            expect(src).not.toMatch(/\(\$\{p\.character\}\)/);
            expect(src).not.toMatch(/displayName \|\| p\.id\) \+/);
        }
    });

    it("keeps the Discord name reachable in the tooltip and the player dialog", () => {
        const chip = fnBody(roster, "PersonChip");
        expect(chip).toContain("const label = personLabel(p);");
        expect(chip).toMatch(/p\.character \? `@\$\{discordName\}`/);
        expect(chip).toContain("data-tip={label} data-tip-sub={tipSub || undefined}");
        expect(fnBody(meta, "personRef")).toContain("discordName: p.character ? (p.displayName || p.id) : undefined");
    });

    it("falls back to the Discord name when no character is assigned", () => {
        const chip = fnBody(roster, "PersonChip");
        expect(chip).toContain("const discordName = p.displayName || p.id;");
        expect(chip).toContain("{!p.character && <Badge>kein Charakter</Badge>}");
    });
});
