// "Addon-Inbox": raid sessions the WoW addon's companion uploader sent in,
// waiting for someone to say which raid they belong to.
//
// The upload already did the guessing — it matched the session's own start time
// against the Raid-Helper events of that day — so the common case is one glance
// and one click on "Übernehmen". The event dropdown only has to be touched when
// the match is ambiguous (two raids the same day) or wrong.
//
// Accepting is remembered on the server: the rest of the raid night arrives in
// the same event by itself, without anyone coming back here. Dismissing is
// remembered too, so a session thrown away does not reappear on the next upload.
import { useState } from "react";
import {
    acceptLootInbox, dismissLootInbox,
    type ApiError, type Category, type HistoryEvent, type InboxSession,
} from "../api";
import { fmtMs, formatEventTime } from "../lib/format";
import { LootTable } from "./LootTable";

/** "20:00 – 23:10" for a session's span; just the start when it has no end. */
function timeSpan(s: InboxSession): string {
    const start = fmtMs(s.startedAt);
    if (!s.endedAt || s.endedAt <= s.startedAt) return start;
    const end = new Date(s.endedAt);
    const hh = String(end.getHours()).padStart(2, "0");
    const mm = String(end.getMinutes()).padStart(2, "0");
    return `${start} – ${hh}:${mm}`;
}

function SessionCard({ session, events, categories, csrfToken, onDone }: {
    session: InboxSession;
    events: HistoryEvent[];
    categories: Category[];
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const match = session.match;
    // Preselect the suggestion; an ambiguous day deliberately preselects nothing
    // so nobody confirms a coin flip by reflex.
    const [eventId, setEventId] = useState(match?.suggested?.eventId || "");
    const [manualLabel, setManualLabel] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [busy, setBusy] = useState<"" | "accept" | "dismiss">("");
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    const showManual = eventId === "__manual__" || eventId === "__auto__";

    const accept = async () => {
        setBusy("accept");
        setError(null);
        try {
            const r = await acceptLootInbox(csrfToken, { id: session.id, event: eventId, manualLabel, categoryId });
            onDone(
                `${r.added} Item(s) zu „${r.eventLabel}" übernommen`
                + `${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`
                + " Weitere Uploads dieses Raids landen automatisch dort.",
            );
        } catch (err) {
            setError((err as ApiError).message);
            setBusy("");
        }
    };

    const dismiss = async () => {
        if (!window.confirm(
            `Session vom ${fmtMs(session.startedAt)} mit ${session.itemCount} Item(s) verwerfen?`
            + "\n\nSie wird nicht erneut angeboten, auch wenn das Addon sie nochmal hochlädt.",
        )) return;
        setBusy("dismiss");
        setError(null);
        try {
            await dismissLootInbox(csrfToken, session.id);
            onDone("Session verworfen.");
        } catch (err) {
            setError((err as ApiError).message);
            setBusy("");
        }
    };

    return (
        <div className="dash-card" style={{ marginBottom: 14 }}>
            <div className="dash-card-head">
                <h3>
                    {session.instance || "Unbekannter Raid"}
                    <span className="sub" style={{ marginLeft: 10, fontWeight: 400 }}>
                        {timeSpan(session)} · {session.itemCount} Item(s)
                    </span>
                </h3>
                <button className="btn ghost" type="button" onClick={() => setOpen((v) => !v)}>
                    {open ? "Loot ausblenden" : "Loot ansehen"}
                </button>
            </div>

            <div style={{ padding: "12px 16px" }}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}

                <p className="sub" style={{ marginTop: 0 }}>
                    Hochgeladen von {session.reporter || "unbekannt"}
                    {session.realm ? ` (${session.realm})` : ""}
                    {session.tokenName ? ` über „${session.tokenName}"` : ""}
                    {" · "}zuletzt {fmtMs(session.updatedAt)}
                    {session.addonVersion ? ` · Addon ${session.addonVersion}` : ""}
                </p>

                {match?.ambiguous && (
                    <p className="sub" style={{ color: "var(--high)" }}>
                        An diesem Tag gab es mehrere Raids — bitte das passende Event selbst wählen.
                    </p>
                )}
                {!match && (
                    <p className="sub">
                        Beim Upload konnten keine Events geladen werden (Raid-Helper nicht erreichbar).
                        Der Loot ist gesichert — das Event muss hier von Hand gewählt werden.
                    </p>
                )}

                <div className="field">
                    <label>Event</label>
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                        <option value="">— bitte wählen —</option>
                        {match?.suggested && (
                            <option value={match.suggested.eventId}>
                                ★ {match.suggested.eventLabel}
                                {match.suggested.startTime ? ` · ${formatEventTime(match.suggested.startTime)}` : ""}
                                {" (vorgeschlagen)"}
                            </option>
                        )}
                        {events
                            .filter((ev) => ev.id !== match?.suggested?.eventId)
                            .map((ev) => (
                                <option key={ev.id} value={ev.id}>
                                    {ev.title || "(ohne Titel)"}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                                </option>
                            ))}
                        <option value="__auto__">— erneut automatisch anhand des Loot-Datums zuordnen —</option>
                        <option value="__manual__">— ohne Raid-Helper-Event, eigener Titel —</option>
                    </select>
                </div>

                {showManual && (
                    <>
                        <div className="field">
                            <label>Titel (optional)</label>
                            <input
                                type="text" value={manualLabel} placeholder="z.B. SSC/TK — 12.07.2026"
                                onChange={(e) => setManualLabel(e.target.value)}
                            />
                        </div>
                        <div className="field">
                            <label>Kategorie (optional)</label>
                            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                                <option value="">— keine —</option>
                                {categories.filter((c) => c.id).map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            <div className="hint">
                                Nur wirksam ohne zugeordnetes Event — sonst gilt die Kategorie des Events.
                            </div>
                        </div>
                    </>
                )}

                <div className="row-actions">
                    <button className="btn" type="button" onClick={accept} disabled={!!busy || !eventId}>
                        {busy === "accept" ? "Übernimmt…" : "Übernehmen"}
                    </button>
                    <button className="btn ghost" type="button" onClick={dismiss} disabled={!!busy}>
                        {busy === "dismiss" ? "Verwirft…" : "Verwerfen"}
                    </button>
                </div>
            </div>

            {open && (
                <div style={{ borderTop: "1px solid var(--line)" }}>
                    <LootTable items={session.items} />
                </div>
            )}
        </div>
    );
}

export function LootInboxTab({ sessions, events, categories, csrfToken, onChanged, error }: {
    sessions: InboxSession[];
    events: HistoryEvent[];
    categories: Category[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
    error: string | null;
}) {
    if (error) return <div className="empty">Inbox konnte nicht geladen werden: {error}</div>;
    if (!sessions.length) {
        return (
            <div className="empty">
                Keine offenen Addon-Uploads.<br />
                Das WoW-Addon lädt Raid-Sessions über das Sync-Tool hoch; sie erscheinen hier zur Bestätigung.
                Ein API-Token dafür wird in den <a className="mlink" href="/admin/settings">Einstellungen → Loot-Sync</a> erzeugt.
            </div>
        );
    }
    return (
        <>
            <p className="sub">
                {sessions.length} Raid-Session(s) vom Addon. Nach dem Übernehmen fließt weiterer Loot desselben
                Raids automatisch in dasselbe Event — hier muss nur einmal bestätigt werden.
            </p>
            {sessions.map((s) => (
                <SessionCard
                    key={s.id} session={s} events={events} categories={categories}
                    csrfToken={csrfToken} onDone={onChanged}
                />
            ))}
        </>
    );
}
