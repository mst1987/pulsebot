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
