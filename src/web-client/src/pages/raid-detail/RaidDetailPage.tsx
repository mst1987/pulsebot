// Raid-Detail (design issue #219): the head shows where the raid stands as a
// progress bar (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs), below it
// the tabs — Roster, Setup (only an own event, #263), Loot, Logs. Everything
// that is a form opens as a dialog.
// The parts live in pages/raid-detail/; this file loads the data, holds which
// tab and which dialog is open, and wires the steps to them.
//
// An *own* event answers the orga's one question ("was ist als Nächstes zu
// tun?") as the six-step cockpit instead (#319, StepBar.tsx): the server sends
// it as `data.steps`, every step names at most one deed, and this file is the
// one place that turns such a deed into a dialog, a tab, a menu action or an
// evaluation. A Raid-Helper event has no `steps` and keeps today's view.
//
// A raid category plans with the raid plan OR a Google Sheet, never both
// (`data.planning`, src/services/events/planning.js): "sheet" hides the
// Raidplan tab and its switch, "raidplan" the sheet dialog and its menu entry.
// The steps the server sends are gated the same way.
import { Suspense, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
    canAccess, getRaidDetail, recreateChannel, reopenRaid, setRaidSignupsOpen, setRaidplanLink,
    type ApiError, type RaidDetailModal, type RaidEventSteps,
    type RaidPrimaryAction, type RaidStep, type RaidStepDeed } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useConfirm } from "../../components/ui/Modal";
import BackButton from "../../components/ui/BackButton";
import ArchiveBanner from "../../components/raid/ArchiveBanner";
import { lootSystemEntry, raidhelperMenu, type ManageAction } from "../../lib/raids/eventManage";
import { withoutDeeds } from "../../lib/raids/raidSteps";
import ManageMenu from "./manage/ManageMenu";
import MoveModal from "./manage/MoveModal";
import CancelModal from "./manage/CancelModal";
import DeleteModal from "./manage/DeleteModal";
import RaiderModal from "./manage/RaiderModal";
import HistoryModal from "./manage/HistoryModal";
import InviteModal from "./manage/InviteModal";
import RaidplanLinkModal from "./manage/RaidplanLinkModal";
import "../../styles/event-manage.css";
import RaidCreateDialog from "../../components/raid-create/RaidCreateDialog";
import { usePersistedSearchParam } from "../../lib/ui/persistedState";
import type { ShellContext } from "../../components/shell/Shell";
import { useJobs } from "../../components/shell/Jobs";
import WowIcon from "../../components/ui/WowIcon";
import RaidDetailHero from "./RaidDetailHero";
import StepBar from "./StepBar";
import RosterTab from "./RosterTab";
import LootTab from "./LootTab";
import LogsTab from "./LogsTab";
import SetupEditor from "./setup/SetupEditor";
import useEvaluate from "./useEvaluate";
import NotifyModal from "./modals/NotifyModal";
import SheetModal from "./modals/SheetModal";
import RaidplanPostModal from "./modals/RaidplanPostModal";
import SoftresModal from "./modals/SoftresModal";
import LootSystemModal from "./modals/LootSystemModal";
import PingModal from "./modals/PingModal";
import PlayerModal from "./modals/PlayerModal";
import LootAddModal from "./modals/LootAddModal";
import LogAssignModal from "./modals/LogAssignModal";
import type { PlayerRef, RaidCtx } from "./meta";
import "../../styles/raid-detail.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { OrgaZone } from "../../components/ui/OrgaZone";
import { isOrga } from "../../lib/app/orgaArea";
import { useT } from "../../i18n";
import { lazyWithReload } from "../../lib/app/chunkReload";

// The raidplan editor (board, workspace, its css) is by far the heaviest part
// of this page and only one of five tabs — it is a chunk of its own (#436).
const RaidplanTab = lazyWithReload(() => import("./RaidplanTab"));

type Tab ="roster" | "setup" | "loot" | "logs" | "plan";
const TABS: Tab[] = ["roster", "setup", "plan", "loot", "logs"];

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
    plan: "inv_misc_map02",
};

