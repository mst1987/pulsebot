// Das eigene Raider-Profil (#255). Schreibt auf Platte – in eine eigene Datei
// im Temp-Verzeichnis, damit parallel laufende Suites sich nichts teilen.
const store = require("../../src/stores/raiderProfileStore");
const { tempStoreFile } = require("../helpers/tempStore");

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-store.json")));
afterEach(() => store.reset());
afterAll(() => store.useFile(null));

describe("stores/raiderProfileStore", () => {
    it("liefert für ein neues Konto ein leeres Profil statt null", () => {
        const p = store.getProfile(A);
        expect(p).toMatchObject({ userId: A, characters: [], canOfftank: null, canHeal: null, wishes: [], note: "" });
        expect(store.hasProfile(A)).toBe(false);
        expect(store.getProfile("")).toBeNull();
    });

    it("legt Charaktere an – hinten angehängt, ohne Main –, Specs nur aus der eigenen Klasse", () => {
        const first = store.addCharacter(A, {
            name: "Nerathil-Thunderstrike", className: "mage", source: "manual",
            specs: [{ key: "Mage-Arcane", gear: "ready" }, { key: "Priest-Holy", gear: "ready" }, "Mage-Fire"],
        }, { name: "nerathil" });
        expect(first.character).toMatchObject({ key: "nerathil", name: "Nerathil", className: "Mage", source: "manual" });
        expect(first.character).not.toHaveProperty("main");
        expect(first.character.specs).toEqual([{ key: "Mage-Arcane", gear: "ready" }, { key: "Mage-Fire", gear: "usable" }]);

        store.addCharacter(A, { name: "Nerasol", className: "Priest", source: "log" });
        expect(store.getProfile(A).characters.map((c) => c.key)).toEqual(["nerathil", "nerasol"]);
        expect(store.firstCharacter(store.getProfile(A)).key).toBe("nerathil");
        expect(store.getProfile(A).name).toBe("nerathil");
    });

    it("hält 12 Charaktere je Spielversion – TBC-Charaktere nehmen Forever keinen Platz", () => {
        const D = "300000000000000005";
        const names = ["Aa", "Bb", "Cc", "Dd", "Ee", "Ff", "Gg", "Hh", "Ii", "Jj", "Kk", "Ll"];
        for (const n of names) expect(store.addCharacter(D, { name: n, className: "Mage", source: "log" }).error).toBeUndefined();
        expect(store.addCharacter(D, { name: "Mm", className: "Mage", source: "log" }).error).toMatch(/Höchstens 12 Charaktere je Spielversion \(TBC/);
        for (const n of names) {
            expect(store.addCharacter(D, { name: `${n} Res`, className: "Mage", source: "log", versionId: "forever" }).error).toBeUndefined();
        }
        expect(store.addCharacter(D, { name: "Mm Res", className: "Mage", source: "log", versionId: "forever" }).error).toMatch(/je Spielversion/);
        expect(store.getProfile(D).characters).toHaveLength(24);
    });

    it("speichert die Reihenfolge des Raiders – der erste je Version wird vorgeschlagen, nur Umsortieren", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage" });
        store.addCharacter(A, { name: "Nerasol", className: "Priest" });
        store.addCharacter(A, { name: "Devi Res", className: "Mage", versionId: "forever" });
        store.addCharacter(A, { name: "Tara Wind", className: "Priest", versionId: "forever" });
        const saved = store.saveProfile(A, { order: ["forever~tara wind", "nerasol", "fremder", "forever~devi res"] });
        // named ones in the given order, the rest after them as they were; an unknown key changes nothing
        expect(saved.characters.map((c) => c.key)).toEqual(["forever~tara wind", "nerasol", "forever~devi res", "nerathil"]);
        expect(store.firstCharacter(saved, "tbc").key).toBe("nerasol");
        expect(store.firstCharacter(saved, "forever").key).toBe("forever~tara wind");
        expect(store.firstCharacter(saved, "", { preferVersion: "tbc" }).key).toBe("nerasol");
        expect(store.firstCharacter(saved, "classic")).toBeNull();
        expect(store.firstCharacter(null)).toBeNull();
    });

    it("liest ein Profil aus der Main-Zeit: der alte Main steht je Version vorn, die Markierung ist weg", () => {
        const legacy = store.normalizeProfile({
            characters: [
                { name: "Alpha", className: "Mage", versionId: "tbc" },
                { name: "Beta", className: "Priest", versionId: "tbc", main: true },
                { name: "Devi Res", className: "Mage", versionId: "forever" },
            ],
        }, A);
        expect(legacy.characters.map((c) => c.name)).toEqual(["Beta", "Alpha", "Devi Res"]);
        expect(legacy.characters.some((c) => "main" in c)).toBe(false);
    });

    it("verlangt Name und Klasse", () => {
        expect(store.addCharacter(A, { name: "", className: "Mage" }).error).toMatch(/Namen/);
        expect(store.addCharacter(A, { name: "Foo", className: "Deathknight" }).error).toMatch(/Klasse/);
    });

    it("prüft neu getippte Namen: Buchstaben, je 12, Nachname nur mit Forever, kein Schimpfwort", () => {
        const C = "300000000000000003";
        // #543: the character's own version decides — Forever with last name, TBC (the default) without.
        expect(store.addCharacter(C, { name: "Aldric Sturmwind", className: "Mage", source: "manual", versionId: "forever" }).character)
            .toMatchObject({ key: "forever~aldric sturmwind", name: "Aldric Sturmwind", versionId: "forever" });
        expect(store.addCharacter(C, { name: "Aldric Sturmwind", className: "Mage", versionId: "forever" }).error).toBeUndefined();
        expect(store.addCharacter(C, { name: "Aldric Sturmwind", className: "Mage" }).error).toMatch(/nur in WoW Forever/);
        expect(store.addCharacter(C, { name: "Brom Eisenfaust", className: "Warrior" }, { versionId: "tbc" }).error).toMatch(/nur in WoW Forever/);
        expect(store.addCharacter(C, { name: "Brom Eisenfaust", className: "Warrior" }, { versionId: "forever" }).character.name).toBe("Brom Eisenfaust");
        expect(store.addCharacter(C, { name: "Abcdefghijklm", className: "Warrior" }).error).toMatch(/höchstens 12/);
        expect(store.addCharacter(C, { name: "Hurensohn", className: "Warrior", source: "armory" }).error).toMatch(/nicht erlaubt/);
        expect(store.getProfile(C).characters.map((c) => c.name)).toEqual(["Aldric Sturmwind", "Brom Eisenfaust"]);
    });

    it("lässt Namen aus den Logs ungeprüft – das sind die des Spiels", () => {
        const D = "300000000000000004";
        expect(store.addCharacter(D, { name: "Zwölfbuchstabenx", className: "Mage", source: "log" }).character.name).toBe("Zwölfbuchstabenx");
    });

    it("führt denselben Charakter zweimal zusammen statt ihn doppelt anzulegen", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        store.addCharacter(A, { name: "nerathil", className: "Mage", specs: ["Mage-Frost"] });
        const p = store.getProfile(A);
        expect(p.characters).toHaveLength(1);
        expect(p.characters[0].specs.map((s) => s.key)).toEqual(["Mage-Arcane", "Mage-Frost"]);
    });

    it("speichert Schalter, Tage, Raids, Wünsche und Notiz – und bereinigt sie", () => {
        const saved = store.saveProfile(A, {
            canOfftank: true, canHeal: "ja",
            availability: ["so", "mi", "xx"],
            preferredRaids: ["ssc", "bt", "gibtsnicht", "ssc"],
            wishes: [B, A, "keine-id", B],
            note: "  Mittwochs erst ab 19:45.  ",
            userId: B,
        });
        expect(saved).toMatchObject({
            userId: A, canOfftank: true, canHeal: null,
            availability: ["mi", "so"], preferredRaids: ["ssc", "bt"], wishes: [B], note: "Mittwochs erst ab 19:45.",
        });
        expect(store.hasProfile(B)).toBe(false);
    });

    it("führt „kann offtanken / heilen“ je Charakter: eigenes Wort, sonst das alte profilweite, sonst die Specs", () => {
        store.addCharacter(A, { name: "Bärbel", className: "Druid", specs: ["Druid-Guardian"] });
        store.addCharacter(A, { name: "Nerasol", className: "Priest", specs: ["Priest-Shadow"] });
        let p = store.getProfile(A);
        const roles = (key) => store.characterRoles(p, p.characters.find((c) => c.key === key));
        expect(roles("bärbel")).toMatchObject({ canOfftank: true, canHeal: false, explicit: { canOfftank: null, canHeal: null } });
        expect(roles("nerasol")).toMatchObject({ canOfftank: false, canHeal: false });

        // ein altes Profil mit profilweitem Schalter: gilt für jeden Charakter ohne eigenes Wort
        p = store.saveProfile(A, { canHeal: true });
        expect(roles("nerasol")).toMatchObject({ canHeal: true, explicit: { canHeal: true } });

        p = store.saveProfile(A, { characters: [{ key: "nerasol", canHeal: false }, { key: "bärbel", canOfftank: "ja" }] });
        expect(p.characters.find((c) => c.key === "nerasol").canHeal).toBe(false);
        expect(p.characters.find((c) => c.key === "bärbel").canOfftank).toBeNull();
        expect(roles("nerasol")).toMatchObject({ canHeal: false });
        expect(roles("bärbel")).toMatchObject({ canHeal: true });
        expect(store.characterRoles(p, null)).toMatchObject({ canOfftank: false, canHeal: true });
    });

    it("lässt eine Klasse ohne Tank-/Heil-Spec nie „ja“ sagen – auch nicht über das alte profilweite Feld", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        store.addCharacter(A, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] });
        let p = store.saveProfile(A, { canOfftank: true, canHeal: true, characters: [{ key: "nerathil", canOfftank: true, canHeal: true }, { key: "nerasol", canOfftank: true }] });
        // gespeichert wird das „ja“ gar nicht erst
        expect(p.characters.find((c) => c.key === "nerathil")).toMatchObject({ canOfftank: null, canHeal: null });
        expect(p.characters.find((c) => c.key === "nerasol").canOfftank).toBeNull();
        const mage = store.characterRoles(p, p.characters.find((c) => c.key === "nerathil"));
        expect(mage).toMatchObject({ canOfftank: false, canHeal: false, possible: { canOfftank: false, canHeal: false }, explicit: { canOfftank: false, canHeal: false } });
        p = store.getProfile(A);
        expect(store.characterRoles(p, p.characters[1])).toMatchObject({ canOfftank: false, canHeal: true, possible: { canOfftank: false, canHeal: true } });
        expect(store.classCan("Druid")).toEqual({ canOfftank: true, canHeal: true });
        expect(store.classCan("Rogue")).toEqual({ canOfftank: false, canHeal: false });
    });

    it("hält „nicht mit X raiden“ aus, bis es eingeschaltet ist, und vergisst die Namen beim Ausschalten", () => {
        expect(store.saveProfile(A, { avoid: [B] })).toMatchObject({ avoidEnabled: false, avoid: [] });
        const on = store.saveProfile(A, { avoidEnabled: true, avoid: [B, A, C, "keine-id", B], wishes: [C] });
        // nicht sich selbst, keine ungültige Id, niemand, der zugleich ein Wunsch ist
        expect(on).toMatchObject({ avoidEnabled: true, avoid: [B] });
        expect(store.saveProfile(A, { avoidEnabled: false })).toMatchObject({ avoidEnabled: false, avoid: [] });
        expect(store.saveProfile(A, { avoidEnabled: true }).avoid).toEqual([]);
    });

    it("kann beim Speichern keinen Charakter hinzufügen, nur vorhandene ändern", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage" });
        store.addCharacter(A, { name: "Nerasol", className: "Priest" });
        const saved = store.saveProfile(A, {
            characters: [
                // a "main" from an old client is ignored — there is none
                { key: "nerasol", main: true, specs: [{ key: "Priest-Holy", gear: "ready" }] },
                { key: "fremder", specs: [] },
            ],
        });
        expect(saved.characters.map((c) => c.key)).toEqual(["nerathil", "nerasol"]);
        expect(saved.characters.some((c) => "main" in c)).toBe(false);
        expect(saved.characters[1].specs).toEqual([{ key: "Priest-Holy", gear: "ready" }]);
    });

    it("entfernt einen Charakter nur aus dem eigenen Profil", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage" });
        store.addCharacter(B, { name: "Nerathil", className: "Mage" });
        expect(store.removeCharacter(A, "Nerathil")).toBe(true);
        expect(store.removeCharacter(A, "Nerathil")).toBe(false);
        expect(store.getProfile(B).characters).toHaveLength(1);
    });

    it("meldet doppelt beanspruchte Charaktere, statt sie abzulehnen", () => {
        store.addCharacter(A, { name: "Nerathil", className: "Mage" }, { name: "Anna" });
        const second = store.addCharacter(B, { name: "Nerathil-Thunderstrike", className: "Mage" }, { name: "Bert" });
        expect(second.error).toBeUndefined();
        store.addCharacter(C, { name: "Einzeln", className: "Rogue" }, { name: "Cleo" });

        expect(store.claimsFor("nerathil", A)).toEqual([{ userId: B, name: "Bert" }]);
        expect(store.characterClaims()).toEqual([{
            key: "nerathil", character: "Nerathil", versionId: "tbc", className: "Mage",
            claims: [{ userId: A, name: "Anna" }, { userId: B, name: "Bert" }],
        }]);
    });

    it("sucht Raider nur mit Namen und erstem Charakter – ohne Wünsche, Notiz oder Tage", () => {
        store.addCharacter(B, { name: "Ysolde", className: "Mage" }, { name: "Bert" });
        store.addCharacter(B, { name: "Bert Stein", className: "Warrior", versionId: "forever" }, { name: "Bert" });
        store.saveProfile(B, { wishes: [A], note: "geheim", availability: ["mo"] }, { name: "Bert" });
        store.addCharacter(A, { name: "Nerathil", className: "Mage" }, { name: "Anna" });

        const hits = store.searchRaiders("ysol", A);
        expect(hits).toEqual([{ userId: B, name: "Bert", character: "Ysolde", className: "Mage" }]);
        // named by their first character of the caller's main version when they have one
        expect(store.searchRaiders("ysol", A, 10, { preferVersion: "forever" })).toEqual([{ userId: B, name: "Bert", character: "Bert Stein", className: "Warrior" }]);
        expect(store.searchRaiders("", A).map((h) => h.userId)).toEqual([B]);
        expect(JSON.stringify(store.searchRaiders("", C))).not.toMatch(/wishes|geheim|availability/);
    });
});
