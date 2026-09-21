// Raid-Detail (design issue #219): the head shows where the raid stands as a
// progress bar (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs), below it
// the tabs — Roster, Setup (only an own event, #263), Loot, Logs. Everything
// that is a form opens as a dialog.
// The parts live in pages/raid-detail/; this file loads the data, holds which
// tab and which dialog is open, and wires the steps to them.
//
// An *own* event answers the orga's one question ("was ist als Nächstes zu
// tun?") as the five-step cockpit instead (#319, StepBar.tsx): the server sends
// it as `data.steps`, every step names at most one deed, and this file is the
// one place that turns such a deed into a dialog, a tab, a menu action or an
// evaluation. A Raid-Helper event has no `steps` and keeps today's view.
import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    canAccess, getRaidDetail, reopenRaid, setRaidSignupsOpen,
    type ApiError, type RaidDetailData, type RaidDetailModal, type RaidEventSteps,
    type RaidPrimaryAction, type RaidStep, type RaidStepDeed,
} from "../api";
import { useConfirm } from "../components/ui/Modal";
import type { ManageAction } from "../lib/eventManage";
import { withoutDeeds } from "../lib/raidSteps";
import ManageMenu from "./raid-detail/manage/ManageMenu";
import MoveModal from "./raid-detail/manage/MoveModal";
import CancelModal from "./raid-detail/manage/CancelModal";
import DeleteModal from "./raid-detail/manage/DeleteModal";
import RaiderModal from "./raid-detail/manage/RaiderModal";
import HistoryModal from "./raid-detail/manage/HistoryModal";
import InviteModal from "./raid-detail/manage/InviteModal";
import "../styles/event-manage.css";
import RaidCreateDialog from "../components/RaidCreateDialog";
import { usePersistedSearchParam } from "../lib/persistedState";
import type { ShellContext } from "../components/Shell";
import { useJobs } from "../components/Jobs";
import WowIcon from "../components/ui/WowIcon";
import RaidDetailHero from "./raid-detail/RaidDetailHero";
import StepBar from "./raid-detail/StepBar";
import RosterTab from "./raid-detail/RosterTab";
import LootTab from "./raid-detail/LootTab";
import LogsTab from "./raid-detail/LogsTab";
import SetupEditor from "./raid-detail/SetupEditor";
import useEvaluate from "./raid-detail/useEvaluate";
import NotifyModal from "./raid-detail/modals/NotifyModal";
import SheetModal from "./raid-detail/modals/SheetModal";
import SoftresModal from "./raid-detail/modals/SoftresModal";
import LootSystemModal from "./raid-detail/modals/LootSystemModal";
import PingModal from "./raid-detail/modals/PingModal";
import PlayerModal from "./raid-detail/modals/PlayerModal";
import LootAddModal from "./raid-detail/modals/LootAddModal";
import LogAssignModal from "./raid-detail/modals/LogAssignModal";
import type { PlayerRef, RaidCtx } from "./raid-detail/meta";
import "../styles/raid-detail.css";
import RaidLoader from "../components/ui/RaidLoader";
import { useT } from "../i18n";

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

// Labels are looked up at render time: raidDetail.page.tab.<tab>.
const TAB_ICONS: Record<Tab, string> = {
    roster: "achievement_guildperk_everybodysfriend",
    setup: "inv_misc_map_01",
    loot: "inv_misc_bag_10",
    logs: "inv_misc_pocketwatch_01",
};

