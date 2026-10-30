// Leader-Flags je Konto, Version und Instanz (#1034).
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/roster/leaderFlagsStore");

beforeEach(() => store.useFile(tempStoreFile("leader-flags.json")));
afterAll(() => store.useFile(null));

describe("stores/roster/leaderFlagsStore", () => {
    it("setzt und liest die eigenen Flags mit Urheber und Zeitpunkt", () => {
        const entry = store.setLeads("u1", "tbc", ["ssc", "kara"], { by: "u1" });
        expect(entry).toMatchObject({ instances: ["kara", "ssc"], by: "u1" });
        expect(entry.at).toBeGreaterThan(0);
        expect(store.leadsOf("u1")).toEqual({ tbc: entry });
    });

    it("verwirft unbekannte Instanzen und Instanzen einer anderen Version", () => {
        const entry = store.setLeads("u1", "tbc", ["kara", "gibtsnicht", "forever-hyjal", "kara"]);
        expect(entry.instances).toEqual(["kara"]);
    });

    it("hält die Versionen strikt getrennt", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        store.setLeads("u1", "forever", ["forever-hyjal"]);
        expect(Object.keys(store.leadsOf("u1")).sort()).toEqual(["forever", "tbc"]);
        expect(store.leadsOf("u1").forever.instances).toEqual(["forever-hyjal"]);
    });

    it("entfernt den Eintrag bei leerer Liste und lässt andere Konten in Ruhe", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        store.setLeads("u2", "tbc", ["gruul"], { by: "orga" });
        expect(store.setLeads("u1", "tbc", [])).toBeNull();
        expect(store.leadsOf("u1")).toEqual({});
        expect(store.allLeads()).toEqual({ u2: { tbc: expect.objectContaining({ instances: ["gruul"], by: "orga" }) } });
    });

    it("lehnt eine unbekannte Version und ein leeres Konto ab", () => {
        expect(() => store.setLeads("u1", "wotlk", ["naxx"])).toThrow(/Version/);
        expect(() => store.setLeads("", "tbc", ["kara"])).toThrow(/userId/);
    });

    it("gibt eine Kopie heraus, die den Store nicht verändert", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        store.leadsOf("u1").tbc.instances.push("ssc");
        expect(store.leadsOf("u1").tbc.instances).toEqual(["kara"]);
    });
});
