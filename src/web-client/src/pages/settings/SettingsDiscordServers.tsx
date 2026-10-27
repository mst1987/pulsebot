import { useEffect, useState } from "react";
import {
    getDiscordServers, getTalkOverview, repostTalkOverview, updateSettings,
    type AdminConfig, type ApiError, type DiscordServers, type DiscordServersData,
    type ServerEntry, type ServerLink, type ServerRow, type TalkOverviewStatus, type TextChannel,
} from "../../api";
import { linkKey, linkStatusBadge, linkStatusOf, linkSummary, raidCategoriesText, serverCardState } from "../../lib/settings/settingsLogic";
import { useTableSort } from "../../lib/ui/tableSort";
import { useToast } from "../../components/shell/Jobs";
import { CheckMark, PenIcon, PlusIcon, SaveIcon, SendIcon, TrashIcon, WarnIcon } from "../../components/ui/icons";
import RoleSyncPart from "./SettingsRoleSync";
import RemindersPart from "./SettingsReminders";
import { Modal, useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Chip from "../../components/ui/Chip";
import DataTable, { type Column } from "../../components/ui/DataTable";
import PartHead from "../../components/ui/PartHead";
import RaidLoader from "../../components/ui/RaidLoader";
import { AdminOnlyBadge, ChannelPicker } from "../../components/settings/settingsUi";
import { FieldLabel } from "../../components/ui/Field";
import { t as translate, useT } from "../../i18n";

// Einstellungen → Verbindungen → Discord-Server (#891, Epic #893, design SB).
// Every server is equal; a link posts one server's raid list to a channel on
// another server (or the same one). The links table is the main element: one
// row per link with its status in words and "Neu posten" — it replaces the
// former per-server overview row (SettingsTalkOverview). Below it the servers
// the bot works with (Discord name first, the label an optional extra title)
// and the two channels that apply to every server. Each change saves at once,
// only the fields it touches: the old talk fields stay stored until #897.

const MAX_SERVERS = 10;

type LinkSortKey = "link" | "channel" | "status" | "summary";
type ServerSortKey = "server" | "status" | "categories" | "members";

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "?";
}

function channelName(channels: TextChannel[], id: string): string {
    if (!id) return "—";
    const found = channels.find((c) => c.id === id);
    return found ? `#${found.name}` : id;
}

/** A server's shown name: its Discord name, else the id said as unknown. */
function guildName(data: DiscordServersData, id: string): string {
    const row = data.servers.find((s) => s.id === id);
    if (row && row.name) return row.name;
    const guild = data.guilds.find((g) => g.id === id);
    return guild ? guild.name : translate("settings.ui.unknown", { id });
}

function guildChannels(data: DiscordServersData, id: string): TextChannel[] {
    return data.guilds.find((g) => g.id === id)?.channels || [];
}

/**
 * The channels the messages of "Vielleicht" / "Absagen" and the guild bank may
 * go to: those of every configured server (every server of the bot while none
 * is configured yet), named with their server when there are several.
 */
function noteChannels(guilds: DiscordServersData["guilds"], guildIds: string[]): TextChannel[] {
    const ids = guildIds.filter(Boolean);
    const picked = ids.length ? guilds.filter((g) => ids.includes(g.id)) : guilds;
    return picked.flatMap((g) => g.channels.map((c) => ({
        ...c,
        category: picked.length > 1 ? [g.name, c.category].filter(Boolean).join(" · ") : c.category,
    })));
}

// The server allows one link per source and target ("from:to"), so the client compares the same way.
const sameLink = (a: ServerLink, b: ServerLink) => a.from === b.from && a.to === b.to;

