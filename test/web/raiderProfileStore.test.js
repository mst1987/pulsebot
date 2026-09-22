// Das eigene Raider-Profil (#255). Schreibt auf Platte – in eine eigene Datei
// im Temp-Verzeichnis, damit parallel laufende Suites sich nichts teilen.
const store = require("../../src/web/raiderProfileStore");
const { tempStoreFile } = require("../helpers/tempStore");

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-store.json")));
afterEach(() => store.reset());
afterAll(() => store.useFile(null));

describe("web/raiderProfileStore", () => {
    it("liefert für ein neues Konto ein leeres Profil statt null", () => {
        const p = store.getProfile(A);
        expect(p).toMatchObject({ userId: A, characters: [], canOfftank: null, canHeal: null, wishes: [], note: "" });
        expect(store.hasProfile(A)).toBe(false);
        expect(store.getProfile("")).toBeNull();
    });

    it("legt Charaktere an, der erste wird Main, Specs nur aus der eigenen Klasse", () => {
        const first = store.addCharacter(A, {
            name: "Nerathil-Thunderstrike", className: "mage", source: "manual",
            specs: [{ key: "Mage-Arcane", gear: "ready" }, { key: "Priest-Holy", gear: "ready" }, "Mage-Fire"],
        }, { name: "nerathil" });
        expect(first.character).toMatchObject({ key: "nerathil", name: "Nerathil", className: "Mage", main: true, source: "manual" });
        expect(first.character.specs).toEqual([{ key: "Mage-Arcane", gear: "ready" }, { key: "Mage-Fire", gear: "usable" }]);

        const second = store.addCharacter(A, { name: "Nerasol", className: "Priest", source: "log" });
        expect(second.character.main).toBe(false);
        expect(store.getProfile(A).name).toBe("nerathil");
    });

    it("verlangt Name und Klasse", () => {
        expect(store.addCharacter(A, { name: "", className: "Mage" }).error).toMatch(/Namen/);
        expect(store.addCharacter(A, { name: "Foo", className: "Deathknight" }).error).toMatch(/Klasse/);
    });

    it("prüft neu getippte Namen: Buchstaben, je 12, Nachname nur mit Forever, kein Schimpfwort", () => {
        const C = "300000000000000003";
        expect(store.addCharacter(C, { name: "Aldric Sturmwind", className: "Mage", source: "manual" }).character)
            .toMatchObject({ key: "aldric sturmwind", name: "Aldric Sturmwind" });
        expect(store.addCharacter(C, { name: "Aldric Sturmwind", className: "Mage" }, { versionId: "tbc" }).error).toBeUndefined();
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
                { key: "nerasol", main: true, specs: [{ key: "Priest-Holy", gear: "ready" }] },
                { key: "fremder", main: false, specs: [] },
            ],
        });
        expect(saved.characters.map((c) => [c.key, c.main])).toEqual([["nerathil", false], ["nerasol", true]]);
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
            key: "nerathil", character: "Nerathil", className: "Mage",
            claims: [{ userId: A, name: "Anna", main: true }, { userId: B, name: "Bert", main: true }],
        }]);
    });

    it("sucht Raider nur mit Namen und Main – ohne Wünsche, Notiz oder Tage", () => {
        store.addCharacter(B, { name: "Ysolde", className: "Mage" }, { name: "Bert" });
        store.saveProfile(B, { wishes: [A], note: "geheim", availability: ["mo"] }, { name: "Bert" });
        store.addCharacter(A, { name: "Nerathil", className: "Mage" }, { name: "Anna" });

        const hits = store.searchRaiders("ysol", A);
        expect(hits).toEqual([{ userId: B, name: "Bert", main: "Ysolde", className: "Mage" }]);
        expect(store.searchRaiders("", A).map((h) => h.userId)).toEqual([B]);
        expect(JSON.stringify(store.searchRaiders("", C))).not.toMatch(/wishes|geheim|availability/);
    });
});
