import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaidDetail, importLoot, clearHistoryEvent,
    type ApiError, type RaidDetailData, type SetupPlayer, type AttendancePerson, type LootItem,
} from "../api";
import { formatEventTime, fmtMs } from "../lib/format";
import { eventPostUrl, channelUrl, raidplanUrl } from "../lib/discordLinks";
import { CharacterLink } from "../components/ClassSpec";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };
type Tab = "setup" | "attendance" | "loot";

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

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
                const label = p.displayName || p.id;
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

// --- Anwesenheit tab: role-holder vs. signup reconciliation, read-only (the
// "Fehlende Raider pingen" form is Part B). ---
function AttendanceTab({ data }: { data: RaidDetailData }) {
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
                </>
            )}
        </>
    );
}

// Same rendering as HistoryEventPage's LootTable — no Event column since this
// list is already scoped to a single event.
function LootTable({ items }: { items: LootItem[] }) {
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead><tr><th>Item</th><th>Charakter</th><th>Response</th><th>Boss</th><th>Zeit</th><th>Quelle</th></tr></thead>
            <tbody>
                {items.map((it, i) => (
                    <tr key={i}>
                        <td>{it.itemLink ? <a className="mlink" href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a> : (it.itemName || `Item ${it.itemId}`)}</td>
                        <td><CharacterLink character={it.character} /></td>
                        <td className="small">
                            {it.offspec
                                ? <span className="lbadge lbadge-neutral">{it.response || "Off Spec"}</span>
                                : <span className="lbadge lbadge-ok">{it.response || "Main Spec"}</span>}
                        </td>
                        <td className="small">{it.boss || ""}</td>
                        <td className="small">{fmtMs(it.awardedAt)}</td>
                        <td className="small">{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
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

    const afterLootChange = (msg: string) => {
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

            <div className="dash-card" style={{ marginBottom: 16 }}>
                <div className="dash-card-head"><h3 style={{ margin: 0 }}>{ev.title || "(ohne Titel)"}</h3></div>
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
                <button type="button" className={`tab-btn${tab === "loot" ? " active" : ""}`} role="tab" onClick={() => switchTab("loot")}>
                    Loot
                    {!!data.lootItems.length && <span className="tab-count">{data.lootItems.length}</span>}
                </button>
                {/* Part B: Anmeldung & Sheet, Softres tabs */}
            </div>

            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}

            {tab === "setup" && <SetupTab data={data} />}
            {tab === "attendance" && <AttendanceTab data={data} />}
            {tab === "loot" && <LootTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterLootChange} />}
        </>
    );
}
