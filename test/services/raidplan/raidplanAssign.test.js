// Assignments (Einteilungen): validation, references, suggestions (pure), and how they live in a board.
const assign = require("../../../src/services/raidplan/raidplanAssign");
const board = require("../../../src/services/raidplan/raidplanBoard");
const raidplan = require("../../../src/web/raidplan/raidplan");
const catalogStore = require("../../../src/stores/raidplanCatalogStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { person: basePerson } = require("../../factories/raidplan");

beforeAll(() => catalogStore.useFile(tempStoreFile("assign-catalog.json")));

const slot = (kind, n, userId = "") => ({ kind, n, userId });
const person = (userId, classId, role, group = 1) => basePerson({ userId, classId, role, group });
const refs = (list) => list.map((a) => `${a.assignees.join("+")}>${a.targets.map((t) => `${t.kind}:${t.ref}`).join(",")}`);

describe("cleanAssignments", () => {
    const allowed = new Set(["u1", "u2"]);
    it("keeps valid references, drops the rest and counts it", () => {
        const r = assign.cleanAssignments([{
            id: "a1", type: "heal",
            assignees: ["slot:healer:2", "user:u1", "user:zzz", "slot:group:1", "slot:healer:2", "nonsense"],
            targets: [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "3" }, { kind: "group", ref: "0" }, { kind: "player", ref: "u2" }, { kind: "player", ref: "nope" },
                { kind: "mark", ref: "skull" }, { kind: "mark", ref: "banana" }, { kind: "text", ref: "  Fear  " }, { kind: "text", ref: "" }, { kind: "who", ref: "x" }],
            note: "n".repeat(500),
        }], allowed);
        const a = r.assignments[0];
        expect(a.assignees).toEqual(["slot:healer:2", "user:u1"]);
        expect(a.targets.map((t) => `${t.kind}:${t.ref}`)).toEqual(["slot:tank:1", "group:3", "player:u2", "mark:skull", "text:Fear"]);
        expect(a.note).toHaveLength(200);
        expect(r.dropped).toBe(9);
    });
    it("in a template (nobody allowed) drops users and players but keeps slot placeholders", () => {
        const r = assign.cleanAssignments([{ type: "md", assignees: ["slot:melee:1", "user:u1"], targets: [{ kind: "player", ref: "u1" }, { kind: "slot", ref: "tank:2" }] }]);
        expect(r.assignments[0].assignees).toEqual(["slot:melee:1"]);
        expect(r.assignments[0].targets).toEqual([{ kind: "slot", ref: "tank:2" }]);
    });
    it("an unknown type becomes 'other', ids are made unique, the suggestion flag is a boolean", () => {
        const r = assign.cleanAssignments([{ id: "x", type: "wat", suggested: "yes" }, { id: "x", type: "kick", suggested: true }, { type: "curse" }]);
        expect(r.assignments.map((a) => a.type)).toEqual(["other", "kick", "curse"]);
        expect(new Set(r.assignments.map((a) => a.id)).size).toBe(3);
        expect(r.assignments.map((a) => a.suggested)).toEqual([false, true, false]);
    });
    it("caps the length of the lists and refuses too many assignments", () => {
        const many = Array.from({ length: 20 }, (_, i) => `slot:healer:${i + 1}`);
        const r = assign.cleanAssignments([{ type: "heal", assignees: many, targets: many.map((_, i) => ({ kind: "group", ref: String(i + 1) })) }]);
        expect(r.assignments[0].assignees).toHaveLength(12);
        expect(r.assignments[0].targets).toHaveLength(12);
        expect(assign.cleanAssignments(Array.from({ length: 61 }, () => ({ type: "heal" }))).code).toBe("invalid");
        expect(assign.cleanAssignments("garbage").assignments).toEqual([]);
    });
});

