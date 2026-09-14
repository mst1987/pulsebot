// "Gründe": what every raider got and why, split by the normalized award reason
// (Mainspec, Offspec, PvP, …). One row per raider, the reasons as one stacked
// bar in their colours — so "he only ever takes mainspec" or "half her loot was
// offspec" is a glance, not a count — and a chip per reason that opens the
// items behind it.
//
// The reason catalog, its labels and its colours all come from the server
// (utils/lootReasons.js); this file only lays them out.
import { useMemo, useState } from "react";
import type { CharReasonRow, LootContent, LootReason, Category } from "../api";
import { usePersistedState } from "../lib/persistedState";
import { sortRows, type Dir } from "../lib/tableSort";
import { SortLabel, ariaSort } from "./SortTh";
import { PartHead } from "./ui/PartHead";
import Badge from "./ui/Badge";
import Bar from "./ui/Bar";
import { ReasonBadge, ReasonBadgeButton, RaiderBadge, StackBar } from "./LootBadges";
import { ActiveFilters, SearchBox, type ActiveFilter } from "./LootFilters";
import { RaiderReasonDialog } from "./ItemAwardsDialog";

// The reason column sorts by the raider's strongest reason (the chips are laid
// out in that order anyway), so "wer nimmt nur Mainspec" is one click.
type SortKey = "character" | "count" | "reasons";
const SORT_DEFAULTS: Record<SortKey, Dir> = { character: "asc", count: "desc", reasons: "asc" };

type View = { search: string; reason: string; category: string; sort: SortKey; dir: Dir };
const VIEW_DEFAULT: View = { search: "", reason: "", category: "", sort: "count", dir: "desc" };

function sortValue(c: CharReasonRow, key: SortKey): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "count": return c.count;
        // `order` is the reason catalog's rank (0 = BiS); the buckets arrive
        // sorted by it, so the first one is the strongest. A raider without any
        // bucket can't happen, but sorts last rather than first if it does.
        case "reasons": return c.reasons[0]?.order ?? 99;
        default: return "";
    }
}

export function LootReasonsTab({ characters, reasons, categories, contents }: {
    characters: CharReasonRow[];
    reasons: LootReason[];
    categories: Category[];
    contents: LootContent[];
}) {
    const [view, setView] = usePersistedState<View>("history-reasons-view", VIEW_DEFAULT);
    // The raider and reason whose items the dialog shows.
    const [openBucket, setOpenBucket] = useState<{ key: string; reason: string } | null>(null);
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
    const maxCount = sorted.reduce((m, c) => Math.max(m, c.count), 0);
    const totalItems = characters.reduce((n, c) => n + c.count, 0);

    const active: ActiveFilter[] = view.category
        ? [{ key: "category", label: categoryNameById.get(view.category) || view.category, tone: "accent", onRemove: () => patch({ category: "" }) }]
        : [];

    const openRaider = openBucket ? characters.find((c) => c.key === openBucket.key) || null : null;
    const bucket = openRaider?.reasons.find((b) => b.reason === openBucket?.reason) || null;

    const head = (
        <PartHead
            icon="inv_misc_book_09" tone="history" title="Gründe" crumb="Loot › Gründe"
            tip="Gründe" tipSub="Je Raider, wofür er Items bekommen hat. Die Gründe stammen aus dem RCLootcouncil-/Gargul-Export."
            action={characters.length ? (
                <>
                    <Badge count>{characters.length} Raider</Badge>
                    <Badge tone="accent" count>{totalItems} Items</Badge>
                </>
            ) : undefined}
        />
    );

    if (!characters.length) {
        return (
            <div className="dash-card hl-card">
                {head}
                <div className="empty">Noch kein Loot importiert — die Gründe stammen aus dem RCLootcouncil-/Gargul-Export.</div>
            </div>
        );
    }

    return (
        <div className="dash-card hl-card">
            {head}
            <div className="filter-bar hl-filters">
                <SearchBox id="reasons-search" value={view.search} onChange={(search) => patch({ search })} placeholder="Charaktername …" />
                <select id="reasons-reason" className="hl-sel" aria-label="Grund" value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                    <option value="">Alle Gründe</option>
                    {totals.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {categoryOptions.length > 1 && (
                    <select id="reasons-category" className="hl-sel" aria-label="Kategorie" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                        <option value="">Alle Kategorien</option>
                        {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                )}
                <div className="badge-row" style={{ marginLeft: "auto" }}>
                    {totals.map((r) => <ReasonBadge key={r.id} label={r.label} tone={r.tone} count={r.count} />)}
                </div>
            </div>
            <ActiveFilters filters={active} />

            {!sorted.length
                ? <div className="empty">Keine Raider für diese Filter.</div>
                : (
                    <>
                        <div className="hl-grid reasons hl-th" role="row">
                            <span role="columnheader" aria-sort={ariaSort("character", sort, dir)}>
                                <SortLabel sortKey="character" label="Raider" sort={sort} dir={dir} onSort={onSort} />
                            </span>
                            <span role="columnheader" aria-sort={ariaSort("count", sort, dir)} className="hl-col-opt">
                                <SortLabel sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} tip="Items" tipSub="Alle Items des Raiders; der Balken misst gegen den Raider mit den meisten." />
                            </span>
                            <span role="columnheader" aria-sort={ariaSort("reasons", sort, dir)} className="hl-col-opt">
                                <SortLabel sortKey="reasons" label="Anteile" sort={sort} dir={dir} onSort={onSort} tip="Anteile" tipSub="Die Items nach Grund, in den Farben der Gründe. Sortiert nach dem stärksten Grund des Raiders." />
                            </span>
                            <span role="columnheader" className="tipped" data-tip="Gründe" data-tip-sub="Klick auf einen Grund zeigt die Items dahinter.">Gründe</span>
                        </div>
                        {sorted.map((c) => {
                            const parts = c.reasons.map((b) => ({ id: b.reason, label: b.label, reasonLabel: b.reasonLabel, tone: b.tone, count: b.count, order: b.order }));
                            const specLabel = c.className ? (c.spec ? `${c.spec} ${c.className}` : c.className) : "";
                            return (
                                <div className="hl-grid reasons" key={c.key}>
                                    <span className="hl-raider">
                                        <span><RaiderBadge character={c.character} classColor={c.classColor} iconUrl={c.iconUrl} className={c.className} spec={c.spec} /></span>
                                        {specLabel && <span className="spec">{specLabel}</span>}
                                    </span>
                                    <span className="hl-col-opt"><Bar value={c.count} max={maxCount} label={c.count} /></span>
                                    <span className="hl-col-opt"><StackBar parts={parts} size="mid" /></span>
                                    <div className="badge-row">
                                        {c.reasons.map((b) => (
                                            <ReasonBadgeButton
                                                key={b.reason} label={b.label} reasonLabel={b.reasonLabel} tone={b.tone} count={b.count}
                                                onOpen={() => setOpenBucket({ key: c.key, reason: b.reason })}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}

            <RaiderReasonDialog raider={openRaider} bucket={bucket} contents={contents} onClose={() => setOpenBucket(null)} />
        </div>
    );
}
