// Tokens on the board: sizes, icons, group markers (hiding and splitting),
// facing and board labels.
// The board logic behind the editors (lib/raidplan/) runs for real.
import { describe, expect, it } from "vitest";
import * as lib from ".";

// Role slots belong to the Besetzung: the palette places a free one. These tests start from a board that has one free.
const slotIns = (b, spec, at) => {
    if (spec.type === "slot" && lib.isRoleKind(spec.kind)) {
        const free = { ...lib.addSlot(lib.emptyBoard(), spec.kind, "").slots[0], n: lib.nextSlotNumber(b, spec.kind), placed: false };
        return lib.insertObject({ ...b, slots: [...b.slots, free] }, spec, at);
    }
    return lib.insertObject(b, spec, at);
};

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });
const board = (extra = {}) => ({ ...lib.emptyBoard(), ...extra });

describe("sizes", () => {
    const one = (spec) => slotIns(lib.emptyBoard(), spec, { x: 0.5, y: 0.5 });

    it("starts every object with the default size of its kind", () => {
        expect(one({ type: "slot", kind: "tank", label: "" }).board.slots[0].size).toBe(38);
        expect(one({ type: "mark", mark: "star" }).board.marks[0].size).toBe(34);
        expect(one({ type: "icon", iconKey: "enemy", label: "" }).board.icons[0]).toMatchObject({ size: 48, rotation: 0, iconKey: "enemy" });
        expect(lib.placeToken(lib.emptyBoard(), "u1", 0.5, 0.5).tokens[0].size).toBe(38);
    });

    it("sets a size inside the range of each kind and leaves a locked object alone", () => {
        const check = (kind, board, id, low, high) => {
            expect(lib.sizeOf(lib.setObjectSize(board, kind, id, 1), kind, id)).toBe(low);
            expect(lib.sizeOf(lib.setObjectSize(board, kind, id, 9999), kind, id)).toBe(high);
        };
        let b = lib.emptyBoard();
        for (const spec of [{ type: "slot", kind: "tank", label: "" }, { type: "mark", mark: "star" }, { type: "icon", iconKey: "enemy", label: "" }, { type: "text", text: "T" }, { type: "line", kind: "line" }]) b = slotIns(b, spec, { x: 0.5, y: 0.5 }).board;
        b = lib.placeToken(b, "u1", 0.5, 0.5);
        check("token", b, "u1", 10, 152);
        check("slot", b, b.slots[0].id, 10, 152);
        check("mark", b, b.marks[0].id, 9, 136);
        check("icon", b, b.icons[0].id, 12, 192);
        check("text", b, b.texts[0].id, 5, 72);
        check("line", b, b.lines[0].id, 1, 16);
        expect(lib.setObjectSize(b, "mark", b.marks[0].id, NaN)).toBe(b);
        const locked = lib.patchLook(b, "icon", b.icons[0].id, { lock: true });
        expect(lib.setObjectSize(locked, "icon", b.icons[0].id, 100)).toBe(locked);
        expect(lib.sizeOf(b, "zone", "x")).toBeNull();
        expect(lib.sizeOf(b, "mark", "nope")).toBeNull();
    });

    it("scales an object by a factor, a zone around its centre and inside the board", () => {
        let b = slotIns(lib.emptyBoard(), { type: "icon", iconKey: "enemy", label: "" }, null).board;
        const id = b.icons[0].id;
        expect(lib.sizeOf(lib.scaleObject(b, "icon", id, 2), "icon", id)).toBe(96);
        expect(lib.sizeOf(lib.scaleObject(b, "icon", id, 0.5), "icon", id)).toBe(24);
        expect(lib.sizeOf(lib.scaleObject(lib.scaleObject(b, "icon", id, 1.1), "icon", id, 1 / 1.1), "icon", id)).toBe(48);
        b = slotIns(lib.emptyBoard(), { type: "zone", zoneType: "danger", shape: "rect" }, { x: 0.5, y: 0.5 }).board;
        const z = b.zones[0];
        const big = lib.scaleObject(b, "zone", z.id, 2).zones[0];
        expect(big.w).toBeCloseTo(0.4);
        expect(big.x + big.w / 2).toBeCloseTo(z.x + z.w / 2);
        const huge = lib.scaleObject(b, "zone", z.id, 50).zones[0];
        expect([huge.w, huge.h]).toEqual([1, 1]);
        expect(lib.scaleObject(lib.patchLook(b, "zone", z.id, { lock: true }), "zone", z.id, 2).zones[0].w).toBe(z.w);
        expect(lib.scaleObject(b, "mark", "nope", 2)).toBe(b);
    });

    it("sets the board's default object size between 0.5 and 2", () => {
        expect(lib.setObjectScale(lib.emptyBoard(), 1.5).objectScale).toBe(1.5);
        expect(lib.setObjectScale(lib.emptyBoard(), 0).objectScale).toBe(0.4);
        expect(lib.setObjectScale(lib.emptyBoard(), 7).objectScale).toBe(2);
        expect(lib.setObjectScale(lib.emptyBoard(), NaN).objectScale).toBe(1);
        expect(lib.hasContent(lib.setObjectScale(lib.emptyBoard(), 1.2))).toBe(true);
    });
});

