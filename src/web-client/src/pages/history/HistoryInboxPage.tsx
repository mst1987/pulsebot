// The Addon-Inbox as its own page under Historie & Loot (/history/inbox).
//
// A page rather than a dialog from the head button: a raid week with four raids
// brings four cards, each with its own event choice, and that does not fit into
// a modal. The head button on the history page leads here with the open count.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    getHistoryData, getLootInbox } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { useToast } from "../../components/shell/Jobs";
import { IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { ChevronLeftIcon } from "../../components/ui/icons";
import AllSettingsLink from "../../components/settings/AllSettingsLink";
import { InboxSessionCard, LinkedSessions } from "./LootInboxTab";
import { InfoTip } from "../../components/loot/LootFilters";
import "../../styles/history-loot.css";
import RaidLoader from "../../components/ui/RaidLoader";
import Segment from "../../components/ui/Segment";
import { DismissedList, WaitingList } from "./InboxWaiting";
import { tParts, useT } from "../../i18n";

type Tab = "ready" | "waiting" | "dismissed";

export default function HistoryInboxPage() {
    const t = useT();
    const navigate = useNavigate();
    const toast = useToast();
    // One game version at a time (#741): the sessions of its raids and those not matched yet.
    const { version } = useContentVersion();
    const inbox = useApi(() => (version ? getLootInbox(version) : getLootInbox()), [version]);
    const sessions = inbox.data ? inbox.data.sessions : null;
    const linked = inbox.data?.linked || [];
    const loadError = inbox.error;
    // The full event list and the category names, for "Anderes Event" — loaded
    // beside the inbox; the cards work without it (their candidates come along
    // and the no-event path stays), so a failed load is not shown.
    const history = useApi(() => getHistoryData(), []);
    const events = history.data?.events || [];
    const categories = history.data?.categories || [];

    // Uploads that found no raid by themselves (#1002) and those dismissed in the last 14 days.
    const waiting = inbox.data?.waiting || [];
    const waitingBanks = inbox.data?.waitingBanks || [];
    const dismissed = inbox.data?.dismissed || [];
    const waitCount = waiting.length + waitingBanks.length;
    const [picked, setTab] = useState<Tab | null>(null);
    // Open on "Wartet auf Zuordnung" when nothing is ready but something waits.
    const tab: Tab = picked || (!sessions?.length && waitCount ? "waiting" : "ready");

    const afterChange = (msg: string, error?: boolean) => {
        toast(msg, error ? "err" : undefined);
        inbox.reload();
    };

    return (
        <>
            <div className="hl-inbox-head">
                <IconButton icon={<ChevronLeftIcon />} tip={t("history.shared.back")} onClick={() => navigate("/history")} />
                <div>
                    <div className="kicker">{t("history.shared.kicker")}</div>
                    <h1>
                        {t("history.page.inbox")}
                        {!!sessions?.length && <Badge tone="mid" count>{tParts("history.page.inboxOpen", { count: sessions.length })}</Badge>}
                    </h1>
                </div>
                <InfoTip
                    tip={t("history.inbox.infoTip")}
                    sub={t("history.inbox.infoSub")}
                />
                <div className="ph-act">
                    <AllSettingsLink hide className={buttonClass("ghost", "md", true)} section="verbindungen">
                        <WowIcon name="addons" size={22} />{t("history.inbox.manageToken")}
                    </AllSettingsLink>
                </div>
            </div>

            {inbox.data && (waitCount > 0 || dismissed.length > 0) && (
                <div className="hl-inbox-tabs">
                    <Segment<Tab>
                        ariaLabel={t("history.waiting.tabs")}
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: "ready", label: t("history.waiting.tabReady", { count: sessions?.length || 0 }) },
                            { value: "waiting", label: t("history.waiting.tabWaiting", { count: waitCount }), tip: t("history.waiting.tabWaitingTip") },
                            { value: "dismissed", label: t("history.waiting.tabDismissed", { count: dismissed.length }), tip: t("history.waiting.tabDismissedTip") },
                        ]}
                    />
                </div>
            )}
            {tab === "waiting" && <WaitingList waiting={waiting} banks={waitingBanks} onDone={afterChange} />}
            {tab === "dismissed" && <DismissedList dismissed={dismissed} onDone={afterChange} />}
            {tab === "ready" && <>
            {loadError && <div className="empty">{tParts("history.inbox.loadError", { message: loadError.message })}</div>}
            {!loadError && !sessions && <RaidLoader text={t("history.inbox.loading")} />}
            {!loadError && sessions && !sessions.length && (
                <div className="dash-card hl-card">
                    <div className="empty">
                        {t("history.inbox.empty")}<br />
                        {t("history.inbox.emptyHint")}{" "}
                        <AllSettingsLink inline className="mlink" section="verbindungen">{t("history.inbox.emptyLink")}</AllSettingsLink>.
                    </div>
                </div>
            )}
            {sessions?.map((s) => (
                <InboxSessionCard
                    key={s.id} session={s} events={events} categories={categories}
                    onDone={afterChange}
                />
            ))}
            <LinkedSessions linked={linked} />
            </>}
        </>
    );
}
