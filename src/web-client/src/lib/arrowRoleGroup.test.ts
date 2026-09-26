// The facing wedge of an icon sized on its own (arrowScale, hidden, colour, opacity; also on the auto icons and on several at once) and the
// role group placeholder ("Melees", "Ranged" ...: a zone of type "role") with the role references of the rows and steps ("role:melee").
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as raidplan from "./raidplan";
import * as ms from "./multiSelect";
import * as assign from "./assign";
import * as am from "./assignModal";
import * as st from "./steps";
import { inLang } from "../test/i18n";

// src/web-client/src/lib -> src/web-client/src
const dir = path.resolve(__dirname, "..");
const read = (f) => readFileSync(path.join(dir, f), "utf8");

const icon = (id, extra = {}) => ({ id, iconKey: "boss:609", label: "", showLabel: false, x: 0.5, y: 0.5, size: 48, rotation: 0, mobId: "", autoFace: true, opacity: 1, lock: false, hidden: false, ...extra });
const board = (extra = {}) => ({ ...raidplan.emptyBoard(), ...extra });

describe("the facing wedge of one icon", () => {
    it("100 % by default (an old icon has no field), 25 % .. 300 %, hidden, colour and opacity; only icons and auto mobs have one", () => {
        let b = board({ icons: [icon("i1")] });
        expect(raidplan.arrowOf(b, "icon", "i1")).toEqual({ scale: 1, hidden: false, color: "#ffb020", opacity: 1 });
        b = raidplan.patchArrow(b, "icon", "i1", { scale: 0.5 });
        expect(b.icons[0].arrowScale).toBe(0.5);
        expect(raidplan.patchArrow(b, "icon", "i1", { scale: 9 }).icons[0].arrowScale).toBe(3);
        expect(raidplan.patchArrow(b, "icon", "i1", { scale: 0.01 }).icons[0].arrowScale).toBe(0.25);
        b = raidplan.patchArrow(b, "icon", "i1", { hidden: true, color: "#22c55e", opacity: 0.4 });
        expect(raidplan.arrowOf(b, "icon", "i1")).toEqual({ scale: 0.5, hidden: true, color: "#22c55e", opacity: 0.4 });
        // Alt + "+": relative to its own size
        expect(raidplan.scaleArrow(b, "icon", "i1", 2).icons[0].arrowScale).toBe(1);
        // a locked icon keeps it; a token has no wedge
        const locked = board({ icons: [icon("i2", { lock: true })] });
        expect(raidplan.patchArrow(locked, "icon", "i2", { scale: 2 })).toBe(locked);
        expect(raidplan.arrowOf(board(), "token", "u1")).toBe(null);
    });

    it("an auto mob of the tank rows has its own (autoStyle), an auto tank none; back at 100 % nothing is stored", () => {
        let b = raidplan.patchArrow(board(), "auto", "m:b:bt/illidan#1", { scale: 2 });
        expect(b.autoStyle["m:b:bt/illidan#1"]).toEqual({ arrowScale: 2 });
        expect(raidplan.arrowOf(b, "auto", "t:r1:1")).toBe(null);
        b = raidplan.patchArrow(b, "auto", "m:b:bt/illidan#1", { scale: 1 });
        expect(b.autoStyle["m:b:bt/illidan#1"]).toBeUndefined();
    });

    it("several at once: each wedge relative to its own size, other objects stay", () => {
        const b = board({ icons: [icon("a", { arrowScale: 0.5 }), icon("b")], autoStyle: { "m:d:flame#1": { arrowScale: 2 } } });
        const out = ms.scaleArrowSelection(b, [{ kind: "icon", id: "a" }, { kind: "icon", id: "b" }, { kind: "auto", id: "m:d:flame#1" }, { kind: "zone", id: "z" }], 1.5);
        expect(out.icons.map((i) => i.arrowScale)).toEqual([0.75, 1.5]);
        expect(out.autoStyle["m:d:flame#1"].arrowScale).toBe(3);
    });
});

