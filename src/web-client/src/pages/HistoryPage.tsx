import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
    getHistoryData, getLootStats, importLoot, setLootCategory, deleteHistoryLog, resolveCharacters,
    type ApiError, type HistoryData, type HistoryEvent, type LootEventSummary, type LootLog, type AnnotatedCharacter,
    type Category, type LootStats,
} from "../api";
import { formatEventTime, fmtMs, formatDate } from "../lib/format";
import { usePersistedState, usePersistedSearchParam, useDraftState } from "../lib/persistedState";
import RaidTable from "../components/RaidTable";
import { CharLootHover } from "../components/CharLootHover";
import { ClassSpecCell, CharacterLink, CLASS_SOURCE_LABELS } from "../components/ClassSpec";
import { LootReasonsTab } from "../components/LootReasonsTab";
import { LootItemsTab } from "../components/LootItemsTab";
import { LatestLootTab } from "../components/LatestLootTab";
import type { ShellContext } from "../components/Shell";
import { TrashIcon } from "../components/icons";

type Flash = { type: "ok" | "err"; text: string };
type Tab = "raids" | "import" | "loot" | "awards" | "reasons" | "items" | "logs" | "chars";

const TABS: { id: Tab; label: string; count?: (d: HistoryData) => number }[] = [
    { id: "raids", label: "Alle Raids", count: (d) => d.upcomingRaids.events.length + d.pastRaids.events.length },
    { id: "import", label: "Import" },
    { id: "loot", label: "Importierter Loot", count: (d) => d.lootEvents.length },
    { id: "awards", label: "Latest Loot" },
    { id: "reasons", label: "Loot-Gründe" },
    { id: "items", label: "Items" },
    { id: "logs", label: "Warcraft Logs", count: (d) => d.logs.length },
    { id: "chars", label: "Charaktere", count: (d) => d.chars.length },
];

// The two overview tabs carry every loot row ever imported, so they load on
// demand instead of with the page — opening "Alle Raids" must not pay for them.
const STATS_TABS: Tab[] = ["reasons", "items"];

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

// Everything typed into the import form. Kept as a draft (see useDraftState), so
// a pasted export survives a detour to another tab — re-pasting it is the one
// step nobody can redo from memory.
type ImportDraft = { eventId: string; manualLabel: string; categoryId: string; tool: string; text: string };
const IMPORT_DRAFT_DEFAULT: ImportDraft = { eventId: "__auto__", manualLabel: "", categoryId: "", tool: "auto", text: "" };

