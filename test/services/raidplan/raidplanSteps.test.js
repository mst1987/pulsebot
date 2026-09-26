// The tactic of a raid plan section (src/services/raidplan/raidplanSteps.js): validation, migration of the old tactic rows and notes, resolution.
const { tempStoreFile } = require("../../helpers/tempStore");
const steps = require("../../../src/services/raidplan/raidplanSteps");
const board = require("../../../src/services/raidplan/raidplanBoard");
const profiles = require("../../../src/stores/raidplanProfileStore");

const step = (over) => ({ id: "s1", action: "tank", participants: [], sentence: "tankt den Boss", targets: [], timing: { kind: "" }, ...over });

describe("cleaning steps", () => {
    it("keeps a full step and fixes what is off: unknown action -> note, unknown refs dropped, users only of the lineup", () => {
        const r = steps.cleanSteps([step({
            action: "fly",
            participants: ["slot:tank:1", "class:Mage:1:any", "class:Any:1:tank", "group:3", "user:u1", "user:stranger", "slot:tank:1", "bogus", "group:99"],
            targets: [{ kind: "mob", ref: "b:bt/supremus", name: "Supremus", icon: "boss:601" }, { kind: "zone", ref: "Arena" }, { kind: "mark", ref: "skull" }, { kind: "group", ref: "2" }, { kind: "mark", ref: "moonx" }, { kind: "zone", ref: "Arena" }],
            timing: { kind: "hp", from: 50, to: 30 },
        })], new Set(["u1"]));
        expect(r.steps).toEqual([{
            id: "s1", action: "note",
            participants: ["slot:tank:1", "class:Mage:1:any", "class:Any:1:tank", "group:3", "user:u1"],
            sentence: "tankt den Boss",
            targets: [{ kind: "mob", ref: "b:bt/supremus", name: "Supremus", icon: "boss:601" }, { kind: "zone", ref: "Arena" }, { kind: "mark", ref: "skull" }, { kind: "group", ref: "2" }],
            timing: { kind: "hp", from: 50, to: 30, text: "" },
        }]);
        expect(r.dropped).toBe(6);
    });
    it("a template (no lineup) keeps slots and classes, never a player", () => {
        expect(steps.cleanSteps([step({ participants: ["user:u1", "slot:healer:2"] })]).steps[0].participants).toEqual(["slot:healer:2"]);
    });
    it("clamps texts and timings, drops an empty step, refuses too many steps", () => {
        const long = "x".repeat(300);
        const r = steps.cleanSteps([step({ sentence: long, timing: { kind: "phase", from: 42 } }), step({ id: "s2", sentence: "  ", participants: [] }), step({ id: "s1", timing: { kind: "interval", from: 0 } })]);
        expect(r.steps).toHaveLength(2);
        expect(r.steps[0].sentence).toHaveLength(160);
        expect(r.steps[0].timing).toEqual({ kind: "phase", from: 9, to: null, text: "" });
        expect(r.steps[1].timing).toEqual({ kind: "interval", from: 1, to: null, text: "" });
        expect(r.steps[1].id).not.toBe("s1");
        expect(steps.cleanTiming({ kind: "hp", from: 30, to: 50 })).toEqual({ kind: "hp", from: 30, to: null, text: "" });
        expect(steps.cleanTiming({ kind: "text", text: "" })).toEqual({ kind: "", from: null, to: null, text: "" });
        expect(steps.cleanTiming({ kind: "later" }).kind).toBe("");
        expect(steps.cleanSteps(Array.from({ length: 31 }, (_, i) => step({ id: `s${i}` }))).code).toBe("invalid");
    });
    it("a board keeps its steps, a template board drops players from them, new ids when copied", () => {
        const c = board.cleanBoard({ steps: [step({ participants: ["user:u1", "slot:tank:1"] })] }, { allowedUserIds: [] });
        expect(c.board.steps[0].participants).toEqual(["slot:tank:1"]);
        expect(board.boardHasContent(c.board)).toBe(true);
        expect(board.reidBoard(c.board).steps[0].id).not.toBe(c.board.steps[0].id);
    });
});

describe("resolving steps (each on its own, no fallback)", () => {
    const roster = [
        { userId: "war", classId: "Warrior", role: "tank", group: 1 }, { userId: "mage", classId: "Mage", role: "ranged", group: 2 },
        { userId: "pal", classId: "Paladin", role: "healer", group: 1 },
    ];
    it("a mage of any spec tanks; the same class reference in two steps is the same raider; groups stay; strangers leave", () => {
        const list = [step({ participants: ["class:Mage:1:any", "group:2"] }), step({ id: "s2", participants: ["class:Mage:1:any", "user:gone"] })];
        const r = steps.resolveSteps(list, { roster, known: new Set(["war", "mage", "pal"]) });
        expect(r[0].participants).toEqual(["user:mage", "group:2"]);
        expect(r[1].participants).toEqual(["user:mage"]);
        expect([...steps.stepUsers(r)]).toEqual(["mage"]);
    });
    it("a tanking step takes tank specs only; a missing class stays its reference (an open chip)", () => {
        const r = steps.resolveSteps([step({ participants: ["class:Mage:1", "class:Druid:1:any"] }), step({ id: "h", action: "heal", participants: ["class:Paladin:1"] })], { roster });
        expect(r[0].participants).toEqual(["class:Mage:1", "class:Druid:1:any"]);
        expect(r[1].participants).toEqual(["user:pal"]);
    });
});

describe("migration of the old tactic profiles", () => {
    beforeEach(() => profiles.useFile(tempStoreFile("raidplan-profiles-steps.json")));
    afterAll(() => profiles.useFile());
    it("reads the old row titles as note steps (stable), keeps the note, and stores new steps without players", () => {
        const fs = require("fs");
        const file = tempStoreFile("raidplan-profiles-steps.json");
        profiles.useFile(file);
        fs.writeFileSync(file, JSON.stringify({ profiles: [{ id: "p1", name: "Alt", category: "Tank", bossKey: "", targets: [{ title: "Main-Tank" }, { title: "Off-Tank" }], notes: "Notiz" }] }));
        const p = profiles.getProfile("p1");
        expect(p.steps.map((s) => [s.id, s.action, s.sentence, s.participants])).toEqual([["t1", "note", "Main-Tank", []], ["t2", "note", "Off-Tank", []]]);
        expect(p.notes).toBe("Notiz");
        expect(profiles.getProfile("p1")).toEqual(p);
        const made = profiles.createProfile({ name: "Kiten", category: "Kiten", steps: [step({ action: "kite", participants: ["user:u1", "slot:tank:2"], sentence: "kitet" })] });
        expect(made.profile.steps[0]).toMatchObject({ action: "kite", participants: ["slot:tank:2"], sentence: "kitet" });
        expect(profiles.createProfile({ name: "x", steps: "no" }).code).toBe("invalid");
    });
});
