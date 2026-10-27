import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useOutletContext } from "react-router-dom";
import {
    canAccess, createRoleMessage, deleteRoleMessage, getRoleMessageOptions, getRoleMessages, updateRoleMessage,
    type RoleMessage, type RoleMessageInput, type RoleMessageLimits, type RoleMessageOptions, type RoleMessageRoleOption,
    type DiscordServerChoice, type RoleMessageSaved,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { useToast } from "../../components/shell/Jobs";
import { Badge, Button, DataTable, Field, IconButton, Modal, PageHead, Segment, Switch, useConfirm, type Column } from "../../components/ui";
import DiscordTabs from "../../components/channels/DiscordTabs";
import { pickSearch, useServerPick } from "../../hooks/useServerPick";
import EmojiPicker from "../../components/ui/EmojiPicker";
import RaidLoader from "../../components/ui/RaidLoader";
import { AlertIcon, ChevronUpIcon, ExternalIcon, PenIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from "../../components/ui/icons";
import { useCollectionEditor } from "../../lib/ui/collectionEditor";
import { useDraftState } from "../../lib/ui/persistedState";
import { useTableSort, type Dir } from "../../lib/ui/tableSort";
import { previewEmoji } from "../../lib/discord/buttonEmoji";
import { serverExtra, serverName, shortName } from "../../lib/discord/serverPick";
import {
    ROLE_MESSAGE_LIMITS, colorToHex, groupChannels, problemText, roleBlockReason, roleMessageErrorText,
    roleMessageProblems, toInput, type RoleMessageError,
} from "../../lib/discord/roleMessages";
import RoleMessagePreview from "./RoleMessagePreview";
import "../../styles/role-messages.css";
import { tParts, useT } from "../../i18n";

// Rollen-Nachrichten (docs/role-messages.md): a message with a picture and one
// button per role — a click gives or takes the role, an emoji adds the same as a
// reaction. The list first, the editor as a dialog over it (?edit=<id|new>, as
// every collection editor), with the Discord message it will post next to the
// fields. Roles that carry rights (or that the bot cannot reach) are shown, but
// greyed out with the reason — the server refuses them anyway. The list holds the
// messages of every server of the server list (#895); the editor picks the server,
// a new message starts on the one picked on the other Discord tabs.

type SortKey = "title" | "server" | "channel" | "roles";
const SORT_DEFAULTS: Record<SortKey, Dir> = { title: "asc", server: "asc", channel: "asc", roles: "desc" };
const FORM_ID = "role-message-form";
const EMPTY_OPTIONS = (guildId: string): RoleMessageOptions => ({ guildId, online: false, manageRoles: null, roles: [], channels: [], emojis: [] });

/** The servers of the server list with their channels, roles and emojis. */
type ServerOptions = {
    servers: DiscordServerChoice[];
    /** keyed by guild id; a server whose call failed has empty options (bot "offline") */
    byGuild: Record<string, RoleMessageOptions>;
    /** why the server list itself failed ("" = it loaded) — then nothing is "offline", the list is missing */
    error?: string;
};

/** The options of a server; "" (or an unknown id) = the first of the list, as the API does. */
function optionsOf(options: ServerOptions, guildId: string): RoleMessageOptions {
    const id = guildId && options.servers.some((s) => s.guildId === guildId) ? guildId : options.servers[0]?.guildId || "";
    return options.byGuild[id] || EMPTY_OPTIONS(id);
}

function roleStyle(color: string): CSSProperties | undefined {
    return color ? ({ "--rm-role": color } as CSSProperties) : undefined;
}

export default function RoleMessagesPage() {
    const { user } = useOutletContext<ShellContext>();
    const canWrite = canAccess(user, "channels", "write");
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const editor = useCollectionEditor("edit");
    const sort = useTableSort<SortKey>("role-messages-sort", SORT_DEFAULTS, "title");

    const loaded = useApi(() => getRoleMessages(), []);
    const pick = useServerPick();
    const servers = pick.servers || [];
    // every server's options in one go: the list names channels and roles of all of them
    const serverKey = servers.map((s) => s.guildId).join(",");
    const opts = useApi(
        () => Promise.all(servers.map((s) => getRoleMessageOptions(s.guildId).catch(() => EMPTY_OPTIONS(s.guildId))))
            .then((list) => Object.fromEntries(list.map((o, i) => [servers[i].guildId, { ...o, guildId: servers[i].guildId }]))),
        [serverKey], { enabled: pick.ready },
    );
    const options: ServerOptions = { servers, byGuild: opts.data || {}, error: pick.error };
    const optionsReady = pick.ready && (!!opts.data || !!opts.error);
    const nameOf = (guildId: string) => {
        const s = servers.find((x) => x.guildId === guildId);
        return s ? serverName(s) : t("roleMessages.list.unknownServer");
    };
    const many = servers.length > 1;

    const [state, setState] = useState<FormState>({ dirty: false, problems: 0, saving: false, offline: false });
    const clearDraftRef = useRef<(() => void) | null>(null);

    if (loaded.error) return <div className="empty">{tParts("roleMessages.page.loadError", { message: loaded.error.message })}</div>;
    if (!loaded.data || !optionsReady) return <RaidLoader text={t("roleMessages.page.loading")} />;

    const { messages } = loaded.data;
    const limits = loaded.data.limits || ROLE_MESSAGE_LIMITS;
    const entry = editor.editId ? messages.find((m) => m.id === editor.editId) || null : null;

    const channelName = (m: RoleMessage) => optionsOf(options, m.guildId).channels.find((c) => c.id === m.channelId)?.name || "";
    const roleOf = (guildId: string, id: string) => optionsOf(options, guildId).roles.find((r) => r.id === id);
    const roleName = (guildId: string) => (id: string) => roleOf(guildId, id)?.name || t("roleMessages.list.unknownRole");

    const close = () => {
        clearDraftRef.current = null;
        setState({ dirty: false, problems: 0, saving: false, offline: false });
        editor.close();
    };
    const cancel = () => {
        clearDraftRef.current?.();
        close();
    };
    const afterSave = (saved: RoleMessageSaved, wasNew: boolean) => {
        toast(wasNew ? t("roleMessages.toast.created") : saved.reposted ? t("roleMessages.toast.reposted") : t("roleMessages.toast.saved"));
        for (const w of saved.warnings || []) toast(t("roleMessages.toast.warning", { warning: w }), "warn");
        close();
        loaded.reload();
    };
    const remove = async (m: RoleMessage) => {
        if (!(await ask({ title: t("roleMessages.delete.title"), text: t("roleMessages.delete.text", { title: m.title }), action: t("common.delete") }))) return;
        try {
            const res = await deleteRoleMessage(m.id);
            toast(res.messageDeleted ? t("roleMessages.toast.deleted") : t("roleMessages.toast.deletedGone"));
            if (editor.open) close();
            loaded.reload();
        } catch (err) {
            toast(roleMessageErrorText(err as RoleMessageError, roleName(m.guildId), limits), "err");
        }
    };

    const columns: Column<RoleMessage, SortKey>[] = [
        {
            id: "title", label: t("roleMessages.col.title"), sortKey: "title",
            cell: (m) => (
                <>
                    <span className="rm-cell rm-title">{m.title}</span>
                    {/* phones hide the server and channel columns; this line carries them instead */}
                    <span className="rm-cell rm-sub rm-meta">
                        {many ? `${nameOf(m.guildId)} · ` : ""}{channelName(m) ? `#${channelName(m)}` : t("roleMessages.list.unknownChannel")}
                    </span>
                </>
            ),
        },
        ...(many ? [{
            id: "server", label: t("roleMessages.col.server"), sortKey: "server" as const, width: 160,
            cell: (m: RoleMessage) => <span className="rm-cell rm-sub" data-tip={nameOf(m.guildId)}>{shortName(nameOf(m.guildId))}</span>,
        }] : []),
        {
            id: "channel", label: t("roleMessages.col.channel"), sortKey: "channel", width: 190,
            cell: (m) => <span className="rm-cell">{channelName(m) ? `#${channelName(m)}` : <span className="rm-sub">{t("roleMessages.list.unknownChannel")}</span>}</span>,
        },
        {
            id: "roles", label: t("roleMessages.col.roles"), sortKey: "roles", width: 140,
            tip: t("roleMessages.col.rolesTip"), tipSub: t("roleMessages.col.rolesSub"),
            cell: (m) => (
                <span className="rm-cell" data-tip={m.roles.map((r) => `@${roleName(m.guildId)(r.roleId)}`).join(", ")}>
                    {t("roleMessages.list.roles", { count: m.roles.length })}
                </span>
            ),
        },
        {
            id: "link", width: 150,
            cell: (m) => (m.url
                ? <a className="rm-link" href={m.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalIcon />{t("roleMessages.list.open")}</a>
                : <span className="rm-sub">{t("roleMessages.list.notPosted")}</span>),
        },
    ];
    if (canWrite) {
        columns.push({
            id: "acts", width: 84, actions: true,
            cell: (m) => (
                <div className="rm-acts">
                    <IconButton icon={<PenIcon />} size="sm" tip={t("common.edit")} onClick={() => editor.startEdit(m.id)} />
                    <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("common.delete")} onClick={() => remove(m)} />
                </div>
            ),
        });
    }

    const sortValue = (m: RoleMessage, key: SortKey) => {
        if (key === "server") return nameOf(m.guildId).toLowerCase();
        if (key === "channel") return channelName(m).toLowerCase();
        if (key === "roles") return m.roles.length;
        return m.title.toLowerCase();
    };

    // Notes over the list: the server list failed, a server the bot is not on, or on which it lacks Manage Roles.
    const listNote = pick.error
        ? [{ key: "servers-error", side: t("roleMessages.hint.serversSide"), text: t("roleMessages.hint.serversError", { message: pick.error }) }]
        : [];
    const notes = [...listNote, ...servers.flatMap((s) => {
        const o = optionsOf(options, s.guildId);
        const name = serverName(s);
        if (!o.online) return [{ key: `${s.guildId}-off`, side: name, text: t("roleMessages.hint.offline") }];
        if (o.manageRoles === false) return [{ key: `${s.guildId}-mr`, side: name, text: t("roleMessages.hint.manageRoles") }];
        return [];
    })];

    const saveDisabled = !canWrite || state.problems > 0 || state.offline || state.saving;

    return (
        <div className="rm-page">
            <PageHead
                icon="inv_shirt_guildtabard_01"
                tone="channels"
                kicker={t("roleMessages.page.kicker")}
                title={t("roleMessages.page.title")}
                meta={(
                    <>
                        <Badge tip={t("roleMessages.page.title")} tipSub={t("roleMessages.page.infoSub")}>{t("roleMessages.page.count", { count: messages.length })}</Badge>
                        {!canWrite && <Badge tone="mid">{t("roleMessages.page.readOnly")}</Badge>}
                    </>
                )}
                action={canWrite ? <Button variant="ghost" icon={<PlusIcon />} onClick={editor.startNew}>{t("roleMessages.page.new")}</Button> : undefined}
            />
            <DiscordTabs user={user} guildId={pick.guildId} search={pickSearch(pick)} />

            {notes.length > 0 && (
                <ul className="rm-notes">
                    {notes.map((n) => <li key={n.key} className="rm-note"><AlertIcon /><span><b>{n.side}:</b> {n.text}</span></li>)}
                </ul>
            )}

            <div className="rm-table">
                <DataTable
                    rows={messages}
                    columns={columns}
                    rowKey={(m) => m.id}
                    sort={sort}
                    sortValue={sortValue}
                    onRowClick={canWrite ? (m) => editor.startEdit(m.id) : undefined}
                    rowClassName={canWrite ? "clickable" : undefined}
                    empty={<div className="empty">{t("roleMessages.page.empty")}</div>}
                />
            </div>

            <Modal
                open={canWrite && !!editor.open}
                onClose={close}
                icon="inv_shirt_guildtabard_01"
                tone="channels"
                kicker={entry ? t("roleMessages.modal.kickerEdit") : t("roleMessages.modal.kickerNew")}
                title={entry ? entry.title : t("roleMessages.page.new")}
                width={1000}
                hint={entry
                    ? <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={() => remove(entry)}>{t("common.delete")}</Button>
                    : undefined}
                footer={(
                    <>
                        {state.dirty && <Badge tone="mid" className="rm-draft" tip={t("roleMessages.modal.draft")} tipSub={t("roleMessages.modal.draftSub")}>{t("roleMessages.modal.draft")}</Badge>}
                        {state.problems > 0 && <Badge tone="bad" icon={<AlertIcon />}>{t("roleMessages.modal.problems", { count: state.problems })}</Badge>}
                        <Button variant="ghost" onClick={cancel}>{t("common.cancel")}</Button>
                        <Button type="submit" variant="go" icon={<SaveIcon />} form={FORM_ID} disabled={saveDisabled} running={state.saving}>
                            {entry ? t("common.save") : t("roleMessages.modal.saveNew")}
                        </Button>
                    </>
                )}
            >
                {canWrite && editor.open && pick.ready && (
                    <RoleMessageForm
                        key={entry?.id ?? "new"}
                        editing={entry}
                        options={options}
                        startGuild={pick.guildId}
                        limits={limits}
                        onSaved={afterSave}
                        onState={(s, clear) => {
                            clearDraftRef.current = clear;
                            if (s.dirty !== state.dirty || s.problems !== state.problems || s.saving !== state.saving || s.offline !== state.offline) setState(s);
                        }}
                    />
                )}
            </Modal>
        </div>
    );
}

// ---- editor -------------------------------------------------------------------------

type FormState = { dirty: boolean; problems: number; saving: boolean; offline: boolean };

function initialInput(m: RoleMessage | null, startGuild: string): RoleMessageInput {
    return {
        guildId: m ? m.guildId : startGuild,
        channelId: m?.channelId ?? "",
        title: m?.title ?? "",
        body: m?.body ?? "",
        imageUrl: m?.imageUrl ?? "",
        color: colorToHex(m?.color),
        roles: (m?.roles ?? []).map((r) => ({ roleId: r.roleId, emoji: r.emoji || "", label: r.label || "" })),
    };
}

function Count({ count, max, label }: { count: number; max: number; label: string }) {
    const t = useT();
    return <span className={`rm-count${count > max ? " over" : ""}`}>{t(label, { count, max })}</span>;
}

export function RoleMessageForm({ editing, options, startGuild = "", limits, onSaved, onState }: {
    editing: RoleMessage | null;
    options: ServerOptions;
    /** the server a new message starts on ("" = the first of the list) */
    startGuild?: string;
    limits: RoleMessageLimits;
    onSaved: (saved: RoleMessageSaved, wasNew: boolean) => void;
    onState: (state: FormState, clearDraft: () => void) => void;
}) {
    const t = useT();
    const toast = useToast();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the start server counts only when the form opens
    const initial = useMemo(() => initialInput(editing, startGuild), [editing]);
    const [draft, patch, clearDraft] = useDraftState<RoleMessageInput>(`role-message:${editing?.id ?? "new"}`, initial);
    const [saving, setSaving] = useState(false);
    const [picking, setPicking] = useState(false);
    const [search, setSearch] = useState("");

    // a draft kept from before the server list has no guildId: it starts on the first server
    const opts = optionsOf(options, draft.guildId || "");
    const roles = opts.roles;
    const problems = roleMessageProblems(draft, roles, limits);
    const offline = !opts.online;
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
    const roleName = (id: string) => roles.find((r) => r.id === id)?.name || t("roleMessages.list.unknownRole");

    useEffect(() => { onState({ dirty, problems: problems.length, saving, offline }, clearDraft); });

    const channel = opts.channels.find((c) => c.id === draft.channelId);
    const groups = groupChannels(opts.channels);
    const used = new Set(draft.roles.map((r) => r.roleId));
    const full = draft.roles.length >= limits.roles;
    const reactions = draft.roles.filter((r) => r.emoji.trim()).length;

    const setServer = (guildId: string) => {
        if (guildId === opts.guildId) return;
        // channels and roles belong to a server: another server starts them empty
        patch({ guildId, channelId: "", roles: [] });
    };
    const setRole = (index: number, fields: Partial<RoleMessageInput["roles"][number]>) =>
        patch({ roles: draft.roles.map((r, i) => (i === index ? { ...r, ...fields } : r)) });
    const removeRole = (index: number) => patch({ roles: draft.roles.filter((_, i) => i !== index) });
    const moveUp = (index: number) => {
        const next = [...draft.roles];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        patch({ roles: next });
    };
    const addRole = (role: RoleMessageRoleOption) => {
        if (roleBlockReason(role) || used.has(role.id) || full) return;
        patch({ roles: [...draft.roles, { roleId: role.id, emoji: "", label: role.name }] });
        setSearch("");
        if (draft.roles.length + 1 >= limits.roles) setPicking(false);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (problems.length || offline || saving) return;
        setSaving(true);
        try {
            const input = toInput({ ...draft, guildId: opts.guildId }, roles);
            const saved = editing ? await updateRoleMessage(editing.id, input) : await createRoleMessage(input);
            clearDraft();
            onSaved(saved, !editing);
        } catch (err) {
            toast(roleMessageErrorText(err as RoleMessageError, roleName, limits), "err");
        } finally {
            setSaving(false);
        }
    };

    const q = search.trim().toLowerCase();
    const matching = roles.filter((r) => r.name !== "@everyone" && (!q || r.name.toLowerCase().includes(q)));
    const pickable = matching.filter((r) => !roleBlockReason(r));
    const blocked = matching.filter((r) => roleBlockReason(r));

    const serverOptions = options.servers.map((s) => {
        const name = serverName(s);
        const extra = serverExtra(s);
        return { value: s.guildId, label: shortName(name), tip: extra ? `${name} · ${extra}` : name };
    });

    const previewRoles = draft.roles.map((r) => ({ ...r, name: roles.find((x) => x.id === r.roleId)?.name || "" }));

    return (
        <form id={FORM_ID} className="rm-grid" onSubmit={submit} noValidate>
            <div>
                {offline && (
                    <div className="rm-note" role="alert"><AlertIcon /><span>
                        {options.error ? t("roleMessages.hint.serversError", { message: options.error }) : t("roleMessages.hint.offline")}
                    </span></div>
                )}
                <div className="rm-pair">
                    {serverOptions.length > 1 && (
                        <Field label={t("roleMessages.form.server")}>
                            {serverOptions.length > 3 ? (
                                <select value={opts.guildId} onChange={(e) => setServer(e.target.value)} aria-label={t("roleMessages.form.server")}>
                                    {serverOptions.map((o) => <option key={o.value} value={o.value}>{o.tip}</option>)}
                                </select>
                            ) : (
                                <Segment options={serverOptions} value={opts.guildId} onChange={setServer} ariaLabel={t("roleMessages.form.server")} />
                            )}
                        </Field>
                    )}
                    <Field label={t("roleMessages.form.channel")} htmlFor="rm-channel">
                        <select id="rm-channel" value={draft.channelId} onChange={(e) => patch({ channelId: e.target.value })} disabled={offline}>
                            <option value="">{t("roleMessages.form.channelPick")}</option>
                            {draft.channelId && !channel && <option value={draft.channelId}>{t("roleMessages.list.unknownChannel")}</option>}
                            {groups.map((g) => (
                                <optgroup key={g.category || "-"} label={g.category || t("roleMessages.form.noCategory")}>
                                    {g.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                </optgroup>
                            ))}
                        </select>
                        {channel && channel.canReact === false && reactions > 0 && (
                            <div className="rm-cant"><AlertIcon /><span>{t("roleMessages.form.cantReact")}</span></div>
                        )}
                    </Field>
                </div>

                <Field label={t("roleMessages.form.title")} htmlFor="rm-title" hint={<Count count={draft.title.trim().length} max={limits.title} label="roleMessages.form.length" />}>
                    <input id="rm-title" type="text" value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("roleMessages.form.titlePlaceholder")} />
                </Field>
                <Field label={t("roleMessages.form.body")} htmlFor="rm-body" tip={t("roleMessages.form.body")} tipSub={t("roleMessages.form.bodySub")}
                    hint={<Count count={draft.body.trim().length} max={limits.body} label="roleMessages.form.length" />}
                >
                    <textarea id="rm-body" value={draft.body} onChange={(e) => patch({ body: e.target.value })} placeholder={t("roleMessages.form.bodyPlaceholder")} />
                </Field>
                <div className="rm-pair">
                    <Field label={t("roleMessages.form.image")} htmlFor="rm-image" tip={t("roleMessages.form.image")} tipSub={t("roleMessages.form.imageSub")}>
                        <input id="rm-image" type="url" inputMode="url" value={draft.imageUrl} onChange={(e) => patch({ imageUrl: e.target.value })} placeholder={t("roleMessages.form.imagePlaceholder")} />
                    </Field>
                    <Field label={t("roleMessages.form.colorField")} tip={t("roleMessages.form.colorField")} tipSub={t("roleMessages.form.colorSub")}>
                        <div className="rm-color">
                            <Switch checked={draft.color !== null} onChange={(on) => patch({ color: on ? draft.color || "#8a7cff" : null })} label={t("roleMessages.form.color")} />
                            {draft.color !== null && (
                                <input type="color" value={draft.color} onChange={(e) => patch({ color: e.target.value })} aria-label={t("roleMessages.form.colorPick")} data-tip={t("roleMessages.form.colorPick")} />
                            )}
                        </div>
                    </Field>
                </div>

                <div className="field">
                    <div className="rm-roles-head">
                        <div className="field-label">
                            <span>{t("roleMessages.form.roles")}</span>
                            <span className="info" tabIndex={0} role="img" aria-label={t("roleMessages.form.roles")} data-tip={t("roleMessages.form.roles")} data-tip-sub={t("roleMessages.form.rolesSub")}>i</span>
                        </div>
                        <div className="rm-counts">
                            <Count count={draft.roles.length} max={limits.roles} label="roleMessages.form.rolesCount" />
                            <Count count={reactions} max={limits.reactions} label="roleMessages.form.reactionsCount" />
                        </div>
                    </div>
                    {draft.roles.length
                        ? (
                            <ol className="rm-rows">
                                {draft.roles.map((r, i) => {
                                    const opt = roles.find((x) => x.id === r.roleId);
                                    const name = opt?.name || t("roleMessages.list.unknownRole");
                                    const bad = roles.length > 0 && (!opt || !!roleBlockReason(opt));
                                    return (
                                        <li key={r.roleId + i} className={`rm-row${bad ? " rm-row-bad" : ""}`}>
                                            <span className="rm-role-name" data-tip={bad && opt ? roleBlockReason(opt) : undefined}>
                                                <span className="rm-dot" style={roleStyle(opt?.color || "")} />
                                                <span>@{name}</span>
                                            </span>
                                            <EmojiField value={r.emoji} emojis={opts.emojis} label={t("roleMessages.form.emoji", { role: name })} onChange={(emoji) => setRole(i, { emoji })} />
                                            <input
                                                type="text"
                                                value={r.label}
                                                onChange={(e) => setRole(i, { label: e.target.value })}
                                                placeholder={name}
                                                aria-label={t("roleMessages.form.label", { role: name })}
                                                data-tip={t("roleMessages.form.label", { role: name })}
                                            />
                                            <span className="rm-row-acts">
                                                {i > 0 && <IconButton icon={<ChevronUpIcon />} size="sm" tone="ghost" tip={t("roleMessages.form.moveUp", { role: name })} onClick={() => moveUp(i)} />}
                                                <IconButton icon={<XIcon />} size="sm" tone="danger" tip={t("roleMessages.form.remove", { role: name })} onClick={() => removeRole(i)} />
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                        )
                        : <div className="rm-empty-roles">{t("roleMessages.form.noRoles")}</div>}

                    <span className="rm-add" data-tip={offline ? t("roleMessages.form.addRoleOffline") : full ? t("roleMessages.form.addRoleFull", { max: limits.roles }) : undefined}>
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<PlusIcon />}
                            pressed={picking}
                            disabled={offline || full}
                            onClick={() => setPicking(!picking)}
                        >
                            {t("roleMessages.form.addRole")}
                        </Button>
                    </span>
                    {picking && !offline && !full && (
                        <div className="rm-pick">
                            <input
                                type="search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("roleMessages.form.searchPlaceholder")}
                                aria-label={t("roleMessages.form.search")}
                                autoFocus
                            />
                            <div className="rm-pick-list">
                                {!matching.length && <div className="rm-empty-roles">{t("roleMessages.form.noMatch")}</div>}
                                {pickable.length > 0 && <div className="rm-pick-head">{t("roleMessages.form.pickable")}</div>}
                                {pickable.map((r) => (
                                    <button key={r.id} type="button" className="rm-opt" disabled={used.has(r.id)} onClick={() => addRole(r)}>
                                        <span className="rm-dot" style={roleStyle(r.color)} />
                                        <span className="rm-opt-name">@{r.name}</span>
                                        <span className="rm-opt-why">{used.has(r.id) ? t("roleMessages.form.used") : ""}</span>
                                    </button>
                                ))}
                                {blocked.length > 0 && <div className="rm-pick-head">{t("roleMessages.form.blocked")}</div>}
                                {blocked.map((r) => (
                                    <button key={r.id} type="button" className="rm-opt" disabled data-tip={roleBlockReason(r)}>
                                        <span className="rm-dot" style={roleStyle(r.color)} />
                                        <span className="rm-opt-name">@{r.name}</span>
                                        <span className="rm-opt-why">{roleBlockReason(r)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {problems.length > 0 && (
                    <ul className="rm-problems" role="alert">
                        {problems.map((p, i) => <li key={`${p.code}-${i}`}><AlertIcon />{problemText(p, limits, roleName)}</li>)}
                    </ul>
                )}
            </div>
            <aside>
                <div className="field-label"><span>{t("roleMessages.form.preview")}</span></div>
                <RoleMessagePreview title={draft.title} body={draft.body} imageUrl={draft.imageUrl} color={draft.color} roles={previewRoles} emojis={opts.emojis} />
            </aside>
        </form>
    );
}

/** A role's emoji: a Unicode emoji or one of the server's own (stored as its <:name:id> code). */
function EmojiField({ value, emojis, label, onChange }: {
    value: string;
    emojis: RoleMessageOptions["emojis"];
    label: string;
    onChange: (emoji: string) => void;
}) {
    const t = useT();
    const parsed = previewEmoji(value);
    const currentCustom = parsed?.kind === "custom" ? emojis.find((e) => e.id === parsed.id) || { id: parsed.id, name: parsed.name, url: parsed.url } : null;
    return (
        <span className="rm-emoji">
            <EmojiPicker
                label={label}
                current={parsed?.kind === "unicode" ? parsed.text : ""}
                host="dialog"
                onPick={onChange}
                custom={emojis.length ? { label: t("emoji.server"), emojis } : undefined}
                onPickCustom={(e) => onChange(emojis.find((x) => x.id === e.id)?.code || `<:${e.name}:${e.id}>`)}
                currentCustom={currentCustom}
            />
            {value && <IconButton icon={<XIcon />} size="sm" tone="ghost" tip={t("roleMessages.form.emojiClear")} onClick={() => onChange("")} />}
        </span>
    );
}
