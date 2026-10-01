// The live half of an open Kader page (docs/kaderplaner.md, "Live"): asks
// GET /api/kader/live every LIVE_MS while the tab is visible — at once when the
// tab comes back, when the page opens a Kader and when it opens something else
// (an interview, the drawer, the account dialog), so the others see it within
// one of their own polls. The answer says who else is here (returned) and the
// Kader's revision: when it moved past the page's, `onMoved` gets the answer
// (the page refetches and says what changed). Leaving the Kader tells the
// server at once. A failed poll stays quiet; the next one asks again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getKaderLive, leaveKaderLive, type KaderLive, type KaderLiveWhere, type KaderPresence } from "../../api";
import { useVisiblePoll } from "../../hooks/useVisiblePoll";

/** How often an open, visible Kader page asks. */
export const LIVE_MS = 5000;

const NOWHERE: KaderLiveWhere = { tab: "", sub: "", playerId: "", what: "", edit: false };
const newTab = () => `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export function useKaderLive({ kaderId, rev, sharedRev, where, enabled, onMoved }: {
    kaderId: string;
    /** The revision of the Kader the page shows, and of the server's side. */
    rev: number;
    sharedRev: number;
    where: Omit<KaderLiveWhere, "tab">;
    /** false: no polling at all (no Kader open, no right to read it). */
    enabled: boolean;
    onMoved: (live: KaderLive) => void;
}): KaderPresence[] {
    const tab = useMemo(newTab, []);
    const [presence, setPresence] = useState<KaderPresence[]>([]);
    const latest = useRef({ kaderId, rev, sharedRev, where, onMoved });
    latest.current = { kaderId, rev, sharedRev, where, onMoved };
    const busy = useRef(false);
    const again = useRef(false);

    const tick = useCallback(async (): Promise<void> => {
        if (busy.current) {
            again.current = true;
            return;
        }
        const asked = latest.current;
        if (!asked.kaderId) return;
        busy.current = true;
        try {
            const live = await getKaderLive(asked.kaderId, asked.rev, { tab, ...asked.where });
            const now = latest.current;
            // the page went on to another Kader meanwhile: this answer is not about it
            if (now.kaderId !== asked.kaderId || !live) return;
            setPresence(live.presence || []);
            if (live.gone || live.rev > now.rev || live.sharedRev > now.sharedRev) now.onMoved(live);
        } catch {
            // offline for a moment, a restart: the next tick asks again
        } finally {
            busy.current = false;
            if (again.current) {
                again.current = false;
                void tick();
            }
        }
    }, [tab]);

    const active = enabled && !!kaderId;
    useVisiblePoll(() => void tick(), LIVE_MS, active);

    // at once when the page opens a Kader or shows something else
    const whereKey = `${where.sub}|${where.playerId}|${where.what}|${where.edit}`;
    useEffect(() => {
        if (active && document.visibilityState === "visible") void tick();
    }, [active, kaderId, whereKey, tick]);

    // leaving the Kader (another one, another page, the tab closing): the others stop seeing this page at once
    useEffect(() => {
        if (!active) return undefined;
        const leave = () => leaveKaderLive(kaderId, { ...NOWHERE, tab });
        window.addEventListener("pagehide", leave);
        return () => {
            window.removeEventListener("pagehide", leave);
            setPresence([]);
            leave();
        };
    }, [active, kaderId, tab]);

    return presence;
}
