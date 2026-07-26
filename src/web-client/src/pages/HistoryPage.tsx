import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getHistoryData, importLoot, deleteHistoryLog, saveCategoryLootTool,
    type ApiError, type HistoryData, type HistoryEvent, type LootEventSummary, type LootLog,
} from "../api";
import { formatEventTime, fmtMs } from "../lib/format";
import RaidTable from "../components/RaidTable";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };
type Tab = "raids" | "import" | "loot" | "logs" | "cats";

const TABS: { id: Tab; label: string; count?: (d: HistoryData) => number }[] = [
    { id: "raids", label: "Alle Raids", count: (d) => d.upcomingRaids.events.length + d.pastRaids.events.length },
    { id: "import", label: "Import" },
    { id: "loot", label: "Importierter Loot", count: (d) => d.lootEvents.length },
    { id: "logs", label: "Warcraft Logs", count: (d) => d.logs.length },
    { id: "cats", label: "Loot-Tools" },
];

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

function ImportForm({ data, csrfToken, onImported }: {
    data: HistoryData;
    csrfToken: string | null;
    onImported: (msg: string) => void;
}) {
    const [eventId, setEventId] = useState("__auto__");
    const [manualLabel, setManualLabel] = useState("");
    const [tool, setTool] = useState("auto");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const selectEvent = (id: string) => {
        setEventId(id);
        const ev = data.events.find((e) => e.id === id);
        const preferred = ev ? (data.categoryLootTool[ev.categoryId || ""] || "") : "";
        if (preferred) setTool(preferred);
    };

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
            const r = await importLoot(csrfToken, { data: text, tool, event: eventId, manualLabel });
            onImported(`${r.added} Item(s) importiert${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`);
            setText("");
            setManualLabel("");
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const showManual = eventId === "__auto__" || eventId === "__manual__";

    return (
        <div className="dash-card" style={{ marginBottom: 18 }}>
            <div className="dash-card-head"><h3>Loot importieren</h3></div>
            <form className="card-form" onSubmit={submit} style={{ padding: "14px 16px" }}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
                <div className="field">
                    <label>Event</label>
                    <select value={eventId} onChange={(e) => selectEvent(e.target.value)}>
                        <option value="__auto__">— Automatisch anhand des Datums im Export zuordnen —</option>
                        {data.events.map((ev: HistoryEvent) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.title || "(ohne Titel)"}{ev.startTime ? ` · ${formatEventTime(ev.startTime)}` : ""}
                            </option>
                        ))}
                        <option value="__manual__">— Anderes / vergangenes Event (manuell benennen) —</option>
                    </select>
                    <div className="hint">„Automatisch" ordnet dem Raid-Helper-Event des gleichen Tages zu; passt keins oder mehrere, muss unten manuell gewählt/benannt werden.</div>
                </div>
                {showManual && (
                    <div className="field">
                        <label>Titel (optional)</label>
                        <input type="text" value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} placeholder="z.B. SSC/TK — 12.07.2026" />
                        <div className="hint">Nur nötig, wenn kein Event automatisch gefunden wird oder ein eigener Titel gewünscht ist.</div>
                    </div>
                )}
                <div className="field">
                    <label>Loot-Tool</label>
                    <select value={tool} onChange={(e) => setTool(e.target.value)}>
                        <option value="auto">Auto-Erkennung</option>
                        <option value="gargul">Gargul</option>
                        <option value="rclc">RCLootcouncil</option>
                    </select>
                    <div className="hint">Wird aus der Kategorie-Markierung vorbelegt. „Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
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

