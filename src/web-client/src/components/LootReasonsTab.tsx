// "Loot-Gründe": what every raider got and why, split by the normalized award
// reason (Mainspec, Offspec, PvP, …). One row per raider, one colour-coded
// badge per reason, and the items behind a badge on hover — so "he only ever
// takes mainspec" or "half her loot was offspec" is a glance, not a count.
//
// The reason catalog, its labels and its colours all come from the server
// (utils/lootReasons.js); this file only lays them out.
import { useMemo } from "react";
import type { CharReasonRow, LootReason, Category } from "../api";
import { usePersistedState } from "../lib/persistedState";
import { sortRows, type Dir } from "../lib/tableSort";
import { ClassSpecCell } from "./ClassSpec";
import { SortTh } from "./SortTh";
import { ReasonBadge, ReasonBadgeHover, RaiderBadge } from "./LootBadges";

// The badge column sorts by the raider's strongest reason (the badges are laid
// out in that order anyway), so "wer nimmt nur Mainspec" is one click.
type SortKey = "character" | "classSpec" | "count" | "reasons";
const SORT_DEFAULTS: Record<SortKey, Dir> = { character: "asc", classSpec: "asc", count: "desc", reasons: "asc" };

type View = { search: string; reason: string; category: string; sort: SortKey; dir: Dir };
const VIEW_DEFAULT: View = { search: "", reason: "", category: "", sort: "count", dir: "desc" };

function sortValue(c: CharReasonRow, key: SortKey): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "classSpec": return `${c.className} ${c.spec}`.toLowerCase().trim();
        case "count": return c.count;
        // `order` is the reason catalog's rank (0 = BiS); the buckets arrive
        // sorted by it, so the first one is the strongest. A raider without any
        // bucket can't happen, but sorts last rather than first if it does.
        case "reasons": return c.reasons[0]?.order ?? 99;
        default: return "";
    }
}

export function LootReasonsTab({ characters, reasons, categories }: {
    characters: CharReasonRow[];
    reasons: LootReason[];
    categories: Category[];
}) {
    const [view, setView] = usePersistedState<View>("history-reasons-view", VIEW_DEFAULT);
    const sort: SortKey = SORT_DEFAULTS[view.sort] ? view.sort : VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    const patch = (p: Partial<View>) => setView((v) => ({ ...v, ...p }));

    const onSort = (key: SortKey) => {
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: SORT_DEFAULTS[key] });
    };

    const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

    // Guild-wide totals per reason, in the catalog's order. Only reasons that
    // actually occur get a chip — an empty "Bank 0" says nothing.
    const totals = useMemo(() => {
        const byReason = new Map<string, number>();
        for (const c of characters) for (const b of c.reasons) byReason.set(b.reason, (byReason.get(b.reason) || 0) + b.count);
        return reasons
            .filter((r) => byReason.get(r.id))
            .map((r) => ({ ...r, count: byReason.get(r.id) || 0 }));
    }, [characters, reasons]);

    const categoryOptions = useMemo(() => {
        const ids = new Set<string>();
        for (const c of characters) for (const id of c.categoryIds) ids.add(id);
        return [...ids]
            .map((id) => ({ id, label: categoryNameById.get(id) || id }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [characters, categoryNameById]);

    const searchLower = view.search.trim().toLowerCase();
    const filtered = characters.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (view.reason && !c.reasons.some((b) => b.reason === view.reason)) return false;
        if (view.category && !c.categoryIds.includes(view.category)) return false;
        return true;
    });

    const sorted = sortRows(filtered, (c) => sortValue(c, sort), dir);

    const totalItems = characters.reduce((n, c) => n + c.count, 0);
    const hasFilters = !!(view.search || view.reason || view.category);

    if (!characters.length) return <p className="sub">Noch kein Loot importiert — die Gründe stammen aus dem RCLootcouncil-/Gargul-Export.</p>;

    return (
        <div className="dash-card">
            <div className="dash-card-head">
                <h3>Loot nach Grund</h3>
                <span className="small" style={{ marginLeft: "auto" }}>{characters.length} Raider · {totalItems} Items</span>
            </div>
            <div className="filter-bar" style={{ gap: 6 }}>
                {totals.map((r) => <ReasonBadge key={r.id} label={r.label} tone={r.tone} count={r.count} />)}
            </div>
            <div className="filter-bar">
                <div className="field" style={{ minWidth: 220 }}>
                    <label htmlFor="reasons-search">Suche</label>
                    <input id="reasons-search" type="text" placeholder="Charaktername …" value={view.search} onChange={(e) => patch({ search: e.target.value })} />
                </div>
                <div className="field" style={{ minWidth: 180 }}>
                    <label htmlFor="reasons-reason">Grund</label>
                    <select id="reasons-reason" value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                        <option value="">Alle Gründe</option>
                        {totals.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                </div>
                {categoryOptions.length > 1 && (
                    <div className="field" style={{ minWidth: 180 }}>
                        <label htmlFor="reasons-category">Kategorie</label>
                        <select id="reasons-category" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                            <option value="">Alle Kategorien</option>
                            {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                    </div>
                )}
                {hasFilters && (
                    <div className="field">
                        <button className="btn btn-ghost" type="button" onClick={() => patch({ search: "", reason: "", category: "" })}>
                            Filter zurücksetzen
                        </button>
                    </div>
                )}
            </div>
            {!sorted.length
                ? <p className="sub" style={{ padding: "0 16px 14px" }}>Keine Raider für diese Filter.</p>
                : (
                    <table className="idx" style={{ margin: 0 }}>
                        <thead>
                            <tr>
                                <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="classSpec" label="Klasse & Spec" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh
                                    sortKey="reasons" label="Gründe (Hover zeigt die Items)"
                                    title="Sortiert nach dem stärksten Grund des Raiders"
                                    sort={sort} dir={dir} onSort={onSort}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((c) => (
                                <tr key={c.key}>
                                    <td><RaiderBadge character={c.character} classColor={c.classColor} iconUrl={c.iconUrl} /></td>
                                    <td><ClassSpecCell className={c.className} spec={c.spec} classColor={c.classColor} iconUrl={c.iconUrl} /></td>
                                    <td className="small">{c.count}</td>
                                    <td>
                                        <div className="badge-row">
                                            {c.reasons.map((b) => (
                                                <ReasonBadgeHover key={b.reason} label={b.label} reasonLabel={b.reasonLabel} tone={b.tone} count={b.count} items={b.items} />
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
        </div>
    );
}
