// The raid-wide tasks of the "Allgemein" section (#536): the new types debuff, blessing, aura, totem and brez - their catalog spells, the
// validation of a save, the ranking (Sunder Armor by the warrior tank is fine) and the suggestions (one blessing per paladin, an aura / a
// totem per paladin / shaman for his group by his role, the debuffs on the boss). The client twin of the ranking rule runs in
// src/web-client/src/lib/raidplan/rank.test.ts.
const assign = require("../../../src/services/raidplan/raidplanAssign");
const defaults = require("../../../src/services/raidplan/raidplanCatalogDefaults");
const { ASSIGN_TYPES, CLASS_IDS } = assign;
const raidplan = require("../../../src/web/raidplan/raidplan");
const catalogStore = require("../../../src/stores/raidplanCatalogStore");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeEach(() => catalogStore.useFile(tempStoreFile("general-types-catalog.json")));

const NEW_TYPES = ["debuff", "blessing", "aura", "totem", "brez"];
const P = (userId, classId, role, group = 1, specRole = role) => ({ userId, character: userId, classId, role, specRole, group });
const spellOf = (a) => (a.spell ? a.spell.id.replace(/^d:/, "") : "");

// a 25er with every class the new tasks need
const roster = [
    P("wtank", "Warrior", "tank", 1), P("wdps", "Warrior", "melee", 1),
    P("bear", "Druid", "tank", 1), P("tree", "Druid", "healer", 4),
    P("prot", "Paladin", "tank", 1), P("ret", "Paladin", "melee", 2), P("holy", "Paladin", "healer", 4),
    P("enh", "Shaman", "melee", 2), P("ele", "Shaman", "ranged", 3), P("resto", "Shaman", "healer", 4),
    P("hunt", "Hunter", "ranged", 3), P("mage", "Mage", "ranged", 3), P("spriest", "Priest", "ranged", 3), P("hpriest", "Priest", "healer", 4),
    P("rogue", "Rogue", "melee", 2), P("lock1", "Warlock", "ranged", 5), P("lock2", "Warlock", "ranged", 5),
];

describe("catalog defaults of the new types", () => {
    it("every default spell has a unique id, a known type, known classes and an icon name", () => {
        const ids = defaults.SPELLS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of defaults.SPELLS) {
            expect(ASSIGN_TYPES).toContain(s.type);
            expect(s.classes.length).toBeGreaterThan(0);
            for (const c of s.classes) expect(CLASS_IDS).toContain(c);
            expect(s.icon).toMatch(/^[a-z0-9_]+$/);
        }
    });
    it("each new type has its spells, with the classes that cast them in TBC", () => {
        const of = (type) => defaults.SPELLS.filter((s) => s.type === type);
        for (const type of NEW_TYPES) expect(of(type).length).toBeGreaterThan(0);
        for (const s of of("blessing")) expect(s.classes).toEqual(["Paladin"]);
        for (const s of of("totem")) expect(s.classes).toEqual(["Shaman"]);
        expect(of("brez").map((s) => [s.name, s.classes])).toEqual([["Rebirth", ["Druid"]]]);
        expect(of("blessing").map((s) => s.name)).toEqual(["Blessing of Kings", "Blessing of Might", "Blessing of Wisdom", "Blessing of Salvation", "Blessing of Light", "Blessing of Sanctuary"]);
        expect(of("debuff").map((s) => s.name)).toEqual(expect.arrayContaining(["Sunder Armor", "Expose Armor", "Faerie Fire", "Hunter's Mark", "Improved Scorch", "Shadow Weaving", "Misery", "Judgement of Wisdom", "Judgement of Light", "Judgement of the Crusader"]));
        expect(of("buff").map((s) => s.name)).toEqual(expect.arrayContaining(["Innervate", "Battle Shout", "Commanding Shout", "Prayer of Fortitude", "Prayer of Spirit", "Prayer of Shadow Protection", "Arcane Brilliance", "Gift of the Wild"]));
        // Curse of Recklessness stays a curse
        expect(defaults.SPELLS.find((s) => s.id === "d:curse-of-recklessness").type).toBe("curse");
        // TBC entries, nothing of a later expansion (#544: every default names its version)
        for (const s of [...NEW_TYPES.flatMap(of), ...of("buff")]) expect(s.versions).toEqual(["tbc"]);
    });
    it("the store gives the classes of a type from its spells", () => {
        expect(catalogStore.classesOf("blessing", "tbc")).toEqual(["Paladin"]);
        expect(catalogStore.classesOf("aura", "tbc")).toEqual(["Paladin", "Hunter", "Druid"]);
        expect(catalogStore.classesOf("debuff", "tbc")).toEqual(["Warrior", "Rogue", "Druid", "Hunter", "Mage", "Priest", "Paladin"]);
        expect(assign._internal.classesFor("totem", [], false, "tbc")).toEqual(["Shaman"]);
    });
});

