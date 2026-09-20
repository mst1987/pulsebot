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
