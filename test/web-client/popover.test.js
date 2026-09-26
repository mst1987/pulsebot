// components/ui/Popover.tsx and lib/popoverPosition.ts (#439): one base for the
// floating boxes that belong to an element — menus, rich tooltips, hover
// panels, the raid plan's right-click menu. The placements are pure and run
// here through loadTs; the component and its users are checked by source.
const { loadTs, read } = require("./i18nHelper");

const lib = loadTs("lib/popoverPosition.ts");
const VIEW = { width: 1600, height: 900 };
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("clampToViewport", () => {
    it("keeps a box inside the viewport", () => {
        expect(lib.clampToViewport(100, 100, 200, 300, 1600, 900)).toEqual({ x: 100, y: 100 });
        expect(lib.clampToViewport(1500, 100, 200, 300, 1600, 900)).toEqual({ x: 1392, y: 100 });
        expect(lib.clampToViewport(100, 800, 200, 300, 1600, 900)).toEqual({ x: 100, y: 592 });
        expect(lib.clampToViewport(1590, 890, 200, 300, 1600, 900)).toEqual({ x: 1392, y: 592 });
        // taller than the viewport: at the top edge, never above it
        expect(lib.clampToViewport(10, 500, 200, 2000, 1600, 900)).toEqual({ x: 10, y: 8 });
        expect(lib.clampToViewport(-50, -50, 200, 300, 1600, 900)).toEqual({ x: 8, y: 8 });
    });
});

describe("tipPosition", () => {
    const box = { width: 100, height: 40 };

    it("centres the box above the anchor", () => {
        expect(lib.tipPosition(rect(500, 300, 60, 20), box, VIEW)).toEqual({ left: 480, top: 251 });
    });

    it("goes below the anchor when there is no room above", () => {
        expect(lib.tipPosition(rect(500, 20, 60, 20), box, VIEW)).toEqual({ left: 480, top: 49 });
    });

    it("never leaves the viewport to the left or right", () => {
        expect(lib.tipPosition(rect(0, 300, 20, 20), box, VIEW).left).toBe(8);
        expect(lib.tipPosition(rect(1590, 300, 10, 20), box, VIEW).left).toBe(1492);
    });

    it("takes another gap", () => {
        expect(lib.tipPosition(rect(500, 300, 60, 20), box, VIEW, 4).top).toBe(256);
    });
});

describe("belowEndPosition", () => {
    it("puts a menu under its button, right edges aligned", () => {
        expect(lib.belowEndPosition(rect(1000, 100, 200, 40), VIEW)).toEqual({ top: 146, right: 400 });
    });

    it("keeps the margin to the right edge", () => {
        expect(lib.belowEndPosition(rect(1500, 100, 100, 40), VIEW).right).toBe(8);
    });
});

describe("panelPosition", () => {
    it("opens below the anchor, its right edge on the anchor's", () => {
        expect(lib.panelPosition(rect(600, 100, 40, 20), VIEW)).toEqual({ left: 300, width: 340, top: 126, maxHeight: 340 });
    });

    it("flips above when there is more room there and not enough below", () => {
        expect(lib.panelPosition(rect(600, 800, 40, 20), VIEW)).toEqual({ left: 300, width: 340, bottom: 106, maxHeight: 340 });
    });

    it("is never wider than the viewport and never past its left edge", () => {
        const narrow = { width: 300, height: 900 };
        expect(lib.panelPosition(rect(10, 100, 40, 20), narrow)).toEqual({ left: 8, width: 284, top: 126, maxHeight: 340 });
    });

    it("caps the height to the room it has", () => {
        expect(lib.panelPosition(rect(600, 100, 40, 20), { width: 1600, height: 300 }).maxHeight).toBe(166);
    });
});

describe("placements", () => {
    const box = { width: 100, height: 40 };

    it("wrap the positions and return nothing without an anchor", () => {
        const a = rect(500, 300, 60, 20);
        expect(lib.tipPlacement()(a, box, VIEW)).toEqual(lib.tipPosition(a, box, VIEW));
        expect(lib.belowEndPlacement()(a, box, VIEW)).toEqual(lib.belowEndPosition(a, VIEW));
        expect(lib.panelPlacement(200, 100)(a, box, VIEW)).toEqual(lib.panelPosition(a, VIEW, 200, 100));
        expect(lib.tipPlacement()(null, box, VIEW)).toEqual({});
        expect(lib.belowEndPlacement()(null, box, VIEW)).toEqual({});
        expect(lib.panelPlacement()(null, box, VIEW)).toEqual({});
    });

    it("a point placement needs no anchor and stays inside", () => {
        expect(lib.pointPlacement(1590, 890)(null, { width: 200, height: 300 }, VIEW)).toEqual({ left: 1392, top: 592 });
        expect(lib.pointPlacement(100, 100)(null, { width: 200, height: 300 }, VIEW)).toEqual({ left: 100, top: 100 });
    });

    it("samePosition ends the re-measure loop", () => {
        expect(lib.samePosition({ left: 1, top: 2 }, { left: 1, top: 2 })).toBe(true);
        expect(lib.samePosition({ left: 1, top: 2 }, { left: 1, top: 3 })).toBe(false);
        expect(lib.samePosition(null, null)).toBe(true);
        expect(lib.samePosition(null, { left: 1 })).toBe(false);
    });
});

describe("ui/Popover", () => {
    const src = read("components/ui/Popover.tsx");

    it("portals, places, follows and dismisses", () => {
        expect(src).toContain("createPortal(");
        expect(src).toMatch(/closest\("dialog"\)/);
        expect(src).toContain("useLayoutEffect(measure)");
        expect(src).toContain("samePosition(prev, next)");
        expect(src).toContain("useDismiss([anchor, box]");
        // the box's own scrolling is not the page moving
        expect(src).toMatch(/box\.current\.contains\(e\.target\)\) return;/);
    });

    it("is exported with the other building blocks", () => {
        expect(read("components/ui/index.ts")).toContain("export { default as Popover } from \"./Popover\";");
    });

    it.each([
        ["pages/lootcouncil/parts.tsx", "tipPlacement()"],
        ["components/HoverPanel.tsx", "panelPlacement("],
        ["pages/raid-detail/manage/ManageMenu.tsx", "belowEndPlacement()"],
        ["pages/raid-detail/raidplan/ContextMenu.tsx", "pointPlacement(x, y)"],
    ])("%s is built on it", (file, placement) => {
        const s = read(file);
        expect(s).toContain("<Popover");
        expect(s).toContain(placement);
        expect(s).not.toContain("createPortal");
    });

    it("the shared tooltip layer borrows the same placement", () => {
        expect(read("components/ui/Tip.tsx")).toContain("tipPosition(t.getBoundingClientRect()");
    });
});
