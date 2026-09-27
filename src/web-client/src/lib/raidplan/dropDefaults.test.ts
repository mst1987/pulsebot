// What a new object starts with when it is dropped on the board (#496): a role group 30 % smaller, the facing wedge of a new icon
// 40 % shorter and thinner. Only the default of a NEW object changes: a saved board keeps its sizes, the wedge's slider and the role
// group's symbol size keep working relative to the new start.
import { describe, expect, it } from "vitest";
import * as raidplan from ".";

const board = () => raidplan.emptyBoard();

describe("the default of a dropped role group", () => {
    it("is 30 % smaller than before (0.18 x 0.16 -> 0.126 x 0.112), centred on the drop point", () => {
        expect(raidplan.NEW_ROLE_GROUP.w).toBeCloseTo(0.18 * 0.7);
        expect(raidplan.NEW_ROLE_GROUP.h).toBeCloseTo(0.16 * 0.7);
        for (const role of ["melee", "ranged", "healer", "tank", "dps"]) {
            const z = raidplan.insertObject(board(), { type: "zone", zoneType: "role", shape: "ellipse", role }, { x: 0.5, y: 0.5 }).board.zones[0];
            expect(z).toMatchObject({ role, w: raidplan.NEW_ROLE_GROUP.w, h: raidplan.NEW_ROLE_GROUP.h });
            expect(z.x + z.w / 2).toBeCloseTo(0.5);
            expect(z.y + z.h / 2).toBeCloseTo(0.5);
        }
    });

    it("leaves the other zones and a saved role group alone; the symbol size stays automatic (relative)", () => {
        const area = raidplan.insertObject(board(), { type: "zone", zoneType: "danger", shape: "rect" }, { x: 0.5, y: 0.5 }).board.zones[0];
        expect(area).toMatchObject({ w: 0.2, h: 0.2 });
        const saved = { ...board(), zones: [{ id: "z1", shape: "ellipse" as const, type: "role" as const, role: "melee" as const, label: "", color: "#f97316", x: 0.1, y: 0.1, w: 0.18, h: 0.16 }] };
        const next = raidplan.insertObject(saved, { type: "zone", zoneType: "role", shape: "ellipse", role: "ranged" }, null).board;
        expect(next.zones[0]).toMatchObject({ w: 0.18, h: 0.16 });
        expect(next.zones[1].iconScale).toBeUndefined();
    });
});

describe("the default wedge of a dropped icon", () => {
    it("starts at 60 % for an icon that faces (boss, mob, enemy), a plain WoW icon has none", () => {
        expect(raidplan.NEW_ARROW_SCALE).toBe(0.6);
        const mob = raidplan.insertObject(board(), { type: "icon", iconKey: "boss:609", label: "Supremus", mobId: "m1" }, { x: 0.5, y: 0.5 });
        expect(mob.board.icons[0].arrowScale).toBe(0.6);
        expect(raidplan.arrowOf(mob.board, "icon", mob.board.icons[0].id)).toMatchObject({ scale: 0.6, hidden: false });
        const enemy = raidplan.insertObject(board(), raidplan.parseInsertId("insert:icon:enemy")!, null).board.icons[0];
        expect(enemy.arrowScale).toBe(0.6);
        const wow = raidplan.insertObject(board(), { type: "icon", iconKey: "wow:spell_fire_fireball", label: "" }, null).board.icons[0];
        expect(wow.arrowScale).toBeUndefined();
    });

    it("scales relative to the new start and keeps a saved icon's wedge as it was", () => {
        const b = raidplan.insertObject(board(), { type: "icon", iconKey: "boss:609", label: "", mobId: "" }, null).board;
        const id = b.icons[0].id;
        // "Pfeil größer" (x 1.25) from 60 % -> 75 %
        expect(raidplan.scaleArrow(b, "icon", id, 1.25).icons[0].arrowScale).toBe(0.75);
        const saved = { ...board(), icons: [{ ...b.icons[0], id: "old", arrowScale: undefined }] };
        expect(raidplan.arrowOf(saved, "icon", "old")!.scale).toBe(1);
        const dup = raidplan.duplicateObject(b, "icon", id);
        expect(dup.board.icons[1].arrowScale).toBe(0.6);
    });
});
