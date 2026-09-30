// The step from the #566 planner to Kader with states, pure (docs/kaderplaner.md,
// "Umstellung"). The whole run over a stored file, with the profiles as a second
// source and its golden master, is test/stores/settingsMigration.kader.test.js.
const { migrateLegacyPlanner, charOfAssignments, decisionFor, migrationSummary, defaultRoleOf } = require("../../../src/services/kader/kaderMigration");

const NOW = "2026-10-01T12:00:00.000Z";
const warrior = { className: "Warrior", specs: ["Warrior-Fury", "Warrior-Protection"], mainSpec: "Warrior-Fury" };

describe("services/kader/kaderMigration", () => {
    it("knows the roles of the planner's rule set", () => {
        expect(defaultRoleOf("Warrior-Protection")).toBe("tank");
        expect(defaultRoleOf("Priest-Holy")).toBe("healer");
        expect(defaultRoleOf("nope")).toBe("");
    });

    it("decides the spec that fits the old role slot, else the main spec", () => {
        expect(decisionFor(warrior, "tank", defaultRoleOf)).toEqual({ className: "Warrior", spec: "Warrior-Protection" });
        expect(decisionFor(warrior, "healer", defaultRoleOf)).toEqual({ className: "Warrior", spec: "Warrior-Fury" });
        expect(decisionFor(warrior, "", defaultRoleOf)).toEqual({ className: "Warrior", spec: "Warrior-Fury" });
        expect(decisionFor(null, "tank", defaultRoleOf)).toBeNull();
        expect(decisionFor({ className: "Mage", specs: [], mainSpec: "" }, "", defaultRoleOf)).toBeNull();
    });

    it("reads the planner's own active character", () => {
        const charOf = charOfAssignments({ assignments: { a: { characters: [
            { id: "x", className: "Mage", specs: [{ spec: "Mage-Frost" }] },
            { id: "y", className: "Warrior", specs: [{ spec: "Warrior-Arms" }, { spec: "Warrior-Fury", main: true }] },
        ], activeCharacterId: "y" } } });
        expect(charOf("a")).toEqual({ className: "Warrior", specs: ["Warrior-Arms", "Warrior-Fury"], mainSpec: "Warrior-Fury" });
        expect(charOf("b")).toBeNull();
        expect(charOfAssignments(null)("a")).toBeNull();
    });

    it("turns rosters into Kader and leaves everything else alone", () => {
        const out = migrateLegacyPlanner({
            accounts: [{ userId: "h" }],
            rosters: [{ id: "r1", name: "", size: 40, members: [{ userId: "a", role: "tank" }, { userId: "a", role: "melee" }], bench: ["a", "b"] }, { nope: 1 }],
            setups: { r1: { variants: [{ id: "v", groups: [["a", "b", "ghost"]] }, { name: "no id" }] } },
        }, { now: NOW, charOf: (id) => (id === "a" ? warrior : null), roleOf: defaultRoleOf });
        expect(out.v).toBe(2);
        expect(out.accounts).toEqual([{ userId: "h" }]);
        const [k] = out.kaders;
        expect(k).toMatchObject({ id: "r1", name: "Kader", leads: [], createdAt: NOW, questions: [] });
        expect(Object.keys(k.players)).toEqual(["a", "b"]);
        expect(k.players.a).toMatchObject({ state: "roster", decision: { spec: "Warrior-Protection" }, wishes: [{ className: "Warrior", spec: "Warrior-Protection" }, { className: "Warrior", spec: "Warrior-Fury" }] });
        expect(k.players.b).toMatchObject({ state: "bench", decision: null, wishes: [] });
        expect(k.setups).toEqual([{ id: "v", name: "Variante", size: 20, groups: [
            [{ userId: "a", spec: "Warrior-Protection" }, { userId: "b", spec: "" }, null, null, null],
            [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null],
        ] }]);
        expect(migrationSummary(out)).toEqual({ kaders: 1, roster: 1, bench: 1, variants: 1 });
        expect(migrateLegacyPlanner({ v: 2, kaders: [] })).toBeNull();
        expect(migrateLegacyPlanner({})).toBeNull();
        expect(migrateLegacyPlanner(null)).toBeNull();
        expect(migrationSummary(null)).toEqual({ kaders: 0, roster: 0, bench: 0, variants: 0 });
    });
});
