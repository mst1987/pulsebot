// hooks/useDismiss.ts (#439): one hook closes every popover, menu and picker on
// a click outside and on Escape. The pure rules live in lib/dismiss.ts and run
// here; the hook and the scan against hand-written copies stay in
// test/web-client/useDismiss.test.js.
import { describe, expect, test } from "vitest";
import { nodeOf, isInside, isDismissKey } from "./dismiss";

/** A fake node: contains itself and the nodes listed as its children. */
type FakeNode = { name: string; contains: (other: unknown) => boolean };
function node(name: string, children: FakeNode[] = []): FakeNode {
    const n: FakeNode = { name, contains: (other) => other === n || children.some((c) => c.contains(other)) };
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
