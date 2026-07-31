// "Items": every piece that was ever looted, once per item, with everyone who
// received it as a class-coloured badge — hovering a badge says when, in which
// raid and for what reason they got it.
//
// Filterable by content (Gruul, SSC, TK, …) and by tier, both resolved from the
// item id on the server (config/tbcContent.js), so a Gargul export — which
// carries nothing but that id — filters exactly like an RCLootcouncil one.
import { useMemo } from "react";
import type { LootCatalogItem, LootContent, LootReason, LootTier } from "../api";
import { fmtMs } from "../lib/format";
import { usePersistedState } from "../lib/persistedState";
import { AwardBadge } from "./LootBadges";

type SortKey = "item" | "content" | "count" | "time";
type Dir = "asc" | "desc";
const SORT_DEFAULTS: Record<SortKey, Dir> = { item: "asc", content: "asc", count: "desc", time: "desc" };

type View = { search: string; content: string; tier: string; reason: string; tokensOnly: boolean; sort: SortKey; dir: Dir };
const VIEW_DEFAULT: View = { search: "", content: "", tier: "", reason: "", tokensOnly: false, sort: "count", dir: "desc" };

// The bucket for items the content table doesn't know (a world drop, a badge
// item, a raid added in a later patch). Never silently filed into a raid — an
// own filter value so they can be found and the table fixed.
const UNKNOWN = "__unknown__";

