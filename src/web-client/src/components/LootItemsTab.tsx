// "Items": every piece that was ever looted, once per item — how often it went
// out, for which reasons, and to whom. A click on the row opens the item's
// dialog with every award (who, when, from which raid, why).
//
// Filterable by raid (Gruul, SSC, TK, …) and by tier, both resolved from the item
// id on the server (config/tbcContent.js), so a Gargul export — which carries
// nothing but that id — filters exactly like an RCLootcouncil one, and by raid
// category (Mainraid, Twinkraid, …) like the Gründe view. What was only ever
// sharded is out of the table by default (see DISENCHANT).
import { useMemo, useState } from "react";
import type { Category, LootAward, LootCatalogItem, LootContent, LootReason, LootTier } from "../api";
import { itemQualityProps } from "../lib/itemQuality";
import { usePersistedState } from "../lib/persistedState";
import { sortRows, type Dir } from "../lib/tableSort";
import { SortLabel, ariaSort } from "./SortTh";
import { PartHead } from "./ui/PartHead";
import Badge from "./ui/Badge";
import Bar from "./ui/Bar";
import WowIcon from "./ui/WowIcon";
import { IconButton } from "./ui/Button";
import { ChevronRightIcon } from "./icons";
import Pager from "./Pager";
import { ItemIcon, RaiderChip, StackBar, contentIcon, tallyReasons } from "./LootBadges";
import { ActiveFilters, FilterPopover, RaidChips, SearchBox, SwitchRow, UNKNOWN_CONTENT, type ActiveFilter } from "./LootFilters";
import { ItemAwardsDialog } from "./ItemAwardsDialog";

// The recipient column sorts by the alphabetically first raider in it, which is
// what "sort by that column" can mean for a cell full of names (how many are in
// it is already the Vergaben column).
type SortKey = "item" | "count" | "recipients";
const SORT_DEFAULTS: Record<SortKey, Dir> = { item: "asc", count: "desc", recipients: "asc" };

type View = { search: string; content: string; tier: string; reason: string; category: string; tokensOnly: boolean; hideDisenchanted: boolean; sort: SortKey; dir: Dir };
const VIEW_DEFAULT: View = { search: "", content: "", tier: "", reason: "", category: "", tokensOnly: false, hideDisenchanted: true, sort: "count", dir: "desc" };

// Sharded loot is not loot anybody got — it says nothing about who was equipped
// with what, which is what this table is read for. Hidden by default, and the
// switch brings it back for the rare "wie viel wurde entzaubert" question.
const DISENCHANT = "disenchant";

// Rows per page. The table was one endless list; a page of this size still
// shows a whole raid's loot at once.
const PAGE_SIZE = 50;

// How many recipients are named in the row; the rest is a "+n" badge.
const NAMED_RECIPIENTS = 3;

// Keeps only the awards a filter selected, and drops the items left without
// any. The count travels with them, so the header and the "Vergaben" column
// never state a number the recipient chips don't show.
function narrow(items: LootCatalogItem[], keep: (award: LootAward) => boolean): LootCatalogItem[] {
    return items
        .map((it) => {
            const awards = it.awards.filter(keep);
            return awards.length === it.awards.length ? it : { ...it, awards, count: awards.length };
        })
        .filter((it) => it.count > 0);
}

/** The recipients once each, newest award first. */
function recipients(awards: LootAward[]): LootAward[] {
    const seen = new Set<string>();
    const out: LootAward[] = [];
    for (const a of awards) {
        if (seen.has(a.characterKey)) continue;
        seen.add(a.characterKey);
        out.push(a);
    }
    return out;
}

