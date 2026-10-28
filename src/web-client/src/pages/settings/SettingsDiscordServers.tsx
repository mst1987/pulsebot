import { useEffect, useState } from "react";
import {
    getDiscordServers, getPugInvites, getTalkOverview, postInviteChannel, postPugInvite, repostTalkOverview, updateSettings,
    type AdminConfig, type ApiError, type DiscordServers, type DiscordServersData, type PugInvites, type PugServerInvite,
    type ServerChannels, type ServerEntry, type ServerLink, type ServerRow, type TalkOverviewStatus, type TextChannel,
} from "../../api";
import { linkKey, linkStatusBadge, linkStatusOf, linkSummary, raidCategoriesText, serverCardState } from "../../lib/settings/settingsLogic";
import { useTableSort } from "../../lib/ui/tableSort";
import { useToast } from "../../components/shell/Jobs";
import { CheckMark, CopyIcon, PenIcon, PlusIcon, RefreshIcon, SaveIcon, SendIcon, TrashIcon, WarnIcon } from "../../components/ui/icons";
import RoleSyncPart from "./SettingsRoleSync";
import PugOnboardingPart from "./PugOnboardingPart";
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
// and each server's own two signup channels (#924: no shared default, a server
// without one posts nothing there). Each change saves at once,
// only the fields it touches. Every server can be removed (#897).

const MAX_SERVERS = 10;

type LinkSortKey = "link" | "channel" | "status" | "summary" | "invite";

