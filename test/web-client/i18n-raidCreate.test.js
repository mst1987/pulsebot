// The "Neues Raid-Event" dialog and the shared raid-plan fields in two
// languages (namespaces raidCreate + raidPlan): the German literals moved into
// the dictionaries, the files translate at render time, and the English texts
// read like English.
const { makeT, read, stripComments } = require("./i18nHelper");

const FILES = {
    dialog: "components/RaidCreateDialog.tsx",
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
        for (const f of ["dialog", "fields", "comp"]) expect(src[f]).toContain("import { useT } from \"../i18n\";");
        for (const f of ["plan", "templates"]) expect(src[f]).toContain("import { t } from \"../i18n\";");
        expect(src.plan).not.toContain("STEP_LABELS");
    });

    it("never translates at module top level", () => {
        for (const [file, text] of Object.entries(src)) {
            const bad = text.split("\n").filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ file, bad }).toEqual({ file, bad: [] });
        }
    });

    it("keeps German unchanged and reads naturally in English", () => {
        const de = makeT("de");
        const en = makeT("en");
        expect(de("raidCreate.footer.titleNew")).toBe("Neues Raid-Event");
        expect(en("raidCreate.footer.titleNew")).toBe("New raid event");
        expect(de("raidCreate.toast.templateCreated", { name: "Kara" })).toBe("Vorlage „Kara“ angelegt.");
        expect(en("raidCreate.footer.stepOf", { n: 2, total: 5 })).toBe("Step 2 of 5");
        expect(en("raidCreate.start.players", { count: 25 })).toBe("25 players");
        expect(en("raidPlan.step.check")).toBe("Review");
        expect(en("raidPlan.comp.dpsLine", { count: 1 })).toBe("1 spot for DPS · suggestion on size change");
        expect(en("raidPlan.problem.maxOverSize", { label: en("wow.role.melee"), size: 10 })).toBe("Melee: maximum is greater than the size 10.");
        expect([...de.missing, ...en.missing]).toEqual([]);
    });
});
