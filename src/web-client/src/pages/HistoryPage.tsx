import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getHistoryData, importLoot, deleteHistoryLog, saveCategoryLootTool, resolveCharacters,
    type ApiError, type HistoryData, type HistoryEvent, type LootEventSummary, type LootLog, type AnnotatedCharacter,
} from "../api";
import { formatEventTime, fmtMs, formatDate } from "../lib/format";
import RaidTable from "../components/RaidTable";
import { ClassSpecCell, CharacterLink } from "../components/ClassSpec";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };
type Tab = "raids" | "import" | "loot" | "logs" | "cats" | "chars";

const TABS: { id: Tab; label: string; count?: (d: HistoryData) => number }[] = [
    { id: "raids", label: "Alle Raids", count: (d) => d.upcomingRaids.events.length + d.pastRaids.events.length },
    { id: "import", label: "Import" },
    { id: "loot", label: "Importierter Loot", count: (d) => d.lootEvents.length },
    { id: "logs", label: "Warcraft Logs", count: (d) => d.logs.length },
    { id: "cats", label: "Loot-Tools" },
    { id: "chars", label: "Charaktere", count: (d) => d.chars.length },
];

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };
// Where a stored class/spec came from, so a wrong entry can be traced back —
// mirrors renderAdmin.js's CLASS_SOURCE_LABELS.
const CLASS_SOURCE_LABELS: Record<string, string> = {
    export: "Loot-Export",
    report: "Auswertung",
    wcl: "Warcraft Log",
    manual: "manuell",
};

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
                                <td className="small">{formatDate(l.postedAt || 0)}</td>
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

type CharSortKey = "character" | "classSpec" | "count" | "source";
type Dir = "asc" | "desc";

const CHAR_SORT_DEFAULTS: Record<CharSortKey, Dir> = { character: "asc", classSpec: "asc", count: "desc", source: "asc" };

function charSortValue(c: AnnotatedCharacter, key: CharSortKey): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "classSpec": return `${c.className} ${c.spec}`.toLowerCase().trim();
        case "count": return c.count;
        case "source": return (CLASS_SOURCE_LABELS[c.source] || c.source || "").toLowerCase();
        default: return "";
    }
}

function CharSortTh({ sortKey, label, sort, dir, onSort }: {
    sortKey: CharSortKey;
    label: string;
    sort: CharSortKey;
    dir: Dir;
    onSort: (key: CharSortKey) => void;
}) {
    const active = sort === sortKey;
    const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
    return (
        <th>
            <button type="button" className={`sort-link${active ? " active" : ""}`} onClick={() => onSort(sortKey)}>
                {label}{arrow}
            </button>
        </th>
    );
}

