// The "signups" namespace (#i18n): the signup page, its dialogs, the character
// picks, the spec picker and lib/signups.ts read their texts from
// i18n/locales/<lang>/signups.json instead of German literals (#435: the source
// half of the former test/web-client/i18n-signups.test.js; the texts and the
// labels following a language switch are tested in
// src/web-client/src/i18n/signups.test.ts).
const { read } = require("../clientSource");

const FILES = [
    "pages/SignupsPage.tsx",
    "components/SignupDialog.tsx",
    "components/BulkSignupDialog.tsx",
    "components/SignupCharacterPicks.tsx",
    "components/SpecPicker.tsx",
    "lib/signups.ts",
];
const src = Object.fromEntries(FILES.map((f) => [f, read(f)]));

describe("signups namespace", () => {
    it("no longer carries the moved German literals", () => {
        const moved = {
            "pages/SignupsPage.tsx": ["Kommende Raids werden geladen", "Alle wählen", "Auswahl aufheben", "Klick zum Ändern"],
            "components/SignupDialog.tsx": ["Anmeldung ändern", "Öffentliche Event-Seite", "In Kalender eintragen"],
            "components/BulkSignupDialog.tsx": ["nicht gespeichert", "Warteliste"],
            "components/SignupCharacterPicks.tsx": ["kein Spec im Profil", "Nach oben"],
            "components/SpecPicker.tsx": ["Spec hinzufügen", "Keine Treffer."],
            "lib/signups.ts": ["\"Dabei\"", "\"Offtank\"", "raidbereit", "über Raid-Helper"],
        };
        for (const [file, literals] of Object.entries(moved)) {
            for (const literal of literals) expect(src[file]).not.toContain(literal);
        }
    });

    it("imports the translation function everywhere", () => {
        for (const file of FILES) {
            if (file.startsWith("lib/")) expect(src[file]).toContain("import { t } from \"../i18n\";");
            else expect(src[file]).toMatch(/import \{ useT \} from "\.\.\/i18n";/);
        }
    });

    it("never translates at module load", () => {
        for (const file of FILES) {
            for (const line of src[file].split("\n")) expect(line).not.toMatch(/^(export )?const \w+[^=]*= [^(]*\bt\(/);
        }
    });
});
