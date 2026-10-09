import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryData, getLootStats, getLootInbox, getSession, canAccess } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState, usePersistedSearchParam } from "../../lib/ui/persistedState";
import RaidTable from "./RaidTable";
import { LootReasonsTab } from "./LootReasonsTab";
import { LootItemsTab } from "./LootItemsTab";
import { LatestLootTab } from "./LatestLootTab";
import { ImportLootDialog } from "./ImportLootDialog";
import type { ShellContext } from "../../components/shell/Shell";
import { useToast } from "../../components/shell/Jobs";
import { Button } from "../../components/ui/Button";
import { ListCount } from "../../components/loot/LootFilters";
import PageHead from "../../components/ui/PageHead";
import Segment from "../../components/ui/Segment";
import { useContentVersion } from "../../hooks/useContentVersion";
import "../../styles/history-loot.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { LootEventsTab } from "./LootEventsTab";
import { LogsTab } from "./LogsTab";
import { CharactersTab } from "./CharactersTab";
import { tParts, useT } from "../../i18n";

// One tab row (Vergaben | Items | Raids | Charaktere) instead of an area switch
// over a second row of views. What used to be a tab of its own is a switch
// inside the tab it belongs to: "Gründe" (per player) next to the item list in
// "Items", "Nach Raid" (the loot per raid) and "Warcraft Logs" next to the raid
// lists in "Raids". The import form and the addon inbox are not views at all —
// the import is a dialog from the page head, the inbox its own page
// (/history/inbox).
// The "loot" tabs are also what the narrower "Loot-Ansichten" permission opens on
// its own — see the page component and src/config/permissions.js.
type Tab = "awards" | "items" | "raids" | "chars";
type RaidsView = "past" | "upcoming" | "loot" | "logs";
type ItemsView = "items" | "players";

// Labels are translated at render (history.page.view.<id>).
const TABS: Tab[] = ["awards", "items", "raids", "chars"];
// What the narrower "loot" permission may open: the loot lists, and of "Raids"
// only the loot per raid.
const LOOT_TABS: Tab[] = ["awards", "items", "raids"];

// ?tab= values from before the single tab row, still posted in Discord and
// bookmarked: each maps to its new tab plus the switch position inside it.
const LEGACY_TABS: Record<string, { tab: Tab; raids?: RaidsView; items?: ItemsView }> = {
    reasons: { tab: "items", items: "players" },
    loot: { tab: "raids", raids: "loot" },
    logs: { tab: "raids", raids: "logs" },
};

// The main view of the page — where the sidebar link lands.
const DEFAULT_TAB: Tab = "items";

// Old ?tab= values that are no longer views: "import" opens the dialog, "inbox"
// goes to its page. Links to them are posted in Discord and must keep working.
const LEGACY_IMPORT = "import";

const LEGACY_INBOX = "inbox";

// The two overview views carry every loot row ever imported, so they load on
// demand instead of with the page — opening "Raids" must not pay for them.
const STATS_TABS: Tab[] = ["items"];