export default function RaidDetailPage() {
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
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
    const detail = useApi(() => getRaidDetail(eventId), [eventId]);
    const { data } = detail;
    const [modal, setModal] = useState<RaidDetailModal | null>(legacy?.modal || null);
    const [player, setPlayer] = useState<PlayerRef | null>(null);
    // "Raidplan aktivieren" of a Raid-Helper event (docs/raidplan.md, "Raid-Helper-Events")
    const [linkOpen, setLinkOpen] = useState(false);
    // "Kanal anlegen" beside the head's "Kanal fehlt" (#537's action, the dashboard has it too)
    const [recreating, setRecreating] = useState(false);

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
        detail.reload();
    };

    // An event of a hidden game version (#563) is an archive: readable, nothing
    // about it can be changed (the server refuses every write with 409 as well).
    const archived = (data && data.archived) || null;
    // The orga (lib/app/orgaArea.ts — a full admin or an orga role, never an area right) gets the
    // whole cockpit; a raider the raid as it interests them: date, category, signup list, setup,
    // loot and the links. The server already left the orga's parts out of a raider's payload.
    const orga = isOrga(user);
    const canWrite = orga && canAccess(user, "raids", "write") && !archived;
    const ctx: RaidCtx | null = data && {
        data, eventId, onChanged: afterChange, openModal: setModal,
        // the player dialog shows other people's raids and loot: the orga's
        openPlayer: orga ? setPlayer : undefined,
        canManage: data.event.source === "eventhelper" && canWrite,
        orga, user,
    };
    const evaluator = useEvaluate({ onChanged: afterChange });

    // The way back is a visible button above the head, not the breadcrumb alone.
    const backLink = <div className="rd-back"><BackButton to="/raids" size="sm" label={t("raidDetail.page.back")} /></div>;
    if (detail.error) return <div className="rd-page">{backLink}<div className="empty">{t("raidDetail.page.loadError", { message: detail.error.message })}</div></div>;
    if (!data || !ctx) return <RaidLoader text={t("raidDetail.page.loading")} />;

    // Only an own event has a setup editor; a Raid-Helper event's setup is its raidplan in the roster.
    const ownEvent = data.event.source === "eventhelper";
    // The raid plan (boards per boss): always on an own event, on a Raid-Helper event once the orga switched it on (its players then
    // come from Raid-Helper). The setup editor stays an own event's. The plan is its own area ("raidplan", docs/permissions.md).
    const planning = data.planning;
    const hasPlan = canAccess(user, "raidplan") && planning !== "sheet" && (ownEvent || !!data.event.raidplanEnabled);
    // The sheet dialog only where the category plans with a sheet (an older server without `planning` keeps it).
    const hasSheet = planning !== "raidplan";
    // the logs are the orga's work: a raider has no Logs tab
    const tabs = TABS.filter((t) => (t === "setup" ? ownEvent : t === "plan" ? hasPlan : t === "logs" ? orga : true));
    const shown: Tab = (tab === "setup" && !ownEvent) || (tab === "plan" && !hasPlan) || (tab === "logs" && !orga) ? LEGACY_TABS.setup.tab : tab;

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
    // An own event's roster comes from its signups (data.setup stays an empty
    // Raid-Helper raidplan for it, see raidDetailView.js's setupPart) — without
    // this branch the tab always showed "0" once #424 folded the roster into
    // this counts object (#479).
    const counts: Record<Tab, number> = {
        roster: ownEvent ? (data.ownSignups?.length || 0) : (data.setup?.total || 0),
        setup: data.ownSetup?.placed || 0,
        loot: data.lootItems.length,
        logs: data.eventLogs.length,
        plan: 0,
    };
    const close = () => setModal(null);

    // Event verwalten (#288): one menu for an own event, only with raids write.
    // Editing reuses the create dialog (#261), everything else is a dialog or one question.
    const canManage = !!ctx.canManage;
    // A Raid-Helper event's menu holds the raid plan switch (raidplan write) and the loot system.
    const canSwitchPlan = orga && !ownEvent && !archived && planning !== "sheet" && canAccess(user, "raidplan", "write");
    // The loot system (once a chip in the head) is a menu entry for whoever may change it (raids write).
    const lootLabel = canWrite && data.lootSystem ? `${data.lootSystem.label}${data.lootSystem.softresExtra ? " + Softres" : ""}` : "";
    const raidhelperEntries = ownEvent ? [] : [
        ...(canSwitchPlan ? raidhelperMenu({ planEnabled: !!data.event.raidplanEnabled, disabled: !!data.event.raidhelperDisabled }) : []),
        ...(lootLabel ? [lootSystemEntry(lootLabel)] : []),
    ];
    const recreate = async () => {
        setRecreating(true);
        try {
            const r = await recreateChannel(data.event.id);
            afterChange([r.message, ...(r.warnings || [])].join("\n"));
        } catch (err) {
            jobs.notify((err as ApiError).message, "err");
        } finally {
            setRecreating(false);
        }
    };
    const runManage = async (action: ManageAction) => {
        const ev = data.event;
        if (action === "lootsystem") setModal("lootsystem");
        else if (action === "raidplanOn") setLinkOpen(true);
        else if (action === "raidplanOff") {
            const ok = await ask({ title: t("raidDetail.raidplanLink.offTitle"), text: t("raidDetail.raidplanLink.offText"), action: t("raidDetail.raidplanLink.offAction"), tone: "danger", icon: "inv_misc_map02" });
            if (!ok) return;
            try {
                await setRaidplanLink({ event: ev.id, enabled: false });
                if (tab === "plan") switchTab("roster");
                afterChange(t("raidDetail.raidplanLink.deactivated"));
            } catch (err) {
                jobs.notify((err as ApiError).message, "err");
            }
        } else if (action === "edit") setEditing(true);
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
        else if (action === "sheet" && hasSheet) setModal("sheet");
        else if (action === "softres") setModal("softres");
        else if (action === "signups") {
            const open = !!ev.signupsClosed;
            const ok = await ask(open
                ? { title: t("raidDetail.page.signups.openTitle"), text: t("raidDetail.page.signups.openText"), action: t("raidDetail.page.signups.openAction"), tone: "primary", icon: "inv_misc_note_02" }
                : { title: t("raidDetail.page.signups.closeTitle"), text: t("raidDetail.page.signups.closeText"), action: t("raidDetail.page.signups.closeAction"), tone: "primary", icon: "inv_misc_note_02" });
            if (!ok) return;
            try {
                const r = await setRaidSignupsOpen({ event: ev.id, open });
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
                const r = await reopenRaid({ event: ev.id });
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
    // Own event: the six-step bar, the orga's. Without raids write it only informs; a raider gets none.
    const cockpit: RaidEventSteps | null = orga && data.steps ? (canManage ? data.steps : withoutDeeds(data.steps)) : null;
    const cockpitEval = cockpit?.action?.evaluate;

    return (
        <div className="rd-page">
            {backLink}
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}
            <ArchiveBanner archive={archived} />

            <RaidDetailHero
                data={data} user={user} orga={orga}
                onStep={archived ? () => undefined : openStep} onPrimary={archived ? () => undefined : runPrimary}
                lootInMenu={!!lootLabel && (canManage || raidhelperEntries.length > 0)}
                onRecreateChannel={canManage ? () => void recreate() : undefined} recreating={recreating}
                primaryRunning={!!primaryEval && evaluator.isRunning(primaryEval.logId, primaryEval.section)}
                cockpit={cockpit ? (
                    <StepBar
                        progress={cockpit} onDeed={runDeed}
                        running={!!cockpitEval && evaluator.isRunning(cockpitEval.logId, cockpitEval.section)}
                    />
                ) : undefined}
                manage={canManage ? (
                    <ManageMenu
                        state={{ cancelled: data.event.status === "cancelled", signupsClosed: !!data.event.signupsClosed, isPast: !!data.event.isPast, logCount: data.event.logCount || 0, softres: data.lootSystem?.softres, invite: !!data.ownSetup?.approvedAt, sheet: hasSheet, lootSystem: lootLabel || undefined }}
                        onAction={runManage}
                    />
                ) : raidhelperEntries.length > 0 ? (
                    <ManageMenu
                        entries={raidhelperEntries}
                        tipSub={canSwitchPlan ? t("raidDetail.manage.tipSubRaidhelper") : t("raidDetail.manage.tipSubLoot")}
                        onAction={runManage}
                    />
                ) : undefined}
            />

            <div className="tabs rd-tabs" role="tablist">
                {tabs.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={shown === id} className={`tab-btn${shown === id ? " active" : ""}`} onClick={() => switchTab(id)}>
                        <WowIcon name={TAB_ICONS[id]} size={16} />
                        {t(`raidDetail.page.tab.${id}`)}
                        {id !== "plan" && <span className="tab-count">{counts[id]}</span>}
                    </button>
                ))}
            </div>

            {shown === "roster" && <RosterTab ctx={ctx} />}
            {shown === "setup" && <SetupEditor ctx={ctx} />}
            {shown === "loot" && <LootTab ctx={ctx} />}
            {shown === "logs" && orga && <OrgaZone user={user}><LogsTab ctx={ctx} evaluator={evaluator} /></OrgaZone>}
            {shown === "plan" && <Suspense fallback={<RaidLoader />}><RaidplanTab ctx={ctx} /></Suspense>}

            {/* the action dialogs and the player dialog are the orga's: a raider gets none of them */}
            {orga && (
                <>
                    <NotifyModal ctx={ctx} open={modal === "notify"} onClose={close} />
                    {hasSheet && <SheetModal ctx={ctx} open={modal === "sheet"} onClose={close} />}
                    <SoftresModal ctx={ctx} open={modal === "softres"} onClose={close} />
                    <LootSystemModal ctx={ctx} open={modal === "lootsystem"} onClose={close} />
                    <PingModal ctx={ctx} open={modal === "ping"} onClose={close} />
                    <LootAddModal ctx={ctx} open={modal === "loot"} onClose={close} />
                    <LogAssignModal ctx={ctx} open={modal === "log"} onClose={close} />
                    <PlayerModal ctx={ctx} player={player} onClose={() => setPlayer(null)} />
                </>
            )}
            {data.raidplanPost && hasPlan && <RaidplanPostModal ctx={ctx} open={modal === "raidplan"} onClose={close} />}
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
            {canSwitchPlan && <RaidplanLinkModal ctx={ctx} open={linkOpen} onClose={() => setLinkOpen(false)} onDone={() => { detail.reload(); switchTab("plan"); }} />}
            {editing && (
                <RaidCreateDialog
                    open sourceId="" editEventId={data.event.id} userId={user?.id || ""}
                    onClose={() => setEditing(false)} onCreated={() => { setEditing(false); detail.reload(); }}
                />
            )}
        </div>
    );
}
