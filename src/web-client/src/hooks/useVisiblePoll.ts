import { useEffect, useRef } from "react";

/**
 * Calls `tick` every `ms` while the tab is visible (#555): a hidden tab asks nothing, and a tab that becomes visible
 * again asks at once. `enabled: false` stops it. The newest `tick` is always the one called, so it may close over the
 * page's current state without restarting the timer. Unlike useRaidProgress it does not ask on mount - the page just
 * loaded what it shows.
 */
export function useVisiblePoll(tick: () => void, ms: number, enabled = true): void {
    const tickRef = useRef(tick);
    tickRef.current = tick;

    useEffect(() => {
        if (!enabled) return undefined;
        const run = () => { if (document.visibilityState === "visible") tickRef.current(); };
        const timer = window.setInterval(run, ms);
        const onVisible = () => { if (document.visibilityState === "visible") run(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [ms, enabled]);
}
