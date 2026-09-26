// The pure half of hooks/useDismiss.ts: what counts as "inside" an open
// popover, menu or picker. Kept free of React and of DOM classes; tested in
// src/web-client/src/lib/useDismiss.test.ts.

/** A part of the page that counts as inside: a ref, a node, or nothing (yet). */
export type DismissTarget = { current: Node | null } | Node | null | undefined;

/** The node behind a target — a ref's current value or the node itself. */
export function nodeOf(target: DismissTarget): Node | null {
    if (!target) return null;
    return "current" in target ? target.current : target;
}

/** Whether `node` lies inside one of the targets; a target that is not mounted holds nothing. */
export function isInside(node: Node | null, targets: DismissTarget[]): boolean {
    if (!node) return false;
    return targets.some((target) => {
        const el = nodeOf(target);
        return !!el && el.contains(node);
    });
}

/** Whether a key press closes the popover. */
export function isDismissKey(key: string): boolean {
    return key === "Escape";
}
