// The one-off switch of #524 (src/services/raidplan/raidplanDefaultsMigration.js, raidplanStore.migrateEventDefaults): the copies of a
// template's Standard that "Vorlage anwenden" wrote into every boss before #524 become the event's Standard again. Golden master: plans
// built exactly the way the old apply built them, edited the way an orga edits them; the effective rows of every section must read the
// same before and after.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const plans = require("../../../src/stores/raidplanStore");
const inherit = require("../../../src/services/raidplan/raidplanInherit");
const board = require("../../../src/services/raidplan/raidplanBoard");
const { migratePlan, signature } = require("../../../src/services/raidplan/raidplanDefaultsMigration");

const SUPREMUS = "bt/supremus";
const GURTOGG = "bt/gurtogg-bloodboil";
const COUNCIL = "bt/the-illidari-council";
const ILLIDAN = "bt/illidan-stormrage";
const TRASH = "bt/trash";
const SECTIONS = plans.bossesForInstances(["bt"]);
const CATALOG = [{ id: "d:flame", name: "Flame of Azzinoth", icon: "", bossKey: ILLIDAN, kind: "add", instanceId: "bt" }];

const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const g = (n) => ({ kind: "group", ref: String(n) });
// the Standard of the user's screenshot: Tank 1 -> the boss, and the heal card with class references on tanks and groups
const DEFAULTS = [
    row("d1", "tank", ["slot:tank:1"], [{ kind: "mob", ref: inherit.THIS_BOSS, name: "", icon: "" }]),
    row("d2", "heal", ["class:Paladin:1"], [{ kind: "slot", ref: "tank:1" }]),
    row("d3", "heal", ["class:Shaman:1"], [{ kind: "slot", ref: "tank:2" }, { kind: "slot", ref: "tank:1" }]),
    row("d4", "heal", ["class:Shaman:2"], [g(1), g(2)]),
    row("d5", "heal", ["slot:healer:4"], [g(5), g(4), g(3)]),
    row("d6", "heal", ["class:Priest:1"], [g(3), g(1), g(2), g(4), g(5)]),
];
const clean = (b) => board.cleanBoard(b, { allowedUserIds: board.ANY_PLAYER }).board;

/** What raidplanStore.applyTemplate did before #524: the Standard's rows as copies (fresh ids, `origin: "default"`) first in every boss and trash. */
function oldApply(templateBosses) {
    const out = {};
    for (const s of SECTIONS) {
        const tb = templateBosses[s.key] || {};
        if (s.general) { if (templateBosses[s.key]) out[s.key] = clean(board.reidBoard(tb)); continue; }
        const sec = inherit.sectionOf(s, CATALOG, tb.mobs);
        const copies = DEFAULTS.filter((r) => !(tb.inheritOff || []).includes(r.id)).map((r) => inherit.resolveRow(r, sec)).map((r) => ({ ...r, _key: r.id, id: board.newId(5), origin: "default", suggested: false }));
        out[s.key] = clean(board.reidBoard({ ...tb, assignments: [...copies, ...(tb.assignments || [])], tokens: [], inheritOff: [] }));
    }
    return out;
}

/** A realistic old plan: applied from a template, then edited by hand in a few bosses. */
function oldPlan() {
    const bosses = oldApply({
        general: { assignments: [row("c1", "curse", ["class:Warlock:1"], [{ kind: "text", ref: "Elements" }])] },
        [ILLIDAN]: {
            assignments: [row("f1", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "d:flame", name: "Flame of Azzinoth", icon: "", n: 1 }])],
            autoPos: { "t:d1:1": { x: 0.2, y: 0.8 } },
        },
    });
    // Supremus: the Paladin heal of the Standard edited by hand in this boss (Paladin 2 instead of 1)
    const sup = bosses[SUPREMUS].assignments;
    const pal = sup.findIndex((a) => a.assignees[0] === "class:Paladin:1");
    sup[pal] = { ...sup[pal], assignees: ["class:Paladin:2"] };
    // Gurtogg: the Priest row deleted, a kick added
    bosses[GURTOGG].assignments = bosses[GURTOGG].assignments.filter((a) => a.assignees[0] !== "class:Priest:1");
    bosses[GURTOGG].assignments.push(row("k1", "kick", ["class:Rogue:1"], [{ kind: "text", ref: "Fel Rage" }]));
    // Council: an own row moved in front of the copies (a board whose order the Standard could not keep)
    bosses[COUNCIL].assignments.unshift(row("cc", "special", ["class:Mage:1:any"], [{ kind: "text", ref: "Zerevor" }]));
    return bosses;
}

