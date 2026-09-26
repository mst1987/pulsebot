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
// wait — a reload, the armory, a simulation — is a job toast (components/Jobs.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getLootCouncil, setCouncilExcluded, getCouncilExport, refreshCouncilArmory, setCouncilRole, canAccess, loadCouncilLogGear, type ApiError, type CouncilRaider, type CouncilExport, type LootCouncilData } from "../../api";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { useJobs, useToast } from "../../components/Jobs";
import type { ShellContext } from "../../components/Shell";
import { fmtMs } from "../../lib/format";
import { usePersistedState } from "../../lib/persistedState";
import { useTableSort } from "../../lib/tableSort";
import PageLoader from "../../components/PageLoader";
import { Button, PageHead, useConfirm } from "../../components/ui";
import { CANDIDATE_SORT, ROLE_LABEL, ROSTER_SORT, VIEW_KEY, dropHref, useCouncilSim, type CandidateSortKey, type RosterSortKey } from "./council";
import FilterBar from "./FilterBar";
import RaiderDialog, { ExportDialog } from "./RaiderDialog";
import "../../styles/loot-council.css";
import type { View } from "./view";
import { CouncilTabs } from "./CouncilTabs";
import { RosterTab } from "./RosterTab";
import { GapsTab } from "./GapsTab";
import { BisListsTab } from "./BisListsTab";
import { CompareTab } from "./CompareTab";

const VIEW_DEFAULT: View = {
    role: "caster", tiers: [], contents: [], category: "", bisTier: "", tab: "roster",
    listTier: "t6", listOff: [], listFocus: 0, cmpOff: [],
};

