// The Addon-Inbox's building blocks: one card per raid session the WoW addon's
// uploader sent in, waiting for someone to say which raid it belongs to, and the
// quiet list of sessions that were already accepted and keep flowing in.
// The page around them is pages/HistoryInboxPage.tsx.
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
} from "../api";
import { formatEventTime } from "../lib/format";
import { LootTable } from "./LootTable";
import { useToast } from "./Jobs";
import { Modal, useConfirm } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import IconTile from "./ui/IconTile";
import WowIcon from "./ui/WowIcon";
import { InfoIcon, TrashIcon } from "./icons";
import { ItemIcon, contentIcon } from "./LootBadges";
import { shortDay } from "./ItemAwardsDialog";

const DISPLAY_TZ = "Europe/Berlin";
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit" });

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
    const title = session.contentLabel || session.instance || "Unbekannter Raid";

    const accept = async () => {
        setBusy("accept");
        try {
            const r = await acceptLootInbox({ id: session.id, event: eventId, manualLabel, categoryId });
            onDone(
                `${r.added} Item(s) zu „${r.eventLabel}" übernommen`
                + `${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`
                + " Weitere Uploads dieses Raids landen automatisch dort.",
            );
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy("");
        }
    };

    const dismiss = async () => {
        if (!(await ask({ title: "Session verwerfen?", text: `${title}, ${sessionSpan(session)}, ${session.itemCount} Item(s). Sie wird nicht erneut angeboten, auch wenn das Addon sie nochmal hochlädt.`, action: "Verwerfen" }))) return;
        setBusy("dismiss");
        try {
            await dismissLootInbox(session.id);
            onDone("Session verworfen.");
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy("");
        }
    };

    const status = !match
        ? <Badge tone="mid" tip="Events nicht geladen" tipSub="Beim Upload war Raid-Helper nicht erreichbar. Der Loot ist gesichert — das Event wird hier von Hand gewählt.">Events nicht geladen</Badge>
        : match.ambiguous
            ? <Badge tone="bad" tip="Mehrere Raids" tipSub="An diesem Tag gab es mehrere Events — bitte das passende selbst wählen.">{candidates.length} Raids an diesem Tag</Badge>
            : match.suggested
                ? <Badge tone="ok">Vorschlag eindeutig</Badge>
                : <Badge tone="mid">Kein Event an diesem Tag</Badge>;

    const uploadInfo = [
        `Von ${session.reporter || "unbekannt"}${session.realm ? ` (${session.realm})` : ""}`,
        session.tokenName ? `Token „${session.tokenName}"` : "",
        session.addonVersion ? `Addon ${session.addonVersion}` : "",
        session.updatedAt ? `zuletzt ${shortDay(session.updatedAt)} ${hhmm(session.updatedAt)}` : "",
    ].filter(Boolean).join(" · ");

    const shown = session.items.slice(0, ICONS_SHOWN);
    const disabledReason = !eventId ? "Erst ein Event wählen" : "";

    return (
        <div className="dash-card hl-card hl-session">
            <div className="hl-session-head">
                <WowIcon name={contentIcon(contentId)} size={36} className="raid-ico" />
                <div className="hl-session-title">
                    <b>{title}</b>
                    <div>
                        {session.startedAt > 0 && <Badge>{sessionSpan(session)}</Badge>}
                        <Badge count>{session.itemCount} Items</Badge>
                        {/* Visible that the raid name was derived, not reported by
                            the addon — otherwise it reads like a fact nobody
                            questions any more. */}
                        {session.contentSource === "items" && (
                            <Badge tone="accent" tip="Aus den Items erkannt" tipSub={`Aus ${session.contentMatched} von ${session.itemCount} Item-IDs — das Addon hat keinen Raid gemeldet.`}>aus Items erkannt</Badge>
                        )}
                    </div>
                </div>
                {status}
                <IconButton icon={<InfoIcon />} size="sm" tip="Upload" tipSub={uploadInfo} />
            </div>

            <div className="hl-session-body">
                <div>
                    <span className="hl-lbl">{match?.ambiguous ? "Event wählen" : "Event"}</span>
                    {candidates.length > 0 && (
                        <div className={candidates.length > 1 ? "hl-radio-grid" : "hl-radio-list"} role="radiogroup" aria-label="Event">
                            {candidates.map((c) => (
                                <EventRadio key={c.eventId} ev={c} checked={eventId === c.eventId} onPick={() => setEventId(c.eventId)} />
                            ))}
                        </div>
                    )}
                    <div style={{ marginTop: candidates.length ? 8 : 0 }}>
                        {candidates.length > 0 && (
                            <Expand open={otherOpen} onToggle={() => setOtherOpen((v) => !v)} label="Anderes Event oder ohne Event" />
                        )}
                        {otherOpen && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: candidates.length ? 8 : 0 }}>
                                <select aria-label="Anderes Event" value={isCandidate ? "" : eventId} onChange={(e) => setEventId(e.target.value)}>
                                    <option value="">— Event wählen —</option>
                                    {events
                                        .filter((ev) => !candidates.some((c) => c.eventId === ev.id))
                                        .map((ev) => (
                                            <option key={ev.id} value={ev.id}>
                                                {ev.title || "(ohne Titel)"}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                                            </option>
                                        ))}
                                    <option value="__auto__">Erneut automatisch nach Datum zuordnen</option>
                                    <option value="__manual__">Ohne Raid-Helper-Event, eigener Titel</option>
                                </select>
                                {showManual && (
                                    <div className="hl-manual">
                                        <input
                                            type="text" value={manualLabel} aria-label="Titel"
                                            // The recognised raid as placeholder: it is
                                            // almost always the title one would type.
                                            placeholder={session.contentLabel ? `${session.contentLabel} — ${shortDay(session.startedAt)}` : "Titel, z.B. SSC/TK — 12.07."}
                                            onChange={(e) => setManualLabel(e.target.value)}
                                        />
                                        <select
                                            aria-label="Kategorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                                            data-tip="Kategorie" data-tip-sub="Nur wirksam ohne zugeordnetes Event — sonst gilt die Kategorie des Events."
                                        >
                                            <option value="">Keine Kategorie</option>
                                            {categories.filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <span className="hl-lbl">Loot</span>
                    <div className="hl-icons">
                        {shown.map((it, i) => (
                            <span key={`${it.itemId}-${i}`} data-tip={it.itemName || `Item ${it.itemId}`} data-tip-sub={it.character}>
                                <ItemIcon url={it.itemIconUrl} quality={it.itemQuality} size="md" />
                            </span>
                        ))}
                        {session.itemCount > shown.length && <Badge count>+{session.itemCount - shown.length}</Badge>}
                    </div>
                </div>
            </div>

            <div className="hl-session-foot">
                <Button icon="inv_misc_bag_10" onClick={accept} disabled={!!busy || !eventId} running={busy === "accept"}>Übernehmen</Button>
                <Button variant="ghost" onClick={() => setLootOpen(true)}>Loot ansehen</Button>
                {disabledReason && <span className="muted">{disabledReason}</span>}
                <IconButton
                    className="danger-end" icon={<TrashIcon />} tone="danger"
                    tip="Session verwerfen" tipSub="Wird nicht erneut angeboten — mit Rückfrage."
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
                title={`${title} · ${session.itemCount} Items`}
                footer={<Button onClick={() => setLootOpen(false)}>Schließen</Button>}
            >
                <LootTable items={session.items} />
            </Modal>
        </div>
    );
}

/** Accepted sessions that keep appending by themselves — folded by default. */
export function LinkedSessions({ linked }: { linked: InboxLinkedSession[] }) {
    const [open, setOpen] = useState(false);
    if (!linked.length) return null;
    return (
        <div className="hl-linked">
            <div className="hl-linked-head">
                <span className="kicker">Verknüpft · laufen automatisch weiter</span>
                <Badge count>{linked.length}</Badge>
                <Expand open={open} onToggle={() => setOpen((v) => !v)} />
            </div>
            {open && linked.map((l) => (
                <div className="hl-linked-row" key={l.sessionId}>
                    <b>{l.contentLabel || "Raid"}</b>
                    {l.startedAt > 0 && <span className="muted mono">{shortDay(l.startedAt)}</span>}
                    <span className="muted">→ {l.eventId
                        ? <Link className="mlink" to={`/history/event?event=${encodeURIComponent(l.eventId)}`}>{l.eventLabel || l.eventId}</Link>
                        : (l.eventLabel || "—")}</span>
                    {l.appended > 0
                        ? <Badge tone="ok" count tip="Nachgeliefert" tipSub="Items, die spätere Uploads ohne Klick an das Event angehängt haben.">+{l.appended} nachgeliefert</Badge>
                        : <Badge count>{l.itemCount} Items</Badge>}
                </div>
            ))}
        </div>
    );
}