export default function DiscordServersSection({ onConfig, icon, crumb }: {
    onConfig: (config: AdminConfig) => void;
    icon: string;
    crumb: string;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const [data, setData] = useState<DiscordServersData | null>(null);
    const [statuses, setStatuses] = useState<TalkOverviewStatus[]>([]);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState<"link" | "server" | "channels" | null>(null);
    const [editServer, setEditServer] = useState<ServerEntry | null>(null);
    const [posting, setPosting] = useState("");
    const linkSort = useTableSort<LinkSortKey>("settings-links-sort", { link: "asc", channel: "asc", status: "asc", summary: "asc" }, "link");
    const serverSort = useTableSort<ServerSortKey>("settings-servers-sort", { server: "asc", status: "desc", categories: "desc", members: "desc" }, "server");

    const load = () => {
        getDiscordServers().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
        // One shared fetch for every link's status instead of one per row.
        getTalkOverview().then((d) => setStatuses(d.statuses)).catch(() => setStatuses([]));
    };
    useEffect(load, []);

    /** Saves only the given fields of discordServers; true when it worked. */
    const save = async (patch: Partial<DiscordServers>, okText: string): Promise<boolean> => {
        try {
            const { config } = await updateSettings({ discordServers: patch } as Partial<AdminConfig>);
            onConfig(config);
            toast(okText);
            load();
            return true;
        } catch (err) {
            toast((err as ApiError).message, "err");
            return false;
        }
    };

    const head = (
        <PartHead
            icon={icon}
            tone="settings"
            title={t("settings.sections.discordserver.label")}
            crumb={t("settings.crumb", { crumb })}
            tip={t("settings.sections.discordserver.label")}
            tipSub={t("settings.discordServers.tipSub")}
        />
    );

    if (error) return <>{head}<div className="empty">{error}</div></>;
    if (!data) return <>{head}<RaidLoader compact text={t("settings.discordServers.loading")} /></>;

    const config = data.discordServers;
    const now = Date.now();

    const repost = async (link: ServerLink) => {
        const key = linkKey(link);
        setPosting(key);
        try {
            const { result, status } = await repostTalkOverview(key);
            if (status) setStatuses((prev) => [...prev.filter((s) => s.key !== status.key), status]);
            if (result.status === "error") toast(result.error || t("settings.talkOverview.postFailed"), "err");
            else toast(t("settings.talkOverview.reposted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting("");
        }
    };

    const removeLink = async (link: ServerLink) => {
        const ok = await ask({
            title: t("settings.discordServers.removeLinkTitle"),
            text: t("settings.discordServers.removeLinkText", {
                from: guildName(data, link.from),
                to: guildName(data, link.to),
                channel: channelName(guildChannels(data, link.to), link.channelId),
            }),
            action: t("settings.discordServers.removeLink"),
            tone: "danger",
        });
        if (!ok) return;
        await save({ links: config.links.filter((l) => !sameLink(l, link)) }, t("settings.discordServers.linkRemoved"));
    };

    const removeServer = async (row: ServerRow) => {
        const dropped = config.links.filter((l) => l.from === row.id).length;
        const ok = await ask({
            title: t("settings.discordServers.removeServerTitle"),
            text: [
                t("settings.discordServers.removeServerText", { name: row.name || row.id }),
                dropped ? t("settings.discordServers.removeServerLinks", { count: dropped }) : "",
            ].filter(Boolean).join(" "),
            action: t("settings.discordServers.removeServer"),
            tone: "danger",
        });
        if (!ok) return;
        // A link needs its source among the servers (configSchema), so the links from it go with it.
        await save({
            servers: config.servers.filter((s) => s.guildId !== row.id),
            links: config.links.filter((l) => l.from !== row.id),
        }, t("settings.discordServers.serverRemoved"));
    };

    const statusOf = (link: ServerLink) => linkStatusOf(link, statuses);

    const linkColumns: Column<ServerLink, LinkSortKey>[] = [
        {
            id: "link", label: t("settings.discordServers.colLink"), sortKey: "link",
            cell: (l) => {
                const label = config.servers.find((s) => s.guildId === l.from)?.label;
                return (
                    <span className="srv-link">
                        <b>{guildName(data, l.from)}</b>
                        {label && <span className="srv-muted"> · {label}</span>}
                        <span className="srv-arrow" aria-hidden="true"> → </span>
                        <span>{guildName(data, l.to)}</span>
                    </span>
                );
            },
        },
        { id: "channel", label: t("settings.discordServers.colChannel"), sortKey: "channel", cell: (l) => channelName(guildChannels(data, l.to), l.channelId) },
        {
            id: "status", label: t("settings.discordServers.colStatus"), sortKey: "status",
            cell: (l) => {
                const status = statusOf(l);
                const badge = linkStatusBadge(status, now);
                const el = (
                    <Badge tone={badge.tone || undefined} icon={badge.tone === "ok" ? <CheckMark /> : badge.tone === "mid" ? <WarnIcon /> : undefined}
                        tip={badge.tip} tipSub={badge.tipSub}>{badge.label}</Badge>
                );
                return status && status.messageUrl ? <a href={status.messageUrl} target="_blank" rel="noreferrer">{el}</a> : el;
            },
        },
        { id: "summary", label: t("settings.discordServers.colLangVersions"), sortKey: "summary", className: "srv-muted", cell: (l) => linkSummary(l, data.versions) },
        {
            id: "actions", actions: true, className: "srv-actions",
            cell: (l) => {
                const busy = posting === linkKey(l);
                return (
                    <span className="row-actions">
                        <Button size="sm" icon={<SendIcon />} onClick={() => repost(l)} disabled={!!posting} running={busy}>
                            {busy ? t("settings.talkOverview.posting") : t("settings.talkOverview.repost")}
                        </Button>
                        <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.discordServers.removeLink")} onClick={() => removeLink(l)} />
                    </span>
                );
            },
        },
    ];

    const linkSortValue = (l: ServerLink, key: LinkSortKey) => {
        if (key === "channel") return channelName(guildChannels(data, l.to), l.channelId).toLowerCase();
        if (key === "status") return linkStatusBadge(statusOf(l), now).label;
        if (key === "summary") return linkSummary(l, data.versions);
        return `${guildName(data, l.from)} ${guildName(data, l.to)}`.toLowerCase();
    };

    const serverColumns: Column<ServerRow, ServerSortKey>[] = [
        {
            id: "server", label: t("settings.discordServers.colServer"), sortKey: "server",
            cell: (s) => (
                <span className="srv-server" data-tip={s.name || s.id} data-tip-sub={t("settings.discordServers.serverId", { id: s.id })}>
                    {s.iconUrl ? <img className="srv-icon" src={s.iconUrl} alt="" /> : <span className="srv-initials">{initials(s.name || s.id)}</span>}
                    <b className="srv-name">{s.name || s.id}</b>
                    {s.label && <span className="srv-muted">{s.label}</span>}
                </span>
            ),
        },
        { id: "status", label: t("settings.discordServers.colStatus"), sortKey: "status", cell: (s) => <ServerStatus row={s} /> },
        {
            id: "categories", label: t("settings.discordServers.colCategories"), sortKey: "categories",
            className: "srv-muted", cell: (s) => raidCategoriesText(s.raidCategories),
        },
        {
            id: "members", label: t("settings.discordServers.colMembers"), sortKey: "members", className: "srv-muted",
            cell: (s) => (s.memberCount == null ? t("settings.discordServers.membersUnknown") : t("settings.discordServers.memberCount", { count: s.memberCount })),
        },
        {
            id: "actions", actions: true, className: "srv-actions",
            cell: (s) => (
                <span className="row-actions">
                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.discordServers.label")} tipSub={t("settings.discordServers.labelSub")}
                        onClick={() => { setEditServer({ guildId: s.id, label: s.label }); setDialog("server"); }} />
                    {s.id === data.talk?.id ? (
                        // Only aria-disabled: a really disabled button gets no hover, and the tooltip says why.
                        <IconButton size="sm" tone="danger" icon={<TrashIcon />} aria-disabled="true" className="srv-remove-off"
                            tip={t("settings.discordServers.removeServer")} tipSub={t("settings.discordServers.removePingServerLocked")} />
                    ) : (
                        <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.discordServers.removeServer")} onClick={() => removeServer(s)} />
                    )}
                </span>
            ),
        },
    ];

    const serverSortValue = (s: ServerRow, key: ServerSortKey) => {
        if (key === "status") return serverCardState(s, false).missing ? 1 : 0;
        if (key === "categories") return s.raidCategories;
        if (key === "members") return s.memberCount ?? -1;
        return (s.name || s.id).toLowerCase();
    };

    const allChannels = data.guilds.flatMap((g) => g.channels);

    return (
        <>
            {head}

            <section className="sync-part">
                <PartHead
                    icon="inv_letter_15"
                    tone="settings"
                    title={t("settings.discordServers.linksTitle")}
                    tip={t("settings.discordServers.linksTitle")}
                    tipSub={t("settings.discordServers.linksSub")}
                    action={config.servers.length
                        ? <Button size="sm" icon={<PlusIcon />} onClick={() => setDialog("link")}>{t("settings.discordServers.addLink")}</Button>
                        : undefined}
                />
                <div className="srv-table srv-links">
                    <DataTable
                        rows={config.links}
                        columns={linkColumns}
                        rowKey={(l) => `${l.from}:${l.to}:${l.channelId}`}
                        sort={linkSort}
                        sortValue={linkSortValue}
                        empty={<div className="sync-empty">{t("settings.discordServers.emptyLinks")}</div>}
                    />
                </div>
            </section>

            <section className="sync-part">
                <PartHead
                    icon="achievement_guildperk_everybodysfriend"
                    tone="settings"
                    title={t("settings.discordServers.serversTitle")}
                    tip={t("settings.discordServers.serversTitle")}
                    tipSub={t("settings.discordServers.serversSub")}
                    action={(
                        <Button variant="ghost" size="sm" icon={<PlusIcon />} disabled={config.servers.length >= MAX_SERVERS}
                            onClick={() => { setEditServer(null); setDialog("server"); }}>
                            {t("settings.discordServers.addServer")}
                        </Button>
                    )}
                />
                <div className="srv-table srv-servers">
                    <DataTable
                        rows={data.servers}
                        columns={serverColumns}
                        rowKey={(s) => s.id}
                        sort={serverSort}
                        sortValue={serverSortValue}
                        empty={<div className="sync-empty">{t("settings.discordServers.emptyServers")}</div>}
                    />
                </div>
            </section>

            <section className="sync-part">
                <PartHead
                    icon="inv_misc_note_02"
                    tone="settings"
                    title={t("settings.discordServers.channelsTitle")}
                    tip={t("settings.discordServers.channelsTitle")}
                    tipSub={t("settings.discordServers.channelsSub")}
                    action={<Button variant="ghost" size="sm" icon={<PenIcon />} onClick={() => setDialog("channels")}>{t("settings.discordServers.editChannels")}</Button>}
                />
                <ul className="sync-list">
                    <li className="sync-row">
                        <span className="sync-role" tabIndex={0} data-tip={t("settings.discordServers.noteTip")} data-tip-sub={t("settings.discordServers.noteTipSub")}>{t("settings.discordServers.noteRow")}</span>
                        <span className="sync-muted">{channelName(allChannels, config.signupNoteChannelId)}</span>
                    </li>
                    <li className="sync-row">
                        <span className="sync-role" tabIndex={0} data-tip={t("settings.discordServers.bankTip")} data-tip-sub={t("settings.discordServers.bankTipSub")}>{t("settings.discordServers.bankRow")}</span>
                        <span className="sync-muted">{channelName(allChannels, config.guildBankChannelId)}</span>
                    </li>
                </ul>
            </section>

            {/* #264: the role sync still needs the talk server until #896 replaces it; reminders work with one server as well. */}
            {data.talk && <RoleSyncPart onConfig={onConfig} />}
            <RemindersPart onConfig={onConfig} />

            {dialog === "link" && (
                <LinkModal data={data} onClose={() => setDialog(null)}
                    onSave={async (link) => {
                        if (await save({ links: [...config.links, link] }, t("settings.discordServers.linkAdded"))) setDialog(null);
                    }} />
            )}
            {dialog === "server" && (
                <ServerModal data={data} entry={editServer} onClose={() => setDialog(null)}
                    onSave={async (entry) => {
                        const editing = config.servers.some((s) => s.guildId === entry.guildId);
                        const servers = editing ? config.servers.map((s) => (s.guildId === entry.guildId ? entry : s)) : [...config.servers, entry];
                        if (await save({ servers }, editing ? t("settings.discordServers.saved") : t("settings.discordServers.serverAdded"))) setDialog(null);
                    }} />
            )}
            {dialog === "channels" && (
                <ChannelsModal data={data} onClose={() => setDialog(null)}
                    onSave={async (fields) => {
                        if (await save(fields, t("settings.discordServers.saved"))) setDialog(null);
                    }} />
            )}
        </>
    );
}

/** One status badge per server; the rights sit in its tooltip. */
function ServerStatus({ row }: { row: ServerRow }) {
    const t = useT();
    const state = serverCardState(row, false);
    const perms = row.permissions;
    const tip = perms
        ? {
            tip: row.missing.length ? t("settings.discordServers.missingPerms", { list: row.missing.join(", ") }) : t("settings.discordServers.allPerms", { count: perms.length }),
            sub: perms.map((p) => `${p.label}: ${p.ok ? t("settings.discordServers.permOk") : t("settings.discordServers.permMissing")}`).join("\n"),
        }
        : { tip: state.label, sub: "" };
    return (
        <Badge tone={state.tone || undefined} icon={state.tone === "ok" ? <CheckMark /> : state.tone === "mid" ? <WarnIcon /> : undefined}
            tip={tip.tip} tipSub={tip.sub || undefined}>{state.label}</Badge>
    );
}

/** Creating one link: source, target, channel on the target, language and versions (#891). */
function LinkModal({ data, onClose, onSave }: {
    data: DiscordServersData;
    onClose: () => void;
    onSave: (link: ServerLink) => Promise<void>;
}) {
    const t = useT();
    const sources = data.discordServers.servers;
    const [link, setLink] = useState<ServerLink>({ from: sources.length === 1 ? sources[0].guildId : "", to: "", channelId: "", lang: "", versions: [] });
    const [busy, setBusy] = useState(false);
    const sourceRow = data.servers.find((s) => s.id === link.from);
    const exists = data.discordServers.links.some((l) => sameLink(l, link));
    const ready = !!(link.from && link.to && link.channelId) && !exists;

    // The language follows the target's Discord language as a suggestion; "" = server language.
    const pickTarget = (to: string) => {
        const lang = data.guilds.find((g) => g.id === to)?.lang || "";
        setLink({ ...link, to, channelId: "", lang });
    };
    const toggleVersion = (id: string) => {
        setLink({ ...link, versions: link.versions.includes(id) ? link.versions.filter((v) => v !== id) : [...link.versions, id] });
    };
    const submit = async () => {
        setBusy(true);
        try { await onSave(link); } finally { setBusy(false); }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="settings"
            kicker={t("settings.sections.discordserver.label")}
            title={t("settings.discordServers.addLink")}
            width={520}
            initialFocus="select"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<PlusIcon />} onClick={submit} disabled={!ready || busy} running={busy}>{t("settings.discordServers.saveLink")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="srv-pair">
                    <div className="dlg-field">
                        <FieldLabel htmlFor="srv-link-from" tip={t("settings.discordServers.source")} tipSub={t("settings.discordServers.sourceSub")}>{t("settings.discordServers.source")}</FieldLabel>
                        <select id="srv-link-from" value={link.from} onChange={(e) => setLink({ ...link, from: e.target.value })}>
                            <option value="">{t("settings.discordServers.chooseOption")}</option>
                            {sources.map((s) => <option key={s.guildId} value={s.guildId}>{guildName(data, s.guildId)}{s.label ? ` · ${s.label}` : ""}</option>)}
                        </select>
                    </div>
                    <div className="dlg-field">
                        <FieldLabel htmlFor="srv-link-to" tip={t("settings.discordServers.target")} tipSub={t("settings.discordServers.targetSub")}>{t("settings.discordServers.target")}</FieldLabel>
                        <select id="srv-link-to" value={link.to} onChange={(e) => pickTarget(e.target.value)}>
                            <option value="">{t("settings.discordServers.chooseOption")}</option>
                            {data.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    </div>
                </div>
                {sourceRow && sourceRow.raidCategories === 0 && (
                    <div className="conn-status mid srv-hint" role="note">
                        <WarnIcon />
                        <span>{t("settings.discordServers.noCategoryHint", { name: sourceRow.name || sourceRow.id })}</span>
                    </div>
                )}
                {link.to && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="srv-link-channel" tip={t("settings.discordServers.channel")} tipSub={t("settings.discordServers.channelSub")}>{t("settings.discordServers.channel")}</FieldLabel>
                        <ChannelPicker id="srv-link-channel" value={link.channelId} channels={guildChannels(data, link.to)} onChange={(channelId) => setLink({ ...link, channelId })} />
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-link-lang" tip={t("settings.discordServers.language")} tipSub={t("settings.discordServers.languageSub")}>{t("settings.discordServers.language")}</FieldLabel>
                    <select id="srv-link-lang" value={link.lang} onChange={(e) => {
                        const lang = e.target.value;
                        setLink({ ...link, lang: lang === "de" || lang === "en" ? lang : "" });
                    }}>
                        <option value="">{t("settings.discordServers.lang.server")}</option>
                        <option value="de">{t("settings.discordServers.lang.de")}</option>
                        <option value="en">{t("settings.discordServers.lang.en")}</option>
                    </select>
                </div>
                {data.versions.length > 1 && (
                    <div className="dlg-field">
                        <FieldLabel tip={t("settings.discordServers.versions")} tipSub={t("settings.discordServers.versionsSub")}>{t("settings.discordServers.versions")}</FieldLabel>
                        <div className="chip-row">
                            <Chip pressed={!link.versions.length} tone={!link.versions.length ? "accent" : undefined} icon={!link.versions.length ? <CheckMark /> : undefined}
                                onClick={() => setLink({ ...link, versions: [] })}>{t("settings.discordServers.allVersions")}</Chip>
                            {data.versions.map((v) => {
                                const on = link.versions.includes(v.id);
                                return (
                                    <Chip key={v.id} pressed={on} tone={on ? "accent" : undefined} icon={on ? <CheckMark /> : undefined} tip={v.label}
                                        onClick={() => toggleVersion(v.id)}>{v.short}</Chip>
                                );
                            })}
                        </div>
                    </div>
                )}
                {exists && <div className="conn-status mid srv-hint" role="note"><WarnIcon /><span>{t("settings.discordServers.linkExists")}</span></div>}
            </div>
        </Modal>
    );
}

/** Adding a server (a bot server not configured yet) or changing a server's label. */
function ServerModal({ data, entry, onClose, onSave }: {
    data: DiscordServersData;
    /** null = add a new server. */
    entry: ServerEntry | null;
    onClose: () => void;
    onSave: (entry: ServerEntry) => Promise<void>;
}) {
    const t = useT();
    const [fields, setFields] = useState<ServerEntry>(entry || { guildId: "", label: "" });
    const [busy, setBusy] = useState(false);
    const taken = new Set(data.discordServers.servers.map((s) => s.guildId));
    const free = data.guilds.filter((g) => !taken.has(g.id));
    const submit = async () => {
        setBusy(true);
        try { await onSave({ guildId: fields.guildId, label: fields.label.trim() }); } finally { setBusy(false); }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="achievement_guildperk_everybodysfriend"
            tone="settings"
            kicker={t("settings.sections.discordserver.label")}
            title={entry ? guildName(data, entry.guildId) : t("settings.discordServers.addServer")}
            width={480}
            initialFocus={entry ? "input" : "select"}
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={entry ? <SaveIcon /> : <PlusIcon />} onClick={submit} disabled={!fields.guildId || busy} running={busy}>
                        {entry ? t("common.save") : t("settings.discordServers.addServer")}
                    </Button>
                </>
            )}
        >
            <div className="conn-form">
                {!entry && !data.guilds.length && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>{t("settings.state.botOffline")}</Badge>
                        <span>{t("settings.discordServers.offlineText")}</span>
                    </div>
                )}
                {!entry && data.guilds.length > 0 && !free.length && <div className="sync-empty">{t("settings.discordServers.noFreeServer")}</div>}
                {!entry && free.length > 0 && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="srv-add-guild">{t("settings.discordServers.server")}</FieldLabel>
                        <select id="srv-add-guild" value={fields.guildId} onChange={(e) => setFields({ ...fields, guildId: e.target.value })}>
                            <option value="">{t("settings.discordServers.chooseOption")}</option>
                            {free.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-add-label" tip={t("settings.discordServers.label")} tipSub={t("settings.discordServers.labelSub")}>{t("settings.discordServers.label")}</FieldLabel>
                    <input id="srv-add-label" type="text" maxLength={60} value={fields.label} placeholder={t("settings.discordServers.labelPlaceholder")}
                        onChange={(e) => setFields({ ...fields, label: e.target.value })} />
                </div>
            </div>
        </Modal>
    );
}

/** The two channels that apply to every server, saved on their own. */
function ChannelsModal({ data, onClose, onSave }: {
    data: DiscordServersData;
    onClose: () => void;
    onSave: (fields: Pick<DiscordServers, "signupNoteChannelId" | "guildBankChannelId">) => Promise<void>;
}) {
    const t = useT();
    const [fields, setFields] = useState({
        signupNoteChannelId: data.discordServers.signupNoteChannelId,
        guildBankChannelId: data.discordServers.guildBankChannelId,
    });
    const [busy, setBusy] = useState(false);
    const picks = noteChannels(data.guilds, data.discordServers.servers.map((s) => s.guildId));
    const submit = async () => {
        setBusy(true);
        try { await onSave(fields); } finally { setBusy(false); }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_note_02"
            tone="settings"
            kicker={t("settings.editKicker")}
            title={t("settings.discordServers.channelsTitle")}
            width={520}
            initialFocus="select, input"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} onClick={submit} disabled={busy} running={busy}>{t("common.save")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-note" tip={t("settings.discordServers.noteTip")} tipSub={t("settings.discordServers.noteTipSub")}>{t("settings.discordServers.noteTip")}</FieldLabel>
                    <ChannelPicker id="srv-note" value={fields.signupNoteChannelId} channels={picks} placeholder={t("settings.discordServers.noPost")}
                        onChange={(signupNoteChannelId) => setFields({ ...fields, signupNoteChannelId })} />
                </div>
                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-bank" tip={t("settings.discordServers.bankTip")} tipSub={t("settings.discordServers.bankTipSub")}>{t("settings.discordServers.bankTip")}</FieldLabel>
                    <ChannelPicker id="srv-bank" value={fields.guildBankChannelId} channels={picks} placeholder={t("settings.discordServers.noBank")}
                        onChange={(guildBankChannelId) => setFields({ ...fields, guildBankChannelId })} />
                </div>
            </div>
        </Modal>
    );
}
