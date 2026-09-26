// The Addon-Inbox as its own page under Historie & Loot (/history/inbox).
//
// A page rather than a dialog from the head button: a raid week with four raids
// brings four cards, each with its own event choice, and that does not fit into
// a modal. The head button on the history page leads here with the open count.
import { Link, useNavigate } from "react-router-dom";
import {
    getHistoryData, getLootInbox } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../components/Jobs";
import { IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { ChevronLeftIcon } from "../../components/icons";
import { InboxSessionCard, LinkedSessions } from "../../components/LootInboxTab";
import { InfoTip } from "../../components/LootFilters";
import "../../styles/historie-loot.css";
import RaidLoader from "../../components/ui/RaidLoader";

export default function HistoryInboxPage() {
    const navigate = useNavigate();
    const toast = useToast();
    const inbox = useApi(() => getLootInbox(), []);
    const sessions = inbox.data ? inbox.data.sessions : null;
    const linked = inbox.data?.linked || [];
    const loadError = inbox.error;
    // The full event list and the category names, for "Anderes Event" — loaded
    // beside the inbox; the cards work without it (their candidates come along
    // and the no-event path stays), so a failed load is not shown.
    const history = useApi(() => getHistoryData(), []);
    const events = history.data?.events || [];
    const categories = history.data?.categories || [];

    const afterChange = (msg: string) => {
        toast(msg);
        inbox.reload();
    };

    return (
        <>
            <div className="hl-inbox-head">
                <IconButton icon={<ChevronLeftIcon />} tip="Zurück zu Historie & Loot" onClick={() => navigate("/history")} />
                <div>
                    <div className="kicker">Historie &amp; Loot</div>
                    <h1>
                        Addon-Inbox
                        {!!sessions?.length && <Badge tone="mid" count>{sessions.length} offen</Badge>}
                    </h1>
                </div>
                <InfoTip
                    tip="Uploads vom WoW-Addon"
                    sub="Das Sync-Tool schickt jede Raid-Session hierher. Einmal übernehmen genügt: weiterer Loot desselben Raids landet danach automatisch im gewählten Event."
                />
                <div className="ph-act">
                    <Link className={buttonClass("ghost", "md", true)} to="/settings?section=lootsync">
                        <WowIcon name="inv_misc_enggizmos_27" size={22} />Sync-Token verwalten
                    </Link>
                </div>
            </div>

            {loadError && <div className="empty">Inbox konnte nicht geladen werden: {loadError.message}</div>}
            {!loadError && !sessions && <RaidLoader text="Inbox wird geladen" />}
            {!loadError && sessions && !sessions.length && (
                <div className="dash-card hl-card">
                    <div className="empty">
                        Keine offenen Addon-Uploads.<br />
                        Das Sync-Tool lädt Raid-Sessions hoch; ein Token dafür gibt es unter{" "}
                        <Link className="mlink" to="/settings?section=lootsync">Einstellungen → Loot-Sync</Link>.
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
        </>
    );
}
