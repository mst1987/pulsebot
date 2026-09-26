// Preferred classes of an assignment row: cleaning, the class order of a suggestion, "allow others".
const assign = require("../../src/web/raidplanAssign");
const catalogStore = require("../../src/stores/raidplanCatalogStore");
const { tempStoreFile } = require("../helpers/tempStore");
const { person: basePerson } = require("../factories/raidplan");

beforeAll(() => catalogStore.useFile(tempStoreFile("preferred-catalog.json")));

const slot = (kind, n, userId = "") => ({ kind, n, userId });
const person = (userId, classId, role, group = 1) => basePerson({ userId, classId, role, group });

describe("preferred classes of a row", () => {
    it("are cleaned: only known classes, once each, in order; allowOthers is a strict boolean; old rows get the defaults", () => {
        const r = assign.cleanAssignments([
            { id: "a", type: "kick", preferredClasses: ["Rogue", "Rogue", "Banana", "Mage", 5, null], allowOthers: true },
            { id: "b", type: "kick", preferredClasses: "Rogue", allowOthers: "yes" },
            { id: "c", type: "kick" },
        ]);
        expect(r.assignments.map((a) => a.preferredClasses)).toEqual([["Rogue", "Mage"], [], []]);
        expect(r.assignments.map((a) => a.allowOthers)).toEqual([true, false, false]);
    });

    it("a row's own classes replace the catalog's, the usual ones only follow when others are allowed", () => {
        expect(assign._internal.classesFor("kick", ["Warrior"], false)).toEqual(["Warrior"]);
        expect(assign._internal.classesFor("kick", ["Warrior"], true)[0]).toBe("Warrior");
        expect(assign._internal.classesFor("kick", ["Warrior"], true)).toEqual(expect.arrayContaining(["Rogue", "Shaman", "Mage"]));
        expect(assign._internal.classesFor("kick", [], false)).toEqual(assign._internal.classesFor("kick"));
    });

    it("a suggestion takes the preferred class first and stays empty when nobody fits and others are not allowed", () => {
        const roster = [person("r1", "Rogue", "dps"), person("w1", "Warrior", "dps"), person("m1", "Mage", "dps")];
        const only = assign.suggest("kick", { roster, preferredClasses: ["Mage"], allowOthers: false });
        expect(only[0].assignees).toEqual(["user:m1"]);
        expect(only[0].preferredClasses).toEqual(["Mage"]);
        const more = assign.suggest("kick", { roster, preferredClasses: ["Mage"], allowOthers: true });
        expect(more[0].assignees[0]).toBe("user:m1");
        expect(more[0].assignees.length).toBeGreaterThan(1);
        expect(assign.suggest("kick", { roster: [person("w1", "Warrior", "dps")], preferredClasses: ["Mage"], allowOthers: false })).toEqual([]);
    });

    it("heal: healers of the preferred class first, others only when allowed", () => {
        const roster = [person("h1", "Priest", "healer"), person("h2", "Paladin", "healer")];
        const slots = [slot("tank", 1, "t"), slot("healer", 1, "h1"), slot("healer", 2, "h2")];
        const only = assign.suggest("heal", { slots, roster, groups: [1], preferredClasses: ["Paladin"], allowOthers: false });
        expect(only.map((a) => a.assignees[0])).toEqual(["slot:healer:2"]);
        const both = assign.suggest("heal", { slots, roster, groups: [1], preferredClasses: ["Paladin"], allowOthers: true });
        expect(both[0].assignees[0]).toBe("slot:healer:2");
        expect(both.length).toBeGreaterThan(1);
    });
});