/** What an invite cell shows: the invite itself, or why there is none. */
type InviteView = { code: string; url: string; error: string; deleted: boolean };
type ServerSortKey = "server" | "status" | "categories" | "members";
/** One server's two signup channels (#924) as a row of the channels table. */
type ChannelRow = ServerChannels & { guildId: string };
type ChannelSortKey = "server" | "note" | "bank";

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
    const [editChannels, setEditChannels] = useState("");
    const [posting, setPosting] = useState("");
    // #905: the invite per link and who joined through it; null = not loaded (or failed), the columns show "—".
    const [invites, setInvites] = useState<PugInvites | null>(null);
    const [inviteBusy, setInviteBusy] = useState("");
    const linkSort = useTableSort<LinkSortKey>("settings-links-sort", {
        link: "asc", channel: "asc", status: "asc", summary: "asc", invite: "desc",
    }, "link");
    const serverSort = useTableSort<ServerSortKey>("settings-servers-sort", { server: "asc", status: "desc", categories: "desc", members: "desc" }, "server");
    const channelSort = useTableSort<ChannelSortKey>("settings-signup-channels-sort", { server: "asc", note: "asc", bank: "asc" }, "server");

    const load = () => {
        getDiscordServers().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
        // One shared fetch for every link's status instead of one per row.
        getTalkOverview().then((d) => setStatuses(d.statuses)).catch(() => setStatuses([]));
        getPugInvites().then(setInvites).catch(() => setInvites(null));
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
            crumb={t("settings.crumbAll", { crumb })}
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
            text: [
                t("settings.discordServers.removeLinkText", {
                    from: guildName(data, link.from),
                    to: guildName(data, link.to),
                    channel: channelName(guildChannels(data, link.to), link.channelId),
                }),
                inviteOf(link)?.url ? t("settings.discordServers.removeLinkInvite") : "",
            ].filter(Boolean).join(" "),
            action: t("settings.discordServers.removeLink"),
            tone: "danger",
        });
        if (!ok) return;
        await save({ links: config.links.filter((l) => !sameLink(l, link)) }, t("settings.discordServers.linkRemoved"));
    };

    const removeServer = async (row: ServerRow) => {
        const droppedLinks = config.links.filter((l) => l.from === row.id);
        const dropped = droppedLinks.length;
        const withInvite = droppedLinks.some((l) => inviteOf(l)?.url) || !!invites?.servers.find((s) => s.guildId === row.id)?.url;
        const ok = await ask({
            title: t("settings.discordServers.removeServerTitle"),
            text: [
                t("settings.discordServers.removeServerText", { name: row.name || row.id }),
                dropped ? t("settings.discordServers.removeServerLinks", { count: dropped }) : "",
                withInvite ? t("settings.discordServers.removeServerInvites") : "",
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
    const inviteOf = (link: ServerLink) => invites?.links.find((i) => i.key === linkKey(link)) || null;

    const copyInvite = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            toast(t("settings.discordServers.inviteCopied"));
        } catch {
            toast(url);
        }
    };

    /** Creates or (after asking) replaces a link's or a server's general invite; `busyKey` marks the row. */
    const runInvite = async (target: { key: string } | { guildId: string }, regenerate: boolean, busyKey: string) => {
        if (regenerate) {
            const ok = await ask({
                title: t("settings.discordServers.regenerateTitle"),
                text: t("settings.discordServers.regenerateText"),
                action: t("settings.discordServers.regenerateInvite"),
                tone: "danger",
                icon: <RefreshIcon />,
                actionIcon: <RefreshIcon />,
            });
            if (!ok) return;
        }
        setInviteBusy(busyKey);
        try {
            const next = await postPugInvite(target, regenerate);
            setInvites(next);
            const rec = "key" in target ? next.links.find((l) => l.key === target.key) : next.servers.find((s) => s.guildId === target.guildId);
            if (rec && rec.error) toast(rec.error, "err");
            else toast(regenerate ? t("settings.discordServers.inviteRegenerated") : t("settings.discordServers.inviteCreated"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setInviteBusy("");
        }
    };

    const saveInviteChannel = async (guildId: string, channelId: string) => {
        setInvites(await postInviteChannel(guildId, channelId));
    };

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
            id: "invite", label: t("settings.discordServers.colInvite"), sortKey: "invite",
            cell: (l) => {
                const inv = inviteOf(l);
                if (!inv) return <span className="srv-muted">—</span>;
                const key = linkKey(l);
                return (
                    <span className="srv-invite-cell">
                        <InviteCell invite={inv} busy={inviteBusy === key} disabled={!!inviteBusy} onCopy={copyInvite}
                            onCreate={() => runInvite({ key }, false, key)} onRegenerate={() => runInvite({ key }, true, key)} />
                        {inv.url && (
                            <span className="srv-counts">
                                <span data-tip={t("settings.discordServers.joinedTip")}>{t("settings.discordServers.joinedCount", { count: inv.joined })}</span>
                                <span aria-hidden="true"> · </span>
                                <span data-tip={t("settings.discordServers.signedUpTip")}>{t("settings.discordServers.signedUpCount", { count: inv.signedUp })}</span>
                            </span>
                        )}
                    </span>
                );
            },
        },
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
        // By who came through it; a link without an invite after one with nobody yet.
        if (key === "invite") return inviteOf(l)?.url ? inviteOf(l)?.joined ?? 0 : -1;
        return `${guildName(data, l.from)} ${guildName(data, l.to)}`.toLowerCase();
    };

    const membersText = (s: ServerRow) => (s.memberCount == null
        ? t("settings.discordServers.membersUnknown")
        : t("settings.discordServers.memberCount", { count: s.memberCount }));

    const serverColumns: Column<ServerRow, ServerSortKey>[] = [
        {
            id: "server", label: t("settings.discordServers.colServer"), sortKey: "server",
            cell: (s) => (
                <span className="srv-server" data-tip={s.name || s.id} data-tip-sub={t("settings.discordServers.serverId", { id: s.id })}>
                    {s.iconUrl ? <img className="srv-icon" src={s.iconUrl} alt="" /> : <span className="srv-initials">{initials(s.name || s.id)}</span>}
                    <span className="srv-server-text">
                        <b className="srv-name">{s.name || s.id}</b>
                        {s.label && <span className="srv-muted">{s.label}</span>}
                        {/* Narrow screens hide the categories and members columns; this line carries them
                            instead, with the noun even for none ("0 Raid-Kategorien" rather than a bare "keine"). */}
                        <span className="srv-sub">
                            <span>{t("settings.discordServers.raidCategoryCount", { count: s.raidCategories })}</span>
                            <span>{membersText(s)}</span>
                        </span>
                    </span>
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
            cell: membersText,
        },
        {
            id: "actions", actions: true, className: "srv-actions",
            cell: (s) => (
                <span className="row-actions">
                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.discordServers.label")} tipSub={t("settings.discordServers.labelSub")}
                        onClick={() => { setEditServer({ guildId: s.id, label: s.label }); setDialog("server"); }} />
                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.discordServers.removeServer")} onClick={() => removeServer(s)} />
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

    // #924: the two signup channels per server; a server without one posts nothing there, no other server stands in.
    const channelRows: ChannelRow[] = Object.entries(data.channels || {}).map(([guildId, ch]) => ({ guildId, ...ch }));
    const missingNote = channelRows.filter((r) => !r.signupNoteChannelId);
    const unsetCell = (tip: string) => <span className="srv-muted" data-tip={tip}>{t("settings.discordServers.channelUnset")}</span>;
    const channelText = (r: ChannelRow, id: string) => (id ? channelName(guildChannels(data, r.guildId), id).toLowerCase() : "~");
    const channelSortValue = (r: ChannelRow, key: ChannelSortKey) => {
        if (key === "note") return channelText(r, r.signupNoteChannelId);
        if (key === "bank") return channelText(r, r.guildBankChannelId);
        return guildName(data, r.guildId).toLowerCase();
    };
    const channelColumns: Column<ChannelRow, ChannelSortKey>[] = [
        { id: "server", label: t("settings.discordServers.colServer"), sortKey: "server", cell: (r) => <b>{guildName(data, r.guildId)}</b> },
        {
            id: "note", sortKey: "note", label: t("settings.discordServers.noteRow"), tip: t("settings.discordServers.noteTip"), tipSub: t("settings.discordServers.noteTipSub"),
            cell: (r) => (r.signupNoteChannelId ? channelName(guildChannels(data, r.guildId), r.signupNoteChannelId) : unsetCell(t("settings.discordServers.noteUnsetTip"))),
        },
        {
            id: "bank", sortKey: "bank", label: t("settings.discordServers.bankRow"), tip: t("settings.discordServers.bankTip"), tipSub: t("settings.discordServers.bankTipSub"),
            cell: (r) => (r.guildBankChannelId ? channelName(guildChannels(data, r.guildId), r.guildBankChannelId) : unsetCell(t("settings.discordServers.bankUnsetTip"))),
        },
        {
            id: "actions", actions: true, className: "srv-actions",
            cell: (r) => (
                <span className="row-actions">
                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.discordServers.editChannels")}
                        onClick={() => { setEditChannels(r.guildId); setDialog("channels"); }} />
                </span>
            ),
        },
    ];

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
                />
                {missingNote.length > 0 && (
                    <p className="note">{t("settings.discordServers.channelsMissing", { list: missingNote.map((r) => guildName(data, r.guildId)).join(", ") })}</p>
                )}
                <div className="srv-table srv-signup-ch">
                    <DataTable
                        rows={channelRows}
                        columns={channelColumns}
                        rowKey={(r) => r.guildId}
                        sort={channelSort}
                        sortValue={channelSortValue}
                        empty={<div className="sync-empty">{t("settings.discordServers.channelsEmpty")}</div>}
                    />
                </div>
            </section>

            {/* #896: the role sync pairs any two servers of the list and says so itself when there is only one. */}
            <RoleSyncPart onConfig={onConfig} reloadKey={data.discordServers} />
            {/* #906: roles + onboarding of a PuG server, applied only by its own button. */}
            <PugOnboardingPart servers={data.servers} />
            <RemindersPart onConfig={onConfig} />

            {dialog === "link" && (
                <LinkModal data={data} onClose={() => setDialog(null)}
                    onSave={async (link) => {
                        if (await save({ links: [...config.links, link] }, t("settings.discordServers.linkAdded"))) setDialog(null);
                    }} />
            )}
            {dialog === "server" && (
                <ServerModal data={data} entry={editServer} onClose={() => setDialog(null)}
                    invite={editServer ? invites?.servers.find((s) => s.guildId === editServer.guildId) : undefined}
                    inviteBusy={!!editServer && inviteBusy === `server:${editServer.guildId}`}
                    onCopy={copyInvite}
                    onInvite={(guildId, regenerate) => runInvite({ guildId }, regenerate, `server:${guildId}`)}
                    onInviteChannel={saveInviteChannel}
                    onSave={async (entry) => {
                        const editing = config.servers.some((s) => s.guildId === entry.guildId);
                        const servers = editing ? config.servers.map((s) => (s.guildId === entry.guildId ? entry : s)) : [...config.servers, entry];
                        if (await save({ servers }, editing ? t("settings.discordServers.saved") : t("settings.discordServers.serverAdded"))) setDialog(null);
                    }} />
            )}
            {dialog === "channels" && editChannels && (
                <ChannelsModal data={data} guildId={editChannels} onClose={() => setDialog(null)}
                    onSave={async (fields) => {
                        if (await save({ channels: { [editChannels]: fields } }, t("settings.discordServers.saved"))) setDialog(null);
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
            className="srv-dlg"
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

/**
 * A link's or a server's invite (#905): the code with copy and "Neu erzeugen", "Erzeugen" while there is
 * none, and the reason (a missing bot right, the bot not on the server) as a red badge.
 */
function InviteCell({ invite, busy, disabled, onCopy, onCreate, onRegenerate }: {
    invite: InviteView;
    busy: boolean;
    disabled: boolean;
    onCopy: (url: string) => void;
    onCreate: () => void;
    onRegenerate: () => void;
}) {
    const t = useT();
    // Someone removed the invite on Discord (found by the check): say so and offer a new one right away.
    if (invite.deleted && !invite.url) {
        return (
            <span className="srv-invite">
                <span className="srv-muted">{t("settings.discordServers.inviteDeleted")}</span>
                <Button size="sm" variant="go" icon={<RefreshIcon />} onClick={onCreate} disabled={disabled} running={busy}>
                    {t("settings.discordServers.createInvite")}
                </Button>
            </span>
        );
    }
    // With a code the error is about that invite (e.g. the check failed); without one nothing could be made.
    const problem = invite.url ? t("settings.discordServers.inviteCheck") : t("settings.discordServers.inviteProblem");
    return (
        <span className="srv-invite">
            {invite.url ? (
                <>
                    <code className="srv-code" data-tip={invite.url}>{invite.code}</code>
                    <IconButton size="sm" icon={<CopyIcon />} tip={t("settings.discordServers.copyInvite")} tipSub={invite.url} onClick={() => onCopy(invite.url)} />
                    <IconButton size="sm" icon={<RefreshIcon />} tip={t("settings.discordServers.regenerateInvite")} tipSub={t("settings.discordServers.regenerateSub")}
                        onClick={onRegenerate} disabled={disabled} aria-busy={busy || undefined} />
                </>
            ) : (
                <Button size="sm" variant="go" icon={<PlusIcon />} onClick={onCreate} disabled={disabled} running={busy}>{t("settings.discordServers.createInvite")}</Button>
            )}
            {invite.error && (
                <Badge tone="bad" icon={<WarnIcon />} tip={problem} tipSub={invite.error}>{problem}</Badge>
            )}
        </span>
    );
}

/** Adding a server (a bot server not configured yet) or changing a server's label, invite channel and general invite. */
function ServerModal({ data, entry, invite, inviteBusy, onCopy, onInvite, onInviteChannel, onClose, onSave }: {
    data: DiscordServersData;
    /** null = add a new server. */
    entry: ServerEntry | null;
    /** The server's invites (#905); only a link source gets them. */
    invite?: PugServerInvite;
    inviteBusy: boolean;
    onCopy: (url: string) => void;
    onInvite: (guildId: string, regenerate: boolean) => void;
    onInviteChannel: (guildId: string, channelId: string) => Promise<void>;
    onClose: () => void;
    onSave: (entry: ServerEntry) => Promise<void>;
}) {
    const t = useT();
    const toast = useToast();
    const [fields, setFields] = useState<ServerEntry>(entry || { guildId: "", label: "" });
    const [inviteChannel, setInviteChannel] = useState(invite?.inviteChannelId || "");
    const [busy, setBusy] = useState(false);
    // The invites load next to the servers and refresh after every save: follow the stored channel.
    useEffect(() => setInviteChannel(invite?.inviteChannelId || ""), [invite?.inviteChannelId]);
    const taken = new Set(data.discordServers.servers.map((s) => s.guildId));
    const free = data.guilds.filter((g) => !taken.has(g.id));
    const withInvites = !!(entry && invite && invite.source);
    const submit = async () => {
        setBusy(true);
        try {
            if (withInvites && invite && inviteChannel !== invite.inviteChannelId) {
                try {
                    await onInviteChannel(fields.guildId, inviteChannel);
                } catch (err) {
                    toast((err as ApiError).message, "err");
                    return;
                }
            }
            await onSave({ guildId: fields.guildId, label: fields.label.trim() });
        } finally { setBusy(false); }
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
            className="srv-dlg"
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
                {withInvites && invite && (
                    <>
                        <div className="dlg-field">
                            <FieldLabel htmlFor="srv-invite-channel" tip={t("settings.discordServers.inviteChannel")} tipSub={t("settings.discordServers.inviteChannelSub")}>
                                {t("settings.discordServers.inviteChannel")}
                            </FieldLabel>
                            <ChannelPicker id="srv-invite-channel" value={inviteChannel} channels={guildChannels(data, invite.guildId)}
                                placeholder={t("settings.discordServers.inviteChannelAuto")} onChange={setInviteChannel} />
                        </div>
                        <div className="dlg-field">
                            <FieldLabel tip={t("settings.discordServers.generalInvite")} tipSub={t("settings.discordServers.generalInviteSub")}>
                                {t("settings.discordServers.generalInvite")}
                            </FieldLabel>
                            <InviteCell invite={invite} busy={inviteBusy} disabled={inviteBusy || busy} onCopy={onCopy}
                                onCreate={() => onInvite(invite.guildId, false)} onRegenerate={() => onInvite(invite.guildId, true)} />
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

/** The two signup channels of one server (#924), saved on their own; only that server's channels are offered. */
function ChannelsModal({ data, guildId, onClose, onSave }: {
    data: DiscordServersData;
    guildId: string;
    onClose: () => void;
    onSave: (fields: ServerChannels) => Promise<void>;
}) {
    const t = useT();
    const current = data.channels?.[guildId];
    const [fields, setFields] = useState<ServerChannels>({
        signupNoteChannelId: current?.signupNoteChannelId || "",
        guildBankChannelId: current?.guildBankChannelId || "",
    });
    const [busy, setBusy] = useState(false);
    const picks = guildChannels(data, guildId);
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
            title={t("settings.discordServers.channelsDialogTitle", { name: guildName(data, guildId) })}
            width={520}
            className="srv-dlg"
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
