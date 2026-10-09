// The "Abgleich" tab of a roster (#656, design canvas "Abgleich"): roster and
// Discord role side by side, four cards with one button per row - in the
// roster without the role ("Rolle geben", for all at once too), the role
// without the roster ("Ins Roster aufnehmen" / "Rolle nehmen"), in the roster
// without a character ("Vorschlag übernehmen" / "Anderen wählen") and
// characters of the category's logs nobody plays ("Person zuordnen" /
// "Ausblenden"). Nothing happens on its own; readers see the lists only.
import { useState, type ReactNode } from "react";
import {
    removeRosterMember, saveRosterMember, setRosterHidden, setRosterRole,
    type RosterDetail, type RosterSync,
} from "../../api";
import { useT } from "../../i18n";
import { Badge, Button, IconTile, Modal, WowIcon, useConfirm } from "../../components/ui";
import { classIconName } from "../../lib/roster/rosterView";
import { changedRoleLines } from "../../lib/roster/rosterEdit";
import { initialOf } from "../../lib/roster/rosters";
import { classLabel } from "../../lib/wow/wowNames";
import { CharChip, MemberAvatar, Notice } from "./RosterParts";
import { useRosterAction } from "./useRosterAction";
import type { AddPrefill } from "./AddMemberDialog";

type LogChar = RosterSync["logCharsWithoutPerson"][number];

function SyncCard({ icon, tone, title, count, unit, children, foot }: {
    icon: string; tone: "mid" | "none" | "ok"; title: string; count: number; unit: "persons" | "chars"; children: ReactNode; foot?: ReactNode;
}) {
    const t = useT();
    return (
        <section className="rn-panel rn-sync-card">
            <div className="rn-sync-head">
                <IconTile icon={icon} tone={count ? tone : "ok"} />
                <h2 className="rn-h3">{title}</h2>
                <Badge tone={count ? (tone === "mid" ? "mid" : undefined) : "ok"}>{t(`roster.sync.${unit}`, { count })}</Badge>
            </div>
            {count ? children : <p className="rn-empty">{t("roster.sync.nothing")}</p>}
            {foot && count > 0 && <div className="rn-sync-foot">{foot}</div>}
        </section>
    );
}

/** A person of a list: avatar (from the roster when they are in it), name, a line below. */
function Person({ userId, name, line, data }: { userId: string; name: string; line: string; data: RosterDetail }) {
    const member = data.members.find((m) => m.userId === userId);
    return (
        <div className="rn-person">
            {member ? <MemberAvatar member={member} /> : <span className="rn-ava" aria-hidden="true">{initialOf(name)}</span>}
            <div className="rn-person-text"><b>{name}</b>{line && <span className="rn-sub">{line}</span>}</div>
        </div>
    );
}

/** "Person zuordnen": pick the roster member who plays a character from the logs. */
function AssignPersonDialog({ char, data, onClose, onDone }: { char: LogChar; data: RosterDetail; onClose: () => void; onDone: () => void }) {
    const t = useT();
    const { run, busy } = useRosterAction();
    const [q, setQ] = useState("");
    const [picked, setPicked] = useState("");
    const claimed = new Set(char.claimedBy.map((c) => c.userId));
    const multi = data.roster.allowMultipleChars;
    const list = data.members
        .filter((m) => !q.trim() || m.displayName.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => Number(claimed.has(b.userId)) - Number(claimed.has(a.userId)));
    const member = data.members.find((m) => m.userId === picked) || null;
    const submit = async () => {
        if (!member) return;
        const keys = member.chars.map((c) => c.key);
        const result = await run("assign", () => saveRosterMember(data.roster.id, member.userId, { chars: multi ? [...keys, char.character] : [char.character] }, "update"),
            () => t("roster.sync.assigned", { char: char.character, name: member.displayName }));
        if (result) {
            onDone();
            onClose();
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon={char.className ? classIconName(char.className) : "inv_misc_questionmark"}
            tone="roster"
            kicker={t("roster.sync.assignKicker")}
            title={t("roster.sync.assignTitle", { char: char.character })}
            width={520}
            className="rn-dlg"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!member} running={busy === "assign"} onClick={submit}>{t("roster.sync.assignSubmit")}</Button>
                </>
            )}
        >
            <section className="rn-dlg-sec">
                <label className="rn-lbl" htmlFor="rn-assign-q">{t("roster.sync.assignWho")}</label>
                <input id="rn-assign-q" className="inp-sm" type="search" value={q} placeholder={t("roster.detail.searchPlaceholder")} onChange={(e) => setQ(e.target.value)} />
                <ul className="rn-results" aria-label={t("roster.add.results")}>
                    {list.map((m) => (
                        <li key={m.userId}>
                            <button type="button" className={`rn-result${picked === m.userId ? " is-on" : ""}`} aria-pressed={picked === m.userId} onClick={() => setPicked(m.userId)}>
                                <MemberAvatar member={m} />
                                <span className="rn-result-main">
                                    <b>{m.displayName}</b>
                                    <span className="rn-sub">{m.chars.map((c) => c.name).join(", ") || t("roster.detail.noChar")}</span>
                                </span>
                                {claimed.has(m.userId) && <Badge tone="accent" size="sm">{t("roster.sync.inProfile")}</Badge>}
                            </button>
                        </li>
                    ))}
                </ul>
                {member && !multi && member.chars.length > 0 && <p className="rn-sub">{t("roster.sync.replaces", { char: member.chars[0].name })}</p>}
            </section>
        </Modal>
    );
}

