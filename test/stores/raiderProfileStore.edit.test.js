// Einen Charakter im Profil bearbeiten: Name, Realm, Klasse, Specs
// (raiderProfileStore.editCharacter) — meist ein Name, den es als Charakter nie
// gab („Gentle“ für einen Druiden).
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const store = require("../../src/stores/raiderProfileStore");

const A = "100000000000000001";

beforeEach(() => fs.__store.clear());

const add = (data, uid = A) => store.addCharacter(uid, { source: "manual", ...data });

describe("stores/raiderProfileStore editCharacter", () => {
    it("benennt um: neuer Schlüssel, Specs, Gear, Schalter und Reihenfolge bleiben", () => {
        add({ name: "Gentle", className: "Druid", specs: [{ key: "Druid-Restoration", gear: "ready" }] });
        add({ name: "Nerathil", className: "Mage" });
        store.saveProfile(A, { characters: [{ key: "gentle", canOfftank: true }] });

        const res = store.editCharacter(A, "gentle", { name: "Blattwerk" });
        expect(res.error).toBeUndefined();
        expect(res.character).toMatchObject({ key: "blattwerk", name: "Blattwerk", className: "Druid", canOfftank: true });
        expect(res.character.specs).toEqual([{ key: "Druid-Restoration", gear: "ready" }]);
        expect(res.renamed).toEqual({ fromKey: "gentle", toKey: "blattwerk", fromName: "Gentle", toName: "Blattwerk", versionId: "tbc" });
        expect(store.getProfile(A).characters.map((c) => c.key)).toEqual(["blattwerk", "nerathil"]);
    });

    it("nimmt dem neuen Namen, was für den alten sprach: Arsenal, Orga-Prüfung, „aus den Logs“", () => {
        store.addCharacter(A, { name: "Brando", className: "Shaman", source: "log" });
        store.setCharacterArmory(A, "brando", { level: 70, guild: "Pulse" });
        store.verifyCharacter(A, "brando", { by: "9", byName: "Orga" });
        const before = store.getProfile(A).characters[0];
        expect(before).toMatchObject({ source: "log", verifiedAt: expect.any(Number) });
        expect(before.armory).toMatchObject({ level: 70 });

        const after = store.editCharacter(A, "brando", { name: "Donnerfaust" }).character;
        expect(after).toMatchObject({ source: "manual", armory: null });
        expect(after).not.toHaveProperty("verifiedAt");
    });

    it("nur die Schreibweise geändert: gleicher Schlüssel, alles bleibt, trotzdem als Umbenennung gemeldet", () => {
        store.addCharacter(A, { name: "gentle", className: "Druid", source: "log" });
        store.verifyCharacter(A, "gentle", { by: "9" });
        const res = store.editCharacter(A, "gentle", { name: "Gentle" });
        expect(res.character).toMatchObject({ key: "gentle", name: "Gentle", source: "log", verifiedAt: expect.any(Number) });
        expect(res.renamed).toMatchObject({ fromKey: "gentle", toKey: "gentle", toName: "Gentle" });
    });

    it("ein unveränderter Name ist keine Umbenennung, auch wenn er die Namensregel nicht bestünde", () => {
        store.addCharacter(A, { name: "Xx'Log", className: "Mage", source: "log" });
        const name = store.getProfile(A).characters[0].name;
        const res = store.editCharacter(A, store.getProfile(A).characters[0].key, { name, realm: "Thunderstrike" });
        expect(res.error).toBeUndefined();
        expect(res.renamed).toBeNull();
        expect(res.character.realm).toBe("Thunderstrike");
    });

    it("anderer Realm: die Arsenal-Antwort gilt nicht mehr", () => {
        add({ name: "Nerathil", className: "Mage", realm: "Spineshatter" });
        store.setCharacterArmory(A, "nerathil", { level: 70 });
        const after = store.editCharacter(A, "nerathil", { realm: "Thunderstrike" }).character;
        expect(after).toMatchObject({ realm: "Thunderstrike", armory: null });
    });

    it("andere Klasse: nur die mitgegebenen Specs der neuen Klasse, Schalter zurück auf „nicht gesagt“", () => {
        add({ name: "Gentle", className: "Druid", specs: ["Druid-Feral"] });
        store.saveProfile(A, { characters: [{ key: "gentle", canOfftank: true, canHeal: false }] });
        const bare = store.editCharacter(A, "gentle", { className: "Shaman" }).character;
        expect(bare).toMatchObject({ className: "Shaman", specs: [], canOfftank: null, canHeal: null });
        const withSpecs = store.editCharacter(A, "gentle", { className: "Shaman", specs: ["Shaman-Restoration", "Druid-Feral"] }).character;
        expect(withSpecs.specs).toEqual([{ key: "Shaman-Restoration", gear: "usable" }]);
    });

    it("Specs allein (gleiche Klasse) ersetzen die Liste und behalten das Gear der gebliebenen", () => {
        add({ name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Fire", gear: "ready" }, "Mage-Frost"] });
        const after = store.editCharacter(A, "nerathil", { specs: ["Mage-Fire", "Mage-Arcane"] }).character;
        expect(after.specs).toEqual([{ key: "Mage-Fire", gear: "ready" }, { key: "Mage-Arcane", gear: "usable" }]);
    });

    it("weist ab: unbekannter Charakter, schlechter Name, Name schon im Profil, Klasse der Version fremd", () => {
        add({ name: "Gentle", className: "Druid" });
        add({ name: "Nerathil", className: "Mage" });
        expect(store.editCharacter(A, "niemand", { name: "Xyz" })).toMatchObject({ code: "not_found" });
        expect(store.editCharacter(A, "gentle", { name: "X1" })).toMatchObject({ code: "bad_name" });
        expect(store.editCharacter(A, "gentle", { name: "Nerathil" })).toMatchObject({ code: "taken", error: "Nerathil steht schon in diesem Profil." });
        expect(store.editCharacter(A, "gentle", { className: "Warlock-ish" })).toMatchObject({ code: "bad_class" });
        // nothing changed by the refused edits
        expect(store.getProfile(A).characters.map((c) => c.key)).toEqual(["gentle", "nerathil"]);
    });

    it("aus den Logs zugeordnet: ohne Namensregel, danach „aus den Logs“", () => {
        add({ name: "Gentle", className: "Druid" });
        const res = store.editCharacter(A, "gentle", { name: "Xâl'thas", className: "Druid", source: "log" });
        expect(res.error).toBeUndefined();
        expect(res.character).toMatchObject({ name: "Xâl'thas", source: "log" });
        expect(res.renamed).toMatchObject({ fromName: "Gentle", toName: "Xâl'thas" });
        // the same name typed by hand would have to pass the rule
        expect(store.editCharacter(A, res.character.key, { name: "X1" })).toMatchObject({ code: "bad_name" });
    });

    it("ein Forever-Charakter behält seine Version und den Versions-Schlüssel", () => {
        add({ name: "Devi Res", className: "Mage", versionId: "forever" });
        const res = store.editCharacter(A, "forever~devi res", { name: "Devira Res" });
        expect(res.error).toBeUndefined();
        expect(res.character).toMatchObject({ key: "forever~devira res", versionId: "forever" });
        expect(res.renamed).toMatchObject({ fromKey: "forever~devi res", toKey: "forever~devira res", versionId: "forever" });
    });
});
