// Phase 1 of the web menu in two languages: the shell, the dashboard, the raid
// pages (list, detail with cockpit, create dialog, manage dialogs, setup editor),
// the signups and "Mein Profil" read every text through t(). This scan is the
// guard that keeps it so — deliberately small and quiet rather than clever:
//
//   * no string literal and no JSX text in these files carries an umlaut or ß —
//     English and the brand/game names never need one, German nearly always does;
//   * no JSX text between two tags reads like a German phrase (two or more words
//     with a German marker word).
//
// Comments are stripped first, so a comment may quote the old German text.
// Anything that is really meant to stay (a proper name) goes into ALLOWED with
// the reason next to it. Phase 2 (other pages, API error texts, report pages)
// is not scanned yet.
const fs = require("fs");
const path = require("path");
const { CLIENT, stripComments } = require("../clientSource");

const PHASE1 = [
    "App.tsx",
    "components/Shell.tsx", "components/LangToggle.tsx", "components/ThemeToggle.tsx", "components/GuildSwitcher.tsx",
    "pages/DashboardPage.tsx", "components/OverviewParts.tsx",
    "pages/RaidsPage.tsx", "components/RaidList.tsx", "components/RaidTable.tsx", "components/RaidIcon.tsx",
    "pages/RaidCreatePage.tsx", "components/RaidCreateDialog.tsx", "components/RaidPlanFields.tsx", "components/CompositionEditor.tsx",
    "components/channels/NamingBadge.tsx",
    "pages/RaidDetailPage.tsx", "pages/raid-detail",
    "pages/SignupsPage.tsx", "components/SignupDialog.tsx", "components/BulkSignupDialog.tsx",
    "components/SignupCharacterPicks.tsx", "components/SpecPicker.tsx", "components/ClassSpec.tsx",
    "pages/profile/ProfilePage.tsx", "components/profile",
    "components/LootTable.tsx", "components/ui",
    "lib/eventManage.ts", "lib/eventPlan.ts", "lib/raidSteps.ts", "lib/raidTemplates.ts", "lib/setupEditor.ts",
    "lib/signups.ts", "lib/signupPicks.ts", "lib/raidIcons.ts", "lib/logRaids.ts", "lib/raidTime.ts",
    "lib/overviewDates.ts", "lib/format.ts", "lib/wowNames.ts",
];

// Literals that may keep an umlaut: none so far. Add "file: text" with a reason.
const ALLOWED = new Set([]);

const GERMAN_WORD = /\b(und|nicht|der|die|das|ist|mit|für|oder|kein|keine|noch|wird|werden|auf|zum|zur|dem|den|ein|eine|einen|bitte|wählen|hinzufügen|entfernen|speichern|abbrechen|löschen|schließen)\b/i;

function files() {
    const out = [];
    for (const rel of PHASE1) {
        const full = path.join(CLIENT, rel);
        if (fs.statSync(full).isDirectory()) {
            for (const entry of fs.readdirSync(full, { recursive: true })) {
                // a test spells out the German texts it expects; it is not the app
                if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path.join(rel, entry).replace(/\\/g, "/"));
            }
        } else out.push(rel);
    }
    return out;
}

/** String literals ("…", `…` without their ${} parts) and JSX text of one source, comments stripped. */
function texts(src) {
    const code = stripComments(src.replace(/\r\n/g, "\n"))
        // translation keys are not texts
        .replace(/\bt(Or)?\(\s*"[^"]*"/g, "t(");
    const out = [];
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)) {
        out.push({ kind: "string", text: (m[1] !== undefined ? m[1] : m[2].replace(/\$\{[^}]*\}/g, " ")) });
    }
    const noStrings = code.replace(/"(?:[^"\\\n]|\\.)*"|`[^`]*`/g, "\"\"");
    for (const m of noStrings.matchAll(/>([^<>{}=;()]*[A-Za-zÄÖÜäöüß][^<>{}=;()]*)</g)) {
        out.push({ kind: "jsx", text: m[1].trim() });
    }
    return out;
}

describe("i18n phase 1: no hard-coded German left", () => {
    const list = files();

    it("scans a real set of files", () => {
        expect(list.length).toBeGreaterThan(50);
        expect(list).toEqual(expect.arrayContaining(["pages/profile/ProfilePage.tsx", "pages/raid-detail/RosterTab.tsx", "components/SignupDialog.tsx"]));
    });

    it("has no umlaut or ß in a string or JSX text", () => {
        const found = [];
        for (const rel of list) {
            for (const { text } of texts(fs.readFileSync(path.join(CLIENT, rel), "utf8"))) {
                if (/[äöüÄÖÜß]/.test(text) && !ALLOWED.has(`${rel}: ${text}`)) found.push(`${rel}: ${text.slice(0, 80)}`);
            }
        }
        expect(found).toEqual([]);
    });

    it("has no German phrase as JSX text", () => {
        const found = [];
        for (const rel of list) {
            for (const { kind, text } of texts(fs.readFileSync(path.join(CLIENT, rel), "utf8"))) {
                if (kind === "jsx" && text.split(/\s+/).length >= 2 && GERMAN_WORD.test(text)) found.push(`${rel}: ${text.slice(0, 80)}`);
            }
        }
        expect(found).toEqual([]);
    });

    // The scan itself must see what it is meant to catch.
    it("would catch a German label, a German sentence in JSX and ignores comments", () => {
        const sample = [
            "// Früher stand hier „Schließen“",
            "const a = <p>Das ist nicht übersetzt</p>;",
            "const b = <Button label=\"Löschen\" />;",
            "const c = t(\"common.close\");",
        ].join("\n");
        const got = texts(sample);
        expect(got.some((x) => x.kind === "jsx" && GERMAN_WORD.test(x.text))).toBe(true);
        expect(got.some((x) => x.text === "Löschen")).toBe(true);
        expect(got.some((x) => /Früher|Schließen/.test(x.text))).toBe(false);
        expect(got.some((x) => x.text === "common.close")).toBe(false);
    });
});