describe("a save keeps the new types", () => {
    it("rows of the new types keep their type and spell; an unknown type is still 'other'", () => {
        const rows = NEW_TYPES.map((type, i) => ({ id: `r${i}`, type, assignees: ["class:Paladin:1"], targets: [{ kind: "group", ref: "2" }], spell: { id: "d:blessing-of-kings", name: "Blessing of Kings", icon: "spell_magic_magearmor" } }));
        const r = assign.cleanAssignments([...rows, { id: "x", type: "bogus", assignees: [], targets: [] }]);
        expect(r.assignments.map((a) => a.type)).toEqual([...NEW_TYPES, "other"]);
        expect(r.assignments[1].spell).toEqual({ id: "d:blessing-of-kings", name: "Blessing of Kings", icon: "spell_magic_magearmor" });
        expect(r.assignments[3].targets).toEqual([{ kind: "group", ref: "2" }]);
    });
    it("every new type is suggestable", () => {
        for (const type of NEW_TYPES) expect(assign.SUGGESTABLE).toContain(type);
    });
});

describe("ranking: a tank keeps up his own debuffs", () => {
    const tank = P("t", "Warrior", "tank");
    const dps = P("d", "Warrior", "melee");
    it("no tank penalty on Sunder Armor / Faerie Fire, the usual one on another debuff", () => {
        expect(assign.scoreCandidate({ type: "debuff", spell: { id: "d:sunder-armor" } }, tank).parts.tank).toBe(0);
        expect(assign.scoreCandidate({ type: "debuff", spell: { id: "d:faerie-fire" } }, tank).parts.tank).toBe(0);
        expect(assign.scoreCandidate({ type: "debuff", spell: { id: "d:hunters-mark" } }, tank).parts.tank).toBe(assign.RANK_POINTS.tank);
        expect(assign.scoreCandidate({ type: "debuff" }, tank).parts.tank).toBe(assign.RANK_POINTS.tank);
        expect(assign.withoutMisfits({ type: "debuff", spell: { id: "d:sunder-armor" } }, [tank, dps]).map((p) => p.userId)).toEqual(["t", "d"]);
        expect(assign.withoutMisfits({ type: "debuff" }, [tank, dps]).map((p) => p.userId)).toEqual(["d"]);
    });
    it("a protection paladin blesses and has an aura without a penalty; a healer only debuffs when nobody else can", () => {
        const prot = P("p", "Paladin", "tank");
        const holy = P("h", "Paladin", "healer");
        expect(assign.scoreCandidate({ type: "blessing" }, prot).parts.tank).toBe(0);
        expect(assign.scoreCandidate({ type: "aura" }, prot).parts.tank).toBe(0);
        expect(assign.scoreCandidate({ type: "debuff" }, holy).parts.healer).toBe(assign.RANK_POINTS.healer);
        expect(assign.withoutMisfits({ type: "debuff" }, [holy]).map((p) => p.userId)).toEqual(["h"]);
    });
});

