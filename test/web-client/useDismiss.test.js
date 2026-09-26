// hooks/useDismiss.ts (#439): one hook closes every popover, menu and picker on
// a click outside and on Escape. There used to be 13 hand-written copies of the
// same listener pair; the scan below keeps them from coming back.
const fs = require("fs");
const path = require("path");
const { CLIENT, loadTs, read } = require("./i18nHelper");

const { nodeOf, isInside, isDismissKey } = loadTs("lib/dismiss.ts");

/** A fake node: contains itself and the nodes listed as its children. */
function node(name, children = []) {
    const n = { name, contains: (other) => other === n || children.some((c) => c.contains(other)) };
    return n;
}

describe("lib/dismiss", () => {
    const leaf = node("leaf");
    const panel = node("panel", [leaf]);
    const button = node("button");
    const elsewhere = node("elsewhere");

    test("nodeOf takes a ref's current value or the node itself", () => {
        expect(nodeOf({ current: panel })).toBe(panel);
        expect(nodeOf(panel)).toBe(panel);
        expect(nodeOf({ current: null })).toBeNull();
        expect(nodeOf(null)).toBeNull();
        expect(nodeOf(undefined)).toBeNull();
    });

    test("a click in the panel or on its button is inside", () => {
        expect(isInside(leaf, [{ current: panel }, button])).toBe(true);
        expect(isInside(button, [{ current: panel }, button])).toBe(true);
    });

    test("a click anywhere else is outside", () => {
        expect(isInside(elsewhere, [{ current: panel }, button])).toBe(false);
    });

    test("a target that is not mounted holds nothing", () => {
        expect(isInside(leaf, [{ current: null }, null, undefined])).toBe(false);
        expect(isInside(leaf, [])).toBe(false);
    });

    test("no target node (a click on the document itself) counts as outside", () => {
        expect(isInside(null, [panel])).toBe(false);
    });

    test("only Escape dismisses", () => {
        expect(isDismissKey("Escape")).toBe(true);
        expect(isDismissKey("Enter")).toBe(false);
        expect(isDismissKey("Tab")).toBe(false);
    });
});

describe("hooks/useDismiss", () => {
    const src = read("hooks/useDismiss.ts");

    test("listens only while open and removes what it added", () => {
        expect(src).toMatch(/if \(!open\) return undefined;/);
        expect(src).toMatch(/document\.addEventListener\(event, away, capture\)/);
        expect(src).toMatch(/document\.removeEventListener\(event, away, capture\)/);
        expect(src).toMatch(/if \(escape\) document\.addEventListener\("keydown", key\)/);
        expect(src).toMatch(/if \(escape\) document\.removeEventListener\("keydown", key\)/);
    });

    test("uses the latest targets and onClose (no resubscribe per render)", () => {
        expect(src).toMatch(/latest\.current = \{ targets, onClose \}/);
        expect(src).toMatch(/\}, \[open, event, capture, escape\]\);/);
    });

    test("defaults: mousedown, bubble phase, Escape on", () => {
        expect(src).toMatch(/event = "mousedown", capture = false, escape = true/);
    });
});

describe("no hand-written click-outside listener is left", () => {
    const files = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.tsx?$/.test(e.name)) files.push(p);
        }
    };
    walk(CLIENT);

    // the former users of the pattern, all on the hook now — directly, or through ui/Popover (which calls it)
    const USERS = [
        "components/LootFilters.tsx", "pages/ClaPage.tsx", "pages/lootcouncil/FilterBar.tsx",
        "components/EmojiPicker.tsx", "components/ItemSearchPicker.tsx", "components/ManualLootForm.tsx", "components/raidplan/Flyout.tsx",
        "components/RolePermissions.tsx", "components/SpecPicker.tsx",
        "pages/raid-detail/raidplan/ViewControls.tsx", "components/ui/Button.tsx",
    ];
    const VIA_POPOVER = ["pages/raid-detail/manage/ManageMenu.tsx", "pages/raid-detail/raidplan/ContextMenu.tsx"];

    test.each(USERS)("%s uses useDismiss", (rel) => {
        expect(read(rel)).toMatch(/useDismiss\(/);
    });

    test.each(VIA_POPOVER)("%s is dismissed by its Popover", (rel) => {
        expect(read(rel)).toMatch(/<Popover[\s\S]*onClose=/);
        expect(read("components/ui/Popover.tsx")).toMatch(/useDismiss\(/);
    });

    test("no component registers a document mousedown/click listener with a contains() check of its own", () => {
        const offenders = files
            .filter((f) => !f.endsWith(path.join("hooks", "useDismiss.ts")))
            .filter((f) => {
                const src = fs.readFileSync(f, "utf8");
                return /document\.addEventListener\("(mousedown|click)"/.test(src) && /\.contains\(/.test(src);
            })
            .map((f) => path.relative(CLIENT, f));
        expect(offenders).toEqual([]);
    });
});
