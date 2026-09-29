import { useCallback, useState } from "react";
import { parseCollapseSet, parseCollapsed, toggleCollapseId } from "../lib/raidplan/collapse";

/**
 * One block of the raid plan editor that folds on its own (Roster slots, Taktik, the mobs bar …): a real boolean under its
 * own storage key, remembered in this browser across a reload. Wrapped in try/catch everywhere - a private window or
 * blocked storage falls back to "open" and never throws.
 */
export function useCollapse(storageKey: string): [boolean, () => void] {
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try { return parseCollapsed(window.localStorage.getItem(storageKey)); } catch { return false; }
    });
    const toggle = useCallback(() => {
        setCollapsed((cur) => {
            const next = !cur;
            try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* private window or blocked storage */ }
            return next;
        });
    }, [storageKey]);
    return [collapsed, toggle];
}

/**
 * A set of same-shaped blocks that fold independently (the assignment cards, one per type): one storage key holds every
 * folded id, so this is ONE hook call for all of them (they are usually rendered in a `.map`, where a hook call per item
 * would break the rules of hooks).
 */
export function useCollapseSet(storageKey: string): [(id: string) => boolean, (id: string) => void] {
    const [ids, setIds] = useState<string[]>(() => {
        try { return parseCollapseSet(window.localStorage.getItem(storageKey)); } catch { return []; }
    });
    const toggle = useCallback((id: string) => {
        setIds((cur) => {
            const next = toggleCollapseId(cur, id);
            try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private window or blocked storage */ }
            return next;
        });
    }, [storageKey]);
    const isCollapsed = useCallback((id: string) => ids.indexOf(id) >= 0, [ids]);
    return [isCollapsed, toggle];
}
