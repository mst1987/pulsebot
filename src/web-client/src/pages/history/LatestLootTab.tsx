// "Vergaben": the dashboard card's list in full — every award, newest first by
// default, filterable, sortable and paged 25 at a time.
//
// Server-side filtering, sorting and paging (GET /api/history/loot-awards): the
// loot store holds every row ever imported, and this view only ever shows one
// page of it, so shipping the lot to the browser to slice it there would be
// wasted payload. Every filter or sort change therefore refetches — the search
// box debounced, so typing doesn't fire a request per keystroke.
//
// "Nur Top-Items" is on by default, which is exactly the dashboard card's
// content; switching it off widens the same list to all imported loot.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getLootAwards, type ApiError, type Category, type LootAwardsData } from "../../api";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort, type Dir } from "../../lib/ui/tableSort";
import { fmtMs } from "../../lib/format";
import { itemQualityProps, itemQualityColor } from "../../lib/wow/itemQuality";
import { contentName } from "../../lib/wow/wowNames";
import { shortDate } from "../../lib/raids/overviewDates";
import { SortTh } from "../../components/ui/SortTh";
import { CharacterLink } from "../../components/character/ClassSpec";
import Pager from "../../components/ui/Pager";
import { LootResponseBadge } from "../../components/loot/LootTable";
import { contentIcon } from "../../components/loot/LootBadges";
import { ActiveFilters, FilterPopover, ListCount, RaidSelect, SearchBox, SwitchRow, type ActiveFilter } from "../../components/loot/LootFilters";
import RaidLoader from "../../components/ui/RaidLoader";
import WowIcon from "../../components/ui/WowIcon";
import { useContentVersion } from "../../hooks/useContentVersion";
import { tParts, useT } from "../../i18n";

type View = { search: string; category: string; content: string; reason: string; topOnly: boolean };
const VIEW_DEFAULT: View = { search: "", category: "", content: "", reason: "", topOnly: true };

type SortKey = "date" | "item" | "character" | "reason" | "raid";
// Dates start newest first, names and labels A to Z.
const SORT_DEFAULTS: Record<SortKey, Dir> = { date: "desc", item: "asc", character: "asc", reason: "asc", raid: "asc" };

const classIcon = (className: string) => `classicon_${className === "DK" ? "deathknight" : className.toLowerCase()}`;

/** "10.10." for this year's awards, the full date for older ones (the list pages back through years). */
function awardDate(ms: number): string {
    if (!ms) return "";
    const full = fmtMs(ms, false);
    return full.endsWith(String(new Date().getFullYear())) ? shortDate(ms) : full;
}

