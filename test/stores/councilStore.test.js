// Was der Council selbst über einen Raider festhält: wer nicht mehr eingeplant
// wird, und als was jemand eingeplant ist. Beides schreibt auf Platte, deshalb
// läuft der Test gegen ein echtes, danach wieder geleertes Verzeichnis.
const fs = require("fs");
const store = require("../../src/stores/councilStore");

afterEach(() => store.reset());

describe("stores/councilStore", () => {
    describe("wer nicht mehr eingeplant wird", () => {
        it("merkt sich Grund und Zeitpunkt, damit die Entscheidung lesbar bleibt", () => {
            const entry = store.exclude("Devihra", { reason: "Gilde verlassen", by: "Raidlead" });
            expect(entry).toMatchObject({ character: "Devihra", reason: "Gilde verlassen", by: "Raidlead" });
            expect(entry.at).toBeGreaterThan(0);
            expect(store.excludedKeys().has("devihra")).toBe(true);
        });

        it("nimmt jemanden wieder auf", () => {
            store.exclude("Devihra");
            expect(store.include("Devihra")).toBe(true);
            expect(store.excludedKeys().has("devihra")).toBe(false);
            // Zweimal aufnehmen ist kein Fehler, ändert aber nichts.
            expect(store.include("Devihra")).toBe(false);
        });
    });

    describe("als was jemand eingeplant ist", () => {
        it("hält die Festlegung samt Urheber fest", () => {
            const entry = store.setRole("Heala", "caster", { by: "Raidlead" });
            expect(entry).toMatchObject({ character: "Heala", role: "caster", by: "Raidlead" });
            expect(store.plannedRoles().get("heala")).toBe("caster");
        });

        it("nimmt sie mit einer leeren Rolle zurück", () => {
            store.setRole("Heala", "caster");
            expect(store.setRole("Heala", "")).toBeNull();
            // Danach folgt die Seite wieder dem, was die Daten sagen.
            expect(store.plannedRoles().has("heala")).toBe(false);
        });

        it("liest den Realm-Zusatz weg wie der Rest der App", () => {
            store.setRole("Heala-Thunderstrike", "healer");
            expect(store.plannedRoles().get("heala")).toBe("healer");
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
            expect(store.plannedRoles().get("heala")).toBe("caster");
            store.include("Heala");
            expect(store.plannedRoles().get("heala")).toBe("caster");
        });

        it("antwortet leer, solange nichts geschrieben wurde", () => {
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

    describe("ganze Listen", () => {
        it("gibt Ausgeschlossene als Objekt und als Schlüsselmenge", () => {
            store.exclude("Devihra-Thunderstrike", { reason: "Gilde verlassen" });
            store.exclude("Zweita");
            const all = store.listExcluded();
            expect(Object.keys(all).sort()).toEqual(["devihra", "zweita"]);
            expect(all.devihra).toMatchObject({ character: "Devihra-Thunderstrike", reason: "Gilde verlassen" });
            expect(store.excludedKeys()).toEqual(new Set(["devihra", "zweita"]));
        });

        it("gibt alle Rollen-Festlegungen samt Urheber", () => {
            store.setRole("Heala", "caster", { by: "Raidlead" });
            expect(store.listRoles()).toEqual({
                heala: expect.objectContaining({ character: "Heala", role: "caster", by: "Raidlead" }),
            });
        });

        it("ist ohne Einträge leer", () => {
            expect(store.listExcluded()).toEqual({});
            expect(store.excludedKeys().size).toBe(0);
            expect(store.listRoles()).toEqual({});
        });
    });

    describe("Ansicht je Kategorie", () => {
        it("gibt ohne gespeicherte Ansicht die Vorgaben der Seite", () => {
            expect(store.viewFor("c1")).toEqual({ role: "caster", tiers: [], contents: [], bisTier: "", version: "", stored: false });
            expect(store.viewFor("")).toMatchObject({ stored: false });
            expect(store.listViews()).toEqual({});
        });

        it("speichert die Ansicht einer Kategorie bereinigt und mit Urheber", () => {
            const entry = store.setView("c1", { role: "", tiers: ["t6", "t6", "<b>"], contents: ["bt"], bisTier: "t6", version: "tbc" }, { by: "Raidlead" });
            expect(entry).toMatchObject({ role: "", tiers: ["t6"], contents: ["bt"], bisTier: "t6", version: "tbc", by: "Raidlead" });
            expect(entry.at).toBeGreaterThan(0);
            // "" ist „Alle Rollen“ – keine fehlende Rolle.
            expect(store.viewFor("c1")).toEqual({ role: "", tiers: ["t6"], contents: ["bt"], bisTier: "t6", version: "tbc", stored: true });
            expect(Object.keys(store.listViews())).toEqual(["c1"]);
            expect(store.setView("", {})).toBeNull();
            store.reset();
            expect(fs.existsSync(store.VIEWS_FILE)).toBe(false);
        });

        it("fällt bei unbekannten Werten auf die Vorgaben zurück", () => {
            expect(store.normalizeView({ role: "tank", tiers: "t6", bisTier: "a b", version: 7 })).toEqual({
                role: "caster", tiers: [], contents: [], bisTier: "", version: "7",
            });
            expect(store.normalizeView(null)).toEqual({ role: "caster", tiers: [], contents: [], bisTier: "", version: "" });
        });
    });
});
