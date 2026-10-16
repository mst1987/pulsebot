// Ein Charakter wird umbenannt (signupStore.renameCharacter): jede Anmeldung
// des Raiders mit diesem Namen nennt den neuen, auch vergangene Raids.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const signupStore = require("../../src/stores/signupStore");

beforeEach(() => fs.__store.clear());

describe("stores/signupStore renameCharacter", () => {
    it("ersetzt den Namen als Hauptcharakter und in der Liste, nur beim eigenen Raider, und meldet jedes Event", () => {
        signupStore.saveSignup("eh-1", "u1", { characters: [{ character: "Gentle", spec: "Druid-Restoration" }, { character: "Nerathil", spec: "Mage-Fire" }] });
        signupStore.saveSignup("eh-2", "u1", { characters: [{ character: "Nerathil", spec: "Mage-Fire" }, { character: "Gentle-Thunderstrike", spec: "Druid-Feral" }] });
        signupStore.saveSignup("eh-3", "u1", { character: "Nerathil", spec: "Mage-Fire" });
        signupStore.saveSignup("eh-1", "u2", { character: "Gentle", spec: "Druid-Balance" });
        const heard = [];
        const off = signupStore.onSignupsChanged((id) => heard.push(id));

        expect(signupStore.renameCharacter("u1", "gentle", "Blattwerk").sort()).toEqual(["eh-1", "eh-2"]);
        off();

        const one = signupStore.getSignup("eh-1", "u1");
        expect(one.character).toBe("Blattwerk");
        expect(one.characters.map((c) => c.character)).toEqual(["Blattwerk", "Nerathil"]);
        expect(signupStore.getSignup("eh-2", "u1").characters.map((c) => c.character)).toEqual(["Nerathil", "Blattwerk"]);
        expect(signupStore.getSignup("eh-2", "u1").character).toBe("Nerathil");
        expect(signupStore.getSignup("eh-1", "u2").character).toBe("Gentle");
        expect(heard.sort()).toEqual(["eh-1", "eh-2"]);
    });

    it("lässt Events aus, die `keep` nicht will, und tut ohne Treffer nichts", () => {
        signupStore.saveSignup("eh-1", "u1", { character: "Gentle", spec: "Druid-Restoration" });
        signupStore.saveSignup("eh-2", "u1", { character: "Gentle", spec: "Druid-Restoration" });
        expect(signupStore.renameCharacter("u1", "gentle", "Blattwerk", { keep: (id) => id === "eh-2" })).toEqual(["eh-2"]);
        expect(signupStore.getSignup("eh-1", "u1").character).toBe("Gentle");
        expect(signupStore.renameCharacter("u1", "niemand", "X")).toEqual([]);
        expect(signupStore.renameCharacter("", "gentle", "X")).toEqual([]);
    });
});
