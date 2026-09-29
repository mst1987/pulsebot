import { useCallback, useEffect, useMemo, useState } from "react";
import { getRaidplanProgress, type RaidplanProgress } from "../api";
import { followTarget, inRaidWindow, PROGRESS_POLL_MS } from "../lib/raidplan/progress";

/**
 * The raid plan follows the raid (#534): while the raid window is open and the tab is visible, asks the server every minute what the
 * linked Warcraft Log shows (GET /api/raidplan/progress) and turns the plan to the boss being fought, else to the next one standing -
 * as long as "follow" is on. A section the user picks himself (`choose`) switches following off; `setFollow(true)` turns it on again
 * and jumps at once. Outside the window, in a hidden tab or without a source no request is made.
 *
 * @param source   `{ token }` for the read view, `{ event }` for the editor, null = nothing to ask
 * @param startTime  the event's start (seconds, as the payloads carry it)
 * @param keys     the sections the page shows (a target it does not show is ignored)
 * @param select   sets the chosen section (the page's own setter)
 * @param initialFollow  false when the page opened on a section the user asked for (a deep link)
 */
export function useRaidProgress({ source, startTime, keys, select, initialFollow = true }: {
    source: { token: string } | { event: string } | null;
    startTime: number;
    keys: readonly string[];
    select: (key: string) => void;
    initialFollow?: boolean;
}) {
    const [progress, setProgress] = useState<RaidplanProgress | null>(null);
    const [follow, setFollow] = useState(initialFollow);
    const sourceKey = source ? ("token" in source ? `t:${source.token}` : `e:${source.event}`) : "";

    useEffect(() => {
        if (!source) return undefined;
        let alive = true;
        const tick = () => {
            if (document.visibilityState !== "visible") return;
            if (!inRaidWindow(startTime, Date.now())) return;
            getRaidplanProgress(source).then((p) => { if (alive) setProgress(p); }).catch(() => { /* the next minute asks again */ });
        };
        tick();
        const timer = window.setInterval(tick, PROGRESS_POLL_MS);
        const onVisible = () => { if (document.visibilityState === "visible") tick(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            alive = false;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [sourceKey, startTime]); // eslint-disable-line react-hooks/exhaustive-deps

    const keyList = keys.join("|");
    useEffect(() => {
        if (!follow) return;
        const target = followTarget(progress, keys);
        if (target) select(target);
    }, [progress, follow, keyList]); // eslint-disable-line react-hooks/exhaustive-deps

    const live = !!progress && progress.live;
    /** A section picked by hand: shown, and following pauses (only while there is something to follow). */
    const choose = useCallback((key: string) => {
        select(key);
        if (live) setFollow(false);
    }, [select, live]);
    const killed = useMemo(() => new Set(live && progress ? progress.killed : []), [live, progress]);
    return { live, killed, follow, setFollow, choose, progress };
}
