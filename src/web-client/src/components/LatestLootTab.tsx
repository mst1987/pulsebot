// "Latest Loot": the dashboard card's list in full — every award, newest first,
// filterable and paged 25 at a time.
//
// Server-side filtering and paging (GET /api/history/loot-awards): the loot
// store holds every row ever imported, and this tab only ever shows one page of
// it, so shipping the lot to the browser to slice it there would be wasted
// payload. Every filter change therefore refetches — the search box debounced,
// so typing doesn't fire a request per keystroke.
//
// "Nur Top-Items" is on by default, which is exactly the dashboard card's
// content; switching it off widens the same list to all imported loot.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLootAwards, type ApiError, type Category, type LootAwardsData } from "../api";
import { usePersistedState } from "../lib/persistedState";
import Pager from "./Pager";
import TopLootList from "./TopLootList";

// Same value and meaning as the Items tab: loot whose raid the content table
// doesn't know, kept findable instead of filed into a wrong raid.
const UNKNOWN = "__unknown__";

type View = { search: string; category: string; content: string; reason: string; topOnly: boolean };
const VIEW_DEFAULT: View = { search: "", category: "", content: "", reason: "", topOnly: true };

export function LatestLootTab({ categories }: { categories: Category[] }) {
    const [view, setView] = usePersistedState<View>("history-awards-view", VIEW_DEFAULT);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<LootAwardsData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Only the search box is debounced; a dropdown change should feel immediate.
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

    if (error) return <div className="empty">Loot konnte nicht geladen werden: {error}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    const categoryOptions = categories.filter((c) => c.id);
    return (
        <>
            <div className="filter-bar">
                <div className="field" style={{ minWidth: 220 }}>
                    <label htmlFor="awards-search">Suche</label>
                    <input
                        id="awards-search" type="text" placeholder="Item, Item-ID oder Charakter …"
                        value={search} onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="field" style={{ minWidth: 180 }}>
                    <label htmlFor="awards-category">Raidtyp</label>
                    <select id="awards-category" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                        <option value="">Alle Kategorien</option>
                        {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="field" style={{ minWidth: 200 }}>
                    <label htmlFor="awards-content">Content</label>
                    <select id="awards-content" value={view.content} onChange={(e) => patch({ content: e.target.value })}>
                        <option value="">Alle Raids</option>
                        {data.contents.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        {!!data.unknownContentCount && <option value={UNKNOWN}>Unbekannt ({data.unknownContentCount})</option>}
                    </select>
                </div>
                <div className="field" style={{ minWidth: 170 }}>
                    <label htmlFor="awards-reason">Grund</label>
                    <select id="awards-reason" value={view.reason} onChange={(e) => patch({ reason: e.target.value })}>
                        <option value="">Alle Gründe</option>
                        {data.reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label className="switch-row">
                        <span className="switch">
                            <input
                                type="checkbox" checked={view.topOnly}
                                onChange={(e) => patch({ topOnly: e.target.checked, content: "", reason: "" })}
                            />
                            <span className="switch-track"><span className="switch-thumb" /></span>
                        </span>
                        Nur Top-Items
                    </label>
                </div>
            </div>

            {!data.items.length ? (
                <div className="empty">
                    {view.topOnly && !data.topItemCount
                        ? <>Noch keine Top-Items festgelegt — <Link className="mlink" to="/settings">Einstellungen → Loot</Link>.</>
                        : "Keine Vergaben für diese Filter."}
                </div>
            ) : (
                <div className="dash-card" style={{ opacity: busy ? .6 : 1 }}>
                    <TopLootList items={data.items} />
                </div>
            )}

            <Pager page={data} onPage={setPage} />
        </>
    );
}
