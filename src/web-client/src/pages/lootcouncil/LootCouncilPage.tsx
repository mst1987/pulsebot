// The caster loot council.
//
// One question per view, in the order a council asks them:
//   "Wer ist dran?"            — the Raider tab: one compact line per raider
//                                (need, wait, loot, BiS, DPS, a few badges);
//                                everything else about a raider opens in their
//                                details (lootcouncil/RaiderDialog.tsx)
//   "Was fehlt noch?"          — the open BiS items, each with its candidates
//   "Das ist gerade gedroppt   — its own page, /lootcouncil/drop/:itemId
//    — wer kriegt es?"           (lootcouncil/DropCheckPage.tsx), so a drop is a
//                                link and seven candidates have room
//
// Two rules run through the whole module:
//
//   Tooltips over words. A filter, a column, a number explains itself in the
//   tooltip box; the page carries no paragraphs, because a council reads it
//   under time pressure while a boss corpse cools.
//
//   Gain and fairness stay apart. What an item would *do* and what a raider has
//   *coming to them* are two different questions, shown as two bars side by
//   side. Multiplying them into one number would look like an answer and hide
//   the judgement a council is there to make.
//
// The DPS numbers come from a background simulation (wowsimcli). There are no
// estimates: a gain is shown once it has been simulated and not before. Every
// wait — a reload, the armory, a simulation — is a job toast (components/shell/Jobs.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getLootCouncil, setCouncilExcluded, getCouncilExport, refreshCouncilArmory, setCouncilRole, canAccess, loadCouncilLogGear, type ApiError, type CouncilRaider, type CouncilRole, type CouncilExport, type LootCouncilData } from "../../api";
import { useCategoryViews } from "./categoryViews";
import { refreshWowheadLinks } from "../../lib/wow/wowheadTooltips";
import { useJobs, useToast } from "../../components/shell/Jobs";
import type { ShellContext } from "../../components/shell/Shell";
import { fmtMs } from "../../lib/format";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort } from "../../lib/ui/tableSort";
import RaidLoader from "../../components/ui/RaidLoader";
import { BackButton, Button, PageHead, useConfirm } from "../../components/ui";
import { CANDIDATE_SORT, ROSTER_SORT, VIEW_KEY, councilContent, councilHref, dropHref, roleLabel, useCouncilSim, type CandidateSortKey, type RosterSortKey } from "./council";
import CouncilOverview from "./CouncilOverview";
import { WowheadPathProvider } from "../../lib/settings/versionLinks";
import { useContentVersion } from "../../hooks/useContentVersion";
import FilterBar from "./FilterBar";
import RaiderDialog, { ExportDialog } from "./RaiderDialog";
import "../../styles/loot-council.css";
import type { View } from "./view";
import { CouncilTabs } from "./CouncilTabs";
import { RosterTab } from "./RosterTab";
import { GapsTab } from "./GapsTab";
import { BisListsTab } from "./BisListsTab";
import { ManualBisTab } from "./ManualBisTab";
import { CompareTab } from "./CompareTab";
import { ProfilesTab } from "./ProfilesTab";
import { CouncilHead } from "./CouncilHead";
import { pickValue } from "./profiles";
import { useDroppedPick } from "./droppedPick";
import { NeedWeightsProvider } from "./needWeights";

const VIEW_DEFAULT: View = {
    role: "caster", tiers: [], contents: [], category: "", roster: "", bisTier: "", bench: false, tab: "roster",
    listTier: "t6", listOff: [], listFocus: 0, cmpOff: [],
};

/** What in the url makes it the council of a pick; plain /lootcouncil is the tile overview. */
const COUNCIL_PARAMS = ["roster", "category", "raider", "tab"];

/**
 * The entry (Oct 2026): plain /lootcouncil shows the tiles of every roster and category that
 * runs as Loot-Council (CouncilOverview.tsx); a tile, a link with `?roster=` / `?category=`,
 * a raider's link or `?tab=profiles` opens the council itself.
 */
export default function LootCouncilPage() {
    const [params] = useSearchParams();
    return COUNCIL_PARAMS.some((key) => params.has(key)) ? <CouncilPage /> : <CouncilOverview />;
}