export default function LootCouncilPage() {
    const { user } = useOutletContext<ShellContext>();
    // Setting a raider aside is an action on the server, so it takes write.
    const canWrite = canAccess(user, "lootcouncil", "write");
    const navigate = useNavigate();
    const ask = useConfirm();
    const [view, setView] = usePersistedState<View>(VIEW_KEY, VIEW_DEFAULT);
    // A stored "drop" tab is from before the drop check had its own page.
    const tab = view.tab === "drop" ? "roster" : view.tab;
    const [data, setData] = useState<LootCouncilData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(true);
    const jobs = useJobs();
    const toast = useToast();
    // Whether a first load has landed — after it, reloads run as quiet jobs
    // (the full-page loader would lose the reader's place).
    const loaded = useRef(false);
    // Sim results live next to the data, not in it: the page is complete
    // without them and they are only ever an improvement laid over the top.
    const { sim, setSim, simRunning, runSim } = useCouncilSim();
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
    const [params, setParams] = useSearchParams();
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
            bisTier: view.bisTier,
        });
        const request = loaded.current
            ? jobs.run({ label: "Loot-Council wird geladen", quiet: true }, fetchData)
            : fetchData().catch((err: ApiError) => { setError(err); return null; });
        return request
            .then((d) => {
                if (d) { setData(d); setError(null); loaded.current = true; }
                return d;
            })
            .finally(() => setLoading(false));
    }, [view.role, view.tiers, view.contents, view.category, view.bisTier, jobs]);

    /** Everything that depends on the raiders' data — every gear-changing action goes through here. */
    const reloadAll = useCallback(async () => load(), [load]);

    // Wrapped rather than passed directly: `load` returns a promise, and a
    // promise handed to useEffect would be mistaken for a cleanup function.
    useEffect(() => { load(); }, [load]);

    // A changed filter changes which raiders and items were simulated, so the
    // old results no longer describe what is on screen.
    useEffect(() => { setSim(null); }, [view.role, view.tiers, view.contents, view.category, view.bisTier, setSim]);

    const patch = (next: Partial<View>) => setView({ ...view, ...next });

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
            case "loot": return r.lootCount;
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
            toast((err as ApiError).message || "Die Aktion ist fehlgeschlagen.", "err");
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
    const setRole = (character: string, role: "" | "caster" | "healer") => runFor(
        `role:${character}`,
        async () => {
            await setCouncilRole(character, role);
            await reloadAll();
            toast(role
                ? `${character} wird als ${ROLE_LABEL[role] || role} eingeplant.`
                : `Festlegung für ${character} zurückgenommen — es gilt wieder, was die Daten sagen.`);
        },
    );

    /**
     * Fetch current gear from the armory, then reload — and report what the
     * reload shows: the armory regularly answers with an arena set, which the
     * server refuses, and then the button looks as if it had done nothing.
     */
    const loadArmory = (characters: string[], key: string) => runFor(key, async () => {
        const result = await jobs.run(
            { label: "Armory wird geladen", detail: characters.length === 1 ? characters[0] : `${characters.length} Raider`, quiet: true },
            () => refreshCouncilArmory(characters),
        );
        // A failure is already on the toast.
        if (!result) return;
        const fresh = await reloadAll();
        if (!result.answered) {
            toast(characters.length === 1
                ? `Die Armory kennt ${characters[0]} nicht (oder antwortet gerade nicht) — es bleibt beim Stand der letzten Auswertung.`
                : "Die Armory hat für niemanden geantwortet — es bleibt beim Stand der letzten Auswertung.", "err");
            return;
        }
        const asked = new Set(characters.map((c) => c.toLowerCase()));
        const rows = fresh ? fresh.roster.filter((r) => asked.has(r.character.toLowerCase())) : [];
        const taken = rows.filter((r) => r.gear && r.gear.source === "armory").length;
        const pvp = rows.filter((r) => r.gear && r.gear.armoryRejected === "pvp").map((r) => r.character);
        const wrongRole = rows.filter((r) => r.gear && r.gear.armoryRejected === "role").map((r) => r.character);
        const parts = [`Armory geladen: ${taken} von ${characters.length} Raider(n) mit aktuellem Gear.`];
        if (pvp.length) parts.push(`${pvp.join(", ")}: die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid.`);
        if (wrongRole.length) parts.push(`${wrongRole.join(", ")}: die Armory zeigt ein Set der anderen Rolle — es bleibt beim Set aus dem letzten Raid.`);
        toast(parts.join(" "), taken ? "ok" : "err");
    });

    /**
     * Gear aus einem Log laden — eines der letzten Logs des Bots, ein Link,
     * oder ohne beides das neueste Log, in dem der Raider steht. Resolves true
     * when the set was taken, so the dialog can close its log panel.
     */
    const loadLogGear = async (character: string, pick: { reportId?: string; link?: string }) => !!(await runFor(`loggear:${character}`, async () => {
        const result = await jobs.run(
            { label: "Log wird geladen", detail: character, quiet: true },
            () => loadCouncilLogGear({ character, ...pick }),
        );
        // A failure ("steht nicht in diesem Log") is already on the toast.
        if (!result) return false;
        const fresh = await reloadAll();
        const row = fresh ? fresh.roster.find((r) => r.character.toLowerCase() === character.toLowerCase()) : null;
        const when = result.reportStart ? ` (${fmtMs(result.reportStart, false)})` : "";
        const from = `„${result.reportTitle || result.reportId}“${when}`;
        if (row && row.gear && row.gear.logRejected === "pvp") {
            toast(`${character} trägt in ${from} PvP-Gear — es bleibt beim Set aus der Auswertung.`, "err");
            return false;
        }
        if (row && row.gear && row.gear.logRejected === "role") {
            toast(`${character} trägt in ${from} ein Set der anderen Rolle — es bleibt beim Set aus der Auswertung.`, "err");
            return false;
        }
        toast(`Gear von ${character} aus ${from} geladen: ${result.items} Teile.`);
        return true;
    }));

    /** Zurück zum Set aus der Auswertung: geladenes Log und Armory-Antwort vergessen. */
    const useEvaluation = (character: string) => runFor(`loggear:${character}`, async () => {
        await loadCouncilLogGear({ character, clear: true });
        await reloadAll();
        toast(`${character} wird wieder nach der letzten Auswertung bewertet.`);
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
            toast(excluded ? `${character} wird nicht mehr eingeplant.` : `${character} wird wieder eingeplant.`);
        },
    );

    /** "Nicht einplanen" from the details — destructive enough to ask first. */
    const excludeFromDialog = async (character: string) => {
        const ok = await ask({
            title: `${character} nicht einplanen?`,
            text: "Bleibt in der Historie und lässt sich jederzeit wieder einplanen — verschwindet nur aus dieser Liste, und die Bedarfswerte der anderen verschieben sich.",
            action: "Nicht einplanen",
            tone: "danger",
            icon: "ability_rogue_feigndeath",
        });
        if (!ok) return;
        closeDetails();
        await setExcluded(character, true);
    };

    if (loading && !data) return <PageLoader show text="Loot-Council wird geladen" />;
    if (error) return <div className="empty">{error.message}</div>;
    if (!data) return null;

    const o = data.options;
    const kicker = [
        o.bisTiers.find((t) => t.id === data.filter.bisTier)?.label || "",
        [...o.tiers.filter((t) => view.tiers.includes(t.id)), ...o.contents.filter((c) => view.contents.includes(c.id))]
            .map((c) => c.label).join(" + ") || "Aller Loot",
        o.categories.find((c) => c.id === view.category)?.name || "Alle Raids",
    ].filter(Boolean).join(" · ");

    return (
        <>
            <PageHead
                icon="inv_misc_coin_02"
                tone="lootcouncil"
                kicker={kicker}
                title="Loot-Council"
                action={<Button icon="inv_misc_bag_10" onClick={() => navigate(dropHref())}>Drop prüfen</Button>}
            />

            <FilterBar
                data={data}
                view={view}
                patch={patch}
                armoryCount={armoryCount}
                simulated={simulated}
                simulatable={simulatable.length}
            />

            <CouncilTabs tab={tab} patch={patch} rosterCount={roster.length} gapCount={gaps.length} />

            {tab === "roster" ? (
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

            {tab === "bis" ? (
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
            {tab === "bislists" ? <BisListsTab view={view} patch={patch} /> : null}

            {/* Wer hat was bekommen, nebeneinander: dieselben Raider und derselbe
                Loot wie im Raider-Tab, nur als Matrix statt als Tooltip je Zeile. */}
            {view.tab === "compare" ? <CompareTab roster={roster} view={view} patch={patch} contents={o.contents} /> : null}

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
        </>
    );
}