export function LootItemsTab({ items, contents, tiers, reasons, categories, unknownContentCount, canEdit, onChanged }: {
    items: LootCatalogItem[];
    contents: LootContent[];
    tiers: LootTier[];
    reasons: LootReason[];
    categories: Category[];
    unknownContentCount: number;
    canEdit: boolean;
    onChanged: (msg: string) => void;
}) {
    const [view, setView] = usePersistedState<View>("history-items-view", VIEW_DEFAULT);
    const [pageNo, setPageNo] = useState(1);
    // Which item's dialog is open — by id, so it follows the reloaded list after
    // a delete instead of showing the stale copy.
    const [openItemId, setOpenItemId] = useState(0);
    const sort: SortKey = SORT_DEFAULTS[view.sort] ? view.sort : VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    // A view remembered before this filter existed carries no flag at all — only
    // an explicit false unhides the shards, so the default holds for everyone.
    const hideDisenchanted = view.hideDisenchanted !== false;
    const patch = (p: Partial<View>) => { setView((v) => ({ ...v, ...p })); setPageNo(1); };

    const onSort = (key: SortKey) => {
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: SORT_DEFAULTS[key] });
    };

    const contentById = useMemo(() => new Map(contents.map((c) => [c.id, c])), [contents]);
    const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

    // The raid chips follow the tier filter, so picking "Tier 5" and then a
    // Tier-4 raid can't produce an empty table.
    const contentOptions = view.tier ? contents.filter((c) => c.tier === view.tier) : contents;
    const categoryOptions = useMemo(() => {
        const ids = new Set<string>();
        for (const it of items) for (const id of it.categoryIds) ids.add(id);
        return [...ids]
            .map((id) => ({ id, label: categoryNameById.get(id) || id }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [items, categoryNameById]);

    // Category and reason narrow the awards themselves, not just which items are
    // listed: "wer hat das im Twinkraid als Offspec bekommen" must neither count
    // the other handouts nor show their raiders among the recipients.
    const inCategory = useMemo(() => {
        const byCategory = view.category ? narrow(items, (a) => a.categoryId === view.category) : items;
        return hideDisenchanted ? narrow(byCategory, (a) => a.reason !== DISENCHANT) : byCategory;
    }, [items, view.category, hideDisenchanted]);

    // Offered before the reason narrowing, otherwise picking one would leave its
    // own dropdown with a single entry. Hidden shards are gone from here too —
    // an "Entzaubert" option that can only ever yield an empty table is a trap.
    const reasonOptions = useMemo(() => {
        const used = new Set(inCategory.flatMap((i) => i.awards.map((a) => a.reason)));
        return reasons.filter((r) => used.has(r.id));
    }, [inCategory, reasons]);

    const scoped = useMemo(
        () => (view.reason ? narrow(inCategory, (a) => a.reason === view.reason) : inCategory),
        [inCategory, view.reason],
    );

    const searchLower = view.search.trim().toLowerCase();
    const filtered = scoped.filter((it) => {
        if (searchLower) {
            const name = (it.itemName || `Item ${it.itemId}`).toLowerCase();
            if (!name.includes(searchLower) && String(it.itemId) !== searchLower) return false;
        }
        if (view.content === UNKNOWN_CONTENT ? !!it.contentId : view.content && it.contentId !== view.content) return false;
        if (view.tier && it.tier !== view.tier) return false;
        if (view.tokensOnly && !it.tokenTier) return false;
        return true;
    });

    const sorted = sortRows(filtered, (it) => {
        switch (sort) {
            case "item": return (it.itemName || `Item ${it.itemId}`).toLowerCase();
            case "count": return it.count;
            case "recipients": return it.awards.map((a) => a.character.toLowerCase()).sort()[0] || "zzz";
            default: return "";
        }
    }, dir);

    const awardCount = sorted.reduce((n, i) => n + i.count, 0);
    const maxCount = sorted.reduce((m, i) => Math.max(m, i.count), 0);
    // The server counts the unknown-content items over all loot; once anything
    // narrows the awards, the chip has to say how many are left.
    const unknownCount = view.category || view.reason || hideDisenchanted
        ? scoped.filter((i) => !i.contentId).length
        : unknownContentCount;

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(pageNo, totalPages);
    const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const openItem = openItemId ? items.find((i) => i.itemId === openItemId) || null : null;

    // The rare filters behind the "Filter" button, each removable from the badge
    // row. Hiding the shards is the default, so it is listed as what it is.
    const tierLabel = tiers.find((t) => t.id === view.tier)?.label || view.tier;
    const active: ActiveFilter[] = [
        ...(view.tier ? [{ key: "tier", label: tierLabel, tone: "accent" as const, onRemove: () => patch({ tier: "" }) }] : []),
        ...(view.category ? [{ key: "category", label: categoryNameById.get(view.category) || view.category, tone: "accent" as const, onRemove: () => patch({ category: "" }) }] : []),
        ...(view.tokensOnly ? [{ key: "tokens", label: "Nur Tier-Token", tone: "accent" as const, onRemove: () => patch({ tokensOnly: false }) }] : []),
        ...(hideDisenchanted ? [{ key: "de", label: "Entzaubertes ausgeblendet", onRemove: () => patch({ hideDisenchanted: false }) }] : []),
    ];
    const popoverCount = (view.tier ? 1 : 0) + (view.category ? 1 : 0) + (view.tokensOnly ? 1 : 0) + (hideDisenchanted ? 1 : 0);
    const sortLabel = sort === "count" ? "Vergaben" : sort === "item" ? "Item" : "Empfänger";

    if (!items.length) {
        return (
            <div className="dash-card hl-card">
                <PartHead icon="inv_misc_bag_10" tone="history" title="Items" crumb="Loot › Items" />
                <div className="empty">Noch kein Loot importiert.</div>
            </div>
        );
    }

    return (
        <div className="dash-card hl-card">
            <PartHead
                icon="inv_misc_bag_10" tone="history" title="Items" crumb="Loot › Items"
                tip="Items" tipSub="Jedes Item einmal, mit allen Vergaben. Klick auf eine Zeile zeigt, wer es wann und warum bekommen hat."
                action={(
                    <>
                        <Badge count>{sorted.length} Items</Badge>
                        <Badge tone="accent" count>{awardCount} Vergaben</Badge>
                    </>
                )}
            />
            <div className="filter-bar hl-filters">
                <SearchBox id="items-search" value={view.search} onChange={(search) => patch({ search })} placeholder="Item oder ID …" />
                <RaidChips contents={contentOptions} value={view.content} onChange={(content) => patch({ content })} unknownCount={view.tier ? 0 : unknownCount} />
                <select id="items-reason" className="hl-sel" aria-label="Grund" value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                    <option value="">Alle Gründe</option>
                    {reasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <FilterPopover active={popoverCount}>
                    <div>
                        <label className="hl-lbl" htmlFor="items-tier">Tier</label>
                        <select
                            id="items-tier"
                            value={view.tier}
                            onChange={(e) => {
                                const tier = e.target.value;
                                // A raid pick from another tier would contradict
                                // the new tier filter — drop it instead of showing
                                // an empty table.
                                const keepContent = !tier || (view.content !== UNKNOWN_CONTENT && contentById.get(view.content)?.tier === tier);
                                patch({ tier, content: keepContent ? view.content : "" });
                            }}
                        >
                            <option value="">Alle Tiers</option>
                            {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                    </div>
                    {categoryOptions.length > 1 && (
                        <div>
                            <label className="hl-lbl" htmlFor="items-category">Kategorie</label>
                            <select id="items-category" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                                <option value="">Alle Kategorien</option>
                                {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                        </div>
                    )}
                    <SwitchRow checked={view.tokensOnly} onChange={(tokensOnly) => patch({ tokensOnly })} label="Nur Tier-Token" />
                    <SwitchRow
                        checked={hideDisenchanted}
                        tip="Items, die niemand bekommen hat, sondern entzaubert wurden"
                        label="Entzaubertes ausblenden"
                        onChange={(hide) => {
                            // Hiding the shards while "Entzaubert" is the picked
                            // reason would leave an empty table with no visible
                            // cause — drop the pick with them.
                            const reason = hide && view.reason === DISENCHANT ? "" : view.reason;
                            patch({ hideDisenchanted: hide, reason });
                        }}
                    />
                </FilterPopover>
            </div>
            <ActiveFilters
                filters={active}
                onReset={() => patch({ search: "", content: "", tier: "", reason: "", category: "", tokensOnly: false, hideDisenchanted: true })}
            />

            {!sorted.length
                ? <div className="empty">Keine Items für diese Filter.</div>
                : (
                    <>
                        <div className="hl-grid items hl-th" role="row">
                            <span role="columnheader" aria-sort={ariaSort("item", sort, dir)}>
                                <SortLabel sortKey="item" label="Item" sort={sort} dir={dir} onSort={onSort} tip="Item" tipSub="Darunter Boss und Raid, aus denen es droppt." />
                            </span>
                            <span role="columnheader" aria-sort={ariaSort("count", sort, dir)} className="hl-col-opt">
                                <SortLabel sortKey="count" label="Vergaben" sort={sort} dir={dir} onSort={onSort} tip="Vergaben" tipSub="Wie oft das Item unter den aktiven Filtern vergeben wurde; der Balken misst gegen das häufigste." />
                            </span>
                            <span role="columnheader" className="hl-col-opt tipped" data-tip="Gründe" data-tip-sub="Die Vergaben nach Grund, als Balken in den Farben der Gründe.">Gründe</span>
                            <span role="columnheader" aria-sort={ariaSort("recipients", sort, dir)} className="hl-col-opt">
                                <SortLabel sortKey="recipients" label="Erhalten von" sort={sort} dir={dir} onSort={onSort} tip="Erhalten von" tipSub="Die letzten Empfänger; wann, aus welchem Raid und warum steht in den Details. Sortiert nach dem alphabetisch ersten." />
                            </span>
                            <span />
                        </div>
                        {pageRows.map((it) => {
                            const content = contentById.get(it.contentId);
                            const name = it.itemName || `Item ${it.itemId}`;
                            const people = recipients(it.awards);
                            const open = () => setOpenItemId(it.itemId);
                            return (
                                <div
                                    key={it.itemId}
                                    className="hl-grid items hl-row"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${name}: Details öffnen`}
                                    onClick={open}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
                                >
                                    <div className="hl-item">
                                        <ItemIcon url={it.itemIconUrl} quality={it.itemQuality} />
                                        <div className="hl-item-text">
                                            <span {...itemQualityProps(it.itemQuality, "hl-item-name")}>{name}</span>
                                            <span className="hl-item-sub">
                                                <WowIcon name={contentIcon(it.contentId)} size={14} />
                                                {[it.boss, content?.label || "Raid unbekannt"].filter(Boolean).join(" · ")}
                                                {!!it.tokenTier && <Badge tone="accent">Token</Badge>}
                                            </span>
                                        </div>
                                    </div>
                                    <span className="hl-col-opt"><Bar value={it.count} max={maxCount} label={it.count} /></span>
                                    <span className="hl-col-opt"><StackBar parts={tallyReasons(it.awards, reasons)} /></span>
                                    <div className="hl-recips hl-col-opt">
                                        {people.slice(0, NAMED_RECIPIENTS).map((a) => (
                                            <RaiderChip key={a.characterKey} character={a.character} classColor={a.classColor} iconUrl={a.iconUrl} />
                                        ))}
                                        {people.length > NAMED_RECIPIENTS && (
                                            <Badge count tip={`${people.length} Empfänger`} tipSub={people.slice(NAMED_RECIPIENTS).map((a) => a.character).join(", ")}>
                                                +{people.length - NAMED_RECIPIENTS}
                                            </Badge>
                                        )}
                                    </div>
                                    <IconButton
                                        icon={<ChevronRightIcon />} size="sm" tip="Details" tipSub="Alle Vergaben dieses Items"
                                        onClick={(e) => { e.stopPropagation(); open(); }}
                                    />
                                </div>
                            );
                        })}
                        <div className="hl-foot">
                            <span className="muted">{pageRows.length} von {sorted.length} · sortiert nach {sortLabel}</span>
                            {totalPages > 1 && <Pager page={{ page, totalPages, total: sorted.length }} onPage={setPageNo} />}
                        </div>
                    </>
                )}

            <ItemAwardsDialog
                item={openItem}
                contents={contents}
                tiers={tiers}
                reasons={reasons}
                canEdit={canEdit}
                onClose={() => setOpenItemId(0)}
                onChanged={onChanged}
            />
        </div>
    );
}
