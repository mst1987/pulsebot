// The roster: every known character of the guild, grouped by the raid category
// it belongs to (Discord category = one recurring raid series, e.g.
// "Montagsraid", "Pug"). A character raiding under several categories shows up
// in each group.
//
// Each row answers the three questions a raid lead has before an invite,
// without leaving the page: where is the char on Warcraft Logs, what was wrong
// with its gear last time, and what did it already get. Details (live gear,
// full loot history) are one click away on the character page.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getRoster, type ApiError, type CharGearReport, type RosterChar, type RosterData } from "../api";
import { fmtMs } from "../lib/format";
import { usePersistedState } from "../lib/persistedState";
import { ClassSpecCell } from "../components/ClassSpec";
import { CharLootHover } from "../components/CharLootHover";
import { HoverPanel } from "../components/HoverPanel";

type SortKey = "character" | "classSpec" | "issues" | "loot";
type Dir = "asc" | "desc";

const SORT_DEFAULTS: Record<SortKey, Dir> = { character: "asc", classSpec: "asc", issues: "desc", loot: "desc" };

// Search/filter/sort survive a reload and a visit to another page. Stored
// values are untrusted: a sort key from an older build falls back to the
// default instead of sorting by nothing.
type View = { search: string; category: string; classSpec: string; onlyIssues: boolean; sort: SortKey; dir: Dir };
const VIEW_DEFAULT: View = { search: "", category: "", classSpec: "", onlyIssues: false, sort: "character", dir: "asc" };

function sortValue(c: RosterChar, key: SortKey): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "classSpec": return `${c.className} ${c.spec}`.toLowerCase().trim();
        case "issues": return c.gear ? c.gear.issueCount : -1;
        case "loot": return c.lootCount;
        default: return "";
    }
}

function SortTh({ sortKey, label, sort, dir, onSort }: {
    sortKey: SortKey;
    label: string;
    sort: SortKey;
    dir: Dir;
    onSort: (key: SortKey) => void;
}) {
    const active = sort === sortKey;
    return (
        <th>
            <button type="button" className={`sort-link${active ? " active" : ""}`} onClick={() => onSort(sortKey)}>
                {label}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
        </th>
    );
}

// The gear issues of the character's latest evaluation, behind the issue count.
// "0" is a result too (evaluated, nothing found) and reads differently from
// "—" (never evaluated / not in any of the stored reports), so both are shown.
function GearIssuesCell({ gear }: { gear: CharGearReport | null }) {
    if (!gear) return <span className="sub" title="In keiner der letzten Auswertungen enthalten">—</span>;
    const when = gear.generatedAt ? fmtMs(gear.generatedAt, false) : "";
    if (!gear.issueCount) {
        return <span className="lbadge lbadge-ok" title={`Ohne Befund${when ? ` — Auswertung vom ${when}` : ""}`}>✓</span>;
    }
    const high = gear.issues.filter((i) => i.severity === "high").length;
    return (
        <HoverPanel
            className={high ? "loot-pop-trigger-high" : "loot-pop-trigger-warn"}
            trigger={gear.issueCount}
            head={
                <>
                    {gear.issueCount} Gear-Problem{gear.issueCount === 1 ? "" : "e"}
                    {when ? ` · ${when}` : ""}
                </>
            }
        >
            {gear.issues.map((issue, i) => (
                <div className="loot-pop-row" key={`${issue.itemId}-${issue.kind}-${i}`}>
                    {issue.iconUrl
                        ? <img className="loot-pop-ico" src={issue.iconUrl} alt="" loading="lazy" />
                        : <span className="loot-pop-ico loot-pop-ico-ph" />}
                    <div className="loot-pop-body">
                        <div className="loot-pop-name" title={issue.itemName}>{issue.itemName || "—"}</div>
                        <div className="loot-pop-meta">
                            <span className={`lbadge${issue.severity === "high" ? " lbadge-warn" : ""}`}>{issue.label}</span>
                        </div>
                    </div>
                </div>
            ))}
            <div className="loot-pop-row" style={{ justifyContent: "flex-end", gap: 10 }}>
                {!!gear.reportRefId && (
                    <a className="mlink small" href={`/r/${gear.reportRefId}`} target="_blank" rel="noopener noreferrer">
                        Auswertung ↗
                    </a>
                )}
                {!!gear.reportUrl && (
                    <a className="mlink small" href={gear.reportUrl} target="_blank" rel="noopener noreferrer">
                        Log ↗
                    </a>
                )}
            </div>
        </HoverPanel>
    );
}

