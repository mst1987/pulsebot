import { useEffect, useRef, useState } from "react";
import { closeVoice, getVoice, openVoice, type ApiError, type VoiceRaid } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { useT } from "../../../i18n";
import { belowEndPlacement } from "../../../lib/ui/popoverPosition";
import { Button } from "../../../components/ui/Button";
import Popover from "../../../components/ui/overlay/Popover";
import WowIcon from "../../../components/ui/icons/WowIcon";
import { ChevronDownIcon } from "../../../components/ui/icons/icons";
import { useToast } from "../../../components/shell/Jobs";
import { voiceStateLine } from "./voiceState";

/** How often the row asks again while open: the channel opens, fills and closes on its own. */
export const VOICE_REFRESH_MS = 60_000;

/**
 * The raid's voice channel in the setup editor (docs/channels.md): one line under
 * the bar with the channel's name, its state as words and "Kanal ▾" (create now,
 * close, open in Discord). Shows nothing when the raid has no channel at all.
 */
export default function VoiceChannelRow({ eventId, canWrite = true }: { eventId: string; canWrite?: boolean }) {
    const t = useT();
    const toast = useToast();
    const voice = useApi(() => getVoice(eventId), [eventId]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const anchor = useRef<HTMLDivElement>(null);
    const { reload } = voice;

    useEffect(() => {
        const timer = window.setInterval(() => { if (!document.hidden) reload(); }, VOICE_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [reload]);

    const raids = voice.data?.raids;
    const raid = Array.isArray(raids) ? raids.find((r) => r.eventId === eventId) : undefined;
    if (!raid || raid.kind === "none") return null;

    const act = async (fn: (id: string) => Promise<{ raids: VoiceRaid[] }>) => {
        setBusy(true);
        try {
            const res = await fn(eventId);
            voice.setData((d) => (d ? { ...d, raids: res.raids } : d));
        } catch (e) {
            toast((e as ApiError).message || t("channels.voiceRow.unknownError"), "err");
        } finally {
            setBusy(false);
        }
    };

    const isTemp = raid.kind === "temp";
    const items: { id: string; label: string; icon: string; onSelect: () => void }[] = [];
    if (canWrite && isTemp && (raid.canOpen ?? (raid.state === "planned" || raid.state === "failed"))) {
        items.push({ id: "open", label: t("channels.voiceRow.openNow"), icon: "channels", onSelect: () => act(openVoice) });
    }
    if (canWrite && isTemp && raid.state === "open") {
        items.push({ id: "close", label: t("channels.voiceRow.close"), icon: "channels", onSelect: () => act(closeVoice) });
    }
    if (raid.url && (raid.state === "open" || raid.state === "fixed")) {
        const url = raid.url;
        items.push({ id: "discord", label: t("channels.voiceRow.inDiscord"), icon: "discord", onSelect: () => window.open(url, "_blank", "noopener") });
    }
    // Discord permission names from the API ("MoveMembers"), named in the page's language.
    const missing = (raid.missingRights || []).map((key) => t(`settings.categories.tempRight.${key}`));

    return (
        <div className="se-voice" data-state={raid.state}>
            <WowIcon name="channels" size={24} />
            <div className="se-voice-text">
                <strong className="se-voice-name">{raid.name || t("channels.voiceRow.noName")}</strong>
                <span className="se-voice-state">{voiceStateLine(raid, t)}</span>
                {missing.length > 0 && <span className="se-voice-warn" role="status">{t("channels.voiceRow.missingRights", { rights: missing.join(", ") })}</span>}
                {voice.data && !voice.data.botOnline && <span className="se-voice-warn" role="status">{t("channels.voiceRow.botOffline")}</span>}
            </div>
            {items.length > 0 && (
                <div className="se-more" ref={anchor}>
                    <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
                        {t("channels.voiceRow.menu")}<span className="se-more-chev" aria-hidden="true"><ChevronDownIcon /></span>
                    </Button>
                    {open && (
                        <Popover anchor={anchor} place={belowEndPlacement()} follow="reposition" onClose={() => setOpen(false)} className="se-more-pop" role="menu">
                            {items.map((it) => (
                                <button key={it.id} type="button" role="menuitem" className="se-more-item" onClick={() => { setOpen(false); it.onSelect(); }}>
                                    <WowIcon name={it.icon} size={24} />
                                    <span className="se-more-text"><span className="se-more-label">{it.label}</span></span>
                                </button>
                            ))}
                        </Popover>
                    )}
                </div>
            )}
        </div>
    );
}
