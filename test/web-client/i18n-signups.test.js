// The "signups" namespace (#i18n): the signup page, its dialogs, the character
// picks, the spec picker and lib/signups.ts read their texts from
// i18n/locales/<lang>/signups.json instead of German literals.
const fs = require("fs");
const path = require("path");
const { makeT } = require("./i18nHelper");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (rel) => fs.readFileSync(path.join(CLIENT, rel), "utf8").replace(/\r\n/g, "\n");

const FILES = [
    "pages/SignupsPage.tsx",
    "components/SignupDialog.tsx",
    "components/BulkSignupDialog.tsx",
    "components/SignupCharacterPicks.tsx",
    "components/SpecPicker.tsx",
    "lib/signups.ts",
];
const src = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const de = makeT("de");
const en = makeT("en");

describe("signups namespace", () => {
    it("no longer carries the moved German literals", () => {
        const moved = {
            "pages/SignupsPage.tsx": ["Kommende Raids werden geladen", "Alle wählen", "Auswahl aufheben", "Klick zum Ändern"],
            "components/SignupDialog.tsx": ["Anmeldung ändern", "Öffentliche Event-Seite","In Kalender eintragen"],
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
        // the status table keeps its labels behind getters, read at render time
        expect(src["lib/signups.ts"]).toContain("get label() { return t(\"signups.status.signed\"); }");
        expect(src["lib/signups.ts"]).toContain("get none() { return t(\"signups.gear.none\"); }");
    });

    it("keeps the German texts and reads naturally in English", () => {
        expect(de("signups.page.upcoming", { count: 1 })).toBe("1 kommender Raid");
        expect(de("signups.page.upcoming", { count: 3 })).toBe("3 kommende Raids");
        expect(de("signups.bulk.signUpAll", { count: 1 })).toBe("Für 1 Raids anmelden");
        expect(en("signups.bulk.signUpAll", { count: 1 })).toBe("Sign up for 1 raid");
        expect(en("signups.selectedCount", { count: 2 })).toBe("2 raids selected");
        expect(en("signups.status.bench")).toBe("Bench");
        expect(en("signups.dialog.wishSignedUp", { count: 1, names: "Zibbo" })).toBe("Zibbo is signed up too");
        expect(en("signups.specPicker.add")).toBe("Add spec");
    });
});