function SortTh({ sortKey, label, sort, dir, onSort }: {
    sortKey: SortKey; label: string; sort: SortKey; dir: Dir; onSort: (k: SortKey) => void;
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

export function LootItemsTab({ items, contents, tiers, reasons, unknownContentCount }: {
    items: LootCatalogItem[];
    contents: LootContent[];
    tiers: LootTier[];
    reasons: LootReason[];
    unknownContentCount: number;
}) {
    const [view, setView] = usePersistedState<View>("history-items-view", VIEW_DEFAULT);
    const sort: SortKey = SORT_DEFAULTS[view.sort] ? view.sort : VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    const patch = (p: Partial<View>) => setView((v) => ({ ...v, ...p }));

    const onSort = (key: SortKey) => {
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: SORT_DEFAULTS[key] });
    };

    const contentById = useMemo(() => new Map(contents.map((c) => [c.id, c])), [contents]);

    // The content dropdown follows the tier filter, so picking "Tier 5" and then
    // a Tier-4 raid can't produce an empty table.
    const contentOptions = view.tier ? contents.filter((c) => c.tier === view.tier) : contents;
    const reasonOptions = useMemo(() => {
        const used = new Set(items.flatMap((i) => i.awards.map((a) => a.reason)));
        return reasons.filter((r) => used.has(r.id));
    }, [items, reasons]);

    const searchLower = view.search.trim().toLowerCase();
    const filtered = items.filter((it) => {
        if (searchLower) {
            const name = (it.itemName || `Item ${it.itemId}`).toLowerCase();
            if (!name.includes(searchLower) && String(it.itemId) !== searchLower) return false;
        }
        if (view.content === UNKNOWN ? !!it.contentId : view.content && it.contentId !== view.content) return false;
        if (view.tier && it.tier !== view.tier) return false;
        if (view.tokensOnly && !it.tokenTier) return false;
        if (view.reason && !it.awards.some((a) => a.reason === view.reason)) return false;
        return true;
    });

    const mul = dir === "asc" ? 1 : -1;
    const sorted = useMemo(() => {
        const value = (it: LootCatalogItem): string | number => {
            switch (sort) {
                case "item": return (it.itemName || `Item ${it.itemId}`).toLowerCase();
                case "content": return (contentById.get(it.contentId)?.label || "zzz").toLowerCase();
                case "count": return it.count;
                case "time": return it.lastAwardedAt;
                default: return "";
            }
        };
        return [...filtered].sort((a, b) => {
            const va = value(a);
            const vb = value(b);
            if (va < vb) return -1 * mul;
            if (va > vb) return 1 * mul;
            return 0;
        });
    }, [filtered, sort, mul, contentById]);

    const hasFilters = !!(view.search || view.content || view.tier || view.reason || view.tokensOnly);
    const awardCount = sorted.reduce((n, i) => n + i.count, 0);

    if (!items.length) return <p className="sub">Noch kein Loot importiert.</p>;

    return (
        <div className="dash-card">
            <div className="dash-card-head">
                <h3>Items</h3>
                <span className="small" style={{ marginLeft: "auto" }}>{sorted.length} Item(s) · {awardCount} Vergabe(n)</span>
            </div>
            <div className="filter-bar">
                <div className="field" style={{ minWidth: 220 }}>
                    <label htmlFor="items-search">Suche</label>
                    <input id="items-search" type="text" placeholder="Itemname oder ID …" value={view.search} onChange={(e) => patch({ search: e.target.value })} />
                </div>
                <div className="field" style={{ minWidth: 150 }}>
                    <label htmlFor="items-tier">Tier</label>
                    <select
                        id="items-tier"
                        value={view.tier}
                        onChange={(e) => {
                            const tier = e.target.value;
                            // A content pick from another tier would contradict
                            // the new tier filter — drop it instead of showing
                            // an empty table.
                            const keepContent = !tier || (view.content !== UNKNOWN && contentById.get(view.content)?.tier === tier);
                            patch({ tier, content: keepContent ? view.content : "" });
                        }}
                    >
                        <option value="">Alle Tiers</option>
                        {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
                <div className="field" style={{ minWidth: 200 }}>
                    <label htmlFor="items-content">Content</label>
                    <select id="items-content" value={view.content} onChange={(e) => patch({ content: e.target.value })}>
                        <option value="">Alle Raids</option>
                        {contentOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        {!!unknownContentCount && !view.tier && <option value={UNKNOWN}>Unbekannt ({unknownContentCount})</option>}
                    </select>
                </div>
                <div className="field" style={{ minWidth: 170 }}>
                    <label htmlFor="items-reason">Grund</label>
                    <select id="items-reason" value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                        <option value="">Alle Gründe</option>
                        {reasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label>
                        <input type="checkbox" checked={view.tokensOnly} onChange={(e) => patch({ tokensOnly: e.target.checked })} />
                        Nur Tier-Token
                    </label>
                </div>
                {hasFilters && (
                    <div className="field">
                        <button className="btn btn-ghost" type="button" onClick={() => patch({ search: "", content: "", tier: "", reason: "", tokensOnly: false })}>
                            Filter zurücksetzen
                        </button>
                    </div>
                )}
            </div>
            {!sorted.length
                ? <p className="sub" style={{ padding: "0 16px 14px" }}>Keine Items für diese Filter.</p>
                : (
                    <table className="idx loot-table" style={{ margin: 0 }}>
                        <thead>
                            <tr>
                                <SortTh sortKey="item" label="Item" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="content" label="Content" sort={sort} dir={dir} onSort={onSort} />
                                <th>Boss</th>
                                <SortTh sortKey="count" label="Vergaben" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="time" label="Zuletzt" sort={sort} dir={dir} onSort={onSort} />
                                <th>Erhalten von (Hover zeigt Raid & Grund)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((it) => {
                                const content = contentById.get(it.contentId);
                                return (
                                    <tr key={it.itemId}>
                                        <td>
                                            {it.itemIconUrl && <img className="loot-ico" src={it.itemIconUrl} alt="" loading="lazy" />}
                                            {it.itemLink
                                                ? <a className="mlink" href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                                : (it.itemName || `Item ${it.itemId}`)}
                                            {!!it.tokenTier && (
                                                <span className="lbadge lbadge-neutral" style={{ marginLeft: 8 }} title="Tier-Set-Token — die Rüstung selbst wird beim Händler eingetauscht und taucht in keinem Export auf">
                                                    {it.tokenTier.toUpperCase()}-Token
                                                </span>
                                            )}
                                        </td>
                                        <td className="small">
                                            {content
                                                ? <span className="lbadge lbadge-neutral" title={content.label}>{content.short}</span>
                                                : <span className="sub" title="Nicht in der Content-Tabelle — siehe scripts/fetch-tbc-loot.js">unbekannt</span>}
                                        </td>
                                        <td className="small">{it.boss || ""}</td>
                                        <td className="small">{it.count}</td>
                                        <td className="small">{fmtMs(it.lastAwardedAt, false)}</td>
                                        <td>
                                            <div className="badge-row">
                                                {it.awards.map((a, i) => <AwardBadge key={`${a.characterKey}-${a.awardedAt}-${i}`} award={a} />)}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
        </div>
    );
}