describe("assignments in a board", () => {
    it("are cleaned with the board, count as content and get new ids when a template is copied", () => {
        const r = board.cleanBoard({ assignments: [{ id: "k", type: "kick", assignees: ["slot:melee:1"], targets: [{ kind: "text", ref: "Fear" }] }] });
        expect(r.board.assignments).toHaveLength(1);
        expect(board.boardHasContent(r.board)).toBe(true);
        expect(board.boardHasContent(board.cleanBoard({}).board)).toBe(false);
        const copy = board.reidBoard(r.board);
        expect(copy.assignments[0].id).not.toBe("k");
        expect(copy.assignments[0].assignees).toEqual(["slot:melee:1"]);
    });
    it("cleanBoard passes a too-long list on as an error", () => {
        expect(board.cleanBoard({ assignments: Array.from({ length: 61 }, () => ({})) }).code).toBe("invalid");
    });
});

describe("suggest: heal", () => {
    const slots = [slot("tank", 1), slot("tank", 2), slot("tank", 3), ...[1, 2, 3, 4, 5, 6, 7].map((n) => slot("healer", n))];
    it("pairs healer 1 with tank 1 and so on, the rest take the groups, every group covered and even", () => {
        const r = assign.suggest("heal", { slots, groups: [1, 2, 3, 4, 5] });
        expect(r).toHaveLength(7);
        expect(r.every((a) => a.suggested && a.type === "heal")).toBe(true);
        expect(refs(r).slice(0, 3)).toEqual(["slot:healer:1>slot:tank:1", "slot:healer:2>slot:tank:2", "slot:healer:3>slot:tank:3"]);
        const groups = r.flatMap((a) => a.targets.filter((t) => t.kind === "group").map((t) => t.ref)).sort();
        expect(groups).toEqual(["1", "2", "3", "4", "5"]);
        // four non-tank healers take five groups: nobody more than two, the tank healers only when needed
        expect(Math.max(...r.map((a) => a.targets.length))).toBeLessThanOrEqual(2);
        expect(r[0].targets).toHaveLength(2 - 1 + (r[0].targets.filter((t) => t.kind === "group").length));
    });
    it("gives a group to a tank healer when there are fewer free healers than groups", () => {
        const r = assign.suggest("heal", { slots: [slot("tank", 1), slot("healer", 1), slot("healer", 2)], groups: [1, 2, 3, 4, 5] });
        const groups = r.flatMap((a) => a.targets.filter((t) => t.kind === "group"));
        expect(groups).toHaveLength(5);
    });
    it("more tanks than healers: the healers take several tanks", () => {
        const r = assign.suggest("heal", { slots: [slot("tank", 1), slot("tank", 2), slot("tank", 3), slot("healer", 1), slot("healer", 2)], groups: [] });
        expect(refs(r)).toEqual(["slot:healer:1>slot:tank:1,slot:tank:3", "slot:healer:2>slot:tank:2"]);
    });
    it("uses the roster's healers when the board has no healer slots, and suggests nothing without healers", () => {
        const r = assign.suggest("heal", { slots: [slot("tank", 1)], roster: [person("h1", "Priest", "healer")], groups: [1] });
        expect(refs(r)).toEqual(["user:h1>slot:tank:1,group:1"]);
        expect(assign.suggest("heal", { slots, roster: [], groups: [] }).length).toBe(3);
        expect(assign.suggest("heal", { slots: [slot("tank", 1)], roster: [person("d", "Mage", "ranged")], groups: [1] })).toEqual([]);
    });
});