const strip = (rows) => rows.map((a) => {
    const rest = { ...a };
    for (const k of ["id", "origin", "suggested"]) delete rest[k];
    return rest;
});
const effective = (bosses, key) => {
    const meta = SECTIONS.find((s) => s.key === key);
    return inherit.effectiveRows(bosses, key, inherit.sectionOf(meta, CATALOG, (bosses[key] || {}).mobs));
};

describe("migratePlan: the copies of the Standard become the event's Standard", () => {
    const before = oldPlan();
    const r = migratePlan(before, SECTIONS, CATALOG);
    const std = r.bosses[inherit.DEFAULTS_KEY].assignments;

    it("makes one Standard row of each row the bosses share, in the Standard's order, the boss target relative again", () => {
        expect(r.rows).toBe(6);
        expect(std.map((a) => a.assignees[0])).toEqual(["slot:tank:1", "class:Paladin:1", "class:Shaman:1", "class:Shaman:2", "slot:healer:4", "class:Priest:1"]);
        expect(std[0].targets).toEqual([expect.objectContaining({ kind: "mob", ref: inherit.THIS_BOSS })]);
        expect(std.every((a) => a.origin === "" && a.suggested === false)).toBe(true);
        // nine bosses and the trash: 10 sections, Council kept its board, Supremus and Gurtogg deviate in one row each
        expect(r.kept).toBe(1);
        expect(r.deviations).toBe(1);
        expect(r.copies).toBe(10 * 6 - 6 - 1 - 1);
    });

    it("golden master: the EFFECTIVE rows of every section are exactly what the section had (content and order)", () => {
        for (const s of SECTIONS) expect(strip(effective(r.bosses, s.key))).toEqual(strip((before[s.key] || { assignments: [] }).assignments));
    });

    it("a boss whose copy differs keeps it as its deviation; a boss that deleted a copy switches the row off", () => {
        const paladin = std[1].id;
        expect(r.bosses[SUPREMUS].inheritOff).toEqual([paladin]);
        expect(r.bosses[SUPREMUS].assignments).toEqual([expect.objectContaining({ assignees: ["class:Paladin:2"], origin: paladin })]);
        expect(r.bosses[GURTOGG].inheritOff).toEqual([std[5].id]);
        expect(r.bosses[GURTOGG].assignments.map((a) => a.id)).toEqual(["k1"]);
        // an untouched boss: nothing of its own left, nothing switched off
        expect(r.bosses["bt/mother-shahraz"].assignments).toEqual([]);
        expect(r.bosses["bt/mother-shahraz"].inheritOff).toEqual([]);
    });

    it("a board whose order the Standard cannot keep stays exactly as it was and inherits nothing", () => {
        expect(r.bosses[COUNCIL].assignments).toEqual(before[COUNCIL].assignments);
        expect(r.bosses[COUNCIL].inheritOff).toEqual(std.map((a) => a.id));
    });

    it("rows without origin 'default' and 'Allgemein' stay as they are; a moved tank keeps its place under the Standard row's key", () => {
        expect(r.bosses.general).toBe(before.general);
        const ill = r.bosses[ILLIDAN];
        expect(ill.assignments.map((a) => a.assignees[0])).toEqual(["slot:tank:2"]);
        expect(ill.assignments[0].id).toBe(before[ILLIDAN].assignments[6].id);
        expect(ill.autoPos).toEqual({ [`t:${std[0].id}:1`]: { x: 0.2, y: 0.8 } });
        // the inherited tank row is keyed by the Standard row (raidplanBoard.rowKey: its origin)
        expect(effective(r.bosses, ILLIDAN)[0].origin).toBe(std[0].id);
        // the trash never had the boss target: it inherits the tank row without one
        expect(effective(r.bosses, TRASH)[0].targets).toEqual([]);
    });

    it("is idempotent: a plan with a Standard, or without copies, is left alone", () => {
        expect(migratePlan(r.bosses, SECTIONS, CATALOG)).toBe(null);
        expect(migratePlan({ [SUPREMUS]: clean({ assignments: [row("a", "kick", ["class:Rogue:1"], [])] }) }, SECTIONS, CATALOG)).toBe(null);
        expect(migratePlan(undefined, SECTIONS, CATALOG)).toBe(null);
    });

    it("a row only one section holds is no Standard row; a section of the event without a board switches every Standard row off", () => {
        const two = oldApply({});
        // only Supremus and the trash have boards: the other bosses have none (a boss with nothing never got stored)
        const only = { [SUPREMUS]: two[SUPREMUS], [TRASH]: two[TRASH], [GURTOGG]: clean({ assignments: [{ ...row("x", "kick", ["class:Rogue:1"], []), origin: "default" }] }) };
        const m = migratePlan(only, SECTIONS, CATALOG);
        expect(m.rows).toBe(6);
        expect(m.bosses[GURTOGG].assignments.map((a) => a.id)).toEqual(["x"]);
        expect(m.bosses["bt/mother-shahraz"].inheritOff).toHaveLength(6);
        for (const s of SECTIONS) expect(strip(effective(m.bosses, s.key))).toEqual(strip((only[s.key] || { assignments: [] }).assignments));
    });

    it("the signature of a row ignores its id, origin and the snapshot of a mob's name", () => {
        const a = row("a", "tank", ["slot:tank:1"], [{ kind: "mob", ref: "b:x", name: "Alt", icon: "1" }], { origin: "default" });
        expect(signature(a)).toBe(signature({ ...a, id: "b", origin: "", targets: [{ kind: "mob", ref: "b:x", name: "Neu", icon: "" }] }));
        expect(signature(a)).not.toBe(signature({ ...a, assignees: ["slot:tank:2"] }));
    });
});

