import { useCallback, useState } from "react";
import { DEFAULT_PREFS, parsePrefs, type ViewPrefs } from "./viewRules";

/**
 * What one person wants to see, remembered in this browser (never in the plan): the highlight of his own character, the selection frame in the editor,
 * the connection lines and - over what the plan already shows - the names, role rings and group rings. The plan's own switches say what is shown for
 * everybody; these can only hide more for one viewer.
 */
export type { ViewPrefs };

function load(key: string): ViewPrefs {
    try { return parsePrefs(window.localStorage.getItem(key)); } catch { return { ...DEFAULT_PREFS }; }
}

export function useViewPrefs(key: string): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
    const [prefs, setPrefs] = useState<ViewPrefs>(() => load(key));
    const set = useCallback((patch: Partial<ViewPrefs>) => {
        setPrefs((cur) => {
            const next = { ...cur, ...patch };
            try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window */ }
            return next;
        });
    }, [key]);
    return [prefs, set];
}