function CategoryToolsTab({ data, csrfToken, onChanged }: { data: HistoryData; csrfToken: string | null; onChanged: (msg: string) => void }) {
    const [saving, setSaving] = useState<string | null>(null);

    const save = async (categoryId: string, tool: string) => {
        setSaving(categoryId);
        try {
            await saveCategoryLootTool(csrfToken, { categoryId, tool });
            onChanged("Gespeichert.");
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Loot-Tool je Kategorie</h3></div>
            <table className="idx" style={{ margin: 0 }}>
                <tbody>
                    {data.categories.length
                        ? data.categories.map((c) => (
                            <tr key={c.id}>
                                <td><strong>{c.name}</strong></td>
                                <td className="row-actions">
                                    <select value={data.categoryLootTool[c.id] || ""} disabled={saving === c.id} onChange={(e) => save(c.id, e.target.value)}>
                                        <option value="">— nicht gesetzt —</option>
                                        <option value="gargul">Gargul</option>
                                        <option value="rclc">RCLootcouncil</option>
                                    </select>
                                </td>
                            </tr>
                        ))
                        : <tr><td colSpan={2} className="sub">Keine Kategorien gefunden (Server gewählt?).</td></tr>}
                </tbody>
            </table>
        </div>
    );
}

function LootEventsTab({ lootEvents }: { lootEvents: LootEventSummary[] }) {
    if (!lootEvents.length) return <p className="sub">Noch kein Loot importiert.</p>;
    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Importierter Loot</h3><span className="small" style={{ marginLeft: "auto" }}>{lootEvents.length} Event(s)</span></div>
            <table className="idx" style={{ margin: 0 }}>
                <thead><tr><th>Event</th><th>Datum</th><th>Items</th><th>Quelle</th><th /></tr></thead>
                <tbody>
                    {lootEvents.map((e) => (
                        <tr key={e.eventId}>
                            <td><strong>{e.label || e.eventId}</strong></td>
                            <td className="small">{fmtMs(e.awardedAt || e.importedAt, false)}</td>
                            <td className="small">{e.count}</td>
                            <td className="small">{(e.sources || []).map((s) => <span key={s} className="lbadge">{LOOT_TOOL_LABELS[s] || s}</span>)}</td>
                            <td className="cell-actions">
                                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                    <Link className="btn btn-ghost btn-sm" to={`/history/event?event=${encodeURIComponent(e.eventId)}`}>Loot ansehen</Link>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function LogsTab({ logs, csrfToken, onChanged }: { logs: LootLog[]; csrfToken: string | null; onChanged: (msg: string) => void }) {
    const remove = async (l: LootLog) => {
        if (!confirm("Log aus der Liste entfernen?")) return;
        try {
            await deleteHistoryLog(csrfToken, l.id);
            onChanged("Gelöscht.");
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    if (!logs.length) return <p className="sub">Keine Warcraft-Logs erfasst (Log-Channels in den Einstellungen konfigurieren).</p>;

    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Warcraft Logs</h3><span className="small" style={{ marginLeft: "auto" }}>{logs.length}</span></div>
            <table className="idx" style={{ margin: 0 }}>
                <thead><tr><th>Log</th><th>Datum</th><th>Zone</th><th>Event</th><th>Status</th><th /></tr></thead>
                <tbody>
                    {logs.map((l) => {
                        const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                        return (
                            <tr key={l.id}>
                                <td>{wclUrl
                                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{l.title || l.reportId || "(Log)"} ↗</a>
                                    : (l.title || "(Log)")}</td>
                                <td className="small" />
                                <td className="small">{l.zone || ""}</td>
                                <td className="small">{l.eventId ? <span className="pill" title={l.eventStartTime ? formatEventTime(l.eventStartTime) : ""}>{l.eventLabel || l.eventId}</span> : <span className="sub">—</span>}</td>
                                <td>{l.status === "done" ? <span className="pill good">ausgewertet</span> : <span className="pill">offen</span>}</td>
                                <td className="cell-actions">
                                    <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                        {l.status === "done" && (l.reportUrl || l.reportRefId) && (
                                            <a className="btn btn-ghost btn-sm" href={l.reportUrl || `/r/${l.reportRefId}`}>Öffnen</a>
                                        )}
                                        <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(l)}>Löschen</button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default function HistoryPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = (searchParams.get("tab") as Tab) || "raids";

    const [data, setData] = useState<HistoryData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);

    const load = () => {
        getHistoryData().then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    const afterChange = (msg: string) => {
        setFlash({ type: "ok", text: msg });
        load();
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <h1 className="page-title">Historie &amp; Loot</h1>
            <p className="note">Loot pro Event importieren (RCLootcouncil-JSON oder Gargul-CSV), Warcraft-Logs verlinken und pro Charakter die Loot-Historie samt Armory einsehen.</p>
            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}

            <div className="tabs" role="tablist">
                {TABS.map((t) => (
                    <button key={t.id} type="button" className={`tab-btn${tab === t.id ? " active" : ""}`} role="tab" onClick={() => setSearchParams(t.id === "raids" ? {} : { tab: t.id })}>
                        {t.label}
                        {!!t.count?.(data) && <span className="tab-count">{t.count(data)}</span>}
                    </button>
                ))}
            </div>

            {tab === "raids" && (
                <>
                    <div className="dash-card" style={{ marginBottom: 18 }}>
                        <div className="dash-card-head"><h3>Kommende Raids</h3><span className="small" style={{ marginLeft: "auto" }}>{data.upcomingRaids.events.length}</span></div>
                        <RaidTable events={data.upcomingRaids.events} guildId={data.activeGuildId} error={data.upcomingRaids.error} emptyMessage="Keine anstehenden Raids gefunden." />
                    </div>
                    <div className="dash-card">
                        <div className="dash-card-head"><h3>Vergangene Raids</h3><span className="small" style={{ marginLeft: "auto" }}>{data.pastRaids.events.length}</span></div>
                        <RaidTable events={data.pastRaids.events} guildId={data.activeGuildId} error={data.pastRaids.error} emptyMessage="Keine vergangenen Raids gefunden." />
                    </div>
                </>
            )}
            {tab === "import" && <ImportForm data={data} csrfToken={csrfToken} onImported={afterChange} />}
            {tab === "loot" && <LootEventsTab lootEvents={data.lootEvents} />}
            {tab === "logs" && <LogsTab logs={data.logs} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "cats" && <CategoryToolsTab data={data} csrfToken={csrfToken} onChanged={afterChange} />}
        </>
    );
}
