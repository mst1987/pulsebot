// Auto placement from the tank rows (lib/autoPlace.ts): what the rows put on the map (mob instances, tanks, placeholders), the
// layout (deterministic, no overlap, positions moved by hand stay), one place per player, the facing and the editing helpers.
const fs = require("fs");
const path = require("path");
const { loadTs } = require("./i18nHelper");

const lib = loadTs("lib/autoPlace.ts");
const dir = path.join(__dirname, "../../src/web-client/src");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

const board = (extra = {}) => ({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], assignments: [], autoPlace: true, autoPos: {}, objectScale: 1, ...extra });
const row = (id, assignees, targets, extra = {}) => ({ id, type: "tank", title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const mob = (ref, name, n) => ({ kind: "mob", ref, name, icon: "", ...(n ? { n } : {}) });
const BOSS = mob("b:bt/illidan", "Illidan");
const FLAME = (n) => mob("d:flame", "Flame of Azzinoth", n);
const roster = [
    { userId: "u1", character: "Tankwart", classId: "Warrior", role: "tank", group: 1 },
    { userId: "u2", character: "Bollwerk", classId: "Paladin", role: "tank", group: 1 },
    { userId: "u3", character: "Baerchen", classId: "Druid", role: "tank", group: 2 },
    { userId: "u4", character: "Arkanix", classId: "Mage", role: "ranged", group: 3 },
];
const EVENT = { template: false, roster };
const TEMPLATE = { template: true, roster: [] };
const W = 1000;
const H = 625;
/** Whether no two objects of a plan overlap (in the layout's reference px). */
function noOverlap(plan) {
    const pts = [...plan.mobs.filter((m) => !m.iconId).map((m) => ({ x: m.x * W, y: m.y * H, r: 24 })), ...plan.tanks.filter((t) => !t.existing).map((t) => ({ x: t.x * W, y: t.y * H, r: 19 }))];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < pts[i].r + pts[j].r) return false;
    return pts.every((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H);
}

describe("what the tank rows put on the map", () => {
    it("one boss and three tanks: one boss icon in the middle, three tanks in front of it, side by side", () => {
        const plan = lib.deriveAuto([row("r1", ["user:u1", "user:u2", "user:u3"], [BOSS])], board(), EVENT);
        expect(plan.mobs).toHaveLength(1);
        expect(plan.mobs[0]).toMatchObject({ key: "m:b:bt/illidan#1", boss: true, iconId: "", iconKey: "enemy", x: 0.5, y: 0.4 });
        expect(plan.tanks.map((t) => t.key)).toEqual(["t:r1:1", "t:r1:2", "t:r1:3"]);
        expect(plan.tanks.every((t) => t.mobKey === "m:b:bt/illidan#1" && t.state === "player" && !t.existing)).toBe(true);
        // below the boss (towards the raid), all at the same height
        expect(plan.tanks.every((t) => t.y > plan.mobs[0].y)).toBe(true);
        expect(new Set(plan.tanks.map((t) => t.y)).size).toBe(1);
        expect(plan.users).toEqual(["u1", "u2", "u3"]);
        expect(noOverlap(plan)).toBe(true);
    });

    it("two Flames and two tanks: two rows naming the Flame without a number make two Flames, each with its tank, left and right of the boss", () => {
        const rows = [row("r0", ["user:u1"], [BOSS]), row("r1", ["user:u2"], [FLAME()]), row("r2", ["user:u3"], [FLAME()])];
        const plan = lib.deriveAuto(rows, board(), EVENT);
        expect(plan.mobs.map((m) => m.key)).toEqual(["m:b:bt/illidan#1", "m:d:flame#1", "m:d:flame#2"]);
        expect(plan.mobs[1].count).toBe(2);
        expect(plan.tanks.map((t) => t.mobKey)).toEqual(["m:b:bt/illidan#1", "m:d:flame#1", "m:d:flame#2"]);
        const [boss, f1, f2] = plan.mobs;
        expect(f1.x).toBeLessThan(boss.x);
        expect(f2.x).toBeGreaterThan(boss.x);
        // each tank stands on the far side of its Flame (away from the boss)
        expect(plan.tanks[1].x).toBeLessThan(f1.x);
        expect(plan.tanks[2].x).toBeGreaterThan(f2.x);
        expect(noOverlap(plan)).toBe(true);
    });

    it("a numbered target is that Flame; one row with two Flames and two tanks pairs them in order", () => {
        const plan = lib.deriveAuto([row("r1", ["user:u2", "user:u3"], [FLAME(1), FLAME(2)])], board(), EVENT);
        expect(plan.mobs.map((m) => m.key)).toEqual(["m:d:flame#1", "m:d:flame#2"]);
        expect(plan.tanks.map((t) => t.mobKey)).toEqual(["m:d:flame#1", "m:d:flame#2"]);
        // a row without a number next to a numbered one takes the next free number
        const mixed = lib.deriveAuto([row("a", ["user:u2"], [FLAME(1)]), row("b", ["user:u3"], [FLAME()])], board(), EVENT);
        expect(mixed.mobs.map((m) => m.key)).toEqual(["m:d:flame#1", "m:d:flame#2"]);
    });

    it("the boss is one, also when several rows name it (a tank swap)", () => {
        const plan = lib.deriveAuto([row("r1", ["user:u1"], [BOSS]), row("r2", ["user:u2"], [BOSS])], board(), EVENT);
        expect(plan.mobs).toHaveLength(1);
        expect(plan.tanks.map((t) => t.mobKey)).toEqual(["m:b:bt/illidan#1", "m:b:bt/illidan#1"]);
    });

    it("trash with five mobs: a row of mobs at the top, each tank below its mob, nothing overlaps", () => {
        const rows = ["a", "b", "c", "d", "e"].map((m, i) => row(`r${i}`, [`user:u${(i % 4) + 1}`], [mob(`d:${m}`, m.toUpperCase())], { type: "trashtank" }));
        const plan = lib.deriveAuto(rows, board(), EVENT);
        expect(plan.mobs).toHaveLength(5);
        expect(new Set(plan.mobs.map((m) => m.y)).size).toBe(1);
        expect(plan.mobs.map((m) => m.x)).toEqual([...plan.mobs.map((m) => m.x)].sort((a, b) => a - b));
        // u1 tanks a and e: a player is on the map once (the second row uses his token)
        expect(plan.tanks[4]).toMatchObject({ userId: "u1", existing: "auto:t:r0:1" });
        for (const t of plan.tanks.filter((x) => !x.existing)) expect(t.y).toBeGreaterThan(plan.mobs[0].y);
        expect(noOverlap(plan)).toBe(true);
    });

    it("a tank row without a mob: the tank stands in a row below the boss; other kinds of rows put nothing on the map", () => {
        const plan = lib.deriveAuto([row("r1", ["user:u1"], [BOSS]), row("r2", ["user:u2"], [{ kind: "mark", ref: "skull" }]), row("h", ["user:u4"], [], { type: "heal" })], board(), EVENT);
        expect(plan.tanks.map((t) => t.key)).toEqual(["t:r1:1", "t:r2:1"]);
        expect(plan.tanks[1].mobKey).toBe("");
        expect(plan.tanks[1].y).toBeGreaterThan(plan.tanks[0].y - 0.0001);
    });

    it("is the same every time (no randomness), and nothing with the switch off", () => {
        const rows = [row("r0", ["user:u1"], [BOSS]), row("r1", ["user:u2"], [FLAME()]), row("r2", ["user:u3"], [FLAME()])];
        expect(JSON.stringify(lib.deriveAuto(rows, board(), EVENT))).toBe(JSON.stringify(lib.deriveAuto(rows, board(), EVENT)));
        expect(lib.deriveAuto(rows, board({ autoPlace: false }), EVENT)).toEqual({ mobs: [], tanks: [], users: [] });
        expect(lib.deriveAuto([], board(), EVENT)).toEqual({ mobs: [], tanks: [], users: [] });
    });
});

describe("placed by hand: kept, never doubled", () => {
    it("a position moved by hand stays, the others find free places around it", () => {
        const rows = [row("r1", ["user:u1", "user:u2"], [BOSS])];
        const base = lib.deriveAuto(rows, board(), EVENT);
        // the first tank dropped right where the second one would stand
        const moved = lib.deriveAuto(rows, board({ autoPos: { "t:r1:1": { x: base.tanks[1].x, y: base.tanks[1].y } } }), EVENT);
        expect(moved.tanks[0]).toMatchObject({ x: base.tanks[1].x, y: base.tanks[1].y, moved: true });
        expect(moved.tanks[1].moved).toBe(false);
        expect(noOverlap(moved)).toBe(true);
        // a new row later: the moved one stays, the new tank gets a free place
        const more = lib.deriveAuto([...rows, row("r2", ["user:u3"], [FLAME()])], board({ autoPos: { "t:r1:1": { x: 0.2, y: 0.8 } } }), EVENT);
        expect(more.tanks[0]).toMatchObject({ x: 0.2, y: 0.8 });
        expect(noOverlap(more)).toBe(true);
    });

    it("a mob icon placed by hand plays the mob: no second icon, its position is the anchor", () => {
        const icons = [{ id: "i1", iconKey: "boss:601", mobId: "", x: 0.3, y: 0.3, size: 48, rotation: 0, hidden: false }, { id: "f1", iconKey: "enemy", mobId: "d:flame", x: 0.7, y: 0.2, size: 48, rotation: 0, hidden: false }];
        const plan = lib.deriveAuto([row("r0", ["user:u1"], [BOSS]), row("r1", ["user:u2"], [FLAME()]), row("r2", ["user:u3"], [FLAME()])], board({ icons }), EVENT);
        // the older boss portrait without a mob plays the boss, the Flame icon the first Flame; the second Flame is new
        expect(plan.mobs.map((m) => m.iconId)).toEqual(["i1", "f1", ""]);
        expect(plan.mobs[0]).toMatchObject({ x: 0.3, y: 0.3 });
        expect(plan.tanks[0].y).toBeGreaterThan(0.3);
    });

    it("a player who stands on the map already is used as he is: free token, role slot, group ring", () => {
        const slots = [
            { id: "s1", kind: "tank", n: 1, userId: "u2", x: 0.1, y: 0.1, placed: true, hidden: false },
            { id: "g3", kind: "group", n: 2, userId: "", x: 0.9, y: 0.9, placed: true, hidden: false, split: true, hideMembers: false },
        ];
        const plan = lib.deriveAuto([row("r1", ["user:u1", "user:u2", "user:u3", "slot:tank:1"], [BOSS])], board({ tokens: [{ userId: "u1", x: 0.5, y: 0.9 }], slots }), EVENT);
        expect(plan.tanks.map((t) => t.existing)).toEqual(["token:u1", "slot:s1", "member:g3:u3", "slot:s1"]);
        expect(plan.users).toEqual([]);
    });

    it("a slot on the Besetzung only (not on the map) with a player: his auto token; an empty one: an open place", () => {
        const slots = [{ id: "s1", kind: "tank", n: 1, userId: "u2", x: 0, y: 0, placed: false }, { id: "s2", kind: "tank", n: 2, userId: "", x: 0, y: 0, placed: false }];
        const plan = lib.deriveAuto([row("r1", ["slot:tank:1", "slot:tank:2"], [BOSS])], board({ slots }), EVENT);
        expect(plan.tanks.map((t) => [t.state, t.userId, t.existing])).toEqual([["player", "u2", ""], ["slot", "", ""]]);
        expect(plan.users).toEqual(["u2"]);
        // a template's open "Tank 1" named by two rows is one place
        const two = lib.deriveAuto([row("a", ["slot:tank:1"], [BOSS]), row("b", ["slot:tank:1"], [FLAME()])], board(), TEMPLATE);
        expect(two.tanks.map((t) => t.existing)).toEqual(["", "auto:t:a:1"]);
    });
});

describe("rules: template placeholder, resolved player, missing class", () => {
    const rows = [row("r1", ["class:Mage:1:any"], [mob("d:zerevor", "High Nethermancer Zerevor")]), row("r2", ["class:Paladin:1:tank"], [mob("d:malande", "Lady Malande")])];

    it("in a template a class reference is a placeholder with its class and role", () => {
        const plan = lib.deriveAuto(rows, board(), TEMPLATE);
        expect(plan.tanks.map((t) => [t.state, t.classId, t.role])).toEqual([["rule", "Mage", "any"], ["rule", "Paladin", "tank"]]);
        expect(plan.users).toEqual([]);
    });

    it("in an event the resolved reference is the player; an unresolved one is missing at the same place, never another class", () => {
        const resolved = [row("r1", ["user:u4"], rows[0].targets), row("r2", ["class:Paladin:1:tank"], rows[1].targets)];
        const plan = lib.deriveAuto(resolved, board(), EVENT);
        expect(plan.tanks.map((t) => [t.state, t.userId])).toEqual([["player", "u4"], ["missing", ""]]);
        const tpl = lib.deriveAuto(rows, board(), TEMPLATE);
        // the same place as the template's placeholder
        expect(plan.tanks.map((t) => [t.x, t.y])).toEqual(tpl.tanks.map((t) => [t.x, t.y]));
    });
});

describe("the facing follows the tank", () => {
    it("an auto icon faces its tank; a mob whose only tank is missing keeps its own facing", () => {
        const plan = lib.deriveAuto([row("r1", ["user:u1"], [BOSS])], board(), EVENT);
        const boss = plan.mobs[0];
        // the tank stands straight below the boss: 180 degrees
        expect(lib.autoFacing(plan, `auto:${boss.key}`, boss, board(), {}, 1.6)).toBe(180);
        const miss = lib.deriveAuto([row("r1", ["class:Paladin:1:tank"], [BOSS])], board(), EVENT);
        expect(lib.autoFacing(miss, `auto:${miss.mobs[0].key}`, miss.mobs[0], board(), {}, 1.6)).toBe(-2);
        // an icon the rows do not know: the older rule applies
        expect(lib.autoFacing(plan, "zz", { x: 0, y: 0 }, board(), {}, 1.6)).toBe(-1);
    });

    it("the n-th Flame faces the n-th tank, also a hand-placed icon and a tank in a group ring (its drawn place)", () => {
        const icons = [{ id: "f1", iconKey: "enemy", mobId: "d:flame", x: 0.3, y: 0.5, size: 48, hidden: false }, { id: "f2", iconKey: "enemy", mobId: "d:flame", x: 0.7, y: 0.5, size: 48, hidden: false }];
        const slots = [{ id: "g", kind: "group", n: 2, userId: "", x: 0.9, y: 0.5, placed: true, split: true, hideMembers: false }];
        const b = board({ icons, slots });
        const plan = lib.deriveAuto([row("r1", ["user:u2"], [FLAME()]), row("r2", ["user:u3"], [FLAME()])], b, EVENT);
        expect(plan.tanks[1].existing).toBe("member:g:u3");
        // u3 is drawn in the ring straight right of Flame 2
        expect(lib.autoFacing(plan, "f2", icons[1], b, { u3: { x: 0.9, y: 0.5 } }, 1.6)).toBe(90);
        expect(lib.autoFacing(plan, "f1", icons[0], b, {}, 1.6)).toBeGreaterThanOrEqual(0);
    });
});

describe("editing the rows from the map and the dialog", () => {
    it("Anzahl and Nr. of a mob target", () => {
        const rows = [row("r1", ["user:u2", "user:u3"], [FLAME(), { kind: "mark", ref: "skull" }])];
        const two = lib.setMobCount(rows, "r1", "d:flame", 2);
        expect(two[0].targets.map((x) => [x.kind, x.n])).toEqual([["mob", 1], ["mob", 2], ["mark", undefined]]);
        expect(lib.mobCountOf(two[0], "d:flame")).toBe(2);
        const one = lib.setMobCount(two, "r1", "d:flame", 1);
        expect(one[0].targets.map((x) => x.n)).toEqual([undefined, undefined]);
        const nr = lib.setMobInstance(one, "r1", "d:flame", 3);
        expect(lib.mobInstanceOf(nr[0], "d:flame")).toBe(3);
        expect(lib.mobInstanceOf(lib.setMobInstance(nr, "r1", "d:flame", 0)[0], "d:flame")).toBe(0);
    });

    it("Tankt -> mob: the own row of a single tank is retargeted, a shared one gives him a row of his own, a new tank gets a new row", () => {
        const b = board({ assignments: [row("r1", ["user:u1"], [BOSS]), row("r2", ["user:u2", "user:u3"], [BOSS])] });
        const a = lib.tankTo(b, "user:u1", FLAME(), "tank");
        expect(a.assignments[0].targets).toEqual([FLAME()]);
        const s = lib.tankTo(b, "user:u3", FLAME(), "tank");
        expect(s.assignments[1].assignees).toEqual(["user:u2"]);
        expect(s.assignments[2]).toMatchObject({ assignees: ["user:u3"], targets: [FLAME()], type: "tank" });
        const n = lib.tankTo(b, "slot:tank:3", FLAME(), "trashtank");
        expect(n.assignments[2]).toMatchObject({ assignees: ["slot:tank:3"], type: "trashtank" });
        const u = lib.untank(b, "user:u1");
        expect(u.assignments.map((x) => x.id)).toEqual(["r2"]);
        expect(lib.untank(b, "user:u3").assignments[1].assignees).toEqual(["user:u2"]);
    });

    it("a copy of a default row keeps the default's key (a moved tank stays)", () => {
        expect(lib.rowKeyOf({ id: "x", origin: "d1" })).toBe("d1");
        expect(lib.rowKeyOf({ id: "x", origin: "default" })).toBe("x");
        expect(lib.rowKeyOf({ id: "x" })).toBe("x");
    });
});

describe("wiring", () => {
    it("editor, template and sheet draw the same plan; one object is moved, reset and never deleted on its own", () => {
        const ws = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
        expect(ws).toContain("deriveAuto(filledRows, board, { template: !isEvent, roster })");
        expect(ws).toContain("raidBoard.auto.noDelete");
        expect(ws).toContain("autoUsers: auto.users");
        const sheet = read("pages/PlanPublicPage.tsx");
        expect(sheet).toContain("deriveAuto(boss.assignments");
        expect(sheet).toContain("boss.showMap !== false ? deriveAuto");
        const pb = read("components/raidplan/PlanBoard.tsx");
        expect(pb).toContain("data-obj={`auto:${k.key}`}");
        expect(pb).toContain("raidBoard.auto.missing");
        const rp = read("lib/raidplan.ts");
        expect(rp).toContain("if (kind === \"auto\") return resetAutoPos(board, id);");
    });
});
