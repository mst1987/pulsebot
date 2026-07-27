import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaidDetail, importLoot, clearHistoryEvent,
    notifyRaid, pingMissingRaiders, fillRaidsheet, postRaidSheet, postRaidSoftres,
    searchSoftresItems, createSoftres, linkSoftres, evalLog, linkLog, unlinkLog,
    type ApiError, type RaidDetailData, type SetupPlayer, type AttendancePerson,
    type SoftresSearchItem, type SoftresCatalogueGroup, type EventSoftres, type RaidLogRow,
} from "../api";
import { formatEventTime, fmtMs } from "../lib/format";
import { eventPostUrl, channelUrl, raidplanUrl } from "../lib/discordLinks";
import { LootTable } from "../components/LootTable";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };
type Tab = "setup" | "attendance" | "actions" | "loot" | "softres" | "logs";

// Ported from renderAdmin.js's renderEventDetail() overview stat spans (statSpans).
function OverviewStats({ data }: { data: RaidDetailData }) {
    const { event: ev, setup, attendance, attendanceRoleIds, eventSoftres, signupTarget } = data;
    return (
        <div className="setup-summary" style={{ marginTop: 10 }}>
            <span className="setup-count setup-total"><b>{ev.signupCount || 0}{signupTarget ? ` / ${signupTarget}` : ""}</b> Anmeldungen</span>
            {!!setup?.total && <span className="setup-count"><b>{setup.total}</b> im Setup</span>}
            {!!attendanceRoleIds.length && <span className="setup-count"><b>{attendance.missing.length}</b> fehlt</span>}
            {!!eventSoftres?.instances?.length && <span className="setup-count"><b>{eventSoftres.instances.length}</b> Softres-Instanz(en)</span>}
        </div>
    );
}

// One roster chip — icon (or a blank placeholder) plus the name — shared shape
// between the setup groups and the attendance name lists (renderAdmin.js reuses
// the same "setup-player" markup for both).
function PlayerChip({ iconUrl, className, imgTitle, name }: {
    iconUrl?: string;
    className?: string;
    imgTitle?: string;
    name: string;
}) {
    return (
        <>
            {iconUrl
                ? <img className="setup-ico" src={iconUrl} alt={className || ""} title={imgTitle} loading="lazy" />
                : <span className="setup-ico setup-ico-blank" />}
            <span className="sp-name">{name}</span>
        </>
    );
}

