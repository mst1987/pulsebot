import { useEffect, useRef, useState } from "react";
import { leaveSetupPresence, setupPresence, type SetupActivity, type SetupPresenceAction, type SetupPresenceEditor } from "../../../api";

// Who else is in this setup editor (services/setup/setupPresence.js): a heartbeat
// every PRESENCE_POLL_MS while the tab is visible — and at once whenever what the
// orga member holds changes (a raider dragged or picked, a signup opened), so the
// others see it within a moment. The answer carries the others, the stored
// version (newer than the page's = somebody else changed the setup) and the
// activity since the last heartbeat. Closing the editor says goodbye.

export const PRESENCE_POLL_MS = 3000;
/** How many lines of "Gerade eben" the page keeps. */
const ACTIVITY_KEEP = 20;

/** Six colours told apart by lightness too — one per orga member, the same on every page. */
const COLORS = ["#f0a04b", "#4fc3d9", "#e86fa8", "#8bc34a", "#b39dff", "#ffd54f"];

export function presenceColor(userId: string): string {
    let h = 0;
    for (const ch of String(userId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
}

/** "Exitus" → "Ex", "Rasheed Zz" → "RZ" */
export function initials(name: string): string {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    const one = parts[0] || "?";
    return one.slice(0, 1).toUpperCase() + one.slice(1, 2).toLowerCase();
}

export function usePresence(eventId: string, action: SetupPresenceAction | null, { enabled, onNew }: { enabled: boolean; onNew?: (entries: SetupActivity[]) => void }) {
    const [editors, setEditors] = useState<SetupPresenceEditor[]>([]);
    const [activity, setActivity] = useState<SetupActivity[]>([]);
    const [version, setVersion] = useState(0);
    const since = useRef(0);
    const first = useRef(true);
    const actionRef = useRef(action);
    actionRef.current = action;
    const onNewRef = useRef(onNew);
    onNewRef.current = onNew;
    const beatRef = useRef<() => Promise<void>>(async () => undefined);
    beatRef.current = async () => {
        try {
            const answer = await setupPresence(eventId, { action: actionRef.current, since: since.current });
            setEditors(Array.isArray(answer?.editors) ? answer.editors : []);
            setVersion(Number(answer?.version) || 0);
            const fresh = Array.isArray(answer?.activity) ? answer.activity : [];
            if (fresh.length) {
                since.current = Math.max(since.current, ...fresh.map((e) => e.id));
                setActivity((prev) => [...prev, ...fresh].slice(-ACTIVITY_KEEP));
                // what happened before the page opened is history, not news
                if (!first.current) onNewRef.current?.(fresh);
            }
            first.current = false;
        } catch {
            // offline or a hiccup: the next heartbeat tries again
        }
    };

    useEffect(() => {
        if (!enabled) return undefined;
        void beatRef.current();
        const timer = setInterval(() => {
            if (typeof document === "undefined" || document.visibilityState !== "hidden") void beatRef.current();
        }, PRESENCE_POLL_MS);
        // back to the tab: catch up at once instead of on the next tick
        const visible = () => {
            if (document.visibilityState === "visible") void beatRef.current();
        };
        document.addEventListener("visibilitychange", visible);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", visible);
            // best-effort goodbye: without it the others drop this editor after the TTL anyway
            leaveSetupPresence(eventId).catch(() => undefined);
        };
    }, [enabled, eventId]);

    // what the orga member holds changed: tell the others at once, not on the next tick
    const key = action ? `${action.kind}:${action.userId}` : "";
    const lastKey = useRef(key);
    useEffect(() => {
        if (!enabled || lastKey.current === key) return;
        lastKey.current = key;
        void beatRef.current();
    }, [enabled, key]);

    return { editors, activity, version };
}