export default function SyncTab({ data, sync, onChanged, onAdd, onOpen }: {
    data: RosterDetail;
    sync: RosterSync;
    /** A change was saved: the page reloads the roster and the lists. */
    onChanged: () => void;
    onAdd: (prefill: AddPrefill) => void;
    onOpen: (userId: string) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const { run, busy } = useRosterAction();
    const [assign, setAssign] = useState<LogChar | null>(null);
    const manage = sync.canManage;
    const rosterId = data.roster.id;
    const main = sync.roles.find((r) => r.main) || null;
    const roleLabel = (r: { name: string; id: string }) => `@${r.name || r.id}`;
    const roleList = sync.roles.map(roleLabel).join(", ");
    const statusOf = (s: string) => t(`roster.status.${s}`);

    const giveRole = (userId: string, name: string) => run(`give-${userId}`, () => setRosterRole(rosterId, userId, true),
        (r) => changedRoleLines([r.result])[0] ? t("roster.sync.gaveTo", { role: roleLabel({ name: r.result.roleName, id: r.result.roleId }), name }) : t("roster.drawer.roleUnchanged"));

    // a person who is not on the server cannot get a role: no button for them, and not in "Allen n"
    const giveable = sync.inRosterWithoutRole.filter((p) => data.members.find((m) => m.userId === p.userId)?.onServer !== false);
    const giveAll = async () => {
        for (const p of giveable) {
            // one after the other: the bot writes roles one by one anyway, and a refusal stops nothing else
            await giveRole(p.userId, p.displayName);
        }
        onChanged();
    };

    const takeRole = async (userId: string, name: string) => {
        if (!(await ask({ title: t("roster.sync.takeTitle", { name }), text: t("roster.sync.takeText", { roles: roleList }), action: t("roster.sync.take"), tone: "danger" }))) return;
        for (const role of sync.roles.filter((r) => !r.trial)) {
            await run(`take-${userId}`, () => setRosterRole(rosterId, userId, false, role.id), (r) => changedRoleLines([r.result])[0] || null);
        }
        onChanged();
    };

    const takeSuggestion = async (userId: string, key: string, name: string) => {
        const r = await run(`char-${userId}`, () => saveRosterMember(rosterId, userId, { chars: [key] }, "update"), () => t("roster.sync.charTaken", { char: name }));
        if (r) onChanged();
    };

    const hide = async (c: LogChar) => {
        const r = await run(`hide-${c.key}`, () => setRosterHidden(c.character, true), () => t("roster.sync.hidden", { char: c.character }));
        if (r) onChanged();
    };

    const removeMember = async (userId: string, name: string) => {
        if (!(await ask({ title: t("roster.drawer.removeTitle", { name }), text: t("roster.drawer.removeText", { roles: roleList }), action: t("roster.drawer.remove"), tone: "danger" }))) return;
        const r = await run(`remove-${userId}`, () => removeRosterMember(rosterId, userId), () => t("roster.drawer.removed", { name }));
        if (r) onChanged();
    };

    return (
        <div className="rn-sync-page">
            <Notice>
                {sync.roles.length ? t("roster.sync.info", { roles: roleList }) : t("roster.sync.infoNoRole")}
                {sync.mirrored.map((m) => (
                    <span key={`${m.roleId}-${m.side}`} className="rn-notice-line">
                        {m.outgoing && t("roster.sync.mirrorOut", { role: roleLabel(sync.roles.find((r) => r.id === m.roleId) || { name: "", id: m.roleId }) })}
                        {m.outgoing && m.incoming && " "}
                        {m.incoming && t("roster.sync.mirrorIn", { role: roleLabel(sync.roles.find((r) => r.id === m.roleId) || { name: "", id: m.roleId }) })}
                    </span>
                ))}
            </Notice>
            {sync.membersError && <Notice tone="warn">{t(`roster.sync.membersError.${sync.membersError === "offline" ? "offline" : "unavailable"}`)}</Notice>}
            {!sync.membersError && sync.roles.length > 0 && !sync.canManageRoles && <Notice tone="warn">{t("roster.sync.noManageRoles")}</Notice>}
            {sync.roles.some((r) => !r.exists) && <Notice tone="warn">{t("roster.sync.roleGone")}</Notice>}

            <div className="rn-sync">
                <SyncCard
                    icon="achievement_guildperk_everybodysfriend"
                    tone="mid"
                    title={t("roster.sync.withoutRole")}
                    count={sync.inRosterWithoutRole.length}
                    unit="persons"
                    foot={manage && main && giveable.length > 1 && (
                        <Button size="sm" variant="ghost" disabled={busy !== ""} onClick={giveAll}>{t("roster.sync.giveAll", { count: giveable.length })}</Button>
                    )}
                >
                    {sync.inRosterWithoutRole.map((p) => {
                        const m = data.members.find((x) => x.userId === p.userId);
                        const line = [statusOf(p.status), m?.chars[0]?.name, m?.onServer === false ? t("roster.detail.notOnServer") : ""].filter(Boolean).join(" · ");
                        return (
                            <div key={p.userId} className="rn-sync-row">
                                <Person userId={p.userId} name={p.displayName} line={line} data={data} />
                                {manage && main && m?.onServer !== false && <Button size="sm" variant="run" running={busy === `give-${p.userId}`} disabled={busy !== "" && busy !== `give-${p.userId}`} onClick={async () => { if (await giveRole(p.userId, p.displayName)) onChanged(); }}>{t("roster.detail.giveRole")}</Button>}
                                {manage && m?.onServer === false && <Button size="sm" variant="ghost" running={busy === `remove-${p.userId}`} onClick={() => removeMember(p.userId, p.displayName)}>{t("roster.sync.takeOut")}</Button>}
                            </div>
                        );
                    })}
                </SyncCard>

                <SyncCard icon="inv_misc_groupneedmore" tone="mid" title={t("roster.sync.roleOnly")} count={sync.roleWithoutRoster.length} unit="persons"
                    foot={manage && <span className="rn-sub">{t("roster.sync.roleOnlyFoot")}</span>}>
                    {sync.roleWithoutRoster.map((p) => (
                        <div key={p.userId} className="rn-sync-row">
                            <Person userId={p.userId} name={p.displayName} line={p.takeFailed ? t("roster.sync.takeFailed") : ""} data={data} />
                            {manage && <Button size="sm" variant="ghost" onClick={() => onAdd({ userId: p.userId, displayName: p.displayName })}>{t("roster.sync.takeIn")}</Button>}
                            {manage && <Button size="sm" variant="danger" running={busy === `take-${p.userId}`} onClick={() => takeRole(p.userId, p.displayName)}>{t("roster.sync.take")}</Button>}
                        </div>
                    ))}
                </SyncCard>

                <SyncCard icon="inv_misc_note_02" tone="mid" title={t("roster.sync.withoutChar")} count={sync.withoutChar.length} unit="persons">
                    {sync.withoutChar.map((p) => (
                        <div key={p.userId} className="rn-sync-row">
                            <Person userId={p.userId} name={p.displayName} line={p.suggestion ? t("roster.sync.suggestion") : t("roster.sync.noSuggestion")} data={data} />
                            {p.suggestion && (
                                <CharChip char={{ name: p.suggestion.name, className: p.suggestion.className, classColor: "", specId: "", specLabel: "", specIcon: "" }} />
                            )}
                            {manage && p.suggestion && <Button size="sm" variant="ghost" running={busy === `char-${p.userId}`} onClick={() => takeSuggestion(p.userId, p.suggestion?.key || "", p.suggestion?.name || "")}>{t("roster.sync.takeSuggestion")}</Button>}
                            {manage && <Button size="sm" variant="ghost" onClick={() => onOpen(p.userId)}>{t("roster.sync.pickOther")}</Button>}
                        </div>
                    ))}
                </SyncCard>

                <SyncCard icon="inv_misc_book_09" tone="none" title={t("roster.sync.logChars")} count={sync.logCharsWithoutPerson.length} unit="chars">
                    {sync.logCharsWithoutPerson.map((c) => (
                        <div key={c.key} className="rn-sync-row">
                            <span className="rn-log-char">
                                {c.className ? <WowIcon name={classIconName(c.className)} size={22} /> : null}
                                <b>{c.character}</b>
                                <span className="rn-sub">{[c.className ? classLabel(c.className, c.className) : "", t("roster.sync.nights", { count: c.nights })].filter(Boolean).join(" · ")}</span>
                            </span>
                            {manage && <Button size="sm" variant="ghost" onClick={() => setAssign(c)}>{t("roster.sync.assign")}</Button>}
                            {manage && <Button size="sm" variant="ghost" running={busy === `hide-${c.key}`} onClick={() => hide(c)}>{t("roster.sync.hide")}</Button>}
                        </div>
                    ))}
                </SyncCard>
            </div>
            {assign && <AssignPersonDialog char={assign} data={data} onClose={() => setAssign(null)} onDone={onChanged} />}
        </div>
    );
}
