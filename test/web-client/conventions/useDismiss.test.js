// hooks/useDismiss.ts (#439): one hook closes every popover, menu and picker on
// a click outside and on Escape. There used to be 13 hand-written copies of the
// same listener pair; the scan below keeps them from coming back. The pure
// rules (lib/dismiss.ts) run in src/web-client/src/lib/useDismiss.test.ts (Vitest).
const fs = require("fs");
const path = require("path");
const { CLIENT, read } = require("../clientSource");

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
