// "Vergaben": the dashboard card's list in full — every award, newest first,
// filterable and paged 25 at a time.
//
// Server-side filtering and paging (GET /api/history/loot-awards): the loot
// store holds every row ever imported, and this view only ever shows one page of
// it, so shipping the lot to the browser to slice it there would be wasted
// payload. Every filter change therefore refetches — the search box debounced,
// so typing doesn't fire a request per keystroke.
//
// "Nur Top-Items" is on by default, which is exactly the dashboard card's
// content; switching it off widens the same list to all imported loot.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLootAwards, type ApiError, type Category, type LootAwardsData } from "../../api";
import { usePersistedState } from "../../lib/persistedState";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import Pager from "../../components/Pager";
import TopLootList from "../../components/loot/TopLootList";
import { ActiveFilters, FilterPopover, RaidChips, SearchBox, SwitchRow, type ActiveFilter } from "../../components/loot/LootFilters";
import RaidLoader from "../../components/ui/RaidLoader";
import { useT } from "../../i18n";

type View = { search: string; category: string; content: string; reason: string; topOnly: boolean };
const VIEW_DEFAULT: View = { search: "", category: "", content: "", reason: "", topOnly: true };

export function LatestLootTab({ categories }: { categories: Category[] }) {
    const t = useT();
    const [view, setView] = usePersistedState<View>("history-awards-view", VIEW_DEFAULT);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<LootAwardsData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Only the search box is debounced; a chip or select change should feel immediate.
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
            content: view.content, reason: view.reason, page,
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
    }, [view.topOnly, view.search, view.category, view.content, view.reason, page]);

    const categoryOptions = categories.filter((c) => c.id);
    const categoryName = categoryOptions.find((c) => c.id === view.category)?.name || view.category;
    const active: ActiveFilter[] = view.category
        ? [{ key: "category", label: categoryName, tone: "accent", onRemove: () => patch({ category: "" }) }]
        : [];

    return (
        <div className="dash-card hl-card">
            <PartHead
                icon="inv_misc_coin_02" tone="history" title={t("history.page.view.awards")} crumb={t("history.latest.crumb")}
                tip={t("history.page.view.awards")} tipSub={t("history.latest.tipSub")}
                action={data ? <Badge count>{t("history.shared.awards", { count: data.total })}</Badge> : undefined}
            />
            <div className="filter-bar hl-filters">
                <SearchBox id="awards-search" value={search} onChange={setSearch} placeholder={t("history.latest.searchPlaceholder")} />
                {data && (
                    <RaidChips
                        contents={data.contents}
                        value={view.content}
                        onChange={(content) => patch({ content })}
                        unknownCount={data.unknownContentCount}
                    />
                )}
                <select id="awards-reason" className="hl-sel" aria-label={t("history.shared.reason")} value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                    <option value="">{t("history.shared.allReasons")}</option>
                    {(data?.reasons || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
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
            </div>
            <ActiveFilters filters={active} />

            {error
                ? <div className="empty">{t("history.latest.loadError", { error })}</div>
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
                            <div style={{ opacity: busy ? 0.6 : 1 }}>
                                <TopLootList items={data.items} />
                            </div>
                        )}
            {data && data.totalPages > 1 && (
                <div className="hl-foot">
                    <span className="muted">{t("history.latest.foot", { shown: data.items.length, total: data.total })}</span>
                    <Pager page={data} onPage={setPage} />
                </div>
            )}
        </div>
    );
}
