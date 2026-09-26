// The "Neues Raid-Event" dialog and the shared raid-plan fields in two
// languages (namespaces raidCreate + raidPlan): the German literals moved into
// the dictionaries and the files translate at render time (#435: the source
// half of the former test/web-client/i18n-raidCreate.test.js; how the texts
// read is tested in src/web-client/src/i18n/raidCreate.test.ts).
const { read, stripComments } = require("../clientSource");

const FILES = {
    // the dialog, its steps and its state (components/raid-create/, #438)
    dialog: "components/raid-create",
    fields: "components/RaidPlanFields.tsx",
    comp: "components/CompositionEditor.tsx",
    plan: "lib/eventPlan.ts",
    templates: "lib/raidTemplates.ts",
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]));
const code = Object.fromEntries(Object.entries(src).map(([k, s]) => [k, stripComments(s)]));

describe("i18n: raidCreate / raidPlan", () => {
    it("no longer holds the moved German literals", () => {
        const gone = {
            dialog: ["Wovon ausgehen?", "Leer beginnen", "Event-Leiter (Discord-User-ID)", "Neue Vorlage", "Beim Anlegen ankündigen", "Anmeldeschluss", "Neues Raid-Event", "Event angelegt."],
            fields: ["Instanzen", "Raidgröße", "Pflicht-Buffs", "Zurücksetzen", "Gruppen-Buff"],
            comp: ["für DPS", "Heiler"],
            plan: ["Kanal & Anmeldung", "voll: Warteliste (Bank)", "Die Raidgröße muss"],
            templates: ["Name fehlt.", "Standard für", "Die Bild-Adresse muss"],
        };
        for (const [file, literals] of Object.entries(gone)) {
            for (const lit of literals) expect({ file, lit, found: code[file].includes(lit) }).toEqual({ file, lit, found: false });
        }
    });

    it("imports useT in the components and t in the libs", () => {
        expect(src.dialog).toContain("import { useT } from \"../../i18n\";");
        for (const f of ["fields", "comp"]) expect(src[f]).toContain("import { useT } from \"../i18n\";");
        for (const f of ["plan", "templates"]) expect(src[f]).toContain("import { t } from \"../i18n\";");
        expect(src.plan).not.toContain("STEP_LABELS");
    });

    it("never translates at module top level", () => {
        for (const [file, text] of Object.entries(src)) {
            const bad = text.split("\n").filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ file, bad }).toEqual({ file, bad: [] });
        }
    });
});