export default function RaidDetailPage() {
    const t = useT();
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

    const backLink = <p className="note"><Link className="mlink" to="/raids">{t("raidDetail.page.back")}</Link></p>;
    if (error) return <>{backLink}<div className="empty">{t("raidDetail.page.loadError", { message: error.message })}</div></>;
    if (!data || !ctx) return <RaidLoader text={t("raidDetail.page.loading")} />;

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
        else if (action === "invite") setModal("invite");
        else if (action === "history") setModal("history");
        else if (action === "cancel") setModal("cancel");
        else if (action === "delete") setModal("delete");
        else if (action === "setup") switchTab("setup");
        // The three the old progress bar used to be the only way to (#319).
        else if (action === "notify") setModal("notify");
        else if (action === "sheet") setModal("sheet");
        else if (action === "softres") setModal("softres");
        else if (action === "signups") {
            const open = !!ev.signupsClosed;
            const ok = await ask(open
                ? { title: t("raidDetail.page.signups.openTitle"), text: t("raidDetail.page.signups.openText"), action: t("raidDetail.page.signups.openAction"), tone: "primary", icon: "inv_misc_note_02" }
                : { title: t("raidDetail.page.signups.closeTitle"), text: t("raidDetail.page.signups.closeText"), action: t("raidDetail.page.signups.closeAction"), tone: "primary", icon: "inv_misc_note_02" });
            if (!ok) return;
            try {
                const r = await setRaidSignupsOpen(csrfToken, { event: ev.id, open });
                afterChange([r.message, ...(r.warnings || [])].join("\n"));
            } catch (err) {
                jobs.notify((err as ApiError).message, "err");
            }
        } else if (action === "reopen") {
            const ok = await ask({
                title: t("raidDetail.page.reopen.title"), action: t("raidDetail.page.reopen.action"), tone: "primary", icon: "spell_holy_divineintervention",
                text: ev.cancelArchived ? t("raidDetail.page.reopen.textArchived") : t("raidDetail.page.reopen.text"),
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

    // A step's one deed, whatever kind it is (#319) — the single place that maps
    // the server's answer onto this page's dialogs, tabs and menu actions.
    const runDeed = (deed: RaidStepDeed) => {
        if (deed.manage) runManage(deed.manage);
        else if (deed.modal) setModal(deed.modal);
        else if (deed.tab) switchTab(deed.tab);
        else if (deed.evaluate) {
            const log = data.eventLogs.find((l) => l.id === deed.evaluate!.logId);
            if (log) evaluator.evaluate(log, deed.evaluate.section);
        }
    };
    // Own event: the five-step bar. Without raids write it only informs.
    const cockpit: RaidEventSteps | null = data.steps ? (canManage ? data.steps : withoutDeeds(data.steps)) : null;
    const cockpitEval = cockpit?.action?.evaluate;

    return (
        <div className="rd-page">
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}

            <RaidDetailHero
                data={data} onStep={openStep} onPrimary={runPrimary}
                onLootSystem={canAccess(user, "raids", "write") ? () => setModal("lootsystem") : undefined}
                primaryRunning={!!primaryEval && evaluator.isRunning(primaryEval.logId, primaryEval.section)}
                cockpit={cockpit ? (
                    <StepBar
                        progress={cockpit} onDeed={runDeed}
                        running={!!cockpitEval && evaluator.isRunning(cockpitEval.logId, cockpitEval.section)}
                    />
                ) : undefined}
                manage={canManage ? (
                    <ManageMenu
                        state={{ cancelled: data.event.status === "cancelled", signupsClosed: !!data.event.signupsClosed, isPast: !!data.event.isPast, logCount: data.event.logCount || 0, softres: data.lootSystem?.softres, invite: !!data.ownSetup?.approvedAt }}
                        onAction={runManage}
                    />
                ) : undefined}
            />

            <div className="tabs rd-tabs" role="tablist">
                {tabs.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={shown === id} className={`tab-btn${shown === id ? " active" : ""}`} onClick={() => switchTab(id)}>
                        <WowIcon name={TAB_ICONS[id]} size={16} />
                        {t(`raidDetail.page.tab.${id}`)}
                        <span className="tab-count">{counts[id]}</span>
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
            <LootSystemModal ctx={ctx} open={modal === "lootsystem"} onClose={close} />
            <PingModal ctx={ctx} open={modal === "ping"} onClose={close} />
            <LootAddModal ctx={ctx} open={modal === "loot"} onClose={close} />
            <LogAssignModal ctx={ctx} open={modal === "log"} onClose={close} />
            <PlayerModal ctx={ctx} player={player} onClose={() => setPlayer(null)} />
            {canManage && (
                <>
                    <MoveModal ctx={ctx} open={modal === "move"} onClose={close} />
                    <CancelModal ctx={ctx} open={modal === "cancel"} onClose={close} />
                    <DeleteModal ctx={ctx} open={modal === "delete"} onClose={close} />
                    <RaiderModal ctx={ctx} open={modal === "raider"} onClose={close} />
                    <HistoryModal ctx={ctx} open={modal === "history"} onClose={close} />
                    <InviteModal ctx={ctx} open={modal === "invite"} onClose={close} />
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
