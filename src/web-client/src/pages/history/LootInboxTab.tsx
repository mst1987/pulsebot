// The Addon-Inbox's building blocks: one card per raid session the WoW addon's
// uploader sent in, waiting for someone to say which raid it belongs to, and the
// quiet list of sessions that were already accepted and keep flowing in.
// The page around them is pages/history/HistoryInboxPage.tsx.
//
// The upload already did the guessing — it matched the session's own start time
// against the Raid-Helper events of that day — so the common case is one glance
// and one click on "Übernehmen". The event only has to be touched when the match
// is ambiguous (two raids the same day: every candidate is shown, nothing is
// preselected so nobody confirms a coin flip by reflex) or wrong.
//
// Accepting is remembered on the server: the rest of the raid night arrives in
// the same event by itself, without anyone coming back here. Dismissing is
// remembered too, so a session thrown away does not reappear on the next upload.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
    acceptLootInbox, dismissLootInbox,
    type ApiError, type Category, type HistoryEvent, type InboxLinkedSession, type InboxMatchEvent, type InboxSession, type LootItem,
} from "../../api";
import { formatEventTime, formatTime as hhmm } from "../../lib/format";
import { LootTable } from "../../components/loot/LootTable";
import { useToast } from "../../components/Jobs";
import { Modal, useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import IconTile from "../../components/ui/IconTile";
import WowIcon from "../../components/ui/WowIcon";
import { InfoIcon, TrashIcon } from "../../components/icons";
import { ItemIcon, contentIcon } from "../../components/loot/LootBadges";
import { shortDay } from "./ItemAwardsDialog";
import { tParts, useT } from "../../i18n";


/** "Do 11.09. · 20:02–23:18"; just the start when the session has no end. */
function sessionSpan(s: { startedAt: number; endedAt: number }): string {
    if (!s.startedAt) return "";
    const start = `${shortDay(s.startedAt)} · ${hhmm(s.startedAt)}`;
    return s.endedAt > s.startedAt ? `${start}–${hhmm(s.endedAt)}` : start;
}

/** The raid most of the session's items come from — its icon heads the card. */
function dominantContent(items: LootItem[]): string {
    const counts = new Map<string, number>();
    for (const it of items) if (it.contentId) counts.set(it.contentId, (counts.get(it.contentId) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// How many item icons the card shows before "+n".
const ICONS_SHOWN = 6;

/** A Raid-Helper event as a radio card. */
function EventRadio({ ev, checked, onPick, aside }: {
    ev: InboxMatchEvent;
    checked: boolean;
    onPick: () => void;
    aside?: React.ReactNode;
}) {
    return (
        <button type="button" role="radio" aria-checked={checked} className={`hl-radio${checked ? " on" : ""}`} onClick={onPick}>
            <span className="dot" aria-hidden="true" />
            <IconTile icon="inv_misc_note_02" tone={checked ? undefined : "none"} />
            <span className="txt">
                <b>{ev.eventLabel}</b>
                <small>{[ev.startTime ? formatEventTime(ev.startTime) : "", ev.categoryName].filter(Boolean).join(" · ")}</small>
            </span>
            {aside}
        </button>
    );
}

export function InboxSessionCard({ session, events, categories, onDone }: {
    session: InboxSession;
    events: HistoryEvent[];
    categories: Category[];
    onDone: (msg: string) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const match = session.match;
    const candidates = match?.candidates?.length
        ? match.candidates
        : (match?.suggested ? [match.suggested] : []);
    // Preselect the suggestion; an ambiguous day deliberately preselects nothing.
    const [eventId, setEventId] = useState(match?.ambiguous ? "" : (match?.suggested?.eventId || ""));
    const [manualLabel, setManualLabel] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [busy, setBusy] = useState<"" | "accept" | "dismiss">("");
    // "Anderes Event" — the full event list and the no-event path, folded away
    // while a candidate card answers the question.
    const [otherOpen, setOtherOpen] = useState(!candidates.length);
    const [lootOpen, setLootOpen] = useState(false);

    const showManual = eventId === "__manual__" || eventId === "__auto__";
    const isCandidate = candidates.some((c) => c.eventId === eventId);
    const contentId = dominantContent(session.items);
    const title = session.contentLabel || session.instance || t("history.shared.unknownRaid");

    const accept = async () => {
        setBusy("accept");
        try {
            const r = await acceptLootInbox({ id: session.id, event: eventId, manualLabel, categoryId });
            onDone(r.skipped
                ? t("history.inboxCard.acceptedSkipped", { count: r.added, event: r.eventLabel, skipped: r.skipped })
                : t("history.inboxCard.accepted", { count: r.added, event: r.eventLabel }));
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy("");
        }
    };

    const dismiss = async () => {
        if (!(await ask({ title: t("history.inboxCard.dismissTitle"), text: t("history.inboxCard.dismissText", { title, span: sessionSpan(session), count: session.itemCount }), action: t("common.discard") }))) return;
        setBusy("dismiss");
        try {
            await dismissLootInbox(session.id);
            onDone(t("history.inboxCard.dismissed"));
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy("");
        }
    };

    const status = !match
        ? <Badge tone="mid" tip={t("history.inboxCard.notLoaded")} tipSub={t("history.inboxCard.notLoadedSub")}>{t("history.inboxCard.notLoaded")}</Badge>
        : match.ambiguous
            ? <Badge tone="bad" tip={t("history.inboxCard.multiTip")} tipSub={t("history.inboxCard.multiSub")}>{t("history.inboxCard.multi", { count: candidates.length })}</Badge>
            : match.suggested
                ? <Badge tone="ok">{t("history.inboxCard.unique")}</Badge>
                : <Badge tone="mid">{t("history.shared.noEvent")}</Badge>;

    const reporter = session.reporter || t("history.inboxCard.unknownReporter");
    const uploadInfo = [
        session.realm ? t("history.inboxCard.fromRealm", { name: reporter, realm: session.realm }) : t("history.inboxCard.from", { name: reporter }),
        session.tokenName ? t("history.inboxCard.token", { name: session.tokenName }) : "",
        session.addonVersion ? t("history.inboxCard.addon", { version: session.addonVersion }) : "",
        session.updatedAt ? t("history.shared.last", { date: `${shortDay(session.updatedAt)} ${hhmm(session.updatedAt)}` }) : "",
    ].filter(Boolean).join(" · ");

    const shown = session.items.slice(0, ICONS_SHOWN);
    const disabledReason = !eventId ? t("history.inboxCard.chooseFirst") : "";

    return (
        <div className="dash-card hl-card hl-session">
            <div className="hl-session-head">
                <WowIcon name={contentIcon(contentId)} size={36} className="raid-ico" />
                <div className="hl-session-title">
                    <b>{title}</b>
                    <div>
                        {session.startedAt > 0 && <Badge>{sessionSpan(session)}</Badge>}
                        <Badge count>{tParts("history.shared.items", { count: session.itemCount })}</Badge>
                        {/* Visible that the raid name was derived, not reported by
                            the addon — otherwise it reads like a fact nobody
                            questions any more. */}
                        {session.contentSource === "items" && (
                            <Badge tone="accent" tip={t("history.inboxCard.detectedTip")} tipSub={t("history.inboxCard.detectedSub", { matched: session.contentMatched, count: session.itemCount })}>{t("history.inboxCard.detected")}</Badge>
                        )}
                    </div>
                </div>
                {status}
                <IconButton icon={<InfoIcon />} size="sm" tip={t("history.inboxCard.upload")} tipSub={uploadInfo} />
            </div>

            <div className="hl-session-body">
                <div>
                    <span className="hl-lbl">{match?.ambiguous ? t("history.inboxCard.chooseEvent") : t("history.inboxCard.event")}</span>
                    {candidates.length > 0 && (
                        <div className={candidates.length > 1 ? "hl-radio-grid" : "hl-radio-list"} role="radiogroup" aria-label={t("history.inboxCard.event")}>
                            {candidates.map((c) => (
                                <EventRadio key={c.eventId} ev={c} checked={eventId === c.eventId} onPick={() => setEventId(c.eventId)} />
                            ))}
                        </div>
                    )}
                    <div className={candidates.length ? "hl-inbox-gap" : undefined}>
                        {candidates.length > 0 && (
                            <Expand open={otherOpen} onToggle={() => setOtherOpen((v) => !v)} label={t("history.inboxCard.other")} />
                        )}
                        {otherOpen && (
                            <div className={`hl-inbox-other${candidates.length ? " hl-inbox-gap" : ""}`}>
                                <select aria-label={t("history.inboxCard.otherAria")} value={isCandidate ? "" : eventId} onChange={(e) => setEventId(e.target.value)}>
                                    <option value="">{t("history.inboxCard.chooseOption")}</option>
                                    {events
                                        .filter((ev) => !candidates.some((c) => c.eventId === ev.id))
                                        .map((ev) => (
                                            <option key={ev.id} value={ev.id}>
                                                {ev.title || t("history.shared.untitled")}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                                            </option>
                                        ))}
                                    <option value="__auto__">{t("history.inboxCard.auto")}</option>
                                    <option value="__manual__">{t("history.inboxCard.manual")}</option>
                                </select>
                                {showManual && (
                                    <div className="hl-manual">
                                        <input
                                            type="text" value={manualLabel} aria-label={t("history.shared.titleAria")}
                                            // The recognised raid as placeholder: it is
                                            // almost always the title one would type.
                                            placeholder={session.contentLabel ? `${session.contentLabel} — ${shortDay(session.startedAt)}` : t("history.inboxCard.titlePlaceholder")}
                                            onChange={(e) => setManualLabel(e.target.value)}
                                        />
                                        <select
                                            aria-label={t("history.shared.category")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                                            data-tip={t("history.shared.category")} data-tip-sub={t("history.inboxCard.categorySub")}
                                        >
                                            <option value="">{t("history.shared.noCategory")}</option>
                                            {categories.filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <span className="hl-lbl">{t("history.inboxCard.loot")}</span>
                    <div className="hl-icons">
                        {shown.map((it, i) => (
                            <span key={`${it.itemId}-${i}`} data-tip={it.itemName || t("history.shared.itemFallback", { id: it.itemId })} data-tip-sub={it.character}>
                                <ItemIcon url={it.itemIconUrl} quality={it.itemQuality} size="md" />
                            </span>
                        ))}
                        {session.itemCount > shown.length && <Badge count>+{session.itemCount - shown.length}</Badge>}
                    </div>
                </div>
            </div>

            <div className="hl-session-foot">
                <Button icon="inv_misc_bag_10" onClick={accept} disabled={!!busy || !eventId} running={busy === "accept"}>{t("common.apply")}</Button>
                <Button variant="ghost" onClick={() => setLootOpen(true)}>{t("history.shared.viewLoot")}</Button>
                {disabledReason && <span className="muted">{disabledReason}</span>}
                <IconButton
                    className="danger-end" icon={<TrashIcon />} tone="danger"
                    tip={t("history.inboxCard.dismissTip")} tipSub={t("history.inboxCard.dismissSub")}
                    disabled={!!busy} onClick={dismiss}
                />
            </div>

            <Modal
                open={lootOpen}
                onClose={() => setLootOpen(false)}
                width={980}
                icon={contentIcon(contentId)}
                tone="history"
                kicker={sessionSpan(session)}
                title={t("history.inboxCard.modalTitle", { title, count: session.itemCount })}
                footer={<Button onClick={() => setLootOpen(false)}>{t("common.close")}</Button>}
            >
                <LootTable items={session.items} />
            </Modal>
        </div>
    );
}

/** Accepted sessions that keep appending by themselves — folded by default. */
export function LinkedSessions({ linked }: { linked: InboxLinkedSession[] }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    if (!linked.length) return null;
    return (
        <div className="hl-linked">
            <div className="hl-linked-head">
                <span className="kicker">{t("history.inboxCard.linked")}</span>
                <Badge count>{linked.length}</Badge>
                <Expand open={open} onToggle={() => setOpen((v) => !v)} />
            </div>
            {open && linked.map((l) => (
                <div className="hl-linked-row" key={l.sessionId}>
                    <b>{l.contentLabel || t("history.inboxCard.raidFallback")}</b>
                    {l.startedAt > 0 && <span className="muted mono">{shortDay(l.startedAt)}</span>}
                    <span className="muted">→ {l.eventId
                        ? <Link className="mlink" to={`/history/event?event=${encodeURIComponent(l.eventId)}`}>{l.eventLabel || l.eventId}</Link>
                        : (l.eventLabel || "—")}</span>
                    {l.appended > 0
                        ? <Badge tone="ok" count tip={t("history.inboxCard.appendedTip")} tipSub={t("history.inboxCard.appendedSub")}>{t("history.inboxCard.appended", { count: l.appended })}</Badge>
                        : <Badge count>{tParts("history.shared.items", { count: l.itemCount })}</Badge>}
                </div>
            ))}
        </div>
    );
}
