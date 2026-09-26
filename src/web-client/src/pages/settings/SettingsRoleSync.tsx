import { useEffect, useState } from "react";
import {
    getRoleSync, updateSettings,
    type AdminConfig, type ApiError, type RoleSyncData, type RoleSyncRule,
} from "../../api";
import { DIRECTION_LABEL, directionText, driftBadge, roleSyncPatch, withRoleRule, type RoleSyncDirection } from "../../lib/settingsLogic";
import { tParts, t as translate, useT } from "../../i18n";
import { useToast } from "../../components/Jobs";
import { PlusIcon, TrashIcon } from "../../components/icons";
import { Modal, useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import PartHead from "../../components/ui/PartHead";
import RaidLoader from "../../components/ui/RaidLoader";
import Segment from "../../components/ui/Segment";
import { AdminOnlyBadge, PenIcon, RolePicker, WarnIcon } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";

// Einstellungen → Verbindungen → Discord-Server, part "Rollen-Abgleich" (#264).
// One line per role pair; add and edit in a dialog. The sync only ever adds a
// role — whoever lost the source role keeps the synced one, and the drift badge
// with its fold-out list says who, with a link to the Discord profile, so a
// person removes it there.

/** The options of the direction segment, in the active language. */
const directions = (): { value: RoleSyncDirection; label: string; tip: string }[] => [
    { value: "toTalk", label: directionText("toTalk"), tip: translate("settings.roleSync.dirToTalkTip") },
    { value: "toEvent", label: directionText("toEvent"), tip: translate("settings.roleSync.dirToEventTip") },
    { value: "both", label: translate("settings.roleSync.dirBoth"), tip: translate("settings.roleSync.dirBothTip") },
];

const roleName = (roles: { id: string; name: string }[], id: string) => {
    const r = roles.find((x) => x.id === id);
    return r ? `@${r.name}` : id;
};

export default function RoleSyncPart({ onConfig }: {
    onConfig: (config: AdminConfig) => void;
}) {
    const [data, setData] = useState<RoleSyncData | null>(null);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<number | null>(null);
    const [driftOpen, setDriftOpen] = useState(false);
    const ask = useConfirm();
    const toast = useToast();
    const t = useT();

    const load = () => {
        getRoleSync().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
    };
    useEffect(load, []);

    const save = async (rules: RoleSyncRule[], message: string) => {
        const { config } = await updateSettings(roleSyncPatch(rules) as Partial<AdminConfig>);
        toast(message);
        onConfig(config);
        load();
    };

    const remove = async (index: number) => {
        if (!data) return;
        const rule = data.roleSync[index];
        const label = `${roleName(data.eventRoles, rule.eventRoleId)} ${DIRECTION_LABEL[rule.direction]} ${roleName(data.talkRoles, rule.talkRoleId)}`;
        if (!(await ask({ title: t("settings.roleSync.deleteAsk", { label }), text: t("settings.roleSync.deleteText"), action: t("common.delete"), tone: "danger" }))) return;
        try {
            await save(data.roleSync.filter((_, i) => i !== index), t("settings.roleSync.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const drift = data ? driftBadge(data.driftTotal, data.driftError) : null;
    const head = (
        <PartHead
            icon="inv_misc_groupneedmore"
            tone="settings"
            title={t("settings.roleSync.title")}
            tip={t("settings.roleSync.title")}
            tipSub={t("settings.roleSync.tipSub")}
            action={data ? (
                <span className="sync-actions">
                    {data.roleSync.length > 0 && drift && (
                        <Badge tone={drift.tone || undefined} icon={drift.tone === "mid" ? <WarnIcon /> : undefined} tip={drift.label} tipSub={drift.tip}>{drift.label}</Badge>
                    )}
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setEditing(-1)}>{t("settings.roleSync.add")}</Button>
                </span>
            ) : undefined}
        />
    );

    if (error) return <section className="sync-part">{head}<div className="empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text={t("settings.roleSync.loading")} /></section>;

    // The sides a mapping writes to, and which of them the bot may not touch.
    const needs = new Set(data.roleSync.flatMap((r) => (r.direction === "both" ? ["event", "talk"] : [r.direction === "toTalk" ? "talk" : "event"])));
    const blocked = [...needs].filter((side) => !data.canManage[side as "event" | "talk"]);

    return (
        <section className="sync-part">
            {head}
            {blocked.length > 0 && (
                <div className="conn-status mid">
                    <Badge tone="mid" icon={<WarnIcon />}>{t("settings.roleSync.rightMissing")}</Badge>
                    <span>
                        {t("settings.roleSync.manageMissing", {
                            servers: blocked.map((s) => t(s === "talk" ? "settings.roleSync.driftTalk" : "settings.roleSync.driftEvent")).join(t("settings.roleSync.serverJoin")),
                        })}
                    </span>
                </div>
            )}
            {data.roleSync.length === 0
                ? <div className="sync-empty">{t("settings.roleSync.empty")}</div>
                : (
                    <ul className="sync-list">
                        {data.roleSync.map((rule, i) => (
                            <li key={`${rule.eventRoleId}:${rule.talkRoleId}`} className="sync-row">
                                <span className="sync-role">{roleName(data.eventRoles, rule.eventRoleId)}</span>
                                <span className="sync-dir" data-tip={directionText(rule.direction)}>{DIRECTION_LABEL[rule.direction]}</span>
                                <span className="sync-role">{roleName(data.talkRoles, rule.talkRoleId)}</span>
                                <span className="grow" />
                                <IconButton size="sm" icon={<PenIcon />} tip={t("settings.roleSync.edit")} onClick={() => setEditing(i)} />
                                <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.roleSync.delete")} onClick={() => remove(i)} />
                            </li>
                        ))}
                    </ul>
                )}
            {data.driftTotal > 0 && (
                <div className="sync-drift">
                    <div className="sync-drift-head">
                        <span className="grow">
                            {data.drift.map((g) => (
                                <span key={g.ruleIndex} className="sync-drift-line">
                                    <b>{g.members.length}</b> {t("settings.roleSync.driftHas", { count: g.members.length })} <b>@{g.roleName}</b> {tParts("settings.roleSync.driftOnlyOn", {
                                        where: g.guildName || t(g.side === "talk" ? "settings.roleSync.driftTalk" : "settings.roleSync.driftEvent"),
                                    })}
                                </span>
                            ))}
                        </span>
                        <Expand open={driftOpen} onToggle={() => setDriftOpen(!driftOpen)} label={t("settings.roleSync.who")} />
                    </div>
                    {driftOpen && (
                        <ul className="sync-drift-list">
                            {data.drift.flatMap((g) => g.members.map((m) => (
                                <li key={`${g.ruleIndex}:${m.userId}`}>
                                    <a href={m.profileUrl} target="_blank" rel="noreferrer" data-tip={t("settings.roleSync.removeTip", { role: g.roleName })} data-tip-sub={m.notOnSource ? t("settings.roleSync.notOnSource") : t("settings.roleSync.lostSource", { role: g.sourceRoleName })}>{m.name}</a>
                                    <span className="sync-muted">@{g.roleName}</span>
                                </li>
                            )))}
                        </ul>
                    )}
                </div>
            )}

            {editing !== null && (
                <RoleRuleModal
                    data={data}
                    index={editing}
                    onClose={() => setEditing(null)}
                    onSave={async (rule) => {
                        await save(withRoleRule(data.roleSync, editing, rule), t("settings.roleSync.saved"));
                        setEditing(null);
                    }}
                />
            )}
        </section>
    );
}

/** Add (index -1) or edit one role pair. */
function RoleRuleModal({ data, index, onClose, onSave }: {
    data: RoleSyncData;
    index: number;
    onClose: () => void;
    onSave: (rule: RoleSyncRule) => Promise<void>;
}) {
    const existing = index >= 0 ? data.roleSync[index] : null;
    const [rule, setRule] = useState<RoleSyncRule>(existing || { eventRoleId: "", talkRoleId: "", direction: "toTalk" });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();

    const submit = async () => {
        setBusy(true);
        try {
            await onSave(rule);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="settings"
            kicker={t("settings.roleSync.title")}
            title={existing ? t("settings.roleSync.edit") : t("settings.roleSync.create")}
            width={520}
            initialFocus="select, input"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button onClick={submit} disabled={busy || !rule.eventRoleId || !rule.talkRoleId}>{busy ? t("settings.saving") : t("common.save")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="dlg-field">
                    <FieldLabel htmlFor="sync-event" tip={t("settings.roleSync.eventTip")}>{t("settings.roleSync.eventDiscord")}</FieldLabel>
                    <RolePicker id="sync-event" value={rule.eventRoleId} roles={data.eventRoles} onChange={(eventRoleId) => setRule({ ...rule, eventRoleId })} />
                </div>
                <div className="dlg-field">
                    <FieldLabel tip={t("settings.roleSync.direction")} tipSub={t("settings.roleSync.directionSub")}>{t("settings.roleSync.direction")}</FieldLabel>
                    <Segment size="sm" ariaLabel={t("settings.roleSync.direction")} options={directions()} value={rule.direction} onChange={(direction) => setRule({ ...rule, direction })} />
                </div>
                <div className="dlg-field">
                    <FieldLabel htmlFor="sync-talk" tip={t("settings.roleSync.talkTip")}>{t("settings.roleSync.talkDiscord")}</FieldLabel>
                    <RolePicker id="sync-talk" value={rule.talkRoleId} roles={data.talkRoles} onChange={(talkRoleId) => setRule({ ...rule, talkRoleId })} />
                </div>
            </div>
        </Modal>
    );
}
