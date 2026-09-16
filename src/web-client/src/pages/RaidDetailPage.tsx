// Raid-Detail (design issue #219): the head shows where the raid stands as a
// progress bar (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs), below it
// the tabs — Roster, Setup (only an own event, #263), Loot, Logs. Everything
// that is a form opens as a dialog.
// The parts live in pages/raid-detail/; this file loads the data, holds which
// tab and which dialog is open, and wires the steps to them.
import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    canAccess, getRaidDetail, reopenRaid, setRaidSignupsOpen,
    type ApiError, type RaidDetailData, type RaidDetailModal, type RaidPrimaryAction, type RaidStep,
} from "../api";
import { useConfirm } from "../components/ui/Modal";
import type { ManageAction } from "../lib/eventManage";
import ManageMenu from "./raid-detail/manage/ManageMenu";
import MoveModal from "./raid-detail/manage/MoveModal";
import CancelModal from "./raid-detail/manage/CancelModal";
import RaiderModal from "./raid-detail/manage/RaiderModal";
import HistoryModal from "./raid-detail/manage/HistoryModal";
import "../styles/event-manage.css";
import RaidCreateDialog from "../components/RaidCreateDialog";
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
    const { csrfToken, user } = useOutletContext<ShellContext>();
    const [editing, setEditing] = useState(false);
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
    const ask = useConfirm();
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
        canManage: data.event.source === "eventhelper" && canAccess(user, "raids", "write"),
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

    // Event verwalten (#288): one menu for an own event, only with raids write.
    // Editing reuses the create dialog (#261), everything else is a dialog or one question.
    const canManage = !!ctx.canManage;
    const runManage = async (action: ManageAction) => {
        const ev = data.event;
        if (action === "edit") setEditing(true);
        else if (action === "move") setModal("move");
        else if (action === "raider") setModal("raider");
        else if (action === "ping") setModal("ping");
        else if (action === "history") setModal("history");
        else if (action === "cancel") setModal("cancel");
        else if (action === "setup") switchTab("setup");
        else if (action === "signups") {
            const open = !!ev.signupsClosed;
            const ok = await ask(open
                ? { title: "Anmeldung wieder öffnen?", text: "Raider können sich wieder an- und ummelden. Die Event-Nachricht wird aktualisiert.", action: "Öffnen", tone: "primary", icon: "inv_misc_note_02" }
                : { title: "Anmeldung schließen?", text: "Neue Anmeldungen gehen nicht mehr — abmelden bleibt möglich, und die Orga kann weiter eintragen. Die Event-Nachricht zeigt „Anmeldung geschlossen“.", action: "Schließen", tone: "primary", icon: "inv_misc_note_02" });
            if (!ok) return;
            try {
                const r = await setRaidSignupsOpen(csrfToken, { event: ev.id, open });
                afterChange([r.message, ...(r.warnings || [])].join("\n"));
            } catch (err) {
                jobs.notify((err as ApiError).message, "err");
            }
        } else if (action === "reopen") {
            const ok = await ask({
                title: "Absage zurücknehmen?", action: "Zurücknehmen", tone: "primary", icon: "spell_holy_divineintervention",
                text: `Das Event ist wieder offen für Anmeldungen, die Nachricht verliert „ABGESAGT“.${ev.cancelArchived ? " Der Kanal bleibt im Archiv — zurückholen unter Kanäle." : ""} Wer eine Absage-DM bekam, erfährt davon nichts.`,
            });
            if (!ok) return;
            try {
                const r = await reopenRaid(csrfToken, { event: ev.id });
                afterChange([r.message, ...(r.warnings || [])].join("\n"));
            } catch (err) {
                jobs.notify((err as ApiError).message, "err");
            }
        }
    };

    return (
        <div className="rd-page">
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}

            <RaidDetailHero
                data={data} onStep={openStep} onPrimary={runPrimary}
                primaryRunning={!!primaryEval && evaluator.isRunning(primaryEval.logId, primaryEval.section)}
                manage={canManage ? (
                    <ManageMenu
                        state={{ cancelled: data.event.status === "cancelled", signupsClosed: !!data.event.signupsClosed, isPast: !!data.event.isPast, logCount: data.event.logCount || 0 }}
                        onAction={runManage}
                    />
                ) : undefined}
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
            {canManage && (
                <>
                    <MoveModal ctx={ctx} open={modal === "move"} onClose={close} />
                    <CancelModal ctx={ctx} open={modal === "cancel"} onClose={close} />
                    <RaiderModal ctx={ctx} open={modal === "raider"} onClose={close} />
                    <HistoryModal ctx={ctx} open={modal === "history"} onClose={close} />
                </>
            )}
            {editing && (
                <RaidCreateDialog
                    open sourceId="" editEventId={data.event.id} csrfToken={csrfToken} userId={user?.id || ""}
                    onClose={() => setEditing(false)} onCreated={() => { setEditing(false); load(); }}
                />
            )}
        </div>
    );
}