describe("icons", () => {
    it("tells the sources apart and turns a boss entry into its icon key", () => {
        expect(lib.iconKeyType("boss:609")).toBe("boss");
        expect(lib.iconKeyType("wow:spell_fire_fireball")).toBe("wow");
        expect(lib.iconKeyType("enemy")).toBe("enemy");
        expect(lib.iconKeyType("bosspos")).toBe("bosspos");
        expect(lib.iconKeyType("http://x")).toBe("");
        expect(lib.iconKeyForBoss("/bosses/602.jpg")).toBe("boss:602");
        // a boss the encounter list has no picture for shows its instance's icon
        expect(lib.iconKeyForBoss("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg")).toBe("wow:achievement_boss_illidan");
        expect(lib.iconKeyForBoss("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_kael%27thassunstrider_01.jpg")).toBe("wow:achievement_boss_kael'thassunstrider_01");
        expect(lib.iconKeyForBoss("")).toBe("enemy");
    });

    it("moves, copies, orders, names and deletes an icon, and lists it among the layers", () => {
        let b = slotIns(lib.emptyBoard(), { type: "icon", iconKey: "boss:609", label: "Illidan" }, { x: 0.3, y: 0.3 }).board;
        const id = b.icons[0].id;
        b = lib.moveObject(b, "icon", id, 2, -1);
        expect(b.icons[0]).toMatchObject({ x: 1, y: 0 });
        b = lib.updateIcon(b, id, { rotation: 90 });
        const copy = lib.duplicateObject(b, "icon", id);
        expect(copy.board.icons).toHaveLength(2);
        expect(copy.board.icons[1].rotation).toBe(90);
        expect(lib.reorderObject(copy.board, "icon", id, "front").icons[1].id).toBe(id);
        const players = lib.rosterMap([]);
        expect(lib.objectName(b, "icon", id, players)).toBe("Illidan");
        expect(lib.objectName(lib.updateIcon(b, id, { label: "", iconKey: "enemy" }), "icon", id, players)).toBe("Gegner / Add");
        expect(lib.layerList(b, players)[0]).toMatchObject({ kind: "icon", name: "Illidan" });
        expect(lib.patchLook(b, "icon", id, { opacity: 0.5 }).icons[0].opacity).toBe(0.5);
        expect(lib.removeObject(b, "icon", id).icons).toEqual([]);
        expect(lib.parseInsertId("insert:icon:enemy")).toEqual({ type: "icon", iconKey: "enemy", label: "" });
    });
});

