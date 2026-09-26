import { useState } from "react";
import { repostTalkOverview, type ApiError, type TalkOverviewStatus } from "../../api";
import { talkOverviewBadge } from "../../lib/settingsLogic";
import { useToast } from "../../components/Jobs";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";

// One row of an event server's card (#257, #361): that server's own raid
// overview state as a badge (the times and any error in its tooltip), where it
// posts, and "Neu posten", which deletes the old message and posts a fresh one
// at the channel's end. Everything else runs by itself — sign-ups, new events
// and a sweep every 5 minutes.
//
// Controlled from DiscordServersSection: `status` is fetched once for every
// configured event server there (one GET instead of one per card), and a
// successful repost is reported back through `onReposted` instead of being
// held in local state here — the parent only renders this row once the entry
// has an overview target, so the button needs no separate "configured" check.
export default function TalkOverviewRow({
    guildId, targetGuildName, targetChannelName, status, onReposted,
}: {
    guildId: string;
    targetGuildName: string;
    targetChannelName: string;
    status: TalkOverviewStatus | null;
    onReposted: (status: TalkOverviewStatus) => void;
}) {
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const repost = async () => {
        setBusy(true);
        try {
            const { result, status: next } = await repostTalkOverview(guildId);
            if (next) onReposted(next);
            if (result.status === "error") toast(result.error || "Übersicht konnte nicht gepostet werden.", "err");
            else toast("Raid-Übersicht neu gepostet.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const badge = talkOverviewBadge(status, Date.now());
    const target = [targetChannelName, targetGuildName].filter(Boolean).join(" · ");
    return (
        <div>
            <dt tabIndex={0} data-tip="Raid-Übersicht" data-tip-sub={target ? `Wird gepostet auf ${target}.` : undefined}>Übersicht</dt>
            <dd className="talk-overview">
                {status && status.messageUrl ? (
                    <a href={status.messageUrl} target="_blank" rel="noreferrer">
                        <Badge tone={badge.tone || undefined} tip={badge.tip} tipSub={badge.tipSub}>{badge.label}</Badge>
                    </a>
                ) : (
                    <Badge tone={badge.tone || undefined} tip={badge.tip} tipSub={badge.tipSub}>{badge.label}</Badge>
                )}
                <Button variant="ghost" size="sm" onClick={repost} disabled={busy}>{busy ? "Postet…" : "Neu posten"}</Button>
            </dd>
        </div>
    );
}
