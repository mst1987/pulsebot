// Umstieg von Raid-Helper (#291) in Einstellungen → Verbindungen: the card's
// structure checked on the source — a compact line per item with the rest in
// tooltips, the switch only for full admins, the import as a dry run first,
// and the category list saying which categories still use Raid-Helper. The
// rules (lib/raidhelperRetirement.ts) run in Vitest
// (src/web-client/src/lib/raidhelperRetirement.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the profile's suggestion from Raid-Helper", () => {
    it("prefills only the manual way and says where it came from", () => {
        const dialog = read("components", "profile", "AddCharacterDialog.tsx");
        expect(dialog).toContain("if (way === \"manual\") applySuggestion();");
        expect(dialog).toContain("t(\"profile.add.fromRaidhelper\")");
        expect(require("../clientSource").dictionary("de")["profile.add.fromRaidhelper"]).toBe("aus Raid-Helper");
        expect(read("pages", "profile", "ProfilePage.tsx")).toContain("suggestion={specSuggestion(data.specHistory)}");
    });
});

describe("the card on the page", () => {
    const card = read("pages", "settings", "SettingsRaidhelperRetirement.tsx");
    const connections = read("pages", "settings", "SettingsConnections.tsx");

    it("sits under the connection cards, for full admins only", () => {
        expect(connections).toContain("{data.canManageAccess && <RaidhelperRetirementCard />}");
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
        expect(matrix).toContain("noch Raid-Helper");
        expect(matrix).toContain("categorySignupSource[cat.id] || signupSourceDefault");
        expect(matrix).not.toContain("categorySignupSource[cat.id] || \"raidhelper\"");
    });
});