describe("a role group placeholder", () => {
    it("inserts as a soft ellipse in its role colour, without players; the palette, the tool bar and the board menu offer Melees and Ranged first", () => {
        const r = raidplan.insertObject(board(), raidplan.parseInsertId("insert:role:ranged"), { x: 0.5, y: 0.5 });
        const z = r.board.zones[0];
        expect(z).toMatchObject({ type: "role", role: "ranged", shape: "ellipse", color: "#a78bfa", count: 0, showNames: false, w: 0.18, h: 0.16 });
        expect(raidplan.objectName(r.board, "zone", z.id, new Map())).toBe("Ranged");
        const menu = raidplan.contextMenuItems("board", { locked: false, hasPlayer: false, isEvent: true, kind: "" }).map((m) => m.id);
        expect(menu).toEqual(expect.arrayContaining(["insert:role:melee", "insert:role:ranged"]));
        expect(raidplan.insertObject(board(), { type: "zone", zoneType: "role", shape: "ellipse", role: "nope" }, null).board.zones[0].role).toBe("melee");
        const pal = read("pages/raid-detail/raidplan/Palette.tsx");
        expect(pal.indexOf("role: \"melee\"")).toBeLessThan(pal.indexOf("role: \"ranged\""));
        expect(read("pages/raid-detail/raidplan/workspace/WorkspaceToolbar.tsx")).toContain("zoneType: \"role\", shape: \"ellipse\", role: \"melee\"");
    });

    it("moves and scales like any area (it is a zone), and is not a player: nobody is placed by it", () => {
        const b = raidplan.insertObject(board(), raidplan.parseInsertId("insert:role:melee"), { x: 0.5, y: 0.5 }).board;
        const id = b.zones[0].id;
        const moved = raidplan.moveObject(b, "zone", id, 0.1, 0.1);
        expect(moved.zones[0].x).toBeCloseTo(0.1);
        expect(moved.zones[0].y).toBeCloseTo(0.1);
        expect(raidplan.scaleObject(b, "zone", id, 2).zones[0].w).toBeCloseTo(0.36);
        expect(raidplan.unplaced([{ userId: "u1", role: "melee", group: 1 }], b).map((p) => p.userId)).toEqual(["u1"]);
    });
});

describe("role references in rows and steps", () => {
    const ctx = { slots: [], players: new Map() };
    it("resolve to the role group (icon, name), never to players, never open", async () => {
        expect(assign.resolveAssignee("role:melee", ctx)).toMatchObject({ kind: "role", ref: "melee", label: "Melees", player: null, open: false, icon: "ability_dualwield" });
        expect(assign.resolveTarget({ kind: "role", ref: "ranged" }, ctx)).toMatchObject({ kind: "role", label: "Ranged", open: false });
        expect(await inLang("en", () => assign.resolveAssignee("role:healer", ctx).label)).toBe("Healers");
        expect(assign.ROLE_REFS).toEqual(["melee", "ranged", "healer", "tank", "dps"]);
    });

    it("the dialog has a category Rollen for who and for at whom, counted apart from people and classes", () => {
        expect(am.categoriesFor("who", "other", false, false)).toContain("roles");
        expect(am.categoriesFor("at", "other", false, false)).toContain("roles");
        expect(am.categoryOfKey("who", "role:melee")).toBe("roles");
        expect(am.categoryOfKey("at", "role|ranged")).toBe("roles");
        expect(am.chosenCounts({ assignees: ["role:melee", "class:Hunter:1"], targets: [], spell: null, title: "" }, "who")).toEqual({ roles: 1, classes: 1 });
    });

    it("a step keeps its role group as it is while its classes resolve", () => {
        const step = { id: "s", action: "tank", participants: ["role:melee", "class:Warrior:1"], sentence: "", targets: [], timing: { kind: "" } };
        const roster = [{ userId: "w", classId: "Warrior", role: "tank", group: 1 }];
        expect(st.resolveParticipants(step, [], roster, {})).toEqual(["role:melee", "user:w"]);
    });
});
