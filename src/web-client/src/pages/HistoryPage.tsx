import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getHistoryData, getLootStats, setLootCategory, deleteHistoryLog, resolveCharacters,
    getLootInbox, getSession, canAccess,
    type ApiError, type HistoryData, type LootEventSummary, type LootLog, type AnnotatedCharacter,
    type Category, type LootStats,
} from "../api";
import { formatEventTime, fmtMs, formatDate } from "../lib/format";
import { usePersistedState, usePersistedSearchParam } from "../lib/persistedState";
import { sortRows, useTableSort, type Dir } from "../lib/tableSort";
import RaidTable from "../components/RaidTable";
import { SortTh } from "../components/SortTh";
import { CharLootHover } from "../components/CharLootHover";
import { ClassSpecCell, CharacterLink, CLASS_SOURCE_LABELS } from "../components/ClassSpec";
import { LootReasonsTab } from "../components/LootReasonsTab";
import { LootItemsTab } from "../components/LootItemsTab";
import { LatestLootTab } from "../components/LatestLootTab";
import { ImportLootDialog } from "../components/ImportLootDialog";
import type { ShellContext } from "../components/Shell";
import { ChevronRightIcon, ExternalIcon, TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";
import { useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import { PartHead } from "../components/ui/PartHead";
import PageHead from "../components/ui/PageHead";
import Segment from "../components/ui/Segment";
import Badge from "../components/ui/Badge";
import "../styles/historie-loot.css";
import RaidLoader from "../components/ui/RaidLoader";

type Tab = "awards" | "items" | "reasons" | "loot" | "raids" | "logs" | "chars";

// Three areas instead of three groups of nine tabs (design issue #225): the
// area says what kind of thing it is, the view which one. The import form and
// the addon inbox are gone from the tab list — neither is a view; the import is
// a dialog from the page head, the inbox its own page (/history/inbox).
// The open area follows from the open view, so there is nothing extra to
// remember or persist.
// The "loot" area is also what the narrower "Loot-Ansichten" permission opens on
// its own — see the page component and src/config/permissions.js.
type AreaId = "loot" | "raids" | "chars";
const AREAS: { id: AreaId; label: string; icon: string; views: { id: Tab; label: string }[] }[] = [
    {
        id: "loot", label: "Loot", icon: "inv_misc_bag_10", views: [
            { id: "awards", label: "Vergaben" },
            { id: "items", label: "Items" },
            { id: "reasons", label: "Gründe" },
            { id: "loot", label: "Nach Raid" },
        ],
    },
    {
        id: "raids", label: "Raids & Logs", icon: "inv_misc_note_02", views: [
            { id: "raids", label: "Raids" },
            { id: "logs", label: "Warcraft Logs" },
        ],
    },
    { id: "chars", label: "Charaktere", icon: "achievement_guildperk_everybodysfriend", views: [{ id: "chars", label: "Charaktere" }] },
];

// The main view of the page — where the sidebar link lands.
const DEFAULT_TAB: Tab = "items";

// Old ?tab= values that are no longer views: "import" opens the dialog, "inbox"
// goes to its page. Links to them are posted in Discord and must keep working.
const LEGACY_IMPORT = "import";
const LEGACY_INBOX = "inbox";

// The two overview views carry every loot row ever imported, so they load on
// demand instead of with the page — opening "Raids" must not pay for them.
const STATS_TABS: Tab[] = ["reasons", "items"];

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

type LootEventSortKey = "event" | "date" | "category" | "count" | "source";
const LOOT_EVENT_SORT_DEFAULTS: Record<LootEventSortKey, Dir> = {
    event: "asc", date: "desc", category: "asc", count: "desc", source: "asc",
};

function LootEventsTab({ lootEvents, categories, csrfToken, onChanged, canEdit }: {
    lootEvents: LootEventSummary[];
    categories: Category[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
    // Without write access to "Historie & Loot" the category is shown, not set —
    // the loot views are read-only (src/config/permissions.js).
    canEdit: boolean;
}) {
    const [saving, setSaving] = useState<string | null>(null);
    const toast = useToast();
    const navigate = useNavigate();
    // Newest import first by default — that is the one just pasted in, and the
    // reason this list is opened at all.
    const { sort, dir, onSort, apply } = useTableSort<LootEventSortKey>(
        "history-loot-events-sort", LOOT_EVENT_SORT_DEFAULTS, "date",
    );
    const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

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
            // Not onChanged: nothing changed, so this must not reload the list
            // and must not be reported in the success tone.
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(null);
        }
    };

    const head = (
        <PartHead
            icon="inv_misc_bag_10" tone="history" title="Nach Raid" crumb="Loot › Nach Raid"
            tip="Nach Raid" tipSub="Der importierte Loot je Event. Die Kategorie ordnet Loot ohne Raid-Helper-Event einer Raid-Serie zu."
            action={<Badge count>{lootEvents.length} Events</Badge>}
        />
    );

    if (!lootEvents.length) return <div className="dash-card hl-card">{head}<div className="empty">Noch kein Loot importiert.</div></div>;

    const sorted = apply(lootEvents, (e, key) => {
        switch (key) {
            case "event": return (e.label || e.eventId).toLowerCase();
            case "date": return e.awardedAt || e.importedAt || 0;
            // By the name shown in the select, not the snowflake id; a bucket
            // without a category sorts last instead of first.
            case "category": return (categoryNameById.get(e.categoryId || "") || e.categoryId || "zzz").toLowerCase();
            case "count": return e.count;
            case "source": return (e.sources || []).map((s) => LOOT_TOOL_LABELS[s] || s).sort().join(", ").toLowerCase();
            default: return "";
        }
    });

    return (
        <div className="dash-card hl-card">
            {head}
            <table className="idx" style={{ margin: 0 }}>
                <thead>
                    <tr>
                        <SortTh sortKey="event" label="Event" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="date" label="Datum" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="category" label="Kategorie" sort={sort} dir={dir} onSort={onSort} tip="Kategorie" tipSub="Raid-Kategorie, unter der dieser Loot geführt wird — nötig für Loot ohne Event." />
                        <SortTh sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} />
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((e) => (
                        <tr key={e.eventId}>
                            <td><strong>{e.label || e.eventId}</strong></td>
                            <td className="small">{fmtMs(e.awardedAt || e.importedAt, false)}</td>
                            <td className="small">
                                {canEdit ? (
                                    <select
                                        aria-label="Kategorie"
                                        value={e.categoryId || ""}
                                        disabled={saving === e.eventId}
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
                                ) : (categoryNameById.get(e.categoryId || "") || e.categoryId || "—")}
                            </td>
                            <td className="small"><Badge count>{e.count}</Badge></td>
                            <td className="small">
                                <div className="badge-row">{(e.sources || []).map((s) => <Badge key={s}>{LOOT_TOOL_LABELS[s] || s}</Badge>)}</div>
                            </td>
                            <td className="cell-actions">
                                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                    <IconButton
                                        icon={<ChevronRightIcon />} size="sm" tip="Loot ansehen" tipSub="Alle Items dieses Events, mit Nachtragen und Löschen"
                                        onClick={() => navigate(`/history/event?event=${encodeURIComponent(e.eventId)}`)}
                                    />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

type LogSortKey = "log" | "date" | "zone" | "event" | "status";
const LOG_SORT_DEFAULTS: Record<LogSortKey, Dir> = { log: "asc", date: "desc", zone: "asc", event: "asc", status: "asc" };

function LogsTab({ logs, csrfToken, onChanged }: { logs: LootLog[]; csrfToken: string | null; onChanged: (msg: string) => void }) {
    const ask = useConfirm();
    const { sort, dir, onSort, apply } = useTableSort<LogSortKey>("history-logs-sort", LOG_SORT_DEFAULTS, "date");
    const toast = useToast();

    const remove = async (l: LootLog) => {
        if (!(await ask({ title: "Log entfernen?", text: `„${l.title || l.reportId || "Log"}" wird aus der Liste entfernt.`, action: "Entfernen" }))) return;
        try {
            await deleteHistoryLog(csrfToken, l.id);
            onChanged("Gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const head = (
        <PartHead
            icon="inv_misc_pocketwatch_01" tone="history" title="Warcraft Logs" crumb="Raids & Logs › Warcraft Logs"
            tip="Warcraft Logs" tipSub="Die in den Log-Channels geposteten Logs. Log-Channels werden in den Einstellungen konfiguriert."
            action={<Badge count>{logs.length} Logs</Badge>}
        />
    );

    if (!logs.length) return <div className="dash-card hl-card">{head}<div className="empty">Keine Warcraft-Logs erfasst (Log-Channels in den Einstellungen konfigurieren).</div></div>;

    const sorted = apply(logs, (l, key) => {
        switch (key) {
            case "log": return (l.title || l.reportId || "").toLowerCase();
            case "date": return l.postedAt || 0;
            case "zone": return (l.zone || "zzz").toLowerCase();
            // Unassigned logs are the ones that need work, so they lead the
            // ascending order instead of trailing the named ones.
            case "event": return (l.eventLabel || l.eventId || "").toLowerCase();
            case "status": return l.status === "done" ? 1 : 0;
            default: return "";
        }
    });

    return (
        <div className="dash-card hl-card">
            {head}
            <table className="idx" style={{ margin: 0 }}>
                <thead>
                    <tr>
                        <SortTh sortKey="log" label="Log" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="date" label="Datum" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="zone" label="Zone" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="event" label="Event" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="status" label="Status" sort={sort} dir={dir} onSort={onSort} tip="Status" tipSub="Ausgewertet heißt: eine Log-Auswertung liegt vor und kann geöffnet werden." />
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((l) => {
                        const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
                        const reportUrl = l.status === "done" && (l.reportUrl || l.reportRefId) ? (l.reportUrl || `/r/${l.reportRefId}`) : "";
                        return (
                            <tr key={l.id}>
                                <td>{wclUrl
                                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{l.title || l.reportId || "(Log)"} ↗</a>
                                    : (l.title || "(Log)")}</td>
                                <td className="small">{formatDate(l.postedAt || 0)}</td>
                                <td className="small">{l.zone || ""}</td>
                                <td className="small">{l.eventId
                                    ? <Badge icon="inv_misc_note_02" tip={l.eventLabel || l.eventId} tipSub={l.eventStartTime ? formatEventTime(l.eventStartTime) : undefined}>{l.eventLabel || l.eventId}</Badge>
                                    : <span className="sub">—</span>}</td>
                                <td>{l.status === "done" ? <Badge tone="ok">ausgewertet</Badge> : <Badge tone="mid">offen</Badge>}</td>
                                <td className="cell-actions">
                                    <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                        {reportUrl && (
                                            <IconButton
                                                icon={<ExternalIcon />} size="sm" tip="Auswertung öffnen"
                                                onClick={() => { window.location.href = reportUrl; }}
                                            />
                                        )}
                                        <IconButton icon={<TrashIcon />} tone="danger" size="sm" tip="Log entfernen" tipSub="Nur aus dieser Liste — mit Rückfrage." onClick={() => remove(l)} />
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

type CharSortKey = "character" | "classSpec" | "category" | "count" | "source";

const CHAR_SORT_DEFAULTS: Record<CharSortKey, Dir> = { character: "asc", classSpec: "asc", category: "asc", count: "desc", source: "asc" };

// Everything the Charaktere view remembers between visits (see usePersistedState).
type CharView = { search: string; category: string; classSpec: string; sort: CharSortKey; dir: Dir };
const CHAR_VIEW_DEFAULT: CharView = { search: "", category: "", classSpec: "", sort: "count", dir: CHAR_SORT_DEFAULTS.count };

// The category cell holds badges, one per raid series the character shows up
// in; it sorts by their names (the ids are snowflakes and would sort by channel
// creation date), a character without any last.
function charSortValue(c: AnnotatedCharacter, key: CharSortKey, categoryNames: (c: AnnotatedCharacter) => string): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "classSpec": return `${c.className} ${c.spec}`.toLowerCase().trim();
        case "category": return categoryNames(c) || "zzz";
        case "count": return c.count;
        case "source": return (CLASS_SOURCE_LABELS[c.source] || c.source || "").toLowerCase();
        default: return "";
    }
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
                    <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="classSpec" label="Klasse & Spec" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="category" label="Kategorie" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} tip="Items" tipSub="Hover über die Zahl zeigt die Items." />
                    <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} tip="Quelle" tipSub="Woher Klasse und Spec stammen." />
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
                                    ? c.categoryIds.map((id) => <Badge key={id} tone="accent">{categoryNameById.get(id) || id}</Badge>)
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
                            ? <Badge>{CLASS_SOURCE_LABELS[c.source]}</Badge>
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
    const toast = useToast();
    // Search, filters, grouping and sort live in localStorage, so they survive a
    // reload and switching away to another view (which unmounts this component).
    // Stored values are treated as untrusted: a sort key from an older build
    // falls back to the default instead of sorting by nothing.
    const [view, setView] = usePersistedState<CharView>("history-chars-view", CHAR_VIEW_DEFAULT);
    const search = view.search;
    const categoryFilter = view.category;
    const classFilter = view.classSpec;
    const sort: CharSortKey = CHAR_SORT_DEFAULTS[view.sort] ? view.sort : CHAR_VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    const patch = (p: Partial<CharView>) => setView((v) => ({ ...v, ...p }));

    // The result has to be a toast: the old page-level flash line was rendered
    // far above the fold, so a finished lookup looked like nothing had happened.
    const resolve = async () => {
        setBusy(true);
        try {
            const r = await resolveCharacters(csrfToken);
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
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

    const missing = chars.filter((c) => !c.className || !c.spec).length;

    const head = (
        <PartHead
            icon="achievement_guildperk_everybodysfriend" tone="history" title="Charaktere" crumb="Charaktere"
            tip="Charaktere" tipSub="Jeder Charakter mit Loot, gruppiert nach Raid-Kategorie. Der Name öffnet die Loot-Historie samt Armory."
            action={chars.length ? (
                <Button
                    variant="run"
                    icon="inv_misc_spyglass_03"
                    running={busy}
                    data-tip="Klassen & Specs ergänzen"
                    data-tip-sub="Nimmt die Klasse aus dem Loot-Export bzw. einer vorhandenen Auswertung und liest den Rest aus dem Warcraft-Log des Raids."
                    onClick={resolve}
                >
                    {`Klassen & Specs ergänzen${missing ? ` (${missing} offen)` : ""}`}
                </Button>
            ) : undefined}
        />
    );

    if (!chars.length) return <div className="dash-card hl-card">{head}<div className="empty">Noch keine Charaktere mit Loot.</div></div>;

    const searchLower = search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (categoryFilter && !c.categoryIds.includes(categoryFilter)) return false;
        if (classFilter && `${c.className}||${c.spec}` !== classFilter) return false;
        return true;
    });

    const categoryNames = (c: AnnotatedCharacter) =>
        c.categoryIds.map((id) => (categoryNameById.get(id) || id).toLowerCase()).sort().join(", ");
    const sorted = sortRows(filtered, (c) => charSortValue(c, sort, categoryNames), dir);

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
        <div className="dash-card hl-card">
            {head}
            <div className="filter-bar hl-filters">
                <input
                    id="chars-search"
                    type="search"
                    aria-label="Charaktername"
                    placeholder="Charaktername …"
                    value={search}
                    onChange={(e) => patch({ search: e.target.value })}
                />
                <select id="chars-category" className="hl-sel" aria-label="Kategorie" value={categoryFilter} onChange={(e) => patch({ category: e.target.value })}>
                    <option value="">Alle Kategorien</option>
                    {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <select id="chars-class" className="hl-sel" aria-label="Klasse & Spec" value={classFilter} onChange={(e) => patch({ classSpec: e.target.value })}>
                    <option value="">Alle Klassen</option>
                    {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {hasFilters && (
                    <Button
                        variant="ghost"
                        data-tip="Filter zurücksetzen"
                        data-tip-sub="Suche und Filter werden lokal im Browser gespeichert."
                        onClick={() => patch({ search: "", category: "", classSpec: "" })}
                    >
                        Filter zurücksetzen
                    </Button>
                )}
            </div>
            {!sorted.length && <div className="empty">Keine Charaktere gefunden.</div>}
            {groups.map((g) => (
                <div key={g.id}>
                    <div className="hl-linked-head">
                        <strong>{g.label}</strong>
                        <Badge count>{g.chars.length}</Badge>
                    </div>
                    <CharTable chars={g.chars} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            ))}
            {!!ungrouped.length && (
                <div>
                    <div className="hl-linked-head"><strong>Ohne Kategorie</strong><Badge count>{ungrouped.length}</Badge></div>
                    <CharTable chars={ungrouped} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            )}
        </div>
    );
}

export default function HistoryPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // Two ways in: "history" opens the whole page, the narrower "loot" only the
    // loot views (see src/config/permissions.js). Everything below asks this one
    // flag; the server sends the loot-only caller a payload to match, so the
    // hidden views would have nothing to show anyway (apiRoutes/history.js).
    const fullHistory = canAccess(user, "history");
    const canWrite = canAccess(user, "history", "write");
    const areas = fullHistory ? AREAS : AREAS.filter((a) => a.id === "loot");
    const allowedTabs = areas.flatMap((a) => a.views.map((v) => v.id));
    // In the URL (linkable, survives a reload) and remembered on top of that, so
    // coming back via the sidebar re-opens the view that was last used here.
    const [tab, setTab] = usePersistedSearchParam<Tab>("history-tab", "tab", DEFAULT_TAB, allowedTabs);
    const legacyTab = searchParams.get("tab");

    const [data, setData] = useState<HistoryData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const toast = useToast();
    const [stats, setStats] = useState<LootStats | null>(null);
    const [statsError, setStatsError] = useState<ApiError | null>(null);
    // Loaded with the page: the head's count is the only hint that a raid is
    // waiting to be filed, so it has to be there before anyone thinks to look.
    const [inboxCount, setInboxCount] = useState(0);
    const [importOpen, setImportOpen] = useState(legacyTab === LEGACY_IMPORT && canWrite);
    const [guildName, setGuildName] = useState("");

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
        // Skipped without "history": the inbox is not open to that caller, and
        // the call would only earn a 403.
        if (fullHistory) {
            getLootInbox().then((r) => setInboxCount(r.sessions.length)).catch(() => setInboxCount(0));
        }
        // Only refresh the overviews once they have been opened — before that
        // there is nothing on screen that could go stale after an import.
        if (statsRequested.current) loadStats();
    };

    useEffect(load, []);

    // The kicker names the guild whose history this is.
    useEffect(() => {
        getSession()
            .then((s) => setGuildName(s.guilds.find((g) => g.id === s.activeGuildId)?.name || ""))
            .catch(() => setGuildName(""));
    }, []);

    // Fetched on the first visit to one of the overview views, then kept.
    useEffect(() => {
        if (STATS_TABS.includes(tab) && !statsRequested.current) loadStats();
    }, [tab]);

    const afterChange = (msg: string) => {
        toast(msg);
        load();
    };

    // ?tab=inbox from before the inbox became a page.
    if (legacyTab === LEGACY_INBOX && fullHistory) return <Navigate to="/history/inbox" replace />;

    const activeArea = areas.find((a) => a.views.some((v) => v.id === tab)) || areas[0];
    const counts: Partial<Record<Tab, number>> = data ? {
        // No count on "Items": the view hides sharded loot by default, so the
        // raw catalogue size would contradict the number in its own head.
        reasons: stats?.characters.length,
        loot: data.lootEvents.length,
        raids: data.upcomingRaids.events.length + data.pastRaids.events.length,
        logs: data.logs.length,
    } : {};

    const head = (
        <div className="hl-page">
            <PageHead
                icon="inv_misc_bag_10"
                tone="history"
                kicker={guildName || "Gilde"}
                title="Historie & Loot"
                action={(fullHistory || canWrite) ? (
                    <>
                        {fullHistory && (
                            <Button variant="ghost" icon="inv_letter_18" onClick={() => navigate("/history/inbox")}>
                                Addon-Inbox
                                {inboxCount > 0 && <Badge tone="mid" count>{inboxCount} offen</Badge>}
                            </Button>
                        )}
                        {canWrite && (
                            <Button icon="inv_scroll_03" disabled={!data} onClick={() => setImportOpen(true)}>Loot importieren</Button>
                        )}
                    </>
                ) : undefined}
            />
        </div>
    );

    if (error) return <>{head}<div className="empty">Fehler beim Laden: {error.message}</div></>;
    if (!data) return <>{head}<RaidLoader text="Historie wird geladen" /></>;

    return (
        <>
            {head}

            {/* A switch with a single area would say nothing the subnav under it
                doesn't — the loot-only view goes straight to its views. */}
            {areas.length > 1 && (
                <div className="hl-areas">
                    <Segment<AreaId>
                        ariaLabel="Bereich"
                        options={areas.map((a) => ({ value: a.id, label: a.label, icon: a.icon }))}
                        value={activeArea.id}
                        onChange={(id) => setTab((areas.find((a) => a.id === id) || areas[0]).views[0].id)}
                    />
                </div>
            )}
            {activeArea.views.length > 1 && (
                <div className="subnav" role="tablist">
                    {activeArea.views.map((v) => {
                        const count = counts[v.id];
                        return (
                            <button key={v.id} type="button" className={`subnav-item${tab === v.id ? " active" : ""}`} role="tab" aria-selected={tab === v.id} onClick={() => setTab(v.id)}>
                                {v.label}
                                {!!count && <span className="subnav-count">{count}</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            {tab === "raids" && (
                <>
                    <div className="dash-card hl-card">
                        <PartHead icon="inv_misc_note_02" tone="history" title="Kommende Raids" crumb="Raids & Logs › Raids" action={<Badge count>{data.upcomingRaids.events.length}</Badge>} />
                        <RaidTable events={data.upcomingRaids.events} guildId={data.activeGuildId} error={data.upcomingRaids.error} emptyMessage="Keine anstehenden Raids gefunden." sortKey="raids-upcoming-sort" initialDir="asc" />
                    </div>
                    <div className="dash-card hl-card">
                        <PartHead icon="inv_misc_note_02" tone="history" title="Vergangene Raids" crumb="Raids & Logs › Raids" action={<Badge count>{data.pastRaids.events.length}</Badge>} />
                        <RaidTable events={data.pastRaids.events} guildId={data.activeGuildId} error={data.pastRaids.error} emptyMessage="Keine vergangenen Raids gefunden." sortKey="raids-past-sort" />
                    </div>
                </>
            )}
            {tab === "loot" && (
                <LootEventsTab
                    lootEvents={data.lootEvents} categories={data.categories} csrfToken={csrfToken}
                    onChanged={afterChange} canEdit={canAccess(user, "history", "write")}
                />
            )}
            {/* Fetches its own page of awards — see LatestLootTab. */}
            {tab === "awards" && <LatestLootTab categories={data.categories} />}
            {STATS_TABS.includes(tab) && (
                statsError
                    ? <div className="empty">Fehler beim Laden: {statsError.message}</div>
                    : !stats
                        ? <RaidLoader compact text="Übersicht wird geladen" />
                        : tab === "reasons"
                            ? <LootReasonsTab characters={stats.characters} reasons={stats.reasons} categories={data.categories} contents={stats.contents} />
                            : (
                                <LootItemsTab
                                    items={stats.items}
                                    contents={stats.contents}
                                    tiers={stats.tiers}
                                    reasons={stats.reasons}
                                    categories={data.categories}
                                    unknownContentCount={stats.unknownContentCount}
                                    canEdit={canWrite}
                                    csrfToken={csrfToken}
                                    onChanged={afterChange}
                                />
                            )
            )}
            {tab === "logs" && <LogsTab logs={data.logs} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "chars" && <CharactersTab chars={data.chars} categories={data.categories} csrfToken={csrfToken} onChanged={afterChange} />}

            {canWrite && (
                <ImportLootDialog
                    open={importOpen}
                    onClose={() => { setImportOpen(false); if (legacyTab === LEGACY_IMPORT) setTab(DEFAULT_TAB); }}
                    data={data}
                    csrfToken={csrfToken}
                    onImported={afterChange}
                />
            )}
        </>
    );
}
