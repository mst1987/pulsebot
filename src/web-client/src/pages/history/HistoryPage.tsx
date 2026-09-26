import { useEffect, useState } from "react";
import { Navigate, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryData, getLootStats, getLootInbox, getSession, canAccess } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState, usePersistedSearchParam } from "../../lib/persistedState";
import RaidTable from "../../components/RaidTable";
import { LootReasonsTab } from "../../components/LootReasonsTab";
import { LootItemsTab } from "../../components/LootItemsTab";
import { LatestLootTab } from "../../components/LatestLootTab";
import { ImportLootDialog } from "../../components/ImportLootDialog";
import type { ShellContext } from "../../components/Shell";
import { useToast } from "../../components/Jobs";
import { Button } from "../../components/ui/Button";
import { PartHead } from "../../components/ui/PartHead";
import PageHead from "../../components/ui/PageHead";
import Segment from "../../components/ui/Segment";
import Badge from "../../components/ui/Badge";
import "../../styles/historie-loot.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { LootEventsTab } from "./LootEventsTab";
import { LogsTab } from "./LogsTab";
import { CharactersTab } from "./CharactersTab";

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

// The Raids view's two lists. They used to sit stacked in one view, the coming
// raids on top — which put the list nobody comes here for above the one they do.
type RaidWhen = "past" | "upcoming";

// Old ?tab= values that are no longer views: "import" opens the dialog, "inbox"
// goes to its page. Links to them are posted in Discord and must keep working.
const LEGACY_IMPORT = "import";

const LEGACY_INBOX = "inbox";

// The two overview views carry every loot row ever imported, so they load on
// demand instead of with the page — opening "Raids" must not pay for them.
const STATS_TABS: Tab[] = ["reasons", "items"];

export default function HistoryPage() {
    const { user } = useOutletContext<ShellContext>();
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
    // The Raids view shows one list at a time, and it opens on the past raids:
    // what already happened is what this page is for — the coming ones are
    // planned on the Raid-Events page, not looked up here.
    const [raidWhen, setRaidWhen] = usePersistedState<RaidWhen>("history-raids-when", "past");

    // The overviews are fetched on the first visit to one of their views, then
    // kept — and refreshed after an import only once they were opened, since
    // before that there is nothing on screen that could go stale. Switched on
    // once and never off: after a failed load there is nothing in `stats`, and
    // asking again on every render would hammer the endpoint.
    const [statsWanted, setStatsWanted] = useState(false);
    useEffect(() => {
        if (STATS_TABS.includes(tab)) setStatsWanted(true);
    }, [tab]);
    const statsData = useApi(() => getLootStats(), [], { enabled: statsWanted });
    const { data: stats, error: statsError } = statsData;

    const afterChange = (msg: string) => {
        toast(msg);
        history.reload();
        if (fullHistory) inbox.reload();
        if (statsWanted) statsData.reload();
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
                <div className="dash-card hl-card">
                    <PartHead
                        icon="inv_misc_note_02" tone="history"
                        title={raidWhen === "past" ? "Vergangene Raids" : "Kommende Raids"}
                        crumb="Raids & Logs › Raids"
                        tip={raidWhen === "past" ? "Gelaufene Raids" : "Angesetzte Raids"}
                        tipSub={raidWhen === "past"
                            ? "Jeder Termin, der vorbei ist, mit seinen Logs und dem importierten Loot."
                            : "Was im Kalender steht. Geplant wird er unter Raid-Events."}
                        action={(
                            <Segment<RaidWhen>
                                ariaLabel="Zeitraum"
                                size="sm"
                                value={raidWhen}
                                onChange={setRaidWhen}
                                options={[
                                    { value: "past", label: `Vergangene (${data.pastRaids.events.length})`, icon: "inv_misc_pocketwatch_01", tip: "Schon gelaufen" },
                                    { value: "upcoming", label: `Kommende (${data.upcomingRaids.events.length})`, icon: "inv_misc_note_02", tip: "Noch angesetzt" },
                                ]}
                            />
                        )}
                    />
                    {raidWhen === "past"
                        ? <RaidTable events={data.pastRaids.events} guildId={data.activeGuildId} error={data.pastRaids.error} emptyMessage="Keine vergangenen Raids gefunden." sortKey="raids-past-sort" />
                        : <RaidTable events={data.upcomingRaids.events} guildId={data.activeGuildId} error={data.upcomingRaids.error} emptyMessage="Keine anstehenden Raids gefunden." sortKey="raids-upcoming-sort" initialDir="asc" />}
                </div>
            )}
            {tab === "loot" && (
                <LootEventsTab
                    lootEvents={data.lootEvents} categories={data.categories}
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
                                    onChanged={afterChange}
                                />
                            )
            )}
            {tab === "logs" && <LogsTab logs={data.logs} onChanged={afterChange} />}
            {tab === "chars" && <CharactersTab chars={data.chars} categories={data.categories} onChanged={afterChange} />}

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
