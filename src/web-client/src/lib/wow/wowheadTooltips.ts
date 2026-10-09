// Re-scan the DOM for wowhead links after an SPA render, so the Wowhead
// tooltip widget (power.js, loaded in index.html) attaches to them. The widget
// only scans once on page load; React renders content afterwards.
// Best-effort: no-ops while the widget script is still loading or blocked.

type WowheadPower = { refreshLinks?: () => void };

export function refreshWowheadLinks(): void {
    const w = (window as unknown as { $WowheadPower?: WowheadPower }).$WowheadPower;
    try {
        w?.refreshLinks?.();
    } catch {
        // widget not ready / offline — tooltips are progressive enhancement
    }
}

/** The class of the box power.js appends to <body> for an item tooltip. */
export const WOWHEAD_TOOLTIP_CLASS = "wowhead-tooltip";

// power.js shows its box with an inline `visibility: visible` and hides it with
// `display: none; visibility: hidden` (checked against the live widget).
function tooltipShown(el: HTMLElement): boolean {
    return el.style.visibility === "visible" && el.style.display !== "none";
}

/**
 * Puts a showing tooltip box into the top layer, and back into the page once it
 * hides. While hidden it is a plain div again, so power.js measures and places it
 * exactly as before; the lift comes in the mutation callback, before the paint.
 */
export function syncWowheadTooltip(el: HTMLElement): void {
    if (typeof el.showPopover !== "function") return;
    if (tooltipShown(el)) {
        if (el.matches(":popover-open")) return; // already lifted; power.js moves it with the mouse
        el.setAttribute("popover", "manual");
        el.showPopover();
    } else if (el.hasAttribute("popover")) {
        if (el.matches(":popover-open")) el.hidePopover();
        el.removeAttribute("popover"); // a plain div again: the popover defaults no longer apply
    }
}

/**
 * Keeps Wowhead's item tooltip above an open modal. A modal <dialog> (ui/Modal,
 * the raider dialog) is drawn in the browser's top layer, above everything in the
 * page however high its z-index — so the tooltip power.js hangs into <body> sat
 * behind the dialog. Same cure as <TipLayer>'s box (components/ui/Tip.tsx): a
 * manual popover, shown afresh on every appearance so it lands above whatever
 * dialog opened since. In the top layer `position: absolute` counts from the
 * document's origin, just like power.js's left/top; styles/ui.css undoes the
 * popover defaults. Without popover support nothing changes. Returns the uninstall.
 */
export function installWowheadTooltipLift(root: HTMLElement = document.body): () => void {
    const watched = new WeakSet<Element>();
    const styleObserver = new MutationObserver((records) => {
        for (const r of records) syncWowheadTooltip(r.target as HTMLElement);
    });
    const watch = (node: Node) => {
        if (!(node instanceof HTMLElement) || !node.classList.contains(WOWHEAD_TOOLTIP_CLASS) || watched.has(node)) return;
        watched.add(node);
        styleObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
        syncWowheadTooltip(node);
    };
    // power.js creates its boxes lazily, on the first hover.
    const childObserver = new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach(watch);
    });
    childObserver.observe(root, { childList: true });
    root.childNodes.forEach(watch);
    return () => {
        childObserver.disconnect();
        styleObserver.disconnect();
    };
}