describe("group markers: hiding and splitting", () => {
    const roster = () => [
        { ...player("t1", "tank"), group: 1 }, { ...player("h1", "healer"), group: 1 }, { ...player("m1", "melee"), group: 1 },
        { ...player("r1", "ranged"), group: 2 }, { ...player("m2", "melee"), group: 2 },
    ];
    const group = (extra = {}) => {
        const b = slotIns(lib.emptyBoard(), { type: "slot", kind: "group", label: "" }, { x: 0.5, y: 0.5 }).board;
        return lib.updateSlot(b, b.slots[0].id, extra);
    };

    it("starts a group together, showing its raiders, and lists its members only when it is split and shown", () => {
        const b = group({ n: 1 });
        expect(b.slots[0]).toMatchObject({ hideMembers: false, split: false, offsets: {} });
        expect(lib.splitMembers(b, b.slots[0], roster())).toEqual([]);
        const s = group({ n: 1, split: true });
        expect(lib.splitMembers(s, s.slots[0], roster()).map((p) => p.userId)).toEqual(["t1", "h1", "m1"]);
        const hidden = group({ n: 1, split: true, hideMembers: true });
        expect(lib.splitMembers(hidden, hidden.slots[0], roster())).toEqual([]);
        expect(lib.splitMembers(lib.addSlot(lib.emptyBoard(), "tank", ""), lib.addSlot(lib.emptyBoard(), "tank", "").slots[0], roster())).toEqual([]);
    });

    it("leaves out a raider who already stands elsewhere on the board and counts split raiders as placed", () => {
        let b = group({ n: 1, split: true });
        b = lib.placeToken(b, "t1", 0.1, 0.1);
        expect(lib.splitMembers(b, b.slots[0], roster()).map((p) => p.userId)).toEqual(["h1", "m1"]);
        expect(lib.unplaced(roster(), b).map((p) => p.userId)).toEqual(["r1", "m2"]);
        // together, the group's raiders are not on the board as tokens: they are still "not placed"
        const together = group({ n: 1 });
        expect(lib.unplaced(roster(), together)).toHaveLength(5);
    });

    it("keeps hiding and splitting independent of each other", () => {
        let b = group({ n: 1 });
        const id = b.slots[0].id;
        b = lib.applyMenuAction(b, "split:on", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: true, hideMembers: false });
        b = lib.applyMenuAction(b, "members:hide", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: true, hideMembers: true });
        b = lib.applyMenuAction(b, "split:off", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: false, hideMembers: true });
        b = lib.applyMenuAction(b, "members:show", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: false, hideMembers: false });
    });

    it("offers the two switches in the group's menu, named for what they will do", () => {
        const items = (extra) => lib.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: true, kind: "group", ...extra }).map((i) => i.id);
        expect(items({})).toEqual(expect.arrayContaining(["members:hide", "split:on"]));
        expect(items({ hideMembers: true, split: true })).toEqual(expect.arrayContaining(["members:show", "split:off"]));
        expect(items({})).not.toContain("assign");
        expect(lib.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: true, kind: "tank" }).map((i) => i.id)).not.toContain("split:on");
        expect(lib.contextMenuItems("member", { locked: false, hasPlayer: false, isEvent: true, kind: "" }).map((i) => i.id)).toEqual(["properties", "member:out", "resetpos"]);
    });

    it("arranges the raiders on a ring that grows with their number and never overlaps", () => {
        expect(lib.ringOffsets(0, 600, 400, 38)).toEqual([]);
        expect(lib.ringOffsets(3, 0, 400, 38)).toEqual([]);
        for (const [count, w, h] of [[1, 600, 400], [5, 650, 650], [12, 800, 500], [25, 1200, 700]]) {
            const ring = lib.ringOffsets(count, w, h, 38);
            expect(ring).toHaveLength(count);
            const pts = ring.map((o) => ({ x: o.dx * w, y: o.dy * h }));
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(38);
            // a circle in pixels, whatever the board's shape
            for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.hypot(pts[0].x, pts[0].y), 5);
        }
        // the first raider is at the top of the marker
        expect(lib.ringOffsets(4, 600, 400, 38)[0].dx).toBeCloseTo(0);
        expect(lib.ringOffsets(4, 600, 400, 38)[0].dy).toBeLessThan(0);
        expect(Math.hypot(...Object.values(lib.ringOffsets(25, 1200, 700, 38)[0]).map((v, i) => v * [1200, 700][i]))).toBeGreaterThan(Math.hypot(...Object.values(lib.ringOffsets(3, 1200, 700, 38)[0]).map((v, i) => v * [1200, 700][i])));
    });

    it("moves a single raider relative to the marker, so the group still moves along, and puts him back with reset", () => {
        let b = group({ n: 1, split: true });
        const slot = b.slots[0].id;
        const mid = lib.memberId(slot, "t1");
        expect(lib.parseMemberId(mid)).toEqual({ slotId: slot, userId: "t1" });
        expect(lib.objectPoint(b, "member", mid)).toBeNull();
        b = lib.moveObject(b, "member", mid, 0.7, 0.4);
        expect(b.slots[0].offsets.t1).toMatchObject({ size: 38 });
        expect(b.slots[0].offsets.t1.dx).toBeCloseTo(0.2);
        expect(b.slots[0].offsets.t1.dy).toBeCloseTo(-0.1);
        expect(lib.objectPoint(b, "member", mid)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.4) });
        // the marker moves: the raider keeps his place relative to it
        b = lib.moveObject(b, "slot", slot, 0.3, 0.3);
        expect(lib.objectPoint(b, "member", mid).x).toBeCloseTo(0.5);
        expect(lib.objectPoint(b, "member", mid).y).toBeCloseTo(0.2);
        b = lib.removeObject(b, "member", mid);
        expect(b.slots[0].offsets).toEqual({});
        expect(lib.moveObject(b, "member", "nope~x", 0.1, 0.1)).toBe(b);
    });

    it("scales a single raider on his own, defaulting to the marker's size, and honours the marker's lock", () => {
        let b = group({ n: 1, split: true, size: 50 });
        const mid = lib.memberId(b.slots[0].id, "h1");
        expect(lib.sizeOf(b, "member", mid)).toBe(50);
        b = lib.setObjectSize(b, "member", mid, 70);
        expect(lib.sizeOf(b, "member", mid)).toBe(70);
        expect(b.slots[0].size).toBe(50);
        expect(lib.sizeOf(lib.scaleObject(b, "member", mid, 2), "member", mid)).toBe(140);
        const locked = lib.patchLook(b, "slot", b.slots[0].id, { lock: true });
        expect(lib.isLocked(locked, "member", mid)).toBe(true);
        expect(lib.moveObject(locked, "member", mid, 0.9, 0.9)).toBe(locked);
        expect(lib.setObjectSize(locked, "member", mid, 30)).toBe(locked);
    });

    it("does not copy a group's individual places into a duplicate", () => {
        let b = group({ n: 1, split: true });
        b = lib.moveObject(b, "member", lib.memberId(b.slots[0].id, "t1"), 0.7, 0.4);
        const c = lib.duplicateObject(b, "slot", b.slots[0].id).board;
        expect(c.slots[1].offsets).toEqual({});
        expect(c.slots[1].split).toBe(true);
    });
});

