import { useState } from "react";
import { Link } from "react-router-dom";
import {
    RAID_UNAVAILABLE, getSignupRaid, saveSignupRaid,
    type OwnSignup, type OwnSignupRow, type SignupCounts,
} from "../api";
import { useApi } from "../hooks/useApi";
import { Button, RaidLoader } from "../components/ui";
import SignupDialog from "../components/signup/SignupDialog";
import { classesForRows, missingVersionLabel, profileForRows, statusBadgeLabel } from "../lib/signups/status";
import { useT } from "../i18n";
import "../styles/signups.css";

// One raid behind a signup link (#1074), for whoever cannot reach it through the
// list of the active server: no active server, or another one. It shows this raid's
// dialog and nothing else, under the rules of the raid's own server, and it switches
// no server (GET and PUT /api/signups/raid). Closing the dialog leaves the raid's name
// and a way to reopen it. `onClose`: the way back to the list a member came from.

export default function SignupRaidPage({ eventId, accountName, onClose }: {
    eventId: string;
    accountName: string;
    onClose?: () => void;
}) {
    const t = useT();
    const raid = useApi(() => getSignupRaid(eventId), [eventId]);
    const { data, error, setData } = raid;
    const [dialogOpen, setDialogOpen] = useState(true);

    // A group's raids answer with the first one, so the row's id may differ from the link's.
    const row = data?.events.find((e): e is OwnSignupRow => e.source === "eventhelper") || null;

    if (!data && !error) return <RaidLoader text={t("signups.page.loading")} />;

    const back = onClose
        ? <Button variant="ghost" onClick={onClose}>{t("signups.raidLink.backToList")}</Button>
        : <Link className="mlink" to="/">{t("shell.app.backHome")}</Link>;

    if (!data || !row) {
        // The server gives an unknown raid and a closed one the same answer: so does this page.
        const failed = error && error.code !== RAID_UNAVAILABLE;
        return (
            <div className="empty app-notice">
                <p>{failed ? t("signups.page.loadError", { message: error.message }) : t("signups.raidLink.unavailable")}</p>
                {back}
            </div>
        );
    }

    const close = () => setDialogOpen(false);

    const onSaved = (savedId: string, signup: OwnSignup, counts: SignupCounts, created?: boolean) => {
        setData((d) => d && ({
            ...d,
            events: d.events.map((e) => (e.id === savedId && e.source === "eventhelper" ? { ...e, mine: signup, counts, attending: counts.attending, accounts: counts.accounts } : e)),
        }));
        // The dialog added a character to the profile (#907): the next opening offers it.
        if (created) void raid.reload();
        close();
    };

    const mine = row.mine;
    return (
        <>
            {!dialogOpen && (
                <div className="empty app-notice">
                    <p><b>{row.title}</b></p>
                    <p>{mine ? t("signups.raidLink.yours", { status: statusBadgeLabel(mine.status) }) : t("signups.raidLink.notSignedUp")}</p>
                    <Button onClick={() => setDialogOpen(true)}>{mine ? t("signups.dialog.change") : t("signups.signUp")}</Button>
                    <a className="mlink" href={`/e/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">{t("signups.dialog.publicPage")}</a>
                    {back}
                </div>
            )}
            <SignupDialog
                row={dialogOpen ? row : null}
                profile={profileForRows(data.profile, [row])}
                missingVersion={missingVersionLabel(data.profile, [row], data.versions)}
                lastName={!!data.versions?.find((v) => v.id === row.versionId)?.lastName}
                classes={classesForRows(data, [row])}
                save={saveSignupRaid}
                onClose={close}
                onSaved={onSaved}
                accountName={accountName}
            />
        </>
    );
}