function CouncilPage() {
    // The game version of the raiders shown (#563): the menu's content switch.
    const { version: contentVersion, mainVersion } = useContentVersion();
    const { user } = useOutletContext<ShellContext>();
    // Setting a raider aside is an action on the server, so it takes write.
    const canWrite = canAccess(user, "lootcouncil", "write");
    const navigate = useNavigate();
    const t = useT();
    const ask = useConfirm();
    const jobs = useJobs();
    const toast = useToast();
    const [localView, setLocalView] = usePersistedState<View>(VIEW_KEY, VIEW_DEFAULT);
    // A picked category brings its own filters from the server (they drive the
    // in-game council too): lootcouncil/categoryViews.ts.
    // The pick lives in the url (Oct 2026): ?roster=<id> or ?category=<id> - a tile of the
    // overview, the Kaderplaner's "Zum Loot-Council", the roster settings' "Profile verwalten"
    // (with ?tab=profiles, taken over once). A raider's link (?raider=) carries no pick: the
    // last one is put back into the url, so closing the details stays in this council.
    const [params, setParams] = useSearchParams();
    const urlRoster = params.get("roster") || "";
    const urlCategory = urlRoster ? "" : (params.get("category") || "");
    const linkedTab = params.get("tab") || "";
    const pick = urlRoster || urlCategory
        ? { roster: urlRoster, category: urlCategory }
        : { roster: localView.roster || "", category: localView.roster ? "" : localView.category };
    // The roster a link opened - a roster of another version follows into it (droppedPick.ts).
    // A stored pick the page put back into the url itself is no link: a stale one is forgotten.
    const linkedRef = useRef("");
    const restoredRef = useRef("");
    useEffect(() => {
        if (urlRoster && urlRoster !== restoredRef.current) linkedRef.current = urlRoster;
        const tabPatch = linkedTab === "profiles" ? { tab: "profiles" as const } : {};
        if (localView.roster !== pick.roster || localView.category !== pick.category || linkedTab === "profiles") {
            setLocalView({ ...localView, ...pick, ...tabPatch });
        }
        const pickMissing = (pick.roster && !urlRoster) || (pick.category && !urlCategory);
        // `tab` leaves the url only with a pick taking its place - else the url would be the overview's
        if (pickMissing || (linkedTab && (pick.roster || pick.category))) {
            if (pick.roster && !urlRoster) restoredRef.current = pick.roster;
            setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (pick.roster) next.set("roster", pick.roster);
                else if (pick.category) next.set("category", pick.category);
                next.delete("tab");
                return next;
            }, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlRoster, urlCategory, linkedTab]);
    /** Another council: a new url (the effect above takes it into the view), the raider's details closed. */
    const pickCouncil = (fields: { roster: string; category: string }) => navigate(councilHref(fields));
    const { filters: view, patch, ready: viewsReady, reachesGame, profileId, reload: reloadViews } = useCategoryViews({
        view: { ...localView, ...pick },
        setView: setLocalView,
        canWrite,
        version: contentVersion,
        mainVersion,
        onError: (message) => toast(message || t("lootcouncil.page.actionFailed"), "err"),
    });
    // A stored "drop" tab is from before the drop check had its own page; "weights" became "profiles" (#676).
    const tab = view.tab === "drop" ? "roster" : view.tab === "weights" ? "profiles" : view.tab;
    const [data, setData] = useState<LootCouncilData | null>(null);
    // A version without BiS data has no BiS tabs (#748): a stored one opens the Raider tab.
    const content = councilContent(data);
    // Hand lists (#760): a version without BiS data keeps both BiS tabs, its lists are the orga's.
    const hasBis = content.bis || !!content.manualBis;
    const shownTab = !hasBis && (tab === "bis" || tab === "bislists") ? "roster" : tab;
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(true);
    // Whether a first load has landed — after it, reloads run as quiet jobs
    // (the full-page loader would lose the reader's place).
    const loaded = useRef(false);
    // Sim results live next to the data, not in it: the page is complete
    // without them and they are only ever an improvement laid over the top.
    const { sim, setSim, simRunning, runSim } = useCouncilSim({ roster: view.roster || "", category: view.category, version: contentVersion });
    // The open WoWSims export, if any — one raider at a time.
    const [exportData, setExportData] = useState<CouncilExport | null>(null);
    // Which per-raider actions are in flight, as "action:character" — two
    // raiders can be worked on at once, each button shows only its own spinner.
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [excludedOpen, setExcludedOpen] = useState(false);
    const rosterSort = useTableSort<RosterSortKey>("lootcouncil.roster-sort", ROSTER_SORT, "need");
    // One sort for every candidate table, so the cards stay comparable.
    const candidateSort = useTableSort<CandidateSortKey>("lootcouncil.candidate-sort", CANDIDATE_SORT, "gain");
    // The raider whose details are open lives in the url (?raider=<name>), so a
    // link from the drop check or from Discord leads straight there.
    const openName = (params.get("raider") || "").toLowerCase();

    // Returns the promise (resolving with the fresh data, or null) so an action
    // that reloads afterwards can keep its spinner until the new list is on
    // screen — and can report on what it sees there.
    const load = useCallback((): Promise<LootCouncilData | null> => {
        setLoading(true);
        const fetchData = () => getLootCouncil({
            role: view.role,
            tiers: view.tiers,
            contents: view.contents,
            category: view.category,
            roster: view.roster || "",
            bisTier: view.bisTier,
            version: contentVersion,
            bench: !!view.bench,
        });
        const request = loaded.current
            ? jobs.run({ label: t("lootcouncil.page.loading"), quiet: true }, fetchData)
            : fetchData().catch((err: ApiError) => { setError(err); return null; });
        return request
            .then((d) => {
                if (d) { setData(d); setError(null); loaded.current = true; }
                return d;
            })
            .finally(() => setLoading(false));
    }, [view.role, view.tiers, view.contents, view.category, view.roster, view.bisTier, view.bench, contentVersion, jobs, t]);

    /** Everything that depends on the raiders' data — every gear-changing action goes through here. */
    const reloadAll = useCallback(async () => load(), [load]);

    // Wrapped rather than passed directly: `load` returns a promise, and a
    // promise handed to useEffect would be mistaken for a cleanup function.
    // Not before the stored category views are known: a picked category would
    // otherwise load once with this browser's filters and once with its own.
    useEffect(() => { if (viewsReady) load(); }, [load, viewsReady]);

    // A changed filter changes which raiders and items were simulated, so the
    // old results no longer describe what is on screen.
    useEffect(() => { setSim(null); }, [view.role, view.tiers, view.contents, view.category, view.roster, view.bisTier, view.bench, contentVersion, setSim]);

    // A pick of another version (#741/#563): follow a link into it, else forget it and back to the overview.
    const dropped = data && data.council && data.council.dropped && pickValue(view) === `${data.council.dropped.kind}:${data.council.dropped.id}`
        ? data.council.dropped : null;
    // Leaves for the overview one render later, once the forgotten pick is stored (usePersistedState writes in an effect).
    const [toOverview, setToOverview] = useState(false);
    useDroppedPick(dropped, linkedRef.current, () => {
        setLocalView({ ...localView, roster: "", category: "" });
        setToOverview(true);
    });
    useEffect(() => { if (toOverview) navigate("/lootcouncil", { replace: true }); }, [toOverview, navigate]);

    const roster = useMemo(() => (data ? data.roster : []), [data]);
    const gaps = data ? data.gaps : [];
    const simulatable = useMemo(
        () => roster.filter((r) => r.simSupported && r.gear).map((r) => ({ key: r.key, specKey: r.specKey })),
        [roster],
    );
    const armoryCount = roster.filter((r) => r.gear && r.gear.source === "armory").length;
    const simulated = simulatable.filter((s) => sim && sim[s.key] && sim[s.key].baseline !== null).length;

    // The list opens on the server's own order (most overdue first); every other column is one click.
    const sortedRoster = rosterSort.apply(roster, (r, key) => {
        switch (key) {
            case "character": return r.character.toLowerCase();
            case "need": return r.needScore;
            // Loot points (#668) — what the share actually compares; the count for an old answer.
            case "loot": return r.lootPoints ?? r.lootCount;
            // Never having won anything is further back than any date.
            case "last": return r.lastAwardAt || 0;
            case "bis": return r.bis.total ? r.bis.owned / r.bis.total : -1;
            case "dps": return (sim && sim[r.key] && sim[r.key].baseline) || 0;
            default: return 0;
        }
    });
    const openIndex = openName ? sortedRoster.findIndex((r) => r.character.toLowerCase() === openName) : -1;
    const openRaider: CouncilRaider | null = openIndex >= 0 ? sortedRoster[openIndex] : null;

    const openDetails = (character: string) => setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("raider", character);
        return next;
    });
    const closeDetails = () => setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("raider");
        return next;
    });

    /**
     * Run one per-raider action with a visible busy state. Without feedback a
     * row simply sits there and the natural response is to click again, which
     * fires the request twice.
     */
    const runFor = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
        if (busy.has(key)) return;
        setBusy((prev) => new Set(prev).add(key));
        try {
            return await fn();
        } catch (err) {
            toast((err as ApiError).message || t("lootcouncil.page.actionFailed"), "err");
            return undefined;
        } finally {
            setBusy((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    /** That raider's loadout as a WoWSims import, to check our number with. */
    const showExport = (character: string) => runFor(
        `export:${character}`,
        async () => setExportData(await getCouncilExport(character)),
    );

    /** Als was ein Raider eingeplant wird — reicht bis ins Gear durch, also danach alles neu. */
    const setRole = (character: string, role: "" | CouncilRole) => runFor(
        `role:${character}`,
        async () => {
            await setCouncilRole(character, role);
            await reloadAll();
            toast(role
                ? t("lootcouncil.page.roleSet", { character, role: roleLabel(role) })
                : t("lootcouncil.page.roleCleared", { character }));
        },
    );

    /**
     * Fetch current gear from the armory, then reload — and report what the
     * reload shows: the armory regularly answers with an arena set, which the
     * server refuses, and then the button looks as if it had done nothing.
     */
    const loadArmory = (characters: string[], key: string) => runFor(key, async () => {
        const result = await jobs.run(
            { label: t("lootcouncil.page.armoryLoading"), detail: characters.length === 1 ? characters[0] : t("lootcouncil.page.armoryRaiders", { count: characters.length }), quiet: true },
            () => refreshCouncilArmory(characters),
        );
        // A failure is already on the toast.
        if (!result) return;
        const fresh = await reloadAll();
        if (!result.answered) {
            toast(characters.length === 1
                ? t("lootcouncil.page.armoryUnknownOne", { character: characters[0] })
                : t("lootcouncil.page.armoryUnknownAll"), "err");
            return;
        }
        const asked = new Set(characters.map((c) => c.toLowerCase()));
        const rows = fresh ? fresh.roster.filter((r) => asked.has(r.character.toLowerCase())) : [];
        const taken = rows.filter((r) => r.gear && r.gear.source === "armory").length;
        const pvp = rows.filter((r) => r.gear && r.gear.armoryRejected === "pvp").map((r) => r.character);
        const wrongRole = rows.filter((r) => r.gear && r.gear.armoryRejected === "role").map((r) => r.character);
        const parts = [t("lootcouncil.page.armoryLoaded", { taken, count: characters.length })];
        if (pvp.length) parts.push(t("lootcouncil.page.armoryPvp", { names: pvp.join(", ") }));
        if (wrongRole.length) parts.push(t("lootcouncil.page.armoryRole", { names: wrongRole.join(", ") }));
        toast(parts.join(" "), taken ? "ok" : "err");
    });

    /**
     * Gear aus einem Log laden — eines der letzten Logs des Bots, ein Link,
     * oder ohne beides das neueste Log, in dem der Raider steht. Resolves true
     * when the set was taken, so the dialog can close its log panel.
     */
    const loadLogGear = async (character: string, pick: { reportId?: string; link?: string }) => !!(await runFor(`loggear:${character}`, async () => {
        const result = await jobs.run(
            { label: t("lootcouncil.page.logLoading"), detail: character, quiet: true },
            () => loadCouncilLogGear({ character, ...pick }),
        );
        // A failure ("steht nicht in diesem Log") is already on the toast.
        if (!result) return false;
        const fresh = await reloadAll();
        const row = fresh ? fresh.roster.find((r) => r.character.toLowerCase() === character.toLowerCase()) : null;
        const when = result.reportStart ? ` (${fmtMs(result.reportStart, false)})` : "";
        const from = `${t("common.quoted", { text: result.reportTitle || result.reportId })}${when}`;
        if (row && row.gear && row.gear.logRejected === "pvp") {
            toast(t("lootcouncil.page.logPvp", { character, from }), "err");
            return false;
        }
        if (row && row.gear && row.gear.logRejected === "role") {
            toast(t("lootcouncil.page.logRole", { character, from }), "err");
            return false;
        }
        toast(t("lootcouncil.page.logLoaded", { character, from, count: result.items }));
        return true;
    }));

    /** Zurück zum Set aus der Auswertung: geladenes Log und Armory-Antwort vergessen. */
    const useEvaluation = (character: string) => runFor(`loggear:${character}`, async () => {
        await loadCouncilLogGear({ character, clear: true });
        await reloadAll();
        toast(t("lootcouncil.page.evaluationBack", { character }));
    });

    // Wowheads Tooltip-Widget hat die Seite vor React gescannt — nach jedem
    // Render mit neuem Gear die Item-Links nachmelden.
    useEffect(() => { refreshWowheadLinks(); }, [data, view.tab]);

    /**
     * Set a raider aside, or take them back in. Reloads afterwards: the need
     * score is relative to the group, so removing one raider changes
     * everybody else's number.
     */
    const setExcluded = (character: string, excluded: boolean) => runFor(
        `exclude:${character}`,
        async () => {
            await setCouncilExcluded(character, excluded);
            await reloadAll();
            toast(excluded ? t("lootcouncil.page.excluded", { character }) : t("lootcouncil.page.included", { character }));
        },
    );

    /** "Nicht einplanen" from the details — destructive enough to ask first. */
    const excludeFromDialog = async (character: string) => {
        const ok = await ask({
            title: t("lootcouncil.page.excludeTitle", { character }),
            text: t("lootcouncil.page.excludeText"),
            action: t("lootcouncil.page.excludeAction"),
            tone: "danger",
            icon: "ability_rogue_feigndeath",
        });
        if (!ok) return;
        closeDetails();
        await setExcluded(character, true);
    };

    // the first load in the page body like every other page
    if (loading && !data) return <RaidLoader text={t("lootcouncil.page.loading")} />;
    if (error) return <div className="empty">{error.message}</div>;
    if (!data) return null;

    const o = data.options;
    const kicker = [
        o.bisTiers.find((b) => b.id === data.filter.bisTier)?.label || "",
        [...o.tiers.filter((x) => view.tiers.includes(x.id)), ...o.contents.filter((c) => view.contents.includes(c.id))]
            .map((c) => c.label).join(" + ") || t("lootcouncil.page.allLoot"),
        data.council?.roster?.name || o.categories.find((c) => c.id === view.category)?.name || t("lootcouncil.page.allRaids"),
    ].filter(Boolean).join(" · ");

    return (
        <WowheadPathProvider path={data.wowheadPath}>
        <NeedWeightsProvider weights={data.weights}>
            <div className="lc-back-row"><BackButton to="/lootcouncil" label={t("lootcouncil.overview.back")} size="sm" /></div>
            <PageHead
                icon="inv_misc_coin_02"
                tone="lootcouncil"
                kicker={kicker}
                title={t("lootcouncil.title")}
                action={<Button icon="inv_misc_bag_10" onClick={() => navigate(dropHref())}>{t("lootcouncil.page.dropCheck")}</Button>}
            />

            {/* Who the council works for (#676): roster, profile, linked Kader. */}
            {data.council ? (
                <CouncilHead
                    head={data.council}
                    value={pickValue(view)}
                    onPick={pickCouncil}
                    onProfiles={() => patch({ tab: "profiles" })}
                />
            ) : null}

            {/* A version without content data says so, instead of showing TBC's (#748). */}
            {!hasBis ? <div className="lc-panel empty" role="note">{t(content.off ? "lootcouncil.noContent.off" : "lootcouncil.noContent.text")}</div> : null}
            {/* Hand lists without any list yet (#760): one calm line where to start. */}
            {content.manualBis && !roster.some((r) => r.bis.total) && shownTab !== "bislists" ? (
                <div className="lc-panel lc-mb-hint" role="note">
                    <span>{t("lootcouncil.manualBis.noListsYet")}</span>
                    <Button variant="ghost" size="sm" icon="inv_misc_book_09" onClick={() => patch({ tab: "bislists" })}>{t("lootcouncil.manualBis.openTab")}</Button>
                </div>
            ) : null}

            {/* Tabs first, then the one filter line they all share. */}
            <CouncilTabs tab={shownTab} patch={patch} rosterCount={roster.length} gapCount={gaps.length} hasBis={hasBis} />

            <FilterBar
                data={data}
                view={view}
                patch={patch}
                armoryCount={armoryCount}
                simulated={simulated}
                simulatable={simulatable.length}
                reachesGame={reachesGame}
                canWrite={canWrite}
            />

            {shownTab === "roster" ? (
                <RosterTab
                    data={data}
                    roster={roster}
                    sortedRoster={sortedRoster}
                    sim={sim}
                    rosterSort={rosterSort}
                    openRaider={openRaider}
                    openDetails={openDetails}
                    simRunning={simRunning}
                    runSim={runSim}
                    simulatable={simulatable}
                    excludedOpen={excludedOpen}
                    setExcludedOpen={setExcludedOpen}
                    canWrite={canWrite}
                    busy={busy}
                    setExcluded={setExcluded}
                />
            ) : null}

            {shownTab === "bis" ? (
                <GapsTab
                    data={data}
                    gaps={gaps}
                    sim={sim}
                    simRunning={simRunning}
                    runSim={runSim}
                    simulatable={simulatable}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    candidateSort={candidateSort}
                />
            ) : null}

            {/* Die Listen selbst — die einzige Ansicht hier, die nicht von den
                Raidern und ihrem Loot abhängt, sondern nur von WoWSims. */}
            {/* Ohne eigene BiS-Daten (#760): die von Hand gepflegten Listen der Orga. */}
            {shownTab === "bislists" && content.manualBis
                ? <ManualBisTab versionId={data.versionId || ""} canWrite={canWrite} onSaved={() => { void load(); }} />
                : null}
            {shownTab === "bislists" && !content.manualBis ? <BisListsTab view={view} patch={patch} versionId={data.versionId} /> : null}

            {/* Wer hat was bekommen, nebeneinander: dieselben Raider und derselbe
                Loot wie im Raider-Tab, nur als Matrix statt als Tooltip je Zeile. */}
            {view.tab === "compare" ? <CompareTab roster={roster} view={view} patch={patch} contents={o.contents} /> : null}

            {/* Die Profile (#676): Gewichtung und Ansicht je Roster — ändert jede Zahl oben, also danach neu laden. */}
            {shownTab === "profiles" ? (
                <ProfilesTab
                    initialId={profileId || data.council?.profile.id || ""}
                    options={o}
                    canWrite={canWrite}
                    onSaved={() => { reloadViews(); load(); }}
                />
            ) : null}

            {openRaider ? (
                <RaiderDialog
                    key={openRaider.key}
                    raider={openRaider}
                    rank={openIndex + 1}
                    total={sortedRoster.length}
                    sim={sim}
                    canWrite={canWrite}
                    busy={busy}
                    logs={data.recentLogs || []}
                    onClose={closeDetails}
                    onRole={setRole}
                    onArmory={(character) => loadArmory([character], `armory:${character}`)}
                    onLogLoad={loadLogGear}
                    onEvaluation={useEvaluation}
                    onExport={showExport}
                    onExclude={excludeFromDialog}
                />
            ) : null}
            <ExportDialog data={exportData} onClose={() => setExportData(null)} />
        </NeedWeightsProvider>
        </WowheadPathProvider>
    );
}
