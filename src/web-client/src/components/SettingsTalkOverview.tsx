import { useEffect, useState } from "react";
import { getTalkOverview, repostTalkOverview, type ApiError, type TalkOverviewStatus } from "../api";
import { talkOverviewBadge } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";

// One row of the talk server card (#257): the raid overview's state as a badge
// (the times and any error in its tooltip) and "Neu posten", which deletes the
// old message and posts a fresh one at the channel's end. Everything else runs
// by itself — sign-ups, new events and a sweep every 5 minutes.
export default function TalkOverviewRow({ csrfToken }: { csrfToken: string | null }) {
    const [status, setStatus] = useState<TalkOverviewStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        getTalkOverview().then((d) => setStatus(d.status)).catch(() => setStatus(null));
    }, []);

    const repost = async () => {
        setBusy(true);
        try {
            const { result, status: next } = await repostTalkOverview(csrfToken);
            setStatus(next);
            if (result.status === "error") toast(result.error || "Übersicht konnte nicht gepostet werden.", "err");
            else toast("Raid-Übersicht neu gepostet.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const badge = talkOverviewBadge(status, Date.now());
    return (
        <div>
            <dt>Übersicht</dt>
            <dd className="talk-overview">
                {status && status.messageUrl ? (
                    <a href={status.messageUrl} target="_blank" rel="noreferrer">
                        <Badge tone={badge.tone || undefined} tip={badge.tip} tipSub={badge.tipSub}>{badge.label}</Badge>
                    </a>
                ) : (
                    <Badge tone={badge.tone || undefined} tip={badge.tip} tipSub={badge.tipSub}>{badge.label}</Badge>
                )}
                {status && status.configured && (
                    <Button variant="ghost" size="sm" onClick={repost} disabled={busy}>{busy ? "Postet…" : "Neu posten"}</Button>
                )}
            </dd>
        </div>
    );
}
