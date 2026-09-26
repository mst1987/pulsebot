// components/ui/Popover.tsx and lib/popoverPosition.ts (#439): one base for the
// floating boxes that belong to an element — menus, rich tooltips, hover
// panels, the raid plan's right-click menu.
// The placements run in src/web-client/src/lib/popover.test.ts (Vitest);
// the component and its users are checked by source here.
const { read } = require("../clientSource");

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
