// One member of a roster in a drawer at the right edge (#655/#656, design
// canvas "Mitglied"): status as square fields (and the trial's end), the
// characters of this roster, the spec the first one counts with here ("Spec in
// diesem Roster"), the roster's Discord roles as switches, the
// attendance, the orga's note, the person's history, and "Aus dem Roster
// nehmen". Every change is saved at once; the page reloads the roster after it.
// Readers without the right to manage see the same facts without a control.
// Esc, the X or a click on the shade closes it.
import { useEffect, useState } from "react";
import {
    getRosterHistory, removeRosterMember, saveRosterMember, setRosterRole,
    type RosterDetail, type RosterMemberPatch, type RosterRoleResult, type RosterStatus,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { Button, IconButton, useConfirm } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { TrashIcon, XIcon } from "../../components/ui/icons";
import { changedRoleLines, statusSince } from "../../lib/roster/rosterEdit";
import { HistoryLines } from "./HistoryTab";
import { AttendanceSection, CharsSection, DrawerSection, NoteSection, RolesSection, SpecSection, TrialUntil } from "./MemberDrawerParts";
import { MemberAvatar, RoleResults, StatusPicker } from "./RosterParts";
import { useRosterAction } from "./useRosterAction";

export default function MemberDrawer({ data, userId, onClose, onChanged }: {
    data: RosterDetail;
    userId: string;
    onClose: () => void;
    /** A change was saved: the page loads the roster again. */
    onChanged: () => Promise<void> | void;
}) {
    const t = useT();
    const ask = useConfirm();
    const { run, busy } = useRosterAction();
    const [roleResults, setRoleResults] = useState<RosterRoleResult[]>([]);
    const [historyKey, setHistoryKey] = useState(0);
    const member = data.members.find((m) => m.userId === userId) || null;
    const manage = data.canManage;
    const rosterId = data.roster.id;
    const history = useApi(() => getRosterHistory(rosterId, { userId, limit: 20 }), [rosterId, userId, historyKey]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // a dialog over the drawer takes its own Esc
            if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const afterChange = async () => {
        await onChanged();
        setHistoryKey((k) => k + 1);
    };

    const save = async (id: string, patch: RosterMemberPatch) => {
        const result = await run(id, () => saveRosterMember(rosterId, userId, patch, "update"), (r) => {
            const lines = changedRoleLines(r.roles.results);
            return [t("roster.drawer.saved"), ...lines].join(" · ");
        });
        if (!result) return;
        setRoleResults(result.roles.results);
        await afterChange();
    };

    const setStatus = (status: RosterStatus) => save("status", status === "trial" || !member?.trialUntil ? { status } : { status, trialUntil: null });

    const toggleRole = async (roleId: string, give: boolean) => {
        const isLastRosterRole = !give && data.roster.discordRoles.some((r) => r?.id === roleId)
            && (member?.heldRoles || []).filter((id) => data.roster.discordRoles.some((r) => r?.id === id)).length <= 1;
        if (isLastRosterRole && !(await ask({
            title: t("roster.drawer.takeLastTitle"),
            text: t("roster.drawer.takeLastText", { name: member?.displayName || "" }),
            action: t("roster.drawer.takeRole"),
            tone: "danger",
        }))) return;
        const result = await run(`role-${roleId}`, () => setRosterRole(rosterId, userId, give, roleId), (r) => changedRoleLines([r.result])[0] || t("roster.drawer.roleUnchanged"));
        if (!result) return;
        setRoleResults([result.result]);
        await afterChange();
    };

    const remove = async () => {
        if (!member) return;
        const roles = [data.roster.mainRole, data.roster.trialRole].filter(Boolean).map((r) => `@${r?.name || r?.id}`).join(", ");
        if (!(await ask({
            title: t("roster.drawer.removeTitle", { name: member.displayName }),
            text: roles ? t("roster.drawer.removeText", { roles }) : t("roster.drawer.removeTextNoRole"),
            action: t("roster.drawer.remove"),
            tone: "danger",
        }))) return;
        const result = await run("remove", () => removeRosterMember(rosterId, userId), () => t("roster.drawer.removed", { name: member.displayName }));
        if (!result) return;
        setRoleResults(result.roles.results);
        await onChanged();
        if (result.roles.results.every((r) => r.ok)) onClose();
    };

    return (
        <>
            <button type="button" className="rn-shade" tabIndex={-1} aria-label={t("common.close")} onClick={onClose} />
            <aside className="rn-drawer" aria-label={t("roster.drawer.aria", { name: member?.displayName || "" })}>
                <div className="rn-dr-head">
                    {member && <MemberAvatar member={member} large />}
                    <div className="rn-dr-title">
                        <div className="rn-kick">{data.roster.name}</div>
                        <h2 className="rn-h2">{member ? member.displayName : t("roster.drawer.gone")}</h2>
                        {member && <div className="rn-sub">{statusSince(member)}</div>}
                    </div>
                    <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
                </div>
                <div className="rn-dr-body">
                    <RoleResults results={roleResults} />
                    {!member && <p className="rn-sub">{t("roster.drawer.goneText")}</p>}
                    {member && (
                        <>
                            <DrawerSection title={t("roster.drawer.status")} hint={manage ? undefined : t("roster.drawer.readOnly")}>
                                <StatusPicker value={member.status} onChange={setStatus} disabled={!manage || busy !== ""} label={t("roster.drawer.status")} />
                                {member.status === "trial" && <TrialUntil member={member} manage={manage} busy={busy !== ""} onSave={(iso) => save("trial", { trialUntil: iso })} />}
                                {manage && data.roster.trialRole && <p className="rn-sub">{t("roster.drawer.trialRoleHint", { role: `@${data.roster.trialRole.name || data.roster.trialRole.id}` })}</p>}
                            </DrawerSection>
                            <CharsSection member={member} data={data} busy={busy !== ""} onSave={(chars) => save("chars", { chars })} />
                            <SpecSection member={member} data={data} busy={busy !== ""} onSave={(spec) => save("spec", { spec })} />
                            <RolesSection member={member} data={data} busyRole={busy.startsWith("role-") ? busy : ""} onRole={toggleRole} />
                            <AttendanceSection member={member} data={data} onChanged={() => { void onChanged(); }} />
                            {manage && <NoteSection member={member} busy={busy === "note"} onSave={(note) => save("note", { note })} />}
                            <DrawerSection title={t("roster.drawer.history")}>
                                {history.data
                                    ? (history.data.entries.length ? <HistoryLines entries={history.data.entries} withUser={false} /> : <p className="rn-sub">{t("roster.hist.empty")}</p>)
                                    : history.error ? <p className="rn-sub">{t("roster.hist.loadError")}</p> : <RaidLoader compact text={t("roster.hist.loading")} />}
                            </DrawerSection>
                        </>
                    )}
                </div>
                {member && manage && (
                    <div className="rn-dr-foot">
                        <Button variant="danger" icon={<TrashIcon />} running={busy === "remove"} onClick={remove}>{t("roster.drawer.remove")}</Button>
                    </div>
                )}
            </aside>
        </>
    );
}