describe("suggest: class based, never wrong, empty when nobody fits", () => {
    const roster = [
        person("t1", "Warrior", "tank"), person("w1", "Warrior", "melee"), person("r1", "Rogue", "melee"), person("s1", "Shaman", "ranged"),
        person("m1", "Mage", "ranged"), person("h1", "Hunter", "ranged"), person("h2", "Hunter", "ranged"), person("l1", "Warlock", "ranged"),
        person("l2", "Warlock", "ranged"), person("p1", "Priest", "healer"), person("p2", "Paladin", "healer"),
    ];
    const slots = [slot("tank", 1), slot("tank", 2), slot("tank", 3)];
    it("kicks: rogue, shaman, warrior in a rotation of three", () => {
        expect(refs(assign.suggest("kick", { roster }))).toEqual(["user:r1+user:s1+user:t1>"]);
    });
    it("misdirects: hunters to tanks; fear ward: priest to tank; soulstone: warlock to healer; curses: warlocks", () => {
        expect(refs(assign.suggest("md", { roster, slots }))).toEqual(["user:h1>slot:tank:1", "user:h2>slot:tank:2", "user:r1>slot:tank:3"]);
        expect(refs(assign.suggest("fearward", { roster, slots }))).toEqual(["user:p1>slot:tank:1"]);
        expect(refs(assign.suggest("ss", { roster }))).toEqual(["user:l1>player:p1", "user:l2>player:p2"]);
        // one curse per warlock, the spell comes from the catalog (with a snapshot of its name and icon)
        const curses = assign.suggest("curse", { roster });
        expect(curses.map((a) => a.assignees[0])).toEqual(["user:l1", "user:l2"]);
        expect(curses.map((a) => a.spell.name)).toEqual(["Curse of the Elements", "Curse of Recklessness"]);
        expect(curses[0].spell).toMatchObject({ id: "d:curse-of-the-elements", icon: "spell_shadow_chilltouch" });
    });
    it("thunder clap: warrior tanks first; demoralizing shout: the warriors", () => {
        expect(refs(assign.suggest("thunderclap", { roster }))).toEqual(["user:t1+user:w1>"]);
        expect(refs(assign.suggest("demoshout", { roster }))).toEqual(["user:t1+user:w1>"]);
    });
    it("trash tanks: tank n to the n-th raid mark, from slot placeholders alone", () => {
        expect(refs(assign.suggest("trashtank", { slots }))).toEqual(["slot:tank:1>mark:skull", "slot:tank:2>mark:cross", "slot:tank:3>mark:square"]);
    });
    it("nothing fits, nothing is suggested", () => {
        const none = [person("x", "Druid", "ranged")];
        for (const type of ["kick", "md", "ss", "fearward", "curse", "thunderclap", "demoshout"]) expect(assign.suggest(type, { roster: none, slots })).toEqual([]);
        expect(assign.suggest("md", { roster, slots: [] })).toEqual([]);
        expect(assign.suggest("special", { roster, slots })).toEqual([]);
        expect(assign.suggest("trashtank", {})).toEqual([]);
    });
});

describe("suggestFor (from an event)", () => {
    it("uses the event's size for the groups and passes slots through", () => {
        const event = { id: "e", size: 10, versionId: "tbc", setup: { groups: [{ index: 1, slots: [{ userId: "h1", spec: "Priest-Holy", role: "healer" }] }], bench: [] } };
        // only slots somebody stands in count in an event (an open healer slot is not a healer)
        const r = raidplan.suggestFor("heal", { event, slots: [{ kind: "healer", n: 1, userId: "h1" }, { kind: "tank", n: 1, userId: "t1" }, { kind: "healer", n: 2 }] });
        expect(refs(r)).toEqual(["slot:healer:1>slot:tank:1,group:1,group:2"]);
        // a healer who plays DPS on this boss (flex) is no healer here
        expect(raidplan.suggestFor("md", { event: { ...event, setup: { groups: [{ index: 1, slots: [{ userId: "h9", spec: "Hunter-BeastMastery", role: "ranged" }] }], bench: [] } }, slots: [{ kind: "tank", n: 1, userId: "t1" }] }).length).toBe(1);
        expect(raidplan.suggestFor("heal", { event, slots: [{ kind: "healer", n: 1, userId: "h1" }, { kind: "tank", n: 1, userId: "t1" }], roles: { h1: "dps" } }).length).toBe(1);
    });
    it("works without an event (a template)", () => {
        expect(assign.SUGGESTABLE).toContain("heal");
        expect(raidplan.suggestFor("trashtank", { slots: [{ kind: "tank", n: 1 }, { kind: "tank", n: "x" }, null] }).length).toBe(1);
    });
});
