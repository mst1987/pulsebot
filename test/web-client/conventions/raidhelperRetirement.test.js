// Umstieg von Raid-Helper (#291) in Einstellungen → Verbindungen: the card's
// structure checked on the source — a compact line per item with the rest in
// tooltips, the switch only for full admins, the import as a dry run first,
// and the category list saying which categories still use Raid-Helper. The
// rules (lib/settings/raidhelperRetirement.ts) run in Vitest
// (src/web-client/src/lib/settings/raidhelperRetirement.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the profile's suggestion from Raid-Helper", () => {
    it("prefills only the manual way and says where it came from", () => {
        const dialog = read("components", "character", "AddCharacterDialog.tsx");
        expect(dialog).toContain("if (way === \"manual\") applySuggestion(firstVersion);");
        expect(dialog).toContain("t(\"profile.add.fromRaidhelper\")");
        expect(require("../clientSource").dictionary("de")["profile.add.fromRaidhelper"]).toBe("aus Raid-Helper");
        // #543: per game version — the dialog asks for the suggestion of the version it adds to
        expect(read("pages", "profile", "ProfilePage.tsx")).toContain("suggestionFor={(versionId) => specSuggestion(");
    });
});

describe("the card on the page", () => {
    const card = read("pages", "settings", "SettingsRaidhelperRetirement.tsx");
    const section = read("pages", "settings", "SettingsRaidhelperServer.tsx");
    const sections = read("lib", "settings", "settingsSections.ts");

    // #927: per server, in Server > Raid-Helper (full admins only), shown while Raid-Helper is on there
    it("sits in the per-server Raid-Helper section, for full admins only", () => {
        expect(sections).toContain(`{ id: "raidhelper", group: "server", icon: "inv_misc_note_06", adminOnly: true, standalone: true }`);
        expect(section).toContain("{current.enabled && <RaidhelperRetirementCard key={`ret-${round}`} />}");
        expect(read("pages", "settings", "SettingsConnections.tsx")).not.toContain("<RaidhelperRetirementCard");
    });

    it("is one line per item with the explanation in the label's tooltip, not in a paragraph", () => {
        expect(card).toContain("data-tip-sub={itemTip(item)}");
        expect(card).not.toMatch(/<p[\s>]/);
    });

    it("asks before switching and runs the import as a dry run first", () => {
        expect(card).toMatch(/await ask\(off \?/);
        expect(card).toContain("disabled={busy || !canStore}");
        expect(card).toContain("result.dryRun && result.summary.events > 0");
    });

    it("shows the categories still on Raid-Helper in the category list's head", () => {
        const matrix = read("pages", "settings", "CategoryMatrix.tsx");
        // the open card's tabs (CategoryDetail.tsx) pick the source with the same default
        const detail = read("pages", "settings", "CategoryDetail.tsx");
        expect(matrix).toContain("tParts(\"settings.categories.stillRh\", { count: stillRaidhelper.length })");
        expect(require("../clientSource").dictionary("de")["settings.categories.stillRh"]).toBe("{count} noch Raid-Helper");
        expect(matrix).toContain("categorySignupSource[r.id] || signupSourceDefault");
        expect(detail).toContain("(s.categorySignupSource || {})[cat.id] || s.signupSourceDefault");
        expect(matrix + detail).not.toContain("categorySignupSource[cat.id] || \"raidhelper\"");
    });
});
