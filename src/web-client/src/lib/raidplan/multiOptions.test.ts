// Two more things of feature/raidplan-13 (docs/raidplan.md): the inspector of a multi-selection shows every option ALL selected objects
// have (lib/multiSelect.ts sharedOptions / optionSummary and the setters), and the editor opens a board with the cutout the sheet opens
// it with (lib/boardView.ts; BoardWorkspace applies board.view like PlanPublicPage).
import { describe, expect, it } from "vitest";
import * as ms from "./multiSelect";
import * as bv from "./boardView";

const look = { opacity: 1, lock: false, hidden: false };
const icon = (id, extra = {}) => ({ id, iconKey: "enemy", label: "", x: 0.5, y: 0.5, size: 48, rotation: 0, showLabel: false, mobId: "d:flame", autoFace: true, ...look, ...extra });
const board = (extra = {}) => ({
    tokens: [], marks: [{ id: "k1", mark: "skull", x: 0.1, y: 0.1, size: 34, ...look }], slots: [], texts: [{ id: "x1", text: "Hi", x: 0.2, y: 0.2, color: "#ffffff", size: 16, ...look }],
    icons: [icon("f1"), icon("f2", { arrowColor: "#ff0000" }), icon("w1", { iconKey: "wow:spell_fire_fireball", mobId: "" })],
    zones: [{ id: "z1", shape: "rect", type: "danger", label: "", color: "#d33", x: 0.1, y: 0.1, w: 0.2, h: 0.2, ...look }],
    lines: [{ id: "l1", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1, color: "#d33", width: 3, ...look }],
    assignments: [], autoStyle: {}, objectScale: 1, ...extra,
});
const sel = (...ids) => ids.map((s) => { const at = s.indexOf(":"); return { kind: s.slice(0, at), id: s.slice(at + 1) }; });

describe("the options a multi-selection shares", () => {
    it("two Flames: ring, name, the facing target and the arrow; no colour", () => {
        expect(ms.sharedOptions(board(), sel("icon:f1", "icon:f2"))).toEqual({ ring: true, showName: true, color: false, facing: true });
    });

    it("a zone, a line and a text: the colour only; a mark with them: nothing but the look", () => {
        expect(ms.sharedOptions(board(), sel("zone:z1", "line:l1", "text:x1"))).toEqual({ ring: false, showName: false, color: true, facing: false });
        expect(ms.sharedOptions(board(), sel("zone:z1", "mark:k1"))).toEqual({ ring: false, showName: false, color: false, facing: false });
        // a WoW-icon picture has no facing: with a Flame no facing is offered
        expect(ms.sharedOptions(board(), sel("icon:f1", "icon:w1")).facing).toBe(false);
    });

    it("a value where all agree, null (\"gemischt\") where they differ", () => {
        const s = ms.optionSummary(board(), sel("icon:f1", "icon:f2"));
        expect(s).toMatchObject({ ring: true, showName: true, autoFace: true, rotation: 0, arrowScale: 1, arrowHidden: false, arrowColor: null, arrowOpacity: 1, color: null });
        expect(ms.optionSummary(board(), sel("zone:z1", "line:l1")).color).toBe("#d33");
        expect(ms.optionSummary(board(), sel("zone:z1", "text:x1")).color).toBe(null);
    });

    it("a change goes to every selected object that has the option, in one board step", () => {
        let b = ms.patchArrowSelection(board(), sel("icon:f1", "icon:f2", "zone:z1"), { color: "#00ff00", scale: 2 });
        expect(b.icons.slice(0, 2).map((i) => [i.arrowColor, i.arrowScale])).toEqual([["#00ff00", 2], ["#00ff00", 2]]);
        expect(b.zones[0].arrowColor).toBeUndefined();
        b = ms.setFacingSelection(b, sel("icon:f1", "icon:f2"), { rotation: 90 });
        expect(b.icons.slice(0, 2).map((i) => [i.rotation, i.autoFace])).toEqual([[90, false], [90, false]]);
        b = ms.setFacingSelection(b, sel("icon:f1", "icon:f2"), { autoFace: true });
        expect(b.icons.slice(0, 2).map((i) => i.autoFace)).toEqual([true, true]);
        b = ms.setColorSelection(b, sel("zone:z1", "line:l1", "icon:f1"), "#123456");
        expect([b.zones[0].color, b.lines[0].color]).toEqual(["#123456", "#123456"]);
        b = ms.setLookSelection(b, sel("icon:f1", "icon:f2"), { ring: false, showName: false });
        expect(b.icons.slice(0, 2).map((i) => [i.ring, i.showName])).toEqual([[false, false], [false, false]]);
    });

    it("a locked object keeps its facing and colour; the mobs of the tank rows (auto) take the facing too", () => {
        let b = board({ icons: [icon("f1", { lock: true }), icon("f2")], autoStyle: {} });
        b = ms.setFacingSelection(b, sel("icon:f1", "icon:f2", "auto:m:d:flame#3"), { rotation: 180 });
        expect(b.icons[0].rotation).toBe(0);
        expect(b.icons[1].rotation).toBe(180);
        expect(b.autoStyle["m:d:flame#3"]).toMatchObject({ rotation: 180, autoFace: false });
    });
});

describe("the editor opens a board as the sheet does", () => {
    it("sameView tells the sheet's start view from a working zoom", () => {
        const saved = bv.viewFromSaved({ zoom: 2, cx: 0.4, cy: 0.5 });
        expect(bv.sameView(saved, bv.viewFromSaved({ zoom: 2, cx: 0.4, cy: 0.5 }))).toBe(true);
        expect(bv.sameView(saved, bv.zoomAt(saved, 2.5, 0.5, 0.5))).toBe(false);
        expect(bv.sameView(bv.FIT, bv.viewFromSaved(null))).toBe(true);
    });
});

describe("role groups in a multi-selection (feature/raidplan-16)", () => {
    const role = (id, extra) => ({ id, shape: "rect", type: "role", label: "", color: "#f97316", x: 0.1, y: 0.1, w: 0.1, h: 0.4, role: "melee", count: 0, showNames: false, rotation: 0, opacity: 0.3, lock: false, hidden: false, ...extra });
    it("angle, symbol size and label place for all of them; mixed shows null; anything else in the selection = not offered", () => {
        const b = board({ zones: [role("a", { rotation: 30 }), role("b", { rotation: 60, iconScale: 2 })] });
        expect(ms.roleZoneSummary(b, sel("zone:a", "zone:b"))).toEqual({ rotation: null, iconScale: null, labelPos: "in" });
        const c = ms.setRoleZoneSelection(b, sel("zone:a", "zone:b"), { rotation: 90, iconScale: 1.5, labelPos: "top" });
        expect(c.zones.map((z) => [z.rotation, z.iconScale, z.labelPos])).toEqual([[90, 1.5, "top"], [90, 1.5, "top"]]);
        expect(ms.roleZonesOf(b, sel("zone:a", "mark:k1"))).toEqual([]);
    });
    it("a turned zone's box for the rubber band is its upright box", () => {
        const b = board({ zones: [role("a", { rotation: 90, x: 0.4, y: 0.1, w: 0.1, h: 0.5 })] });
        const box = ms.objectBox(b, { kind: "zone", id: "a" }, { w: 1000, h: 625 });
        expect((box.x1 - box.x0) * 1000).toBeCloseTo(0.5 * 625, 3);
        expect((box.y1 - box.y0) * 625).toBeCloseTo(0.1 * 1000, 3);
    });
});