function RosterTable({ chars, categoryNameById, sort, dir, onSort }: {
    chars: RosterChar[];
    categoryNameById: Map<string, string>;
    sort: SortKey;
    dir: Dir;
    onSort: (key: SortKey) => void;
}) {
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="classSpec" label="Klasse & Spec" sort={sort} dir={dir} onSort={onSort} />
                    <th>Kategorie</th>
                    <SortTh sortKey="issues" label="Gear-Issues" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="loot" label="Loot" sort={sort} dir={dir} onSort={onSort} />
                    <th>Links</th>
                </tr>
            </thead>
            <tbody>
                {chars.map((c) => (
                    <tr key={c.key}>
                        <td>
                            <Link className="mlink" to={`/roster/char?name=${encodeURIComponent(c.character)}`} style={{ color: c.classColor || undefined }}>
                                {c.character}
                            </Link>
                            {!c.assigned && !!c.lootCount && (
                                <span className="lbadge lbadge-neutral" style={{ marginLeft: 6 }} title="Nur aus dem Loot bekannt — noch keinem Raider in dieser Kategorie zugeordnet">
                                    aus Loot
                                </span>
                            )}
                        </td>
                        <td><ClassSpecCell className={c.className} spec={c.spec} classColor={c.classColor} iconUrl={c.iconUrl} /></td>
                        <td className="small">
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {c.categoryIds.length
                                    ? c.categoryIds.map((id) => <span key={id} className="lbadge lbadge-neutral">{categoryNameById.get(id) || id}</span>)
                                    : <span className="sub">—</span>}
                            </div>
                        </td>
                        <td className="small"><GearIssuesCell gear={c.gear} /></td>
                        <td className="small">
                            <CharLootHover
                                items={c.items || []}
                                count={c.lootCount}
                                categoryNameById={categoryNameById}
                                showCategory={c.categoryIds.length > 1}
                            />
                        </td>
                        <td className="small">
                            <div className="row-actions" style={{ gap: 6 }}>
                                {!!c.wclUrl && <a className="btn btn-ghost btn-sm" href={c.wclUrl} target="_blank" rel="noopener noreferrer" title="Warcraft Logs">WCL ↗</a>}
                                {!!c.armoryUrl && <a className="btn btn-ghost btn-sm" href={c.armoryUrl} target="_blank" rel="noopener noreferrer" title="Armory">Armory ↗</a>}
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function RosterPage() {
    const [data, setData] = useState<RosterData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [view, setView] = usePersistedState<View>("roster-view", VIEW_DEFAULT);

    useEffect(() => {
        getRoster().then(setData).catch((err: ApiError) => setError(err));
    }, []);

    const chars = data?.chars || [];
    const categories = data?.categories || [];

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

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    const sort: SortKey = SORT_DEFAULTS[view.sort] ? view.sort : VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "desc" ? "desc" : "asc";
    const patch = (p: Partial<View>) => setView((v) => ({ ...v, ...p }));
    const onSort = (key: SortKey) => {
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: SORT_DEFAULTS[key] });
    };

    const searchLower = view.search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (view.category && !c.categoryIds.includes(view.category)) return false;
        if (view.classSpec && `${c.className}||${c.spec}` !== view.classSpec) return false;
        if (view.onlyIssues && !(c.gear && c.gear.issueCount)) return false;
        return true;
    });

    const mul = dir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
        const va = sortValue(a, sort);
        const vb = sortValue(b, sort);
        if (va < vb) return -1 * mul;
        if (va > vb) return 1 * mul;
        return a.character.localeCompare(b.character);
    });

    // Grouping and filtering by category are the same mechanism: picking one
    // just narrows the groups down to it.
    const groups = categoryOptions
        .filter((o) => !view.category || o.id === view.category)
        .map((o) => ({ ...o, chars: sorted.filter((c) => c.categoryIds.includes(o.id)) }))
        .filter((g) => g.chars.length);
    const ungrouped = sorted.filter((c) => !c.categoryIds.length);

    const hasFilters = !!(view.search || view.category || view.classSpec || view.onlyIssues);
    const withIssues = chars.filter((c) => c.gear && c.gear.issueCount).length;

    return (
        <>
            <h1 className="page-title">Roster</h1>
            <p className="note">
                Alle Charaktere je Raid-Kategorie — mit Warcraft-Logs-Link, den Gear-Problemen aus der letzten
                Auswertung und dem erhaltenen Loot im Tooltip. Wer welchen Char in welchem Raid spielt, wird
                im Raid-Detail unter „Anwesenheit" zugeordnet; zusätzlich zählt jeder Raid, in dem ein Char Loot bekommen hat.
            </p>

            <div className="dash-card">
                <div className="dash-card-head">
                    <h3>Charaktere</h3>
                    <span className="small" style={{ marginLeft: "auto" }}>
                        {chars.length} Charakter(e){withIssues ? ` · ${withIssues} mit Gear-Problemen` : ""}
                    </span>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                    <div className="field" style={{ margin: 0, minWidth: 220 }}>
                        <label htmlFor="roster-search">Suche</label>
                        <input
                            id="roster-search"
                            type="text"
                            placeholder="Charaktername …"
                            value={view.search}
                            onChange={(e) => patch({ search: e.target.value })}
                        />
                    </div>
                    <div className="field" style={{ margin: 0, minWidth: 180 }}>
                        <label htmlFor="roster-category">Kategorie</label>
                        <select id="roster-category" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                            <option value="">Alle Kategorien</option>
                            {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="field" style={{ margin: 0, minWidth: 180 }}>
                        <label htmlFor="roster-class">Klasse & Spec</label>
                        <select id="roster-class" value={view.classSpec} onChange={(e) => patch({ classSpec: e.target.value })}>
                            <option value="">Alle Klassen</option>
                            {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="field" style={{ margin: 0, justifyContent: "flex-end" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <input
                                type="checkbox"
                                checked={view.onlyIssues}
                                onChange={(e) => patch({ onlyIssues: e.target.checked })}
                            />
                            Nur mit Gear-Problemen
                        </label>
                    </div>
                    {hasFilters && (
                        <div className="field" style={{ margin: 0, justifyContent: "flex-end" }}>
                            <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                title="Suche und Filter zurücksetzen (werden lokal im Browser gespeichert)"
                                onClick={() => patch({ search: "", category: "", classSpec: "", onlyIssues: false })}
                            >
                                Filter zurücksetzen
                            </button>
                        </div>
                    )}
                </div>
                {!chars.length && (
                    <p className="sub" style={{ padding: "0 16px 14px" }}>
                        Noch keine Charaktere bekannt — Loot importieren oder im Raid-Detail Raider ihren Chars zuordnen.
                    </p>
                )}
                {!!chars.length && !sorted.length && <p className="sub" style={{ padding: "0 16px 14px" }}>Keine Charaktere gefunden.</p>}
                {groups.map((g) => (
                    <div key={g.id} style={{ marginBottom: 10 }}>
                        <div className="dash-card-head" style={{ padding: "8px 16px" }}>
                            <strong>{g.label}</strong>
                            <span className="tab-count">{g.chars.length}</span>
                        </div>
                        <RosterTable chars={g.chars} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                    </div>
                ))}
                {!!ungrouped.length && (
                    <div>
                        <div className="dash-card-head" style={{ padding: "8px 16px" }}>
                            <strong>Ohne Kategorie</strong>
                            <span className="tab-count">{ungrouped.length}</span>
                        </div>
                        <RosterTable chars={ungrouped} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                    </div>
                )}
            </div>
        </>
    );
}