export function LatestLootTab({ categories, lead }: { categories: Category[]; lead?: ReactNode }) {
    const t = useT();
    const [view, setView] = usePersistedState<View>("history-awards-view", VIEW_DEFAULT);
    const { sort, dir, onSort } = useTableSort<SortKey>("history-awards-sort", SORT_DEFAULTS, "date");
    // The menu's content version (#563): only the loot of its raids.
    const { version } = useContentVersion();
    const [page, setPage] = useState(1);
    const [data, setData] = useState<LootAwardsData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Only the search box is debounced; a select change should feel immediate.
    const [search, setSearch] = useState(view.search);
    const firstLoad = useRef(true);

    const patch = (p: Partial<View>) => {
        setView((v) => ({ ...v, ...p }));
        setPage(1); // a narrower list makes the old page number meaningless
    };

    useEffect(() => {
        const handle = setTimeout(() => patch({ search }), firstLoad.current ? 0 : 300);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        setBusy(true);
        getLootAwards({
            topOnly: view.topOnly, search: view.search, category: view.category,
            content: view.content, reason: view.reason, page, version, sort, dir,
        })
            .then((d) => {
                if (cancelled) return;
                setData(d);
                setError(null);
                firstLoad.current = false;
            })
            .catch((err: ApiError) => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setBusy(false); });
        return () => { cancelled = true; };
    }, [view.topOnly, view.search, view.category, view.content, view.reason, page, version, sort, dir]);

    const contentLabel = useMemo(() => new Map((data?.contents || []).map((c) => [c.id, contentName(c.id, c.label)])), [data]);
    const categoryOptions = categories.filter((c) => c.id);
    const categoryName = categoryOptions.find((c) => c.id === view.category)?.name || view.category;
    const active: ActiveFilter[] = view.category
        ? [{ key: "category", label: categoryName, tone: "accent", onRemove: () => patch({ category: "" }) }]
        : [];

    return (
        <div className="dash-card hl-card">
            <div className="filter-bar hl-filters">
                {lead}
                <SearchBox id="awards-search" value={search} onChange={setSearch} placeholder={t("history.latest.searchPlaceholder")} />
                <select id="awards-reason" className="hl-sel" aria-label={t("history.shared.reason")} value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                    <option value="">{t("history.shared.allReasons")}</option>
                    {(data?.reasons || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {data && (
                    <RaidSelect id="awards-raid" contents={data.contents} value={view.content} onChange={(content) => patch({ content })} unknownCount={data.unknownContentCount} />
                )}
                <SwitchRow
                    checked={view.topOnly}
                    onChange={(topOnly) => patch({ topOnly, content: "", reason: "" })}
                    label={t("history.latest.topOnly")}
                    tip={t("history.latest.topOnlyTip")}
                />
                <FilterPopover active={view.category ? 1 : 0}>
                    <div>
                        <label className="hl-lbl" htmlFor="awards-category">{t("history.latest.raidType")}</label>
                        <select id="awards-category" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                            <option value="">{t("history.shared.allCategories")}</option>
                            {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                </FilterPopover>
                {data && <ListCount>{tParts("history.shared.awards", { count: data.total })}</ListCount>}
            </div>
            <ActiveFilters filters={active} />

            {error
                ? <div className="empty">{tParts("history.latest.loadError", { error })}</div>
                : !data
                    ? <RaidLoader compact text={t("history.latest.loading")} />
                    : !data.items.length
                        ? (
                            <div className="empty">
                                {view.topOnly && !data.topItemCount
                                    ? <>{t("history.latest.noTop")} <Link className="mlink" to="/settings?section=loot">{t("history.latest.noTopLink")}</Link>.</>
                                    : t("history.latest.empty")}
                            </div>
                        )
                        : (
                            <table className={`idx flush hl-awards${busy ? " hl-dim" : ""}`}>
                                <thead>
                                    <tr>
                                        <SortTh sortKey="date" label={t("history.shared.colDate")} sort={sort} dir={dir} onSort={onSort} />
                                        <SortTh sortKey="item" label={t("history.shared.colItem")} sort={sort} dir={dir} onSort={onSort} />
                                        <SortTh sortKey="character" label={t("history.shared.colRaider")} sort={sort} dir={dir} onSort={onSort} />
                                        <SortTh sortKey="reason" label={t("history.shared.reason")} sort={sort} dir={dir} onSort={onSort} />
                                        <SortTh sortKey="raid" label={t("history.shared.colRaid")} sort={sort} dir={dir} onSort={onSort} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items.map((it) => {
                                        const name = it.itemName || t("dashboard.topLoot.item", { id: it.itemId });
                                        const raid = contentLabel.get(it.contentId) || it.eventLabel || "";
                                        const who = [it.spec, it.className].filter(Boolean).join(" ");
                                        return (
                                            <tr key={`${it.eventId}-${it.itemId}-${it.character}-${it.awardedAt}`}>
                                                <td className="hl-when">{awardDate(it.awardedAt)}</td>
                                                <td>
                                                    <div className="hl-item">
                                                        {it.itemIconUrl
                                                            ? <img className="hl-ico" src={it.itemIconUrl} alt="" loading="lazy" style={{ "--iqb": itemQualityColor(it.itemQuality) || "var(--line)" } as CSSProperties} />
                                                            : <span className="hl-ico" />}
                                                        <div className="hl-item-text">
                                                            {it.itemLink
                                                                ? <a {...itemQualityProps(it.itemQuality, "hl-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{name}</a>
                                                                : <span {...itemQualityProps(it.itemQuality, "hl-item-name")}>{name}</span>}
                                                            {it.boss && <span className="hl-item-sub">{it.boss}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="hl-who" data-tip={who ? `${it.character} · ${who}` : it.character} data-tip-sub={it.response ? t("dashboard.topLoot.responseSub", { response: it.response }) : t("dashboard.topLoot.noResponse")}>
                                                        {it.className && <WowIcon name={classIcon(it.className)} size={20} />}
                                                        <CharacterLink character={it.character} classColor={it.classColor} />
                                                    </span>
                                                </td>
                                                <td><LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} /></td>
                                                <td>
                                                    <Link
                                                        className="hl-raidlink"
                                                        to={it.eventId ? `/history/event?event=${encodeURIComponent(it.eventId)}` : "/history"}
                                                        aria-label={it.eventLabel ? t("dashboard.topLoot.openLoot", { event: it.eventLabel }) : t("dashboard.topLoot.openLootThis")}
                                                    >
                                                        <WowIcon name={contentIcon(it.contentId)} size={20} />
                                                        {raid || t("history.shared.raidUnknown")}
                                                    </Link>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
            {data && data.totalPages > 1 && (
                <div className="hl-foot">
                    <span className="muted">{tParts("history.latest.foot", { shown: data.items.length, total: data.total })}</span>
                    <Pager page={data} onPage={setPage} />
                </div>
            )}
        </div>
    );
}
