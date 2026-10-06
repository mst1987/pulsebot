// The council's filters per raid category, kept on the server.
//
// With a raid category picked, role, Content and BiS list are the category's
// own — stored on the server for the whole orga, because the in-game addon
// gets its council with exactly these (GET /api/ingest/council?v=2), and the
// menu's game version goes with them. Without a category ("Alle Raid-
// Kategorien") the filters stay this browser's own, as before. Tabs, BiS-list
// tier and the other view preferences stay in the browser either way.
//
// A change shows at once and is saved a moment later (one request for a burst
// of clicks); a reader without write access can still look around, nothing is
// saved for them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCouncilViews, saveCouncilView, type ApiError, type CouncilCategoryView, type CouncilViews } from "../../api";
import type { View } from "./view";

const SERVER_FIELDS = ["role", "tiers", "contents", "bisTier"] as const;
type ServerField = typeof SERVER_FIELDS[number];
const SAVE_DELAY_MS = 600;

/** What the hook needs of a view: the page's View and the drop check's FilterView both have it. */
type FilterFields = Pick<View, "role" | "tiers" | "contents" | "bisTier" | "category">;

export type CategoryViews<V extends FilterFields> = {
    /** False until the stored views were asked for — the page waits so it never loads twice. */
    ready: boolean;
    /** The view in effect: the browser's, with the picked category's stored filters laid over it. */
    filters: V;
    /** Change the view: a category's filters go to the server, everything else stays local. */
    patch: (next: Partial<V>) => void;
    /** The picked category runs as Loot-Council, so its filters reach the game. */
    reachesGame: boolean;
};

export function useCategoryViews<V extends FilterFields>({ view, setView, canWrite, version, mainVersion, onError }: {
    view: V;
    setView: (next: V) => void;
    canWrite: boolean;
    /** The menu's content version — stored with the view, the addon filters by it too. */
    version: string;
    mainVersion: string;
    onError: (message: string) => void;
}): CategoryViews<V> {
    const [views, setViews] = useState<CouncilViews | null>(null);
    const [ready, setReady] = useState(false);
    const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());
    const errorRef = useRef(onError);
    errorRef.current = onError;

    useEffect(() => {
        let live = true;
        getCouncilViews()
            .then((v) => { if (live) setViews(v); })
            // Without them the page still works - with the browser's filters only.
            .catch(() => undefined)
            .finally(() => { if (live) setReady(true); });
        return () => { live = false; };
    }, []);

    // A save still waiting when the page closes goes out right away.
    useEffect(() => () => {
        for (const { timer, run } of timers.current.values()) {
            clearTimeout(timer);
            run();
        }
        timers.current.clear();
    }, []);

    const schedule = useCallback((category: string, next: CouncilCategoryView) => {
        if (!canWrite) return;
        const pending = timers.current.get(category);
        if (pending) clearTimeout(pending.timer);
        const run = () => {
            timers.current.delete(category);
            saveCouncilView(category, next).catch((err: ApiError) => errorRef.current(err.message));
        };
        timers.current.set(category, { timer: setTimeout(run, SAVE_DELAY_MS), run });
    }, [canWrite]);

    const category = view.category;
    const stored = category && views ? (views.views[category] || views.defaults) : null;

    const update = useCallback((cat: string, change: Partial<CouncilCategoryView>) => {
        if (!views) return;
        const next = { ...(views.views[cat] || views.defaults), ...change };
        setViews({ ...views, views: { ...views.views, [cat]: next } });
        schedule(cat, next);
    }, [views, schedule]);

    // The menu's version is part of what the game gets: a category shown in
    // another version than the stored one takes it over (stored "" = main version).
    useEffect(() => {
        if (!stored || !canWrite || !version) return;
        if ((stored.version || mainVersion) !== version) update(category, { version });
    }, [stored, canWrite, version, mainVersion, category, update]);

    const filters = useMemo<V>(() => (stored
        ? { ...view, role: stored.role, tiers: stored.tiers, contents: stored.contents, bisTier: stored.bisTier }
        : view), [view, stored]);

    const patch = (next: Partial<V>) => {
        const cat = next.category !== undefined ? next.category : view.category;
        if (!cat || !views) {
            setView({ ...view, ...next });
            return;
        }
        const server: Partial<CouncilCategoryView> = {};
        const local: Partial<V> = {};
        for (const [key, value] of Object.entries(next)) {
            if ((SERVER_FIELDS as readonly string[]).includes(key)) (server as Record<ServerField, unknown>)[key as ServerField] = value;
            else (local as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(server).length) update(cat, { ...server, ...(version ? { version } : {}) });
        if (Object.keys(local).length) setView({ ...view, ...local });
    };

    return {
        ready,
        filters,
        patch,
        reachesGame: !!(category && views && views.councilCategories.includes(category)),
    };
}