function ImportForm({ data, csrfToken, onImported }: {
    data: HistoryData;
    csrfToken: string | null;
    onImported: (msg: string) => void;
}) {
    // categoryId is only used when the import lands without a Raid-Helper event:
    // a real event brings its own Discord category along (see api.ts's
    // ImportLootInput).
    const [draft, patch] = useDraftState<ImportDraft>("history-import", IMPORT_DRAFT_DEFAULT);
    const { eventId, manualLabel, categoryId, tool, text } = draft;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const selectEvent = (id: string) => {
        const ev = data.events.find((e) => e.id === id);
        const preferred = ev ? (data.categoryLootTool[ev.categoryId || ""] || "") : "";
        patch(preferred ? { eventId: id, tool: preferred } : { eventId: id });
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => patch({ text: String(reader.result || "") });
        reader.readAsText(file);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await importLoot(csrfToken, { data: text, tool, event: eventId, manualLabel, categoryId });
            onImported(`${r.added} Item(s) importiert${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`);
            // Only the imported content goes — the event and tool choice stay, the
            // next import of the evening usually belongs to the same raid.
            patch({ text: "", manualLabel: "" });
            if (fileRef.current) fileRef.current.value = "";
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
                    <>
                        <div className="field">
                            <label>Titel (optional)</label>
                            <input type="text" value={manualLabel} onChange={(e) => patch({ manualLabel: e.target.value })} placeholder="z.B. SSC/TK — 12.07.2026" />
                            <div className="hint">Nur nötig, wenn kein Event automatisch gefunden wird oder ein eigener Titel gewünscht ist.</div>
                        </div>
                        <div className="field">
                            <label>Kategorie (optional)</label>
                            <select value={categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
                                <option value="">— keine —</option>
                                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <div className="hint">
                                Nur wirksam, wenn kein Event zugeordnet wird — dann fehlt dem Loot sonst die Kategorie (Pug, Montagsraid, …)
                                und er taucht in den nach Kategorie gruppierten Übersichten nicht auf. Wird ein Event gefunden, gilt dessen eigene Kategorie.
                            </div>
                        </div>
                    </>
                )}
                <div className="field">
                    <label>Loot-Tool</label>
                    <select value={tool} onChange={(e) => patch({ tool: e.target.value })}>
                        <option value="auto">Auto-Erkennung</option>
                        <option value="gargul">Gargul</option>
                        <option value="rclc">RCLootcouncil</option>
                    </select>
                    <div className="hint">Wird aus der Kategorie-Markierung vorbelegt. „Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
                </div>
                <div className="field">
                    <label>Export einfügen</label>
                    <textarea value={text} onChange={(e) => patch({ text: e.target.value })} rows={6} placeholder="RCLootcouncil-JSON oder Gargul-CSV hier einfügen …" />
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

function LootEventsTab({ lootEvents, categories, csrfToken, onChanged }: {
    lootEvents: LootEventSummary[];
    categories: Category[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [saving, setSaving] = useState<string | null>(null);

    // Assigning a category is what makes loot imported without a Raid-Helper
    // event show up in the category-grouped overviews at all; changing it on a
    // bucket that came from an event is allowed too, but a re-import of that
    // event writes its own category back onto the new rows.
    const save = async (eventId: string, categoryId: string) => {
        setSaving(eventId);
        try {
            const r = await setLootCategory(csrfToken, { event: eventId, categoryId });
            onChanged(`Kategorie gesetzt (${r.updated} Item(s)).`);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setSaving(null);
        }
    };

    if (!lootEvents.length) return <p className="sub">Noch kein Loot importiert.</p>;
    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Importierter Loot</h3><span className="small" style={{ marginLeft: "auto" }}>{lootEvents.length} Event(s)</span></div>
            <table className="idx" style={{ margin: 0 }}>
                <thead><tr><th>Event</th><th>Datum</th><th>Kategorie</th><th>Items</th><th>Quelle</th><th /></tr></thead>
                <tbody>
                    {lootEvents.map((e) => (
                        <tr key={e.eventId}>
                            <td><strong>{e.label || e.eventId}</strong></td>
                            <td className="small">{fmtMs(e.awardedAt || e.importedAt, false)}</td>
                            <td className="small">
                                <select
                                    value={e.categoryId || ""}
                                    disabled={saving === e.eventId}
                                    title="Raid-Kategorie, unter der dieser Loot geführt wird — nötig für Loot ohne Event"
                                    onChange={(ev) => save(e.eventId, ev.target.value)}
                                >
                                    <option value="">— ohne Kategorie —</option>
                                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    {/* A category the bot can't see right now (channel gone / Discord offline)
                                        must stay selectable, else opening the tab silently reassigns it. */}
                                    {e.categoryId && !categories.some((c) => c.id === e.categoryId) && (
                                        <option value={e.categoryId}>{e.categoryId} (unbekannt)</option>
                                    )}
                                </select>
                            </td>
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
                                        <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(l)}><TrashIcon />Löschen</button>
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

// Everything the Charaktere tab remembers between visits (see usePersistedState).
type CharView = { search: string; category: string; classSpec: string; sort: CharSortKey; dir: Dir };
const CHAR_VIEW_DEFAULT: CharView = { search: "", category: "", classSpec: "", sort: "count", dir: CHAR_SORT_DEFAULTS.count };

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

function CharTable({ chars, categoryNameById, sort, dir, onSort }: {
    chars: AnnotatedCharacter[];
    categoryNameById: Map<string, string>;
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
                    <th>Kategorie</th>
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
                                {c.categoryIds.length
                                    ? c.categoryIds.map((id) => <span key={id} className="lbadge lbadge-neutral">{categoryNameById.get(id) || id}</span>)
                                    : <span className="sub">—</span>}
                            </div>
                        </td>
                        <td className="small">
                            <CharLootHover
                                items={c.items || []}
                                count={c.count}
                                categoryNameById={categoryNameById}
                                showCategory={c.categoryIds.length > 1}
                            />
                        </td>
                        <td className="small">{CLASS_SOURCE_LABELS[c.source]
                            ? <span className="lbadge">{CLASS_SOURCE_LABELS[c.source]}</span>
                            : <span className="sub">—</span>}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function CharactersTab({ chars, categories, csrfToken, onChanged }: {
    chars: AnnotatedCharacter[];
    categories: Category[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    // Search, filters, grouping and sort live in localStorage, so they survive a
    // reload and switching away to another tab (which unmounts this component).
    // Stored values are treated as untrusted: a sort key from an older build
    // falls back to the default instead of sorting by nothing.
    const [view, setView] = usePersistedState<CharView>("history-chars-view", CHAR_VIEW_DEFAULT);
    const search = view.search;
    const categoryFilter = view.category;
    const classFilter = view.classSpec;
    const sort: CharSortKey = CHAR_SORT_DEFAULTS[view.sort] ? view.sort : CHAR_VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    const patch = (p: Partial<CharView>) => setView((v) => ({ ...v, ...p }));

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

    // Discord category names (e.g. "Montagsraid", "Pug") — the raid *type* a
    // character raids under, not the individual dated raid event.
    const categoryNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of categories) m.set(c.id, c.name);
        return m;
    }, [categories]);

    const categoryOptions = useMemo(() => {
        const ids = new Set<string>();
        for (const c of chars) for (const id of c.categoryIds) ids.add(id);
        return [...ids]
            .map((id) => ({ id, label: categoryNameById.get(id) || id }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [chars, categoryNameById]);

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
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: CHAR_SORT_DEFAULTS[key] });
    };

    if (!chars.length) return <p className="sub">Noch keine Charaktere mit Loot.</p>;

    const missing = chars.filter((c) => !c.className || !c.spec).length;

    const searchLower = search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (categoryFilter && !c.categoryIds.includes(categoryFilter)) return false;
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

    // Group by raid category (Pug, Montagsraid, …), not by the individual dated
    // raid — a character raiding under several categories shows up in each, so
    // "nach Kategorie filtern" and "nach Kategorie gruppiert" are the same
    // mechanism: picking one just narrows the groups down to it.
    const groups = categoryOptions
        .filter((o) => !categoryFilter || o.id === categoryFilter)
        .map((o) => ({ ...o, chars: sorted.filter((c) => c.categoryIds.includes(o.id)) }))
        .filter((g) => g.chars.length);
    const ungrouped = sorted.filter((c) => !c.categoryIds.length);

    // A filter that outlives the visit needs a visible way back — otherwise a
    // search typed last week silently hides half the roster on the next one.
    const hasFilters = !!(search || categoryFilter || classFilter);

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
            <div className="filter-bar">
                <div className="field" style={{ minWidth: 220 }}>
                    <label htmlFor="chars-search">Suche</label>
                    <input
                        id="chars-search"
                        type="text"
                        placeholder="Charaktername …"
                        value={search}
                        onChange={(e) => patch({ search: e.target.value })}
                    />
                </div>
                <div className="field" style={{ minWidth: 180 }}>
                    <label htmlFor="chars-category">Kategorie</label>
                    <select id="chars-category" value={categoryFilter} onChange={(e) => patch({ category: e.target.value })}>
                        <option value="">Alle Kategorien</option>
                        {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                </div>
                <div className="field" style={{ minWidth: 180 }}>
                    <label htmlFor="chars-class">Klasse & Spec</label>
                    <select id="chars-class" value={classFilter} onChange={(e) => patch({ classSpec: e.target.value })}>
                        <option value="">Alle Klassen</option>
                        {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {hasFilters && (
                    <div className="field">
                        <button
                            className="btn btn-ghost"
                            type="button"
                            title="Suche und Filter zurücksetzen (werden lokal im Browser gespeichert)"
                            onClick={() => patch({ search: "", category: "", classSpec: "" })}
                        >
                            Filter zurücksetzen
                        </button>
                    </div>
                )}
            </div>
            {!sorted.length && <p className="sub" style={{ padding: "0 16px 14px" }}>Keine Charaktere gefunden.</p>}
            {groups.map((g) => (
                <div key={g.id} style={{ marginBottom: 10 }}>
                    <div className="dash-card-head" style={{ padding: "8px 16px" }}>
                        <strong>{g.label}</strong>
                        <span className="tab-count">{g.chars.length}</span>
                    </div>
                    <CharTable chars={g.chars} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            ))}
            {!!ungrouped.length && (
                <div>
                    <div className="dash-card-head" style={{ padding: "8px 16px" }}><strong>Ohne Kategorie</strong></div>
                    <CharTable chars={ungrouped} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            )}
        </div>
    );
}

export default function HistoryPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    // In the URL (linkable, survives a reload) and remembered on top of that, so
    // coming back via the sidebar re-opens the tab that was last used here.
    const [tab, setTab] = usePersistedSearchParam<Tab>("history-tab", "tab", "raids", TABS.map((t) => t.id));

    const [data, setData] = useState<HistoryData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);
    const [stats, setStats] = useState<LootStats | null>(null);
    const [statsError, setStatsError] = useState<ApiError | null>(null);

    // Whether the overviews were ever asked for. A ref, not the state above:
    // after a failed load there is nothing in `stats`, and retrying on every
    // render would hammer the endpoint.
    const statsRequested = useRef(false);

    const loadStats = () => {
        statsRequested.current = true;
        getLootStats().then((s) => { setStats(s); setStatsError(null); }).catch((err: ApiError) => setStatsError(err));
    };

    const load = () => {
        getHistoryData().then(setData).catch((err: ApiError) => setError(err));
        // Only refresh the overviews once they have been opened — before that
        // there is nothing on screen that could go stale after an import.
        if (statsRequested.current) loadStats();
    };

    useEffect(load, []);

    // Fetched on the first visit to one of the overview tabs, then kept.
    useEffect(() => {
        if (STATS_TABS.includes(tab) && !statsRequested.current) loadStats();
    }, [tab]);

    const afterChange = (msg: string) => {
        setFlash({ type: "ok", text: msg });
        load();
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <h1 className="page-title">Historie &amp; Loot</h1>
            <p className="note">Loot pro Event importieren (RCLootcouncil-JSON oder Gargul-CSV), Warcraft-Logs verlinken und pro Charakter die Loot-Historie samt Armory einsehen. „Loot-Gründe" zeigt je Raider, wofür er Items bekommen hat, „Items" alle Items mit ihren Empfängern — filterbar nach Raid und Tier.</p>
            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}

            <div className="tabs" role="tablist">
                {TABS.map((t) => (
                    <button key={t.id} type="button" className={`tab-btn${tab === t.id ? " active" : ""}`} role="tab" onClick={() => setTab(t.id)}>
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
            {tab === "loot" && <LootEventsTab lootEvents={data.lootEvents} categories={data.categories} csrfToken={csrfToken} onChanged={afterChange} />}
            {/* Fetches its own page of awards — see LatestLootTab. */}
            {tab === "awards" && <LatestLootTab categories={data.categories} />}
            {STATS_TABS.includes(tab) && (
                statsError
                    ? <div className="empty">Fehler beim Laden: {statsError.message}</div>
                    : !stats
                        ? <div className="empty">Lade…</div>
                        : tab === "reasons"
                            ? <LootReasonsTab characters={stats.characters} reasons={stats.reasons} categories={data.categories} />
                            : (
                                <LootItemsTab
                                    items={stats.items}
                                    contents={stats.contents}
                                    tiers={stats.tiers}
                                    reasons={stats.reasons}
                                    categories={data.categories}
                                    unknownContentCount={stats.unknownContentCount}
                                />
                            )
            )}
            {tab === "logs" && <LogsTab logs={data.logs} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "chars" && <CharactersTab chars={data.chars} categories={data.categories} csrfToken={csrfToken} onChanged={afterChange} />}
        </>
    );
}
