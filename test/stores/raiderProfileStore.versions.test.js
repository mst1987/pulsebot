// Charaktere je Spielversion (#543): Schlüssel, Anlegen, Finden.
const store = require("../../src/stores/raiderProfileStore");
const { characterKeyOf, nameKeyOf } = require("../../src/utils/loot/lootImport");
const { tempStoreFile } = require("../helpers/tempStore");

const A = "100000000000000011";
const B = "100000000000000012";

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-versions.json")));
afterEach(() => store.reset());
afterAll(() => store.useFile(null));

describe("utils/loot/lootImport characterKeyOf je Version", () => {
    it("lässt TBC-Schlüssel unverändert (Golden Master für Loot, Anwesenheit, Historie)", () => {
        for (const [name, key] of [["Keslight", "keslight"], ["Keslight-Thunderstrike", "keslight"], ["  NAPHFß ", "naphfß"], ["", ""]]) {
            expect(characterKeyOf(name)).toBe(key);
            expect(characterKeyOf(name, "tbc")).toBe(key);
        }
    });

    it("gibt Forever-Charakteren die Version und den Nachnamen in den Schlüssel", () => {
        expect(characterKeyOf("Devi Res", "forever")).toBe("forever~devi res");
        expect(characterKeyOf("Devi Rew", "forever")).toBe("forever~devi rew");
        expect(characterKeyOf("Devi", "forever")).toBe("forever~devi");
        expect(characterKeyOf("Devi", "classic")).toBe("classic~devi");
        // a key stays what it is, also when a version is handed along
        expect(characterKeyOf("forever~devi res", "forever")).toBe("forever~devi res");
        expect(characterKeyOf("FOREVER~Devi Res")).toBe("forever~devi res");
    });

    it("nameKeyOf nimmt nur den Namen", () => {
        expect(nameKeyOf("forever~devi res")).toBe("devi res");
        expect(nameKeyOf("Devi Res")).toBe("devi res");
        expect(nameKeyOf("Keslight-Thunderstrike")).toBe("keslight");
    });
});

describe("stores/raiderProfileStore je Spielversion", () => {
    it("hält Devi Res, Devi Rew und ein TBC-Devi als drei Charaktere auseinander", () => {
        store.addCharacter(A, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
        store.addCharacter(A, { name: "devi res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" });
        store.addCharacter(A, { name: "Devi Rew", className: "Mage", versionId: "forever" });
        const chars = store.getProfile(A).characters;
        expect(chars.map((c) => [c.key, c.name, c.versionId])).toEqual([
            ["devi", "Devi", "tbc"],
            ["forever~devi res", "Devi Res", "forever"],
            ["forever~devi rew", "Devi Rew", "forever"],
        ]);
        // the same name again in its version merges, it does not add a fourth
        store.addCharacter(A, { name: "Devi Res", className: "Priest", specs: ["Priest-Holy"], versionId: "forever" });
        expect(store.getProfile(A).characters).toHaveLength(3);
        expect(store.getProfile(A).characters[1].specs.map((s) => s.key)).toEqual(["Priest-Shadow", "Priest-Holy"]);
    });

    it("erlaubt denselben Vornamen in zwei Versionen – ein Forever-Devi ohne Nachnamen ist nicht der TBC-Devi", () => {
        store.addCharacter(A, { name: "Devi", className: "Priest" });
        const forever = store.addCharacter(A, { name: "Devi", className: "Priest", versionId: "forever" });
        expect(forever.character).toMatchObject({ key: "forever~devi", versionId: "forever" });
        expect(store.getProfile(A).characters).toHaveLength(2);
    });

    it("nimmt die Version aus den Optionen (Discord-Modal) und fällt sonst auf TBC zurück", () => {
        expect(store.addCharacter(A, { name: "Brom Eisenfaust", className: "Warrior" }, { versionId: "forever" }).character.versionId).toBe("forever");
        expect(store.addCharacter(A, { name: "Brom", className: "Warrior" }).character.versionId).toBe("tbc");
        expect(store.addCharacter(A, { name: "Kalt", className: "Mage", versionId: "gibtsnicht" }).character.versionId).toBe("tbc");
    });

    it("filtert und findet Charaktere je Version", () => {
        store.addCharacter(A, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
        store.addCharacter(A, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" });
        const p = store.getProfile(A);
        expect(store.charactersOfVersion(p, "tbc").map((c) => c.name)).toEqual(["Devi"]);
        expect(store.charactersOfVersion(p, "forever").map((c) => c.name)).toEqual(["Devi Res"]);
        expect(store.charactersOfVersion(p, "")).toHaveLength(2);
        expect(store.charactersOfVersion(null, "tbc")).toEqual([]);

        expect(store.findCharacter(p, "Devi Res", "forever").key).toBe("forever~devi res");
        expect(store.findCharacter(p, "forever~devi res", "forever").name).toBe("Devi Res");
        expect(store.findCharacter(p, "Devi Res", "tbc")).toBeNull();
        expect(store.findCharacter(p, "Devi", "forever")).toBeNull();
        expect(store.findCharacter(p, "Devi", "tbc").key).toBe("devi");
        // without a version: the exact key, else the TBC one of that name, else any
        expect(store.findCharacter(p, "Devi").key).toBe("devi");
        expect(store.findCharacter(p, "Devi Res").key).toBe("forever~devi res");
        expect(store.findCharacter(p, "")).toBeNull();
    });

    it("entfernt und meldet doppelte Ansprüche je Version", () => {
        store.addCharacter(A, { name: "Devi Res", className: "Priest", versionId: "forever" }, { name: "Anna" });
        store.addCharacter(B, { name: "Devi Res", className: "Priest", versionId: "forever" }, { name: "Bert" });
        store.addCharacter(B, { name: "Devi", className: "Priest" }, { name: "Bert" });
        expect(store.claimsFor("Devi Res", A, "forever")).toEqual([{ userId: B, name: "Bert" }]);
        expect(store.claimsFor("Devi Res", A, "tbc")).toEqual([]);
        expect(store.characterClaims().map((c) => [c.key, c.versionId])).toEqual([["forever~devi res", "forever"]]);
        expect(store.removeCharacter(A, "forever~devi res")).toBe(true);
        expect(store.getProfile(A).characters).toEqual([]);
    });

    it("sucht Raider über den Namen, nicht über den Versions-Schlüssel", () => {
        store.addCharacter(B, { name: "Devi Res", className: "Priest", versionId: "forever" }, { name: "Bert" });
        expect(store.searchRaiders("devi r", A).map((r) => r.userId)).toEqual([B]);
        expect(store.searchRaiders("forever", A)).toEqual([]);
    });
});
