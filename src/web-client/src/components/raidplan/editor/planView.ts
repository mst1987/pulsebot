// The editor's two views of one section (Oct 2026): "Aufgaben" (the assignments, the Besetzung, the tactic - no drawing tools)
// and "Karte" (the board with its tools in the full width). Never side by side: there is not enough room for the map next
// to the task list. The choice is the user's, remembered in this browser, and - in the event editor, whose section is in the
// address already (`#boss=`, lib/raidplan/sectionUrl.ts) - also in the address (`#view=map`), so a reload or a shared link
// opens the same view. "Allgemein" and "Standard" have no map: there the view is always "tasks" (the stored choice stays).
import { useCallback, useState } from "react";

export type PlanView = "tasks" | "map";

type Section = { key: string; general?: boolean; defaults?: boolean; trash?: boolean };
/** A boss (not Standard, Allgemein or trash): the sections counted as "Boss n von m". */
const isBoss = (b: Section) => !b.general && !b.defaults && !b.trash;

/** Where a section stands in the strip (SectionStrip): "Boss 4 von 9" for a boss, "Abschnitt 2 von 12" for Standard, Allgemein and trash. */
export function sectionPosition(sections: Section[], key: string): { boss: boolean; n: number; of: number } {
    const b = sections.find((x) => x.key === key);
    if (b && isBoss(b)) {
        const list = sections.filter(isBoss);
        return { boss: true, n: list.indexOf(b) + 1, of: list.length };
    }
    return { boss: false, n: sections.findIndex((x) => x.key === key) + 1, of: sections.length };
}

/** Where the choice is remembered in this browser. */
export const VIEW_KEY = "eh.raidplan.view";
const HASH_KEY = "view";

/** A stored or written value as a view; anything else is the default "tasks". */
export function parseView(raw: string | null | undefined): PlanView {
    return raw === "map" ? "map" : "tasks";
}

/** The view a hash names (`#boss=bt/supremus&view=map`), "" when it names none. */
export function viewFromHash(hash: string): PlanView | "" {
    const v = new URLSearchParams(String(hash || "").replace(/^#/, "")).get(HASH_KEY);
    return v === "map" || v === "tasks" ? v : "";
}

/** The hash with the view set, every other part (the section) kept; the default view is left out. The slash of a key stays readable. */
export function hashWithView(hash: string, view: PlanView): string {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (view === "map") params.set(HASH_KEY, view); else params.delete(HASH_KEY);
    const text = params.toString().replace(/%2F/gi, "/");
    return text ? `#${text}` : "";
}

/** Writes the view into the address without a new history entry (path, query and the router's state kept). */
export function showViewInUrl(view: PlanView): void {
    try {
        const loc = window.location;
        const hash = hashWithView(loc.hash, view);
        if (hash === loc.hash) return;
        window.history.replaceState(window.history.state, "", `${loc.pathname}${loc.search}${hash}`);
    } catch { /* a sandboxed frame without history access: the view just is not kept in the address */ }
}

/** The view the editor opens with: the address first (only where it carries one), then this browser's choice, then "tasks". */
export function startView(useUrl: boolean): PlanView {
    if (useUrl) {
        try { const v = viewFromHash(window.location.hash); if (v) return v; } catch { /* no location */ }
    }
    try { return parseView(window.localStorage.getItem(VIEW_KEY)); } catch { return "tasks"; }
}

/**
 * The chosen view and its setter: remembered in this browser (wrapped in try/catch - a private window opens on "tasks") and,
 * with `useUrl`, written into the address.
 */
export function usePlanView(useUrl: boolean): [PlanView, (v: PlanView) => void] {
    const [view, setView] = useState<PlanView>(() => startView(useUrl));
    const choose = useCallback((v: PlanView) => {
        setView(v);
        try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private window or blocked storage */ }
        if (useUrl) showViewInUrl(v);
    }, [useUrl]);
    return [view, choose];
}