describe("raidplanStore.migrateEventDefaults (run once at start)", () => {
    let file;
    beforeEach(() => {
        file = tempStoreFile("raidplans.json");
        plans.useFile(file);
    });
    afterAll(() => plans.useFile());

    it("switches every old plan once, backs the file up first and marks every plan; a second run does nothing", () => {
        const old = { eventId: "e1", version: 3, status: "draft", bosses: oldPlan() };
        const plain = { eventId: "e2", version: 1, status: "draft", bosses: { [SUPREMUS]: clean({ notes: "x" }) } };
        fs.writeFileSync(file, JSON.stringify({ plans: [old, plain] }));
        const r = plans.migrateEventDefaults({ instanceIdsOf: (p) => (p.eventId === "e1" ? ["bt"] : []), now: new Date("2026-09-28T10:00:00Z") });
        expect(r).toMatchObject({ plans: 2, migrated: 1, rows: 6, deviations: 1, kept: 1 });
        expect(r.backup).toBe(`${file}.bak-20260928`);
        expect(JSON.parse(fs.readFileSync(r.backup, "utf8")).plans[0].bosses).toEqual(old.bosses);
        const p1 = plans.getPlan("e1");
        expect(p1.defaultsMigrated).toBe(true);
        expect(p1.version).toBe(3);
        expect(p1.bosses[inherit.DEFAULTS_KEY].assignments).toHaveLength(6);
        expect(plans.getPlan("e2")).toMatchObject({ defaultsMigrated: true, bosses: plain.bosses });
        // idempotent
        const text = fs.readFileSync(file, "utf8");
        expect(plans.migrateEventDefaults()).toBe(null);
        expect(fs.readFileSync(file, "utf8")).toBe(text);
        fs.rmSync(r.backup, { force: true });
    });

    it("a new plan is born switched; an empty file needs nothing", () => {
        expect(plans.migrateEventDefaults()).toBe(null);
        expect(plans.emptyPlan("e9").defaultsMigrated).toBe(true);
        plans.savePlan("e9", { version: 0, bosses: {} }, { bossKeys: [], allowedUserIds: [], userId: "o" });
        expect(plans.migrateEventDefaults()).toBe(null);
    });

    it("a second backup the same day does not overwrite the first", () => {
        fs.writeFileSync(file, JSON.stringify({ plans: [{ eventId: "e1", bosses: {} }] }));
        fs.writeFileSync(`${file}.bak-20260928`, "first");
        const r = plans.migrateEventDefaults({ now: new Date("2026-09-28T10:00:00Z") });
        expect(r.backup).not.toBe(`${file}.bak-20260928`);
        expect(fs.readFileSync(`${file}.bak-20260928`, "utf8")).toBe("first");
        fs.rmSync(r.backup, { force: true });
        fs.rmSync(`${file}.bak-20260928`, { force: true });
    });
});
