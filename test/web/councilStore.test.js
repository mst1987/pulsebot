// Was der Council selbst über einen Raider festhält: wer nicht mehr eingeplant
// wird, und als was jemand eingeplant ist. Beides schreibt auf Platte, deshalb
// läuft der Test gegen ein echtes, danach wieder geleertes Verzeichnis.
const fs = require("fs");
const store = require("../../src/web/councilStore");

afterEach(() => store.reset());

describe("web/councilStore", () => {
    describe("wer nicht mehr eingeplant wird", () => {
        it("merkt sich Grund und Zeitpunkt, damit die Entscheidung lesbar bleibt", () => {
            const entry = store.exclude("Devihra", { reason: "Gilde verlassen", by: "Raidlead" });
            expect(entry).toMatchObject({ character: "Devihra", reason: "Gilde verlassen", by: "Raidlead" });
            expect(entry.at).toBeGreaterThan(0);
            expect(store.isExcluded("devihra-Thunderstrike")).toBe(true);
        });

        it("nimmt jemanden wieder auf", () => {
            store.exclude("Devihra");
            expect(store.include("Devihra")).toBe(true);
            expect(store.isExcluded("Devihra")).toBe(false);
            // Zweimal aufnehmen ist kein Fehler, ändert aber nichts.
            expect(store.include("Devihra")).toBe(false);
        });
    });

    describe("als was jemand eingeplant ist", () => {
        it("hält die Festlegung samt Urheber fest", () => {
            const entry = store.setRole("Heala", "caster", { by: "Raidlead" });
            expect(entry).toMatchObject({ character: "Heala", role: "caster", by: "Raidlead" });
            expect(store.plannedRole("heala")).toBe("caster");
        });

        it("nimmt sie mit einer leeren Rolle zurück", () => {
            store.setRole("Heala", "caster");
            expect(store.setRole("Heala", "")).toBeNull();
            // Danach folgt die Seite wieder dem, was die Daten sagen.
            expect(store.plannedRole("Heala")).toBe("");
        });

        it("liest den Realm-Zusatz weg wie der Rest der App", () => {
            store.setRole("Heala-Thunderstrike", "healer");
            expect(store.plannedRole("heala")).toBe("healer");
        });

        it("gibt den ganzen Satz als Map für einen Durchlauf", () => {
            store.setRole("Heala", "caster");
            store.setRole("Zweita", "healer");
            const roles = store.plannedRoles();
            expect(roles.get("heala")).toBe("caster");
            expect(roles.get("zweita")).toBe("healer");
            expect(roles.size).toBe(2);
        });

        it("ist von der Ausschlussliste unabhängig", () => {
            // Zwei verschiedene Entscheidungen über denselben Raider — die eine
            // darf die andere nicht mitnehmen.
            store.setRole("Heala", "caster");
            store.exclude("Heala");
            expect(store.plannedRole("Heala")).toBe("caster");
            store.include("Heala");
            expect(store.plannedRole("Heala")).toBe("caster");
        });

        it("antwortet leer, solange nichts geschrieben wurde", () => {
            expect(store.plannedRole("Niemand")).toBe("");
            expect(store.plannedRoles().size).toBe(0);
            expect(store.setRole("", "caster")).toBeNull();
        });
    });

    it("räumt beide Dateien wieder ab", () => {
        store.exclude("Devihra");
        store.setRole("Heala", "caster");
        store.reset();
        expect(fs.existsSync(store.EXCLUDED_FILE)).toBe(false);
        expect(fs.existsSync(store.ROLES_FILE)).toBe(false);
    });
});
