import { useEffect, useState } from "react";
import {
    getRoleSync, updateSettings,
    type AdminConfig, type ApiError, type RoleSyncData, type RoleSyncOverlap, type RoleSyncRule, type RoleSyncServer,
} from "../../../api";
import {
    DIRECTION_LABEL, directionText, driftBadge, overlapOf, roleRuleReady, roleSyncPatch, withRoleRule, writtenGuilds,
    type RoleSyncDirection,
} from "../../../lib/settings/settingsLogic";
import { tParts, t as translate, useT } from "../../../i18n";
import { useToast } from "../../../components/shell/Jobs";
import { PenIcon, PlusIcon, TrashIcon, WarnIcon, SaveIcon } from "../../../components/ui/icons/icons";
import { Modal, useConfirm } from "../../../components/ui/overlay/Modal";
import { Button, IconButton } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Expand from "../../../components/ui/layout/Expand";
import PartHead from "../../../components/ui/layout/PartHead";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import Segment from "../../../components/ui/form/Segment";
import { AdminOnlyBadge, RolePicker } from "../../../components/settings/settingsUi";
import { FieldLabel } from "../../../components/ui/form/Field";

// Einstellungen → Verbindungen → Discord-Server, part "Rollen-Abgleich" (#264).
// One line per role pair between two servers of the list (#896); add and edit
// in a dialog. The sync only ever adds a role — whoever lost the source role
// keeps the synced one, and the drift badge with its fold-out list says who,
// per pair, with a link to the Discord profile, so a person removes it there.

/** The options of the direction segment, in the active language. */
const directions = (): { value: RoleSyncDirection; label: string; tip: string }[] => [
    { value: "toTarget", label: directionText("toTarget"), tip: translate("settings.roleSync.dirToTargetTip") },
    { value: "toSource", label: directionText("toSource"), tip: translate("settings.roleSync.dirToSourceTip") },
    { value: "both", label: translate("settings.roleSync.dirBoth"), tip: translate("settings.roleSync.dirBothTip") },
];

const serverOf = (servers: RoleSyncServer[], guildId: string) => servers.find((s) => s.guildId === guildId) || null;

/** A server as the page names it: its label, else the Discord name, else the id. */
const serverName = (servers: RoleSyncServer[], guildId: string) => {
    const s = serverOf(servers, guildId);
    return (s && (s.label || s.name)) || guildId;
};

const roleName = (servers: RoleSyncServer[], guildId: string, id: string) => {
    const r = (serverOf(servers, guildId)?.roles || []).find((x) => x.id === id);
    return r ? `@${r.name}` : id;
};

/** "Pulse @Raider → Talk @Raider-Talk": a pair in one line of text. */
const pairText = (servers: RoleSyncServer[], rule: RoleSyncRule) => `${serverName(servers, rule.fromGuildId)} ${roleName(servers, rule.fromGuildId, rule.fromRoleId)} ${DIRECTION_LABEL[rule.direction]} ${serverName(servers, rule.toGuildId)} ${roleName(servers, rule.toGuildId, rule.toRoleId)}`;

