// The council's filters per Loot-Council profile, kept on the server (#676).
//
// With a roster picked (or a raid category without roster), role, Content and
// BiS list are the view of that council's profile — stored on the server for
// the whole orga, because the in-game addon gets its council with exactly
// these (GET /api/ingest/council), and the menu's game version goes with them.
// Several rosters may share a profile: a change here changes it for all of
// them (the head names the profile). Without a pick ("Alle Raid-Kategorien")
// the filters stay this browser's own, as before. Tabs, BiS-list tier and the
// other view preferences stay in the browser either way.
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
type FilterFields = Pick<View, "role" | "tiers" | "contents" | "bisTier" | "category" | "roster">;

/** The key a council target has in `targets`: "roster:<id>", "category:<id>" or "" (every category). */
export function targetKey(view: { roster?: string; category: string }): string {
    if (view.roster) return `roster:${view.roster}`;
    return view.category ? `category:${view.category}` : "";
}

export type CategoryViews<V extends FilterFields> = {
    /** False until the stored views were asked for — the page waits so it never loads twice. */
    ready: boolean;
    /** The view in effect: the browser's, with the picked council's profile view laid over it. */
    filters: V;
    /** Change the view: a profile's filters go to the server, everything else stays local. */
    patch: (next: Partial<V>) => void;
    /** The picked roster or category runs as Loot-Council, so its filters reach the game. */
    reachesGame: boolean;
    /** The profile whose view is shown ("" without a pick). */
    profileId: string;
    /** Ask for the stored views again (after the profile tab changed one). */
    reload: () => void;
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
    const [round, setRound] = useState(0);
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
    }, [round]);

    // A save still waiting when the page closes goes out right away.
    useEffect(() => () => {
        for (const { timer, run } of timers.current.values()) {
            clearTimeout(timer);
            run();
        }
        timers.current.clear();
    }, []);

    const schedule = useCallback((profileId: string, next: CouncilCategoryView) => {
        if (!canWrite) return;
        const pending = timers.current.get(profileId);
        if (pending) clearTimeout(pending.timer);
        const run = () => {
            timers.current.delete(profileId);
            saveCouncilView(profileId, next).catch((err: ApiError) => errorRef.current(err.message));
        };
        timers.current.set(profileId, { timer: setTimeout(run, SAVE_DELAY_MS), run });
    }, [canWrite]);

    const profileOf = useCallback((key: string) => (key && views && views.targets ? (views.targets[key] || "") : ""), [views]);
    const profileId = profileOf(targetKey(view));
    const stored = profileId && views ? (views.views[profileId] || views.defaults) : null;

    const update = useCallback((pid: string, change: Partial<CouncilCategoryView>) => {
        if (!views) return;
        const next = { ...(views.views[pid] || views.defaults), ...change };
        setViews({ ...views, views: { ...views.views, [pid]: next } });
        schedule(pid, next);
    }, [views, schedule]);

    // The menu's version is part of what the game gets: a council shown in
    // another version than the stored one takes it over (stored "" = main version).
    useEffect(() => {
        if (!stored || !canWrite || !version) return;
        if ((stored.version || mainVersion) !== version) update(profileId, { version });
    }, [stored, canWrite, version, mainVersion, profileId, update]);

    const filters = useMemo<V>(() => (stored
        ? { ...view, role: stored.role, tiers: stored.tiers, contents: stored.contents, bisTier: stored.bisTier }
        : view), [view, stored]);

    const patch = (next: Partial<V>) => {
        const picking = next.roster !== undefined || next.category !== undefined;
        // a new pick only changes the pick; the filters then come from its profile
        const pid = picking ? "" : profileOf(targetKey(view));
        if (!pid) {
            setView({ ...view, ...next });
            return;
        }
        const server: Partial<CouncilCategoryView> = {};
        const local: Partial<V> = {};
        for (const [k, value] of Object.entries(next)) {
            if ((SERVER_FIELDS as readonly string[]).includes(k)) (server as Record<ServerField, unknown>)[k as ServerField] = value;
            else (local as Record<string, unknown>)[k] = value;
        }
        if (Object.keys(server).length) update(pid, { ...server, ...(version ? { version } : {}) });
        if (Object.keys(local).length) setView({ ...view, ...local });
    };

    const reachesGame = !!(views && (view.roster
        ? (views.councilRosters || []).includes(view.roster)
        : view.category && (views.councilCategories || []).includes(view.category)));

    return {
        ready,
        filters,
        patch,
        reachesGame,
        profileId,
        reload: () => setRound((n) => n + 1),
    };
}