describe("facing and board labels", () => {
    const withIcon = () => slotIns(board(), { type: "icon", iconKey: "boss:602", label: "" }, { x: 0.5, y: 0.5 });
    it("angle maths: 0 = up, clockwise, normalised", () => {
        expect(lib.normAngle(-90)).toBe(270);
        expect(lib.normAngle(360)).toBe(0);
        expect(lib.normAngle(725.6)).toBe(6);
        expect(lib.normAngle(NaN)).toBe(0);
        expect(lib.angleTo(0, 0, 0, -10)).toBe(0);
        expect(lib.angleTo(0, 0, 10, 0)).toBe(90);
        expect(lib.angleTo(0, 0, 0, 10)).toBe(180);
        expect(lib.angleTo(0, 0, -10, 0)).toBe(270);
        expect(lib.snapAngle(52, 15)).toBe(45);
        expect(lib.snapAngle(358, 15)).toBe(0);
        expect(lib.compassName(92)).toBe("E");
        expect(lib.compassName(350)).toBe("N");
        expect(lib.COMPASS).toHaveLength(8);
    });
    it("only boss, enemy and position icons face somewhere", () => {
        expect(lib.canFace("boss:602")).toBe(true);
        expect(lib.canFace("enemy")).toBe(true);
        expect(lib.canFace("wow:spell_fire_fireball")).toBe(false);
    });
    it("turns an icon, and the compass entries of the menu set the angle", () => {
        const r = withIcon();
        const id = r.sel.id;
        expect(r.board.icons[0]).toMatchObject({ rotation: 0, showLabel: false });
        expect(lib.turnIcon(r.board, id, -15).icons[0].rotation).toBe(345);
        const items = lib.contextMenuItems("icon", { locked: false, hasPlayer: false, isEvent: false, kind: "", faces: true }).map((m) => m.id);
        expect(items.filter((x) => x.startsWith("face:"))).toHaveLength(8);
        expect(lib.contextMenuItems("icon", { locked: false, hasPlayer: false, isEvent: false, kind: "" }).some((m) => m.id.startsWith("face:"))).toBe(false);
        expect(lib.applyMenuAction(r.board, "face:225", "icon", id, null).board.icons[0].rotation).toBe(225);
    });
    it("draws only labels that were typed (no fallback names on the board)", () => {
        const tank = slotIns(board(), { type: "slot", kind: "tank", label: "" }, null).board.slots[0];
        expect(lib.slotBoardLabel(tank)).toBe("");
        expect(lib.slotTitle(tank)).not.toBe("");
        expect(lib.zoneBoardLabel({ label: "  ", type: "danger" })).toBe("");
        expect(lib.zoneBoardLabel({ label: "Feuer", type: "danger" })).toBe("Feuer");
        expect(lib.iconBoardLabel({ label: "Boss", showLabel: false })).toBe("");
        expect(lib.iconBoardLabel({ label: "Boss", showLabel: true })).toBe("Boss");
        expect(lib.iconBoardLabel({ label: "", showLabel: true })).toBe("");
        expect(lib.textShown({ text: "" }, false)).toBe(false);
        expect(lib.textShown({ text: "" }, true)).toBe(true);
        expect(lib.textShown({ text: "Go" }, false)).toBe(true);
    });
});