// --- Setup (Raidplan comp) tab: read-only display of the raid groups. ---
function SetupTab({ data }: { data: RaidDetailData }) {
    const { setup, setupError } = data;
    return (
        <>
            <p className="note">Aktueller Raidplan dieses Events, in Raid-Gruppen 1–5 wie im Raid-Helper. Icons und Farben richten sich nach der WoW-Spec.</p>
            {setupError ? (
                <div className="flash flash-err">Setup konnte nicht geladen werden: {setupError}</div>
            ) : !setup?.total ? (
                <p className="sub">Für dieses Event ist noch kein Setup (Raidplan) angelegt.</p>
            ) : (
                <>
                    <div className="setup-summary">
                        <span className="setup-count setup-total"><b>{setup.total}</b> Raider</span>
                        <span className="setup-count"><b>{setup.groups.length}</b> Gruppen</span>
                    </div>
                    <div className="setup-groups">
                        {setup.groups.map((g, gi) => (
                            <div className="setup-group" key={gi}>
                                <h4 className="setup-group-head">{g.label}<span className="setup-group-n">{g.players.length}</span></h4>
                                <div className="setup-group-list">
                                    {g.players.map((p: SetupPlayer, pi) => (
                                        <span key={pi} className="setup-player" style={{ borderLeftColor: p.classColor || "var(--line)" }} title={p.specName}>
                                            <PlayerChip iconUrl={p.iconUrl} className={p.className} imgTitle={p.specName} name={p.name} />
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

// A missing/responded name list — a person without a resolved class/spec profile
// renders as a plain rolebox with just the display name.
function NameList({ people }: { people: AttendancePerson[] }) {
    if (!people.length) return <p className="sub">—</p>;
    return (
        <div className="rolegrid">
            {people.map((p) => {
                const prof = p.profile;
                const label = (p.displayName || p.id) + (p.character ? ` (${p.character})` : "");
                if (!prof) return <span key={p.id} className="rolebox">{label}</span>;
                return (
                    <span key={p.id} className="rolebox setup-player" style={{ borderLeftColor: prof.classColor || "var(--line)" }} title={prof.specName || ""}>
                        <PlayerChip iconUrl={prof.iconUrl} className={prof.className} name={label} />
                    </span>
                );
            })}
        </div>
    );
}

// Pings the raiders who have not reacted yet — mirrors renderAdmin.js's
// pingForm (/admin/raids/ping-missing). A "0 missing" outcome from the backend
// is still a normal success, shown the same as any other flash.
function PingMissingForm({ eventId, missingCount, csrfToken, onDone }: {
    eventId: string;
    missingCount: number;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await pingMissingRaiders(csrfToken, { event: eventId, text });
            onDone(r.message);
            setText("");
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" style={{ marginTop: 16 }} onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Nachricht (optional)</label>
                <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Bitte meldet euch für den Raid an oder ab." />
                <div className="hint">Wird im Event-Channel gepostet und pingt genau die {missingCount} fehlenden Raider.</div>
            </div>
            <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Fehlende Raider pingen</button></div>
        </form>
    );
}

// --- Anwesenheit tab: role-holder vs. signup reconciliation, plus the
// "Fehlende Raider pingen" form. ---
function AttendanceTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const { attendance, attendanceRoleIds, membersError } = data;
    return (
        <>
            <p className="note">Abgleich der Raider-Rollen dieser Kategorie mit den Raid-Helper-Anmeldungen: wer sich an- oder abgemeldet hat und wer noch gar nicht reagiert hat.</p>
            {!attendanceRoleIds.length ? (
                <p className="sub">
                    Dieser Kategorie sind noch keine Raider-Rollen zugeordnet. Lege sie in den{" "}
                    <Link className="mlink" to="/settings">Einstellungen → Events</Link> fest, um zu sehen, wer noch fehlt.
                </p>
            ) : membersError ? (
                <>
                    <div className="flash flash-err">Mitglieder konnten nicht geladen werden: {membersError}</div>
                    <p className="sub">Für den Rollen-Abgleich muss im Discord Developer Portal der <strong>„Server Members Intent“</strong> aktiviert sein.</p>
                </>
            ) : (
                <>
                    <div className="setup-summary">
                        <span className="setup-count setup-total"><b>{attendance.responded.length + attendance.missing.length}</b> erwartet</span>
                        <span className="setup-count"><b>{attendance.responded.length}</b> reagiert</span>
                        <span className="setup-count"><b>{attendance.missing.length}</b> fehlt</span>
                    </div>
                    <h4 style={{ margin: "14px 0 6px" }}>Fehlt (noch keine Reaktion)</h4>
                    <NameList people={attendance.missing} />
                    <h4 style={{ margin: "14px 0 6px" }}>Reagiert (an- oder abgemeldet)</h4>
                    <NameList people={attendance.responded} />
                    {attendance.missing.length
                        ? <PingMissingForm eventId={eventId} missingCount={attendance.missing.length} csrfToken={csrfToken} onDone={onChanged} />
                        : <p className="sub" style={{ marginTop: 12 }}>Es haben schon alle erwarteten Raider reagiert. 🎉</p>}
                </>
            )}
        </>
    );
}

// Header quick-actions, top-right of the meta card: open/post the filled sheet,
// open/post the softres list, or (when none exists yet) jump straight to the
// Softres tab. Mirrors renderAdmin.js's headerBtns — errors from a quick-post
// are shown the same way as a success (both just refresh the page via onDone),
// matching how ClaPage's plain action buttons (scan/automatch) treat errors.
function HeaderActions({ data, eventId, csrfToken, onSwitchTab, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onSwitchTab: (t: Tab) => void;
    onDone: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const { eventSheet, eventSoftres, event: ev } = data;
    const channelLabel = ev.channelName || ev.channelId;

    const run = async (fn: () => Promise<{ message: string }>) => {
        setBusy(true);
        try {
            const r = await fn();
            onDone(r.message);
        } catch (err) {
            onDone((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            {!!eventSheet?.url && (
                <>
                    <a className="btn btn-ghost" href={eventSheet.url} target="_blank" rel="noopener noreferrer">📄 Sheet öffnen</a>
                    <button
                        className="btn btn-ghost" type="button" disabled={busy} title={`Sheet-Link in #${channelLabel} posten`}
                        onClick={() => run(() => postRaidSheet(csrfToken, { event: eventId }))}
                    >
                        📤 Sheet posten
                    </button>
                </>
            )}
            {eventSoftres?.url ? (
                <>
                    <a className="btn btn-ghost" href={eventSoftres.url} target="_blank" rel="noopener noreferrer">🔗 Softres öffnen</a>
                    <button
                        className="btn btn-ghost" type="button" disabled={busy} title={`Softres-Link in #${channelLabel} posten`}
                        onClick={() => run(() => postRaidSoftres(csrfToken, { event: eventId }))}
                    >
                        📤 Softres posten
                    </button>
                </>
            ) : (
                <button className="btn btn-ghost" type="button" onClick={() => onSwitchTab("softres")}>➕ Softres erstellen</button>
            )}
        </div>
    );
}

// --- Anmeldung & Sheet tab: Anmelde-Aufruf (notify), Raidsheet füllen, Raidsheet posten. ---

function NotifyForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const { notifyTemplates, roles } = data;
    const [templateId, setTemplateId] = useState(notifyTemplates[0]?.id ?? "");
    const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!notifyTemplates.length) {
        return (
            <p className="sub">
                Noch keine Aufruf-Vorlagen. Lege zuerst unter <Link className="mlink" to="/raids/templates">Aufruf-Vorlagen</Link> eine an.
            </p>
        );
    }

    const toggleRole = (id: string) => {
        setRoleIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await notifyRaid(csrfToken, {
                event: eventId, templateId, channelId: data.event.channelId, roleIds: [...roleIds],
            });
            onDone(r.message);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Aufruf-Vorlage</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                    {notifyTemplates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                </select>
            </div>
            <div className="field">
                <label>Rollen pingen</label>
                {roles.length
                    ? (
                        <div className="rolegrid">
                            {roles.map((r) => (
                                <label key={r.id} className="rolebox">
                                    <input type="checkbox" checked={roleIds.has(r.id)} onChange={() => toggleRole(r.id)} /> @{r.name}
                                </label>
                            ))}
                        </div>
                    )
                    : <p className="sub">Keine Rollen gefunden (Server gewählt?).</p>}
                <div className="hint">Die ausgewählten Rollen werden im Event-Channel angepingt.</div>
            </div>
            <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Anmelde-Aufruf posten</button></div>
        </form>
    );
}

function FillForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const { raidsheets, matchedSheetId, tankCandidates, eventSheet, event: ev } = data;
    const [sheetId, setSheetId] = useState(matchedSheetId || raidsheets[0]?.id || "");
    const [tank3, setTank3] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!raidsheets.length) {
        return <p className="sub">Keine Raidsheets konfiguriert. Lege sie in den <Link className="mlink" to="/settings">Einstellungen</Link> an.</p>;
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await fillRaidsheet(csrfToken, {
                event: eventId, sheetId, tank3, eventTitle: ev.title, eventStartTime: ev.startTime,
            });
            onDone(r.message);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const matchHint = matchedSheetId
        ? "Automatisch anhand des Event-Titels vorausgewählt — bei Bedarf ändern."
        : "Kein Raidsheet passte automatisch zum Titel — bitte manuell wählen.";

    return (
        <>
            {!!eventSheet?.url && (
                <div className="sheetcard">
                    <div><strong>Gefülltes Sheet:</strong> <a className="mlink" href={eventSheet.url} target="_blank" rel="noopener noreferrer">{eventSheet.eventTitle || "Sheet öffnen"}</a></div>
                    <div className="hint">
                        {eventSheet.deleteAfter ? `Wird am ${fmtMs(eventSheet.deleteAfter, false)} automatisch gelöscht.` : "Kopie ist angelegt."} Erneutes Füllen ersetzt diese Kopie.
                    </div>
                </div>
            )}
            <form className="card-form" onSubmit={submit}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
                <div className="field">
                    <label>Vorlage (Ausgangssheet)</label>
                    <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} required>
                        {raidsheets.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                    </select>
                    <div className="hint">{matchHint}</div>
                </div>
                {tankCandidates.length
                    ? (
                        <div className="field">
                            <label>Tank 3 (Off-Tank, optional)</label>
                            <select value={tank3} onChange={(e) => setTank3(e.target.value)}>
                                <option value="">— keiner —</option>
                                {tankCandidates.map((c) => (
                                    <option key={c.name} value={c.name}>{c.name}{c.specName ? ` — ${c.specName}` : ""}</option>
                                ))}
                            </select>
                            <div className="hint">Auswahl aller tank-fähigen Raider im Setup. Wird in die 3. Tank-Zeile eingetragen.</div>
                        </div>
                    )
                    : (
                        <div className="field">
                            <label>Tank 3 (optional)</label>
                            <input type="text" value={tank3} onChange={(e) => setTank3(e.target.value)} placeholder="Name des 3. Tanks" />
                            <div className="hint">Wird manuell in die Tank-Zeile eingetragen.</div>
                        </div>
                    )}
                <div className="row-actions">
                    <button className="btn" type="submit" disabled={busy}>{busy ? "Erstelle Sheet …" : "Neues Sheet erstellen & füllen"}</button>
                </div>
            </form>
        </>
    );
}

function PostSheetForm({ eventId, hasSheet, csrfToken, onDone }: {
    eventId: string;
    hasSheet: boolean;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!hasSheet) {
        return <p className="sub">Noch kein gefülltes Sheet vorhanden — fülle oben zuerst ein Raidsheet, dann kannst du den Link hier in den Channel posten.</p>;
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await postRaidSheet(csrfToken, { event: eventId, message });
            onDone(r.message);
            setMessage("");
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Nachricht (optional)</label>
                <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Das Raidsheet für heute Abend – bitte eintragen!" />
            </div>
            <div className="row-actions"><button className="btn" type="submit" disabled={busy}>📄 Sheet in Channel posten</button></div>
        </form>
    );
}

function ActionsTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    return (
        <>
            <h2 style={{ marginTop: 0 }}>Anmelde-Aufruf</h2>
            <p className="note">Postet eine Aufruf-Nachricht in den Event-Channel und pingt die gewählten Rollen.</p>
            <NotifyForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
            <h2>Raidsheet füllen</h2>
            <p className="note">
                Legt für diesen Raid eine eigene Kopie der Vorlage an, überträgt das Raid-Helper-Setup hinein und teilt sie per Link.
                Die Kopie wird 3 Tage nach dem Raid automatisch gelöscht; die Vorlage bleibt unangetastet.
            </p>
            <FillForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
            <h2>Raidsheet in Channel posten</h2>
            <p className="note">Postet den Link zum gefüllten Raidsheet als Nachricht mit Button in den Event-Channel — optional mit eigener Nachricht.</p>
            <PostSheetForm eventId={eventId} hasSheet={!!data.eventSheet?.url} csrfToken={csrfToken} onDone={onChanged} />
        </>
    );
}

// --- Softres tab: existing-list display, manual-link form, create form with a
// live Wowhead hard-reserve item search. ---

// Live item search dropdown for hard-reserved loot — same shape as EmojiPicker/
// SpecPicker (debounced fetch, click-outside-to-close, add-to-list-on-pick).
function HardReservePicker({ edition, onAdd }: {
    edition: string;
    onAdd: (item: { id: number; name: string }) => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SoftresSearchItem[]>([]);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            setOpen(false);
            return;
        }
        const handle = setTimeout(() => {
            searchSoftresItems(edition, q)
                .then((r) => {
                    setResults(r.items || []);
                    setOpen(true);
                })
                .catch(() => {
                    setResults([]);
                    setOpen(false);
                });
        }, 250);
        return () => clearTimeout(handle);
    }, [query, edition]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    const pick = (item: SoftresSearchItem) => {
        onAdd({ id: item.id, name: item.name });
        setQuery("");
        setResults([]);
        setOpen(false);
    };

    return (
        <div className="hr-picker" ref={rootRef}>
            <input
                type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Item-Namen suchen (Wowhead) …" autoComplete="off"
                onFocus={() => { if (results.length) setOpen(true); }}
            />
            <div className={`hr-panel${open ? " open" : ""}`}>
                {results.map((it) => (
                    <div key={it.id} className="hr-row" onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
                        {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                        <span>{it.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SoftresLinkForm({ eventSoftres, eventId, csrfToken, onDone }: {
    eventSoftres: EventSoftres;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [softresUrl, setSoftresUrl] = useState(eventSoftres?.url || "");
    const [softresEditUrl, setSoftresEditUrl] = useState(eventSoftres?.editUrl || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await linkSoftres(csrfToken, { event: eventId, softresUrl, softresEditUrl });
            onDone(r.message);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <details>
            <summary style={{ cursor: "pointer" }}>
                {eventSoftres?.url ? "Anderen Softres-Link verwenden" : "Schon eine Liste auf softres.it? Link manuell hinterlegen"}
            </summary>
            <form className="card-form" style={{ marginTop: 10 }} onSubmit={submit}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
                <div className="field">
                    <label>Softres-Link (Ansehen)</label>
                    <input type="url" value={softresUrl} onChange={(e) => setSoftresUrl(e.target.value)} placeholder="https://softres.it/raid/..." required />
                </div>
                <div className="field">
                    <label>Softres-Link (Bearbeiten, optional)</label>
                    <input type="url" value={softresEditUrl} onChange={(e) => setSoftresEditUrl(e.target.value)} placeholder="https://softres.it/raid/.../token" />
                </div>
                <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Link speichern</button></div>
            </form>
        </details>
    );
}

// Instance codes grouped by edition, so the single-edition constraint can be
// checked without a DOM query (unlike the legacy inline vanilla-JS script):
// checking a box from a different edition than what's already checked drops
// every other edition's selections.
function editionMap(catalogue: SoftresCatalogueGroup[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const g of catalogue) for (const i of g.instances) m.set(i.code, g.edition);
    return m;
}

function SoftresCreateForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const { softresCatalogue, softresSuggested, softresEdition } = data;
    const [selected, setSelected] = useState<Set<string>>(() => new Set(softresSuggested));
    const [amount, setAmount] = useState(1);
    const [faction, setFaction] = useState<"Horde" | "Alliance">("Horde");
    const [hardReserves, setHardReserves] = useState<Array<{ id: number; name: string }>>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const codeEdition = useMemo(() => editionMap(softresCatalogue), [softresCatalogue]);
    const currentEdition = useMemo(() => {
        for (const code of selected) {
            const ed = codeEdition.get(code);
            if (ed) return ed;
        }
        return softresEdition || softresCatalogue[0]?.edition || "tbc";
    }, [selected, codeEdition, softresEdition, softresCatalogue]);

    const toggle = (code: string, edition: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(code)) {
                next.delete(code);
            } else {
                for (const c of next) if (codeEdition.get(c) !== edition) next.delete(c);
                next.add(code);
            }
            return next;
        });
    };

    const addHardReserve = (item: { id: number; name: string }) => {
        setHardReserves((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
    };
    const removeHardReserve = (id: number) => setHardReserves((prev) => prev.filter((x) => x.id !== id));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await createSoftres(csrfToken, {
                event: eventId, instanceCodes: [...selected], amount, faction, hardReserves, hideReserves: false,
            });
            onDone(r.message);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Instanzen (Raids)</label>
                {softresCatalogue.map((g) => (
                    <fieldset key={g.edition} className="softres-ed">
                        <legend>{g.label}</legend>
                        <div className="rolegrid">
                            {g.instances.map((i) => (
                                <label key={i.code} className="rolebox">
                                    <input type="checkbox" checked={selected.has(i.code)} onChange={() => toggle(i.code, g.edition)} /> {i.name}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                ))}
                <div className="hint">
                    Aus dem Event-Titel vorausgewählt. Alle gewählten Instanzen müssen zur selben Erweiterung gehören —
                    beim Ankreuzen wird die Auswahl automatisch auf eine Erweiterung beschränkt.
                </div>
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
                <label>Softres pro Spieler</label>
                <input
                    type="number" min={1} max={6} value={amount}
                    onChange={(e) => setAmount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                />
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
                <label>Fraktion</label>
                <select value={faction} onChange={(e) => setFaction(e.target.value as "Horde" | "Alliance")}>
                    <option value="Horde">Horde</option>
                    <option value="Alliance">Alliance</option>
                </select>
            </div>
            <div className="field">
                <label>Hardreserved Items (optional)</label>
                <HardReservePicker edition={currentEdition} onAdd={addHardReserve} />
                {hardReserves.length > 0 && (
                    <ul className="hr-list">
                        {hardReserves.map((hr) => (
                            <li key={hr.id} className="rolebox hr-chip">
                                <span>{hr.name} (#{hr.id})</span>
                                <button type="button" className="btn btn-sm" onClick={() => removeHardReserve(hr.id)}>✕</button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="hint">Diese Items werden auf softres.it als Hardreserve (gebannt für Softres) markiert.</div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{busy ? "Erstelle Softres …" : "Softres-Liste erstellen"}</button>
            </div>
        </form>
    );
}

function SoftresTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const so = data.eventSoftres;
    return (
        <>
            <h2 style={{ marginTop: 0 }}>Softres-Liste erstellen</h2>
            <p className="note">
                Legt eine Soft-Reserve-Liste auf softres.it an — die Instanzen sind aus dem Event-Titel vorausgewählt.
                Wähle die Anzahl der Softres pro Spieler und markiere optional hardreservten Loot. Du bekommst danach einen
                Ansehen- und einen Bearbeiten-Link.
            </p>
            {so?.url
                ? (
                    <div className="sheetcard">
                        <div>
                            <strong>Softres-Liste:</strong>{" "}
                            <a className="mlink" href={so.url} target="_blank" rel="noopener noreferrer">Ansehen</a>
                            {" · "}
                            <a className="mlink" href={so.editUrl} target="_blank" rel="noopener noreferrer">Bearbeiten (mit Token)</a>
                        </div>
                        <div className="hint">
                            {so.amount || 1} Softres/Spieler · {(so.instances || []).length} Instanz(en)
                            {so.hardReserveCount ? ` · ${so.hardReserveCount} Hardreserve(s)` : ""}. Neu erstellen ersetzt den Link unten nicht automatisch auf softres.it.
                        </div>
                        <SoftresLinkForm eventSoftres={so} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
                    </div>
                )
                : <SoftresLinkForm eventSoftres={so} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />}
            <SoftresCreateForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
        </>
    );
}

// Simpler than HistoryPage's ImportForm — no event selector, the event is fixed
// by the page we're already on.
function LootImportForm({ eventId, defaultTool, csrfToken, onImported }: {
    eventId: string;
    defaultTool: string;
    csrfToken: string | null;
    onImported: (msg: string) => void;
}) {
    const [tool, setTool] = useState(defaultTool || "auto");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result || ""));
        reader.readAsText(file);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await importLoot(csrfToken, { data: text, tool, event: eventId, manualLabel: "" });
            onImported(`${r.added} Item(s) importiert${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`);
            setText("");
            if (fileRef.current) fileRef.current.value = "";
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Loot importieren</h3></div>
            <form className="card-form" onSubmit={submit} style={{ padding: "14px 16px" }}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
                <div className="field">
                    <label>Loot-Tool</label>
                    <select value={tool} onChange={(e) => setTool(e.target.value)}>
                        <option value="auto">Auto-Erkennung</option>
                        <option value="gargul">Gargul</option>
                        <option value="rclc">RCLootcouncil</option>
                    </select>
                    <div className="hint">„Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
                </div>
                <div className="field">
                    <label>Export einfügen</label>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="RCLootcouncil-JSON oder Gargul-CSV hier einfügen …" />
                </div>
                <div className="field">
                    <label>… oder Datei hochladen</label>
                    <input ref={fileRef} type="file" accept=".json,.csv,.txt,.tsv" onChange={onFile} />
                    <div className="hint">Die Datei wird lokal in das Feld oben geladen — kein separater Upload.</div>
                </div>
                <div className="row-actions"><button className="btn" type="submit" disabled={busy}>{busy ? "Importiert…" : "Loot importieren"}</button></div>
            </form>
        </div>
    );
}

// --- Loot tab: reuses the already-migrated importLoot/clearHistoryEvent endpoints. ---
function LootTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);

    const clear = async () => {
        if (!confirm("Gesamten Loot dieses Events löschen?")) return;
        setBusy(true);
        try {
            const r = await clearHistoryEvent(csrfToken, eventId);
            onChanged(`${r.removed} Loot-Eintrag/-Einträge gelöscht.`);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <p className="note">
                RCLootcouncil-Export (JSON) oder Gargul-CSV dieses Raids einfügen oder hochladen — landet direkt in der{" "}
                <Link className="mlink" to="/history">Event-Historie</Link>. Bereits importierter Loot wird beim erneuten Import
                automatisch übersprungen (Duplikat-Erkennung).
            </p>
            {data.lootItems.length > 0 && (
                <div className="dash-card" style={{ marginBottom: 18 }}>
                    <div className="dash-card-head">
                        <h3>Bereits importierter Loot</h3>
                        <span className="small" style={{ marginLeft: "auto" }}>{data.lootItems.length} Item(s)</span>
                    </div>
                    <div className="row-actions" style={{ padding: "0 16px 12px", justifyContent: "flex-end" }}>
                        <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={clear}>Loot löschen</button>
                    </div>
                    <LootTable items={data.lootItems} />
                </div>
            )}
            <LootImportForm eventId={eventId} defaultTool={data.lootTool || "auto"} csrfToken={csrfToken} onImported={onChanged} />
        </>
    );
}

// --- Logs tab: Warcraft-Logs already assigned to this raid (evaluate/unlink),
// plus a picker to assign a still-unassigned detected log to this raid. Reuses
// the same /api/cla/eval, /api/cla/log-link, /api/cla/log-unlink endpoints as
// the CLA page's "Erkannte Logs" tab, just scoped to a single event here. ---
function LogRow({ l, evalBusy, unlinkBusy, onEvaluate, onUnlink }: {
    l: RaidLogRow;
    evalBusy: boolean;
    unlinkBusy: boolean;
    onEvaluate: () => void;
    onUnlink: () => void;
}) {
    const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
    const name = l.title || l.reportId || "(unbekannt)";
    return (
        <div className="row-actions" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <div>
                {wclUrl
                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{name} ↗</a>
                    : name}
                {" "}
                {l.status === "done" ? <span className="pill good">ausgewertet</span> : <span className="pill">offen</span>}
            </div>
            <div className="row-actions" style={{ gap: 6 }}>
                {l.status === "done"
                    ? ((l.reportUrl || l.reportRefId)
                        ? <a className="btn btn-ghost btn-sm" href={l.reportUrl || `/r/${l.reportRefId}`}>Öffnen</a>
                        : null)
                    : (
                        <button className="btn btn-sm" type="button" disabled={evalBusy} onClick={onEvaluate}>
                            {evalBusy ? "Läuft …" : "Auswerten"}
                        </button>
                    )}
                <button className="btn btn-ghost btn-sm" type="button" disabled={unlinkBusy} title="Zuordnung entfernen" onClick={onUnlink}>✕</button>
            </div>
        </div>
    );
}

function LogsTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [evalBusyId, setEvalBusyId] = useState<string | null>(null);
    const [unlinkBusyId, setUnlinkBusyId] = useState<string | null>(null);
    const [pickedLogId, setPickedLogId] = useState("");
    const [linkBusy, setLinkBusy] = useState(false);

    const evaluate = async (l: RaidLogRow) => {
        setEvalBusyId(l.id);
        try {
            const r = await evalLog(csrfToken, l.id);
            window.open(r.url, "_blank", "noopener");
            onChanged(r.alreadyEvaluated ? "Bereits ausgewertet." : "Auswertung erstellt.");
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setEvalBusyId(null);
        }
    };

    const unlink = async (l: RaidLogRow) => {
        if (!confirm("Zuordnung zu diesem Raid entfernen?")) return;
        setUnlinkBusyId(l.id);
        try {
            const r = await unlinkLog(csrfToken, l.id);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setUnlinkBusyId(null);
        }
    };

    const unlinked = data.unlinkedLogs;
    const assign = async (e: React.FormEvent) => {
        e.preventDefault();
        const logId = pickedLogId || unlinked[0]?.id;
        if (!logId) return;
        setLinkBusy(true);
        try {
            const r = await linkLog(csrfToken, logId, eventId);
            onChanged(r.message);
            setPickedLogId("");
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setLinkBusy(false);
        }
    };

    return (
        <>
            <h2 style={{ marginTop: 0 }}>Zugeordnete Logs</h2>
            {data.eventLogs.length
                ? data.eventLogs.map((l) => (
                    <LogRow
                        key={l.id} l={l} evalBusy={evalBusyId === l.id} unlinkBusy={unlinkBusyId === l.id}
                        onEvaluate={() => evaluate(l)} onUnlink={() => unlink(l)}
                    />
                ))
                : <p className="sub">Für dieses Event ist noch kein Log zugeordnet.</p>}
            <h2>Log zuordnen</h2>
            <p className="note">Ordnet ein bereits erkanntes, aber noch keinem Event zugeordnetes Log diesem Raid zu.</p>
            {unlinked.length
                ? (
                    <form className="row-actions" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={assign}>
                        <select className="sel-sm" value={pickedLogId || unlinked[0].id} onChange={(e) => setPickedLogId(e.target.value)}>
                            {unlinked.map((l) => <option key={l.id} value={l.id}>{l.title || l.reportId || "(unbekannt)"}</option>)}
                        </select>
                        <button className="btn btn-ghost btn-sm" type="submit" disabled={linkBusy}>Log zuordnen</button>
                    </form>
                )
                : <p className="sub">Keine noch nicht zugeordneten Logs vorhanden.</p>}
        </>
    );
}

export default function RaidDetailPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams, setSearchParams] = useSearchParams();
    const eventId = searchParams.get("event") || "";
    const tab: Tab = (searchParams.get("tab") as Tab) || "setup";

    const [data, setData] = useState<RaidDetailData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);

    const load = () => {
        getRaidDetail(eventId).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [eventId]);

    const switchTab = (t: Tab) => {
        const next = new URLSearchParams(searchParams);
        if (t === "setup") next.delete("tab"); else next.set("tab", t);
        setSearchParams(next);
    };

    // Shared success handler for every mutating action on this page (header
    // quick-posts, all Part B forms, and the loot tab): flash the message, then
    // reload so the header/stats/tabs reflect the new state — same convention as
    // ClaPage's/RecruitmentPage's afterChange.
    const afterChange = (msg: string) => {
        setFlash({ type: "ok", text: msg });
        load();
    };

    const backLink = <p className="note"><Link className="mlink" to="/raids">← Zurück zur Event-Übersicht</Link></p>;

    if (error) return <>{backLink}<div className="empty">Fehler beim Laden: {error.message}</div></>;
    if (!data) return <div className="empty">Lade…</div>;

    const ev = data.event;

    return (
        <>
            {backLink}
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}

            <div className="dash-card" style={{ marginBottom: 16 }}>
                <div className="dash-card-head" style={{ flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>{ev.title || "(ohne Titel)"}</h3>
                    <HeaderActions data={data} eventId={eventId} csrfToken={csrfToken} onSwitchTab={switchTab} onDone={afterChange} />
                </div>
                <div style={{ padding: "14px 16px" }} className="small">
                    <div>Termin: <strong>{formatEventTime(ev.startTime) || "—"}</strong></div>
                    <div>Channel: #{ev.channelName || ev.channelId} · Kategorie: {data.categoryName || "—"}</div>
                    <div style={{ marginTop: 8 }}>
                        <a className="mlink" href={eventPostUrl(data.guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer">Discord-Post</a>
                        {" · "}
                        <a className="mlink" href={channelUrl(data.guildId, ev.channelId)} target="_blank" rel="noopener noreferrer">Channel</a>
                        {" · "}
                        <a className="mlink" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer">Setup / Comp</a>
                    </div>
                    <OverviewStats data={data} />
                </div>
            </div>

            <div className="tabs" role="tablist">
                <button type="button" className={`tab-btn${tab === "setup" ? " active" : ""}`} role="tab" onClick={() => switchTab("setup")}>Setup</button>
                <button type="button" className={`tab-btn${tab === "attendance" ? " active" : ""}`} role="tab" onClick={() => switchTab("attendance")}>Anwesenheit</button>
                <button type="button" className={`tab-btn${tab === "actions" ? " active" : ""}`} role="tab" onClick={() => switchTab("actions")}>Anmeldung &amp; Sheet</button>
                <button type="button" className={`tab-btn${tab === "loot" ? " active" : ""}`} role="tab" onClick={() => switchTab("loot")}>
                    Loot
                    {!!data.lootItems.length && <span className="tab-count">{data.lootItems.length}</span>}
                </button>
                <button type="button" className={`tab-btn${tab === "softres" ? " active" : ""}`} role="tab" onClick={() => switchTab("softres")}>Softres</button>
                <button type="button" className={`tab-btn${tab === "logs" ? " active" : ""}`} role="tab" onClick={() => switchTab("logs")}>
                    Logs
                    {!!data.eventLogs.length && <span className="tab-count">{data.eventLogs.length}</span>}
                </button>
            </div>

            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}

            {tab === "setup" && <SetupTab data={data} />}
            {tab === "attendance" && <AttendanceTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "actions" && <ActionsTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "loot" && <LootTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "softres" && <SoftresTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "logs" && <LogsTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
        </>
    );
}
