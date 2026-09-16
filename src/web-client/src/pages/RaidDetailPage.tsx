// Raid-Detail (design issue #219): the head shows where the raid stands as a
// progress bar (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs), below it
// the tabs — Roster, Setup (only an own event, #263), Loot, Logs. Everything
// that is a form opens as a dialog.
// The parts live in pages/raid-detail/; this file loads the data, holds which
// tab and which dialog is open, and wires the steps to them.
import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { getRaidDetail, type ApiError, type RaidDetailData, type RaidDetailModal, type RaidPrimaryAction, type RaidStep } from "../api";
import { usePersistedSearchParam } from "../lib/persistedState";
import type { ShellContext } from "../components/Shell";
import { useJobs } from "../components/Jobs";
import WowIcon from "../components/ui/WowIcon";
import RaidDetailHero from "./raid-detail/RaidDetailHero";
import RosterTab from "./raid-detail/RosterTab";
import LootTab from "./raid-detail/LootTab";
import LogsTab from "./raid-detail/LogsTab";
import SetupEditor from "./raid-detail/SetupEditor";
import useEvaluate from "./raid-detail/useEvaluate";
import NotifyModal from "./raid-detail/modals/NotifyModal";
import SheetModal from "./raid-detail/modals/SheetModal";
import SoftresModal from "./raid-detail/modals/SoftresModal";
import PingModal from "./raid-detail/modals/PingModal";
import PlayerModal from "./raid-detail/modals/PlayerModal";
import LootAddModal from "./raid-detail/modals/LootAddModal";
import LogAssignModal from "./raid-detail/modals/LogAssignModal";
import type { PlayerRef, RaidCtx } from "./raid-detail/meta";
import "../styles/raid-detail.css";
import RaidLoader from "../components/ui/RaidLoader";

type Tab = "roster" | "setup" | "loot" | "logs";
const TABS: Tab[] = ["roster", "setup", "loot", "logs"];

/**
 * The six tabs this page used to have, mapped onto the three it has now — so a
 * bookmark or a link posted in Discord still lands in the right place. The two
 * form tabs open their dialog on top of the roster.
 */
const LEGACY_TABS: Record<string, { tab: Tab; modal?: RaidDetailModal }> = {
    setup: { tab: "roster" },
    attendance: { tab: "roster" },
    actions: { tab: "roster", modal: "notify" },
    softres: { tab: "roster", modal: "softres" },
};

const TAB_META: Record<Tab, { label: string; icon: string }> = {
    roster: { label: "Roster", icon: "achievement_guildperk_everybodysfriend" },
    setup: { label: "Setup", icon: "inv_misc_map_01" },
    loot: { label: "Loot", icon: "inv_misc_bag_10" },
    logs: { label: "Logs", icon: "inv_misc_pocketwatch_01" },
};

export default function RaidDetailPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams] = useSearchParams();
    const eventId = searchParams.get("event") || "";
    // Remembered across raids: opening the next event lands on the tab that was
    // worked in last (the ?event= param is kept by the hook).
    const [tab, switchTab] = usePersistedSearchParam<Tab>("raid-detail-tab", "tab", "roster", TABS);
    // ?tab=setup is a tab of its own again (the setup editor of an own event, #263);
    // for a Raid-Helper event it still lands on the roster, once the event is known.
    const tabParam = searchParams.get("tab") || "";
    const legacy = tabParam === "setup" ? undefined : LEGACY_TABS[tabParam];

    const jobs = useJobs();
    const [data, setData] = useState<RaidDetailData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [modal, setModal] = useState<RaidDetailModal | null>(legacy?.modal || null);
    const [player, setPlayer] = useState<PlayerRef | null>(null);

    const load = () => {
        getRaidDetail(eventId).then(setData).catch((err: ApiError) => setError(err));
    };
    useEffect(load, [eventId]);

    // An old ?tab= value: rewrite it to the tab it became (the dialog it maps to
    // was already opened by the initial state above).
    useEffect(() => {
        if (legacy) switchTab(legacy.tab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [legacy]);

    // Shared success handler for every mutating action: toast the message, then
    // reload so the progress bar and the tabs reflect the new state. An empty
    // message means the action already reported itself through its job toast.
    const afterChange = (msg: string) => {
        if (msg) jobs.notify(msg);
        load();
    };

    const ctx: RaidCtx | null = data && {
        data, eventId, csrfToken, onChanged: afterChange, openModal: setModal, openPlayer: setPlayer,
    };
    const evaluator = useEvaluate({ csrfToken, onChanged: afterChange });

    const backLink = <p className="note"><Link className="mlink" to="/raids">← Zurück zur Event-Übersicht</Link></p>;
    if (error) return <>{backLink}<div className="empty">Fehler beim Laden: {error.message}</div></>;
    if (!data || !ctx) return <RaidLoader text="Raid wird geladen" />;

    // Only an own event has a setup editor; a Raid-Helper event's setup is its raidplan in the roster.
    const ownEvent = data.event.source === "eventhelper";
    const tabs = TABS.filter((t) => t !== "setup" || ownEvent);
    const shown: Tab = tab === "setup" && !ownEvent ? LEGACY_TABS.setup.tab : tab;

    const openStep = (step: RaidStep) => {
        if (step.open.modal) setModal(step.open.modal);
        else if (step.open.tab) switchTab(step.open.tab);
    };
    const runPrimary = (action: RaidPrimaryAction) => {
        if (action.modal) setModal(action.modal);
        else if (action.tab) switchTab(action.tab);
        else if (action.evaluate) {
            const log = data.eventLogs.find((l) => l.id === action.evaluate!.logId);
            if (log) evaluator.evaluate(log, action.evaluate.section);
        }
    };
    const primaryEval = data.progress?.primary?.evaluate;
    const counts: Record<Tab, number> = {
        roster: data.setup?.total || 0,
        setup: data.ownSetup?.placed || 0,
        loot: data.lootItems.length,
        logs: data.eventLogs.length,
    };
    const close = () => setModal(null);

    return (
        <div className="rd-page">
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}

            <RaidDetailHero
                data={data} onStep={openStep} onPrimary={runPrimary}
                primaryRunning={!!primaryEval && evaluator.isRunning(primaryEval.logId, primaryEval.section)}
            />

            <div className="tabs rd-tabs" role="tablist">
                {tabs.map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={shown === t} className={`tab-btn${shown === t ? " active" : ""}`} onClick={() => switchTab(t)}>
                        <WowIcon name={TAB_META[t].icon} size={16} />
                        {TAB_META[t].label}
                        <span className="tab-count">{counts[t]}</span>
                    </button>
                ))}
            </div>

            {shown === "roster" && <RosterTab ctx={ctx} />}
            {shown === "setup" && <SetupEditor ctx={ctx} />}
            {shown === "loot" && <LootTab ctx={ctx} />}
            {shown === "logs" && <LogsTab ctx={ctx} evaluator={evaluator} />}

            <NotifyModal ctx={ctx} open={modal === "notify"} onClose={close} />
            <SheetModal ctx={ctx} open={modal === "sheet"} onClose={close} />
            <SoftresModal ctx={ctx} open={modal === "softres"} onClose={close} />
            <PingModal ctx={ctx} open={modal === "ping"} onClose={close} />
            <LootAddModal ctx={ctx} open={modal === "loot"} onClose={close} />
            <LogAssignModal ctx={ctx} open={modal === "log"} onClose={close} />
            <PlayerModal ctx={ctx} player={player} onClose={() => setPlayer(null)} />
        </div>
    );
}