export default function RoleSyncPart({ onConfig, reloadKey }: {
    onConfig: (config: AdminConfig) => void;
    /** Changes when the server list was saved: the server selects reload without a page reload. */
    reloadKey?: unknown;
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
    useEffect(load, [reloadKey]);

    const save = async (rules: RoleSyncRule[], message: string) => {
        const { config } = await updateSettings(roleSyncPatch(rules) as Partial<AdminConfig>);
        toast(message);
        onConfig(config);
        load();
    };

    const remove = async (index: number) => {
        if (!data) return;
        const label = pairText(data.servers, data.roleSync[index]);
        if (!(await ask({ title: t("settings.roleSync.deleteAsk", { label }), text: t("settings.roleSync.deleteText"), action: t("common.delete"), tone: "danger" }))) return;
        try {
            await save(data.roleSync.filter((_, i) => i !== index), t("settings.roleSync.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const canAdd = !!data && data.servers.length >= 2;
    const drift = data ? driftBadge(data.driftTotal, data.driftError, data.driftErrors) : null;
    const head = (
        <PartHead
            variant="plain"
            title={t("settings.roleSync.title")}
            tip={t("settings.roleSync.title")}
            tipSub={t("settings.roleSync.tipSub")}
            action={data ? (
                <span className="sync-actions">
                    {data.roleSync.length > 0 && drift && (
                        <Badge tone={drift.tone || undefined} icon={drift.tone === "mid" ? <WarnIcon /> : undefined} tip={drift.label} tipSub={drift.tip}>{drift.label}</Badge>
                    )}
                    {canAdd && <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setEditing(-1)}>{t("settings.roleSync.add")}</Button>}
                </span>
            ) : undefined}
        />
    );

    if (error) return <section className="sync-part">{head}<div className="empty">{error}</div></section>;
    if (!data) return <section className="sync-part">{head}<RaidLoader compact text={t("settings.roleSync.loading")} /></section>;

    // The servers a pair writes to, and which of them the bot may not touch.
    const needs = new Set(data.roleSync.flatMap(writtenGuilds));
    const blocked = [...needs].filter((id) => !serverOf(data.servers, id)?.canManage);

    return (
        <section className="sync-part">
            {head}
            {blocked.length > 0 && (
                <div className="conn-status mid">
                    <Badge tone="mid" icon={<WarnIcon />}>{t("settings.roleSync.rightMissing")}</Badge>
                    <span>
                        {t("settings.roleSync.manageMissing", {
                            servers: blocked.map((id) => serverName(data.servers, id)).join(t("settings.roleSync.serverJoin")),
                        })}
                    </span>
                </div>
            )}
            {data.roleSync.length === 0
                ? <div className="sync-empty">{t(canAdd ? "settings.roleSync.empty" : "settings.roleSync.needTwo")}</div>
                : (
                    <ul className="sync-list">
                        {data.roleSync.map((rule, i) => {
                            const overlap = overlapOf(data.overlaps, rule);
                            const from = serverName(data.servers, rule.fromGuildId);
                            const to = serverName(data.servers, rule.toGuildId);
                            return (
                                <li key={`${rule.fromGuildId}:${rule.fromRoleId}:${rule.toGuildId}:${rule.toRoleId}`} className="sync-row">
                                    <span className="sync-muted">{from}</span>
                                    <span className="sync-role">{roleName(data.servers, rule.fromGuildId, rule.fromRoleId)}</span>
                                    <span className="sync-dir" data-tip={`${from} ${DIRECTION_LABEL[rule.direction]} ${to}`}>{DIRECTION_LABEL[rule.direction]}</span>
                                    <span className="sync-muted">{to}</span>
                                    <span className="sync-role">{roleName(data.servers, rule.toGuildId, rule.toRoleId)}</span>
                                    <span className="grow" />
                                    {overlap && <OverlapNote overlap={overlap} servers={data.servers} />}
                                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.roleSync.edit")} onClick={() => setEditing(i)} />
                                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.roleSync.delete")} onClick={() => remove(i)} />
                                </li>
                            );
                        })}
                    </ul>
                )}
            {data.driftTotal > 0 && (
                <div className="sync-drift">
                    <div className="sync-drift-head">
                        <span className="grow">
                            {data.drift.map((g) => (
                                <span key={g.ruleIndex} className="sync-drift-line">
                                    <b>{g.members.length}</b> {t("settings.roleSync.driftHas", { count: g.members.length })} <b>@{g.roleName}</b> {tParts("settings.roleSync.driftOnlyOn", {
                                        where: g.guildName || serverName(data.servers, g.guildId),
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
                                    <span className="sync-muted">{g.guildName || serverName(data.servers, g.guildId)} @{g.roleName}</span>
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

/** "12 von 40 auf beiden": how many members of one server of the pair are on the other as well. */
function OverlapNote({ overlap, servers }: { overlap: RoleSyncOverlap; servers: RoleSyncServer[] }) {
    const t = useT();
    if (overlap.error || overlap.both === null || overlap.fromCount === null) {
        return <span className="sync-muted" data-tip={overlap.error || undefined}>{t("settings.roleSync.overlapError")}</span>;
    }
    return (
        <span
            className="sync-muted"
            data-tip={t("settings.roleSync.overlapTip", { both: overlap.both, from: serverName(servers, overlap.fromGuildId), to: serverName(servers, overlap.toGuildId) })}
        >
            {t("settings.roleSync.overlap", { both: overlap.both, count: overlap.fromCount })}
        </span>
    );
}

/** One end of a pair: the server and its role; changing the server clears the role. */
function PairEnd({ id, label, tip, servers, guildId, roleId, onChange }: {
    id: string;
    label: string;
    tip: string;
    servers: RoleSyncServer[];
    guildId: string;
    roleId: string;
    onChange: (guildId: string, roleId: string) => void;
}) {
    const t = useT();
    const server = serverOf(servers, guildId);
    return (
        <>
            <div className="dlg-field">
                <FieldLabel htmlFor={`${id}-server`} tip={tip}>{label}</FieldLabel>
                <select id={`${id}-server`} value={guildId} onChange={(e) => onChange(e.target.value, "")}>
                    <option value="">{t("settings.roleSync.pickServer")}</option>
                    {servers.map((s) => (
                        <option key={s.guildId} value={s.guildId}>
                            {(s.label || s.name || s.guildId) + (s.connected ? "" : ` (${t("settings.roleSync.notConnected")})`)}
                        </option>
                    ))}
                </select>
            </div>
            <div className="dlg-field">
                <FieldLabel htmlFor={`${id}-role`}>{t("settings.roleSync.role")}</FieldLabel>
                <RolePicker id={`${id}-role`} value={roleId} roles={server ? server.roles : []} onChange={(next) => onChange(guildId, next)} />
            </div>
        </>
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
    const [rule, setRule] = useState<RoleSyncRule>(existing || {
        fromGuildId: data.servers[0]?.guildId || "",
        fromRoleId: "",
        toGuildId: data.servers[1]?.guildId || "",
        toRoleId: "",
        direction: "toTarget",
    });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();
    const same = !!rule.fromGuildId && rule.fromGuildId === rule.toGuildId;

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
            icon="roles"
            tone="settings"
            kicker={t("settings.roleSync.title")}
            title={existing ? t("settings.roleSync.edit") : t("settings.roleSync.create")}
            width={520}
            initialFocus="select, input"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} onClick={submit} disabled={busy || !roleRuleReady(rule)}>{busy ? t("settings.saving") : t("common.save")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <PairEnd
                    id="sync-from"
                    label={t("settings.roleSync.fromServer")}
                    tip={t("settings.roleSync.fromServerTip")}
                    servers={data.servers}
                    guildId={rule.fromGuildId}
                    roleId={rule.fromRoleId}
                    onChange={(fromGuildId, fromRoleId) => setRule({ ...rule, fromGuildId, fromRoleId })}
                />
                <div className="dlg-field">
                    <FieldLabel tip={t("settings.roleSync.direction")} tipSub={t("settings.roleSync.directionSub")}>{t("settings.roleSync.direction")}</FieldLabel>
                    <Segment size="sm" ariaLabel={t("settings.roleSync.direction")} options={directions()} value={rule.direction} onChange={(direction) => setRule({ ...rule, direction })} />
                </div>
                <PairEnd
                    id="sync-to"
                    label={t("settings.roleSync.toServer")}
                    tip={t("settings.roleSync.toServerTip")}
                    servers={data.servers}
                    guildId={rule.toGuildId}
                    roleId={rule.toRoleId}
                    onChange={(toGuildId, toRoleId) => setRule({ ...rule, toGuildId, toRoleId })}
                />
                {same && <div className="conn-status mid"><Badge tone="mid" icon={<WarnIcon />}>{t("settings.roleSync.sameServer")}</Badge></div>}
            </div>
        </Modal>
    );
}