export default function HistoryPage() {
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // Two ways in: "history" opens the whole page, the narrower "loot" only the
    // loot views (see src/config/permissions.js). Everything below asks this one
    // flag; the server sends the loot-only caller a payload to match, so the
    // hidden views would have nothing to show anyway (apiRoutes/history.js).
    const fullHistory = canAccess(user, "history");
    const canWrite = canAccess(user, "history", "write");
    const allowedTabs = fullHistory ? TABS : LOOT_TABS;
    // In the URL (linkable, survives a reload) and remembered on top of that, so
    // coming back via the sidebar re-opens the view that was last used here.
    const [paramTab, setTab] = usePersistedSearchParam<Tab>("history-tab", "tab", DEFAULT_TAB, allowedTabs);
    const legacyTab = searchParams.get("tab");
    const legacy = legacyTab ? LEGACY_TABS[legacyTab] : undefined;
    const tab = legacy && allowedTabs.includes(legacy.tab) ? legacy.tab : paramTab;

    const history = useApi(() => getHistoryData(), []);
    const { data, error } = history;
    const toast = useToast();
    // Loaded with the page: the head's count is the only hint that a raid is
    // waiting to be filed, so it has to be there before anyone thinks to look.
    // Skipped without "history": the inbox is not open to that caller, and the
    // call would only earn a 403. A failed load counts as "nothing waiting".
    const inbox = useApi(() => getLootInbox().then((r) => r.sessions.length), [], { enabled: fullHistory });
    const inboxCount = inbox.error ? 0 : inbox.data || 0;
    const [importOpen, setImportOpen] = useState(legacyTab === LEGACY_IMPORT && canWrite);
    // The kicker names the guild whose history this is (blank until known, or when it cannot be).
    const session = useApi(() => getSession(), []);
    const guildName = session.data ? session.data.guilds.find((g) => g.id === session.data?.activeGuildId)?.name || "" : "";
    // The Raids tab shows one list at a time, and it opens on the past raids:
    // what already happened is what this page is for — the coming ones are
    // planned on the Raid-Events page, not looked up here. Without the full
    // "history" permission only the loot per raid is open.
    const [storedRaidsView, setRaidsView] = usePersistedState<RaidsView>("history-raids-view", "past");
    const [storedItemsView, setItemsView] = usePersistedState<ItemsView>("history-items-view-by", "items");
    const raidsView: RaidsView = fullHistory ? storedRaidsView : "loot";
    const itemsView: ItemsView = storedItemsView === "players" ? "players" : "items";
    // An old link names the switch position too — apply it once, after that the
    // visitor's own clicks rule.
    const legacyApplied = useRef(false);
    useEffect(() => {
        if (!legacy || legacyApplied.current) return;
        legacyApplied.current = true;
        if (legacy.raids) setRaidsView(legacy.raids);
        if (legacy.items) setItemsView(legacy.items);
    }, [legacy, setRaidsView, setItemsView]);
    // The game version of every view (#563): the menu's content switch.
    const { version: contentVersion } = useContentVersion();

    // The overviews are fetched on the first visit to one of their views, then
    // kept — and refreshed after an import only once they were opened, since
    // before that there is nothing on screen that could go stale. Switched on
    // once and never off: after a failed load there is nothing in `stats`, and
    // asking again on every render would hammer the endpoint.
    const [statsWanted, setStatsWanted] = useState(false);
    useEffect(() => {
        if (STATS_TABS.includes(tab)) setStatsWanted(true);
    }, [tab]);
    const statsData = useApi(() => getLootStats(contentVersion), [contentVersion], { enabled: statsWanted });
    const { data: stats, error: statsError } = statsData;

    const afterChange = (msg: string) => {
        toast(msg);
        history.reload();
        if (fullHistory) inbox.reload();
        if (statsWanted) statsData.reload();
    };

    // ?tab=inbox from before the inbox became a page.
    if (legacyTab === LEGACY_INBOX && fullHistory) return <Navigate to="/history/inbox" replace />;

    const head = (
        <div className="hl-page">
            <PageHead
                icon="inv_misc_bag_10"
                tone="history"
                kicker={guildName || t("history.page.guild")}
                title={t("history.shared.kicker")}
                action={(fullHistory || canWrite) ? (
                    <>
                        {fullHistory && (
                            <Button variant="ghost" className="hl-inbox-btn" icon="inv_letter_18" onClick={() => navigate("/history/inbox")}>
                                {t("history.page.inbox")}
                                {inboxCount > 0 && <> · {tParts("history.page.inboxOpen", { count: inboxCount })}</>}
                            </Button>
                        )}
                        {canWrite && (
                            <Button icon="inv_scroll_03" disabled={!data} onClick={() => setImportOpen(true)}>{t("history.page.import")}</Button>
                        )}
                    </>
                ) : undefined}
            />
        </div>
    );

    if (error) return <>{head}<div className="empty">{tParts("history.shared.loadError", { message: error.message })}</div></>;
    if (!data) return <>{head}<RaidLoader text={t("history.page.loading")} /></>;

    // The menu's content version (#563), else the main version the server named.
    const version = contentVersion || data.mainVersion || "";
    const ofVersion = <T extends { versionId?: string }>(rows: T[]) => (version ? rows.filter((e) => (e.versionId || "tbc") === version) : rows);
    const pastEvents = ofVersion(data.pastRaids.events);
    const upcomingEvents = ofVersion(data.upcomingRaids.events);
    const lootEvents = ofVersion(data.lootEvents);
    const statsItems = !stats ? [] : (!version ? stats.items : stats.items
        .map((it) => {
            const awards = it.awards.filter((a) => (a.versionId || "tbc") === version);
            return { ...it, awards, count: awards.length };
        })
        .filter((it) => it.count > 0));

    // The switch inside "Raids": which list of raids it is, one at a time. It
    // leads the filter line of whichever list is open.
    const raidsOptions: { value: RaidsView; label: string; tip: string }[] = [
        { value: "past", label: t("history.page.raids.past", { count: pastEvents.length }), tip: t("history.page.raids.pastOptTip") },
        { value: "upcoming", label: t("history.page.raids.upcoming", { count: upcomingEvents.length }), tip: t("history.page.raids.upcomingOptTip") },
        { value: "loot", label: t("history.page.raids.loot", { count: lootEvents.length }), tip: t("history.page.raids.lootTip") },
        { value: "logs", label: t("history.page.raids.logs", { count: data.logs.length }), tip: t("history.page.raids.logsTip") },
    ];
    const raidsSwitch = fullHistory ? (
        <Segment<RaidsView> ariaLabel={t("history.page.raids.whenAria")} size="sm" value={raidsView} onChange={setRaidsView} options={raidsOptions} />
    ) : undefined;
    // The switch inside "Items": the same loot by item or by player (the old "Gründe").
    const itemsSwitch = (
        <Segment<ItemsView>
            ariaLabel={t("history.page.itemsBy.aria")}
            size="sm"
            value={itemsView}
            onChange={setItemsView}
            options={[
                { value: "items", label: t("history.page.itemsBy.items"), tip: t("history.page.itemsBy.itemsTip") },
                { value: "players", label: t("history.page.itemsBy.players"), tip: t("history.page.itemsBy.playersTip") },
            ]}
        />
    );
    const statsBar = <div className="filter-bar hl-filters">{itemsSwitch}</div>;

    return (
        <>
            {head}

            {/* The one tab row. A loot-only visitor sees three of the four. */}
            <div className="subnav" role="tablist">
                {allowedTabs.map((id) => (
                    <button key={id} type="button" className={`subnav-item${tab === id ? " active" : ""}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                        {t(`history.page.view.${id}`)}
                    </button>
                ))}
            </div>

            {/* Fetches its own page of awards — see LatestLootTab. */}
            {tab === "awards" && <LatestLootTab categories={data.categories} />}
            {tab === "items" && (
                statsError
                    ? <div className="dash-card hl-card">{statsBar}<div className="empty">{tParts("history.shared.loadError", { message: statsError.message })}</div></div>
                    : !stats
                        ? <div className="dash-card hl-card">{statsBar}<RaidLoader compact text={t("history.page.statsLoading")} /></div>
                        : itemsView === "players"
                            ? <LootReasonsTab characters={stats.characters} reasons={stats.reasons} categories={data.categories} contents={stats.contents} lead={itemsSwitch} />
                            : (
                                <LootItemsTab
                                    items={statsItems}
                                    contents={stats.contents}
                                    tiers={stats.tiers}
                                    reasons={stats.reasons}
                                    categories={data.categories}
                                    unknownContentCount={stats.unknownContentCount}
                                    canEdit={canWrite}
                                    onChanged={afterChange}
                                    lead={itemsSwitch}
                                />
                            )
            )}
            {tab === "raids" && raidsView === "loot" && (
                <LootEventsTab lootEvents={lootEvents} categories={data.categories} onChanged={afterChange} canEdit={canWrite} lead={raidsSwitch} />
            )}
            {tab === "raids" && raidsView === "logs" && <LogsTab logs={data.logs} onChanged={afterChange} lead={raidsSwitch} />}
            {tab === "raids" && (raidsView === "past" || raidsView === "upcoming") && (
                <div className="dash-card hl-card">
                    <div className="filter-bar hl-filters">
                        {raidsSwitch}
                        <ListCount>{tParts("history.page.raids.count", { count: raidsView === "past" ? pastEvents.length : upcomingEvents.length })}</ListCount>
                    </div>
                    {raidsView === "past"
                        ? <RaidTable events={pastEvents} guildId={data.activeGuildId} error={data.pastRaids.error} emptyMessage={t("history.page.raids.pastEmpty")} sortKey="raids-past-sort" />
                        : <RaidTable events={upcomingEvents} guildId={data.activeGuildId} error={data.upcomingRaids.error} emptyMessage={t("history.page.raids.upcomingEmpty")} sortKey="raids-upcoming-sort" initialDir="asc" />}
                </div>
            )}
            {tab === "chars" && <CharactersTab chars={data.chars} categories={data.categories} onChanged={afterChange} version={version} />}

            {canWrite && (
                <ImportLootDialog
                    open={importOpen}
                    onClose={() => { setImportOpen(false); if (legacyTab === LEGACY_IMPORT) setTab(DEFAULT_TAB); }}
                    data={data}
                    onImported={afterChange}
                />
            )}
        </>
    );
}