function CharTable({ chars, sort, dir, onSort }: {
    chars: AnnotatedCharacter[];
    sort: CharSortKey;
    dir: Dir;
    onSort: (key: CharSortKey) => void;
}) {
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <CharSortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                    <CharSortTh sortKey="classSpec" label="Klasse & Spec" sort={sort} dir={dir} onSort={onSort} />
                    <th>Raids</th>
                    <CharSortTh sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} />
                    <CharSortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} />
                </tr>
            </thead>
            <tbody>
                {chars.map((c) => (
                    <tr key={c.key}>
                        <td><CharacterLink character={c.character} classColor={c.classColor} /></td>
                        <td><ClassSpecCell className={c.className} spec={c.spec} classColor={c.classColor} iconUrl={c.iconUrl} /></td>
                        <td className="small">
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {c.raids.length
                                    ? c.raids.map((r) => <span key={r.eventId} className="lbadge lbadge-neutral">{r.eventLabel}</span>)
                                    : <span className="sub">—</span>}
                            </div>
                        </td>
                        <td className="small">{c.count}</td>
                        <td className="small">{CLASS_SOURCE_LABELS[c.source]
                            ? <span className="lbadge">{CLASS_SOURCE_LABELS[c.source]}</span>
                            : <span className="sub">—</span>}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function CharactersTab({ chars, csrfToken, onChanged }: {
    chars: AnnotatedCharacter[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [raidFilter, setRaidFilter] = useState("");
    const [classFilter, setClassFilter] = useState("");
    const [sort, setSort] = useState<CharSortKey>("count");
    const [dir, setDir] = useState<Dir>(CHAR_SORT_DEFAULTS.count);

    const resolve = async () => {
        setBusy(true);
        try {
            const r = await resolveCharacters(csrfToken);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const raidOptions = useMemo(() => {
        const byId = new Map<string, string>();
        for (const c of chars) for (const r of c.raids) if (!byId.has(r.eventId)) byId.set(r.eventId, r.eventLabel);
        return [...byId.entries()]
            .map(([eventId, eventLabel]) => ({ eventId, eventLabel }))
            .sort((a, b) => a.eventLabel.localeCompare(b.eventLabel));
    }, [chars]);

    const classOptions = useMemo(() => {
        const byKey = new Map<string, string>();
        for (const c of chars) {
            if (!c.className) continue;
            const key = `${c.className}||${c.spec}`;
            if (!byKey.has(key)) byKey.set(key, c.spec ? `${c.spec} ${c.className}` : c.className);
        }
        return [...byKey.entries()]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [chars]);

    const onSort = (key: CharSortKey) => {
        if (key === sort) { setDir((d) => (d === "asc" ? "desc" : "asc")); return; }
        setSort(key);
        setDir(CHAR_SORT_DEFAULTS[key]);
    };

    if (!chars.length) return <p className="sub">Noch keine Charaktere mit Loot.</p>;

    const missing = chars.filter((c) => !c.className || !c.spec).length;

    const searchLower = search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (raidFilter && !c.raids.some((r) => r.eventId === raidFilter)) return false;
        if (classFilter && `${c.className}||${c.spec}` !== classFilter) return false;
        return true;
    });

    const mul = dir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
        const va = charSortValue(a, sort);
        const vb = charSortValue(b, sort);
        if (va < vb) return -1 * mul;
        if (va > vb) return 1 * mul;
        return 0;
    });

    // Group by raid — a character with loot in several raids shows up in each
    // of them, so "nach Raid filtern" and "nach Raid gruppiert" are the same
    // mechanism: picking a raid just narrows the groups down to one.
    const groups = raidOptions
        .filter((r) => !raidFilter || r.eventId === raidFilter)
        .map((r) => ({ ...r, chars: sorted.filter((c) => c.raids.some((cr) => cr.eventId === r.eventId)) }))
        .filter((g) => g.chars.length);
    const ungrouped = sorted.filter((c) => !c.raids.length);

    return (
        <div className="dash-card">
            <div className="dash-card-head">
                <h3>Charaktere</h3>
                <span style={{ marginLeft: "auto" }}>
                    <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={busy}
                        title="Nimmt die Klasse aus dem Loot-Export bzw. einer vorhandenen Auswertung und liest den Rest aus dem Warcraft-Log des Raids"
                        onClick={resolve}
                    >
                        {busy ? "Suche läuft …" : `Klassen & Specs ergänzen${missing ? ` (${missing} offen)` : ""}`}
                    </button>
                </span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <input
                    type="text"
                    placeholder="Charakter suchen …"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ minWidth: 200 }}
                />
                <select value={raidFilter} onChange={(e) => setRaidFilter(e.target.value)}>
                    <option value="">Alle Raids</option>
                    {raidOptions.map((r) => <option key={r.eventId} value={r.eventId}>{r.eventLabel}</option>)}
                </select>
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                    <option value="">Alle Klassen</option>
                    {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>
            {!sorted.length && <p className="sub" style={{ padding: "0 16px 14px" }}>Keine Charaktere gefunden.</p>}
            {groups.map((g) => (
                <div key={g.eventId} style={{ marginBottom: 10 }}>
                    <div className="dash-card-head" style={{ padding: "8px 16px" }}>
                        <strong>{g.eventLabel}</strong>
                        <span className="tab-count">{g.chars.length}</span>
                    </div>
                    <CharTable chars={g.chars} sort={sort} dir={dir} onSort={onSort} />
                </div>
            ))}
            {!!ungrouped.length && (
                <div>
                    <div className="dash-card-head" style={{ padding: "8px 16px" }}><strong>Ohne Raid-Zuordnung</strong></div>
                    <CharTable chars={ungrouped} sort={sort} dir={dir} onSort={onSort} />
                </div>
            )}
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
            {tab === "chars" && <CharactersTab chars={data.chars} csrfToken={csrfToken} onChanged={afterChange} />}
        </>
    );
}