describe("suggestions of the new types (event)", () => {
    const who = (list) => list.map((a) => `${spellOf(a)}:${a.assignees.join("+")}${a.targets.length ? `>${a.targets.map((t) => t.ref).join(",")}` : ""}`);
    it("blessings: one per paladin, Kings / Might / Wisdom in that order", () => {
        const r = assign.suggest("blessing", { roster, versionId: "tbc" });
        expect(r.map(spellOf)).toEqual(["blessing-of-kings", "blessing-of-might", "blessing-of-wisdom"]);
        expect(new Set(r.map((a) => a.assignees[0])).size).toBe(3);
        for (const a of r) expect(a.assignees[0]).toMatch(/^user:(prot|ret|holy)$/);
        expect(r.every((a) => a.suggested)).toBe(true);
    });
    it("auras: each paladin for his group, the aura by his role", () => {
        expect(who(assign.suggest("aura", { roster, versionId: "tbc" }))).toEqual(["devotion-aura:user:prot>1", "retribution-aura:user:ret>2", "concentration-aura:user:holy>4"]);
    });
    it("totems: each shaman for his group by his role; a second one of the same role in the group takes the next totem", () => {
        expect(who(assign.suggest("totem", { roster, versionId: "tbc" }))).toEqual(["windfury-totem:user:enh>2", "wrath-of-air-totem:user:ele>3", "mana-spring-totem:user:resto>4"]);
        const two = [P("e1", "Shaman", "melee", 1), P("e2", "Shaman", "melee", 1)];
        expect(who(assign.suggest("totem", { roster: two, versionId: "tbc" }))).toEqual(["windfury-totem:user:e1>1", "grace-of-air-totem:user:e2>1"]);
        // a shaman the orga already gave a totem keeps it; the others go round him and his group's totem
        const keep = [{ id: "k", type: "totem", assignees: ["user:e1"], targets: [{ kind: "group", ref: "1" }], spell: { id: "d:windfury-totem", name: "Windfury Totem", icon: "spell_nature_windfury" } }];
        expect(who(assign.suggest("totem", { roster: two, versionId: "tbc", keep }))).toEqual(["grace-of-air-totem:user:e2>1"]);
    });
    it("debuffs: Sunder and Faerie Fire from the tanks, the shadow priest's and the mage's, judgements not from the holy paladin first", () => {
        const r = assign.suggest("debuff", { roster, versionId: "tbc" });
        expect(who(r)).toEqual([
            "sunder-armor:user:wtank", "faerie-fire:user:bear", "hunters-mark:user:hunt", "improved-scorch:user:mage",
            "shadow-weaving:user:spriest", "judgement-of-wisdom:user:ret", "judgement-of-light:user:holy",
        ]);
    });
    it("the row dialog's wand (spellId) asks for that spell only", () => {
        const r = assign.suggest("debuff", { roster, versionId: "tbc", spellId: "d:judgement-of-the-crusader" });
        expect(who(r)).toEqual(["judgement-of-the-crusader:user:ret"]);
        expect(who(assign.suggest("totem", { roster, versionId: "tbc", spellId: "d:tremor-totem" }))).toEqual(["tremor-totem:user:enh>2"]);
        expect(who(assign.suggest("blessing", { roster, versionId: "tbc", spellId: "d:blessing-of-salvation" }))).toHaveLength(1);
    });
    it("battle res: one druid with Rebirth; soulstones still go from the warlocks onto the healers", () => {
        const r = assign.suggest("brez", { roster, versionId: "tbc" });
        expect(r).toHaveLength(1);
        expect(r[0].spell.id).toBe("d:rebirth");
        expect(r[0].assignees[0]).toMatch(/^user:(bear|tree)$/);
        const ss = assign.suggest("ss", { roster, versionId: "tbc" });
        expect(ss.length).toBe(2);
        expect(ss.every((a) => /^user:lock[12]$/.test(a.assignees[0]))).toBe(true);
    });
    it("nobody of the class = no suggestion", () => {
        const none = [P("x", "Rogue", "melee")];
        for (const type of ["blessing", "aura", "totem", "brez"]) expect(assign.suggest(type, { roster: none, versionId: "tbc" })).toEqual([]);
    });
    it("a spell the admin hid is not handed out", () => {
        catalogStore.remove("spells", "d:sunder-armor");
        const left = assign.suggest("debuff", { roster, versionId: "tbc" }).map(spellOf);
        expect(left).not.toContain("sunder-armor");
        expect(left).toContain("faerie-fire");
    });
});

describe("suggestions of the new types (template: no players)", () => {
    it("class references with the spell", () => {
        const deb = assign.suggest("debuff", { roster: [], versionId: "tbc" });
        expect(deb.map((a) => `${spellOf(a)}:${a.assignees[0]}`)).toEqual([
            "sunder-armor:class:Warrior:1:tank", "faerie-fire:class:Druid:1:tank", "hunters-mark:class:Hunter:1", "improved-scorch:class:Mage:1:dps",
            "shadow-weaving:class:Priest:1:dps", "judgement-of-wisdom:class:Paladin:1", "judgement-of-light:class:Paladin:2",
        ]);
        const bl = assign.suggest("blessing", { roster: [], versionId: "tbc" });
        expect(bl.map((a) => `${spellOf(a)}:${a.assignees[0]}`)).toEqual(["blessing-of-kings:class:Paladin:1", "blessing-of-might:class:Paladin:2", "blessing-of-wisdom:class:Paladin:3", "blessing-of-salvation:class:Paladin:4"]);
        expect(assign.suggest("totem", { roster: [] }).map((a) => `${spellOf(a)}:${a.assignees[0]}`)).toEqual(["windfury-totem:class:Shaman:1"]);
        expect(assign.suggest("aura", { roster: [] }).map((a) => `${spellOf(a)}:${a.assignees[0]}`)).toEqual(["devotion-aura:class:Paladin:1"]);
        expect(assign.suggest("brez", { roster: [] }).map((a) => `${spellOf(a)}:${a.assignees[0]}`)).toEqual(["rebirth:class:Druid:1"]);
    });
});

describe("suggestFor passes the row's spell through", () => {
    it("an event's totem wand for Tremor Totem names the one shaman", () => {
        const event = { id: "e536", size: 10, versionId: "tbc", setup: { groups: [{ index: 2, slots: [{ userId: "s1", spec: "Shaman-Enhancement", role: "melee" }] }], bench: [] } };
        const r = raidplan.suggestFor("totem", { event, slots: [], spellId: "d:tremor-totem" });
        expect(r.map((a) => [a.assignees[0], a.spell.id, a.targets])).toEqual([["user:s1", "d:tremor-totem", [{ kind: "group", ref: "2" }]]]);
    });
});
