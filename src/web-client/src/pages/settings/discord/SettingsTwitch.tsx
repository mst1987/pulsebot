import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useT } from "../../../i18n";
import { useApi } from "../../../hooks/useApi";
import {
    addTwitchStreamer, canAccess, checkTwitchStreamers, getTwitchSettings, removeTwitchStreamer, updateTwitchStreamer,
    type ApiError, type Role, type TextChannel, type TwitchLimits, type TwitchMention, type TwitchStreamer, type TwitchView,
} from "../../../api";
import type { ShellContext } from "../../../components/shell/Shell";
import { useToast } from "../../../components/shell/Jobs";
import { Modal, useConfirm } from "../../../components/ui/overlay/Modal";
import { Button, IconButton } from "../../../components/ui/Button";
import Chip from "../../../components/ui/Chip";
import Field from "../../../components/ui/form/Field";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import DataTable, { type Column } from "../../../components/ui/table/DataTable";
import { PenIcon, PlusIcon, SaveIcon, TrashIcon } from "../../../components/ui/icons/icons";
import AllSettingsLink from "../../../components/settings/AllSettingsLink";
import { ChannelPicker, RolePicker } from "../../../components/settings/settingsUi";
import { useTableSort, type Dir } from "../../../lib/ui/tableSort";
import {
    addTwitchGame, TWITCH_PLACEHOLDERS, twitchCheckText, twitchErrorText, twitchFilterText, twitchLastRunText,
    twitchRoleWontPing, twitchStatusRank, twitchStatusWords, twitchUrl,
} from "../../../lib/settings/twitch";

type SortKey = "login" | "channel" | "role" | "filter" | "status";
const SORT_DEFAULTS: Record<SortKey, Dir> = { login: "asc", channel: "asc", role: "asc", filter: "asc", status: "asc" };

/**
 * Twitch stream announcements of the active server (Einstellungen › Server › Twitch,
 * docs/twitch.md): one sortable table with the status in words, one dialog for adding and
 * editing. It saves on its own; a tab left open after a server switch gets 409 and stops.
 */
export default function SettingsTwitch({ guildId, channels, roles }: { guildId: string; channels: TextChannel[]; roles: Role[] }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const ctx = useOutletContext<ShellContext | undefined>();
    const canWrite = !ctx?.user || canAccess(ctx.user, "settings", "write");
    const page = useApi<TwitchView>(() => getTwitchSettings(), [guildId]);
    const view = page.data;

    const [switched, setSwitched] = useState(false);
    const [checking, setChecking] = useState(false);
    /** The dialog: null closed, "new" adding, otherwise the entry being edited. */
    const [editing, setEditing] = useState<TwitchStreamer | "new" | null>(null);

    const sort = useTableSort<SortKey>("twitch-streamers-sort", SORT_DEFAULTS, "status");
    const channelName = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);
    const roleName = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
    const channelText = (id: string) => (channelName.has(id) ? `#${channelName.get(id)}` : t("settings.twitch.channelUnknown"));
    const roleText = (id: string) => (id ? (roleName.has(id) ? `@${roleName.get(id)}` : t("settings.twitch.roleUnknown")) : t("settings.twitch.roleNone"));

    function failed(err: ApiError) {
        if (err.code === "server_switched") setSwitched(true);
        toast(twitchErrorText(err), "err");
    }

    async function check() {
        setChecking(true);
        try {
            const { result, ...next } = await checkTwitchStreamers(guildId);
            page.setData(next);
            const words = twitchCheckText(result);
            toast(words.text, words.ok ? "ok" : "warn");
        } catch (e) {
            failed(e as ApiError);
        } finally {
            setChecking(false);
        }
    }

    async function remove(login: string) {
        const sure = await ask({
            title: t("settings.twitch.removeTitle"),
            text: t("settings.twitch.removeText", { login }),
            action: t("settings.twitch.removeAction"),
            tone: "danger",
        });
        if (!sure) return;
        try {
            page.setData(await removeTwitchStreamer(guildId, login));
            toast(t("settings.twitch.removed", { login }));
        } catch (e) {
            failed(e as ApiError);
        }
    }

    if (!guildId) return null;
    if (page.error) return <div className="set-card set-form"><p className="field-error" role="alert">{twitchErrorText(page.error)}</p></div>;
    if (!view) return <RaidLoader text={t("settings.twitch.loading")} />;
    // The list belongs to the session's active server: after a switch in another tab it is
    // the other server's, its channel ids would not resolve against this tab's names.
    if (view.guildId !== guildId) return <div className="set-card set-form"><p className="field-error" role="alert">{t("settings.serverSwitched")}</p></div>;

    const writable = canWrite && !switched;
    const full = view.streamers.length >= view.limits.streamers;
    const lastRun = twitchLastRunText(view.lastRun);

    const columns: Column<TwitchStreamer, SortKey>[] = [
        {
            id: "login", label: t("settings.twitch.col.streamer"), sortKey: "login",
            cell: (s) => (
                <a className="tws-name" href={twitchUrl(s.login)} target="_blank" rel="noopener noreferrer" data-tip={t("settings.twitch.openOnTwitch")} data-tip-sub={s.login}>
                    {s.login}
                </a>
            ),
        },
        {
            id: "channel", label: t("settings.twitch.col.channel"), sortKey: "channel",
            cell: (s) => <span className="tws-cut" data-tip={channelText(s.channelId)}>{channelText(s.channelId)}</span>,
        },
        {
            id: "role", label: t("settings.twitch.col.role"), sortKey: "role",
            cell: (s) => {
                const wontPing = twitchRoleWontPing(view.mention, s.roleId);
                return (
                    <span
                        className={`tws-cut${s.roleId ? "" : " tws-none"}${wontPing ? " tipped tws-noping" : ""}`}
                        data-tip={roleText(s.roleId)}
                        data-tip-sub={wontPing ? t("settings.twitch.roleNoPingTip") : undefined}
                    >
                        {roleText(s.roleId)}
                    </span>
                );
            },
        },
        {
            id: "filter", label: t("settings.twitch.col.filter"), sortKey: "filter",
            cell: (s) => (
                <span className={`tws-cut${s.games.length > 1 ? " tipped" : ""}${s.games.length ? "" : " tws-none"}`} data-tip={s.games.length ? s.games.join(", ") : undefined}>
                    {twitchFilterText(s.games)}
                </span>
            ),
        },
        {
            id: "status", label: t("settings.twitch.col.status"), sortKey: "status", tip: t("settings.twitch.col.statusTip"),
            cell: (s) => {
                const words = twitchStatusWords(s.status);
                return (
                    <>
                        <span
                            className={`tws-status is-${words.tone}${words.details.length ? " tipped" : ""}`}
                            data-tip={words.details.length ? words.text : undefined}
                            data-tip-sub={words.details.length ? words.details.join(" · ") : undefined}
                        >
                            {words.text}
                        </span>
                        {s.status.postedChannelId && (
                            <span className="tws-note">{t("settings.twitch.movedChannel", { channel: channelText(s.status.postedChannelId) })}</span>
                        )}
                        {s.status.messageGone && s.status.state !== "offline" && <span className="tws-note">{t("settings.twitch.messageGone")}</span>}
                    </>
                );
            },
        },
    ];
    if (writable) {
        columns.push({
            id: "actions", className: "cell-act", actions: true,
            cell: (s) => (
                <span className="tws-actions">
                    <IconButton size="sm" icon={<PenIcon />} tip={t("settings.twitch.editTip")} onClick={() => setEditing(s)} />
                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("settings.twitch.removeTip")} onClick={() => void remove(s.login)} />
                </span>
            ),
        });
    }

    const sortValue = (s: TwitchStreamer, key: SortKey) => {
        switch (key) {
            case "channel": return channelText(s.channelId).toLowerCase();
            case "role": return roleText(s.roleId).toLowerCase();
            case "filter": return twitchFilterText(s.games).toLowerCase();
            case "status": return twitchStatusRank(s.status);
            default: return s.login;
        }
    };

    return (
        <div className="set-card set-form">
            {switched && <p className="field-error" role="alert">{t("settings.serverSwitched")}</p>}
            {!view.hasCredentials && (
                <p className="tws-missing" role="status">
                    {t("settings.twitch.noCredentials")}{" "}
                    <AllSettingsLink section="verbindungen" inline>{t("settings.twitch.noCredentialsLink")}</AllSettingsLink>
                </p>
            )}
            {view.hasCredentials && view.lastRun.error === "bad_credentials" && (
                <p className="tws-missing" role="status">
                    {t("settings.twitch.badCredentials")}{" "}
                    <AllSettingsLink section="verbindungen" inline>{t("settings.twitch.badCredentialsLink")}</AllSettingsLink>
                </p>
            )}
            <div className="tws-head">
                {writable && (
                    <Button variant="go" icon={<PlusIcon />} disabled={full} onClick={() => setEditing("new")}>{t("settings.twitch.add")}</Button>
                )}
                {writable && view.streamers.length > 0 && (
                    <Button variant="ghost" disabled={checking} onClick={() => void check()}>
                        {checking ? t("settings.twitch.checking") : t("settings.twitch.check")}
                    </Button>
                )}
                {lastRun && <span className="tws-last">{lastRun}</span>}
            </div>
            {writable && full && <p className="tws-hint">{t("settings.twitch.limitReached", { max: view.limits.streamers })}</p>}
            <DataTable
                rows={view.streamers}
                columns={columns}
                rowKey={(s) => s.login}
                sort={sort}
                sortValue={sortValue}
                className="idx tws-table"
                wrapClassName="table-scroll"
                empty={<p className="tws-empty">{t("settings.twitch.empty")}</p>}
            />
            {editing && (
                <StreamerDialog
                    guildId={guildId}
                    streamer={editing === "new" ? null : editing}
                    limits={view.limits}
                    mention={view.mention}
                    channels={channels}
                    roles={roles}
                    onClose={() => setEditing(null)}
                    onSaved={(next, login) => {
                        // a pasted link is the input, the server's list knows the actual name
                        const added = next.streamers.find((s) => !view.streamers.some((known) => known.login === s.login));
                        page.setData(next);
                        setEditing(null);
                        toast(t("settings.twitch.saved", { login: added?.login || login }));
                    }}
                    onSwitched={() => {
                        setSwitched(true);
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

/** Adding or editing one streamer: the name stays fixed once saved, it identifies the entry. */
function StreamerDialog({ guildId, streamer, limits, mention, channels, roles, onClose, onSaved, onSwitched }: {
    guildId: string;
    streamer: TwitchStreamer | null;
    limits: TwitchLimits;
    mention: TwitchMention;
    channels: TextChannel[];
    roles: Role[];
    onClose: () => void;
    onSaved: (view: TwitchView, login: string) => void;
    onSwitched: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [login, setLogin] = useState(streamer?.login || "");
    const [channelId, setChannelId] = useState(streamer?.channelId || "");
    const [roleId, setRoleId] = useState(streamer?.roleId || "");
    const [text, setText] = useState(streamer?.text || "");
    const [games, setGames] = useState<string[]>(streamer?.games || []);
    const [gameInput, setGameInput] = useState("");
    const [gameError, setGameError] = useState("");
    const [busy, setBusy] = useState(false);

    const textOver = text.length > limits.textLength;

    function addGame() {
        const next = addTwitchGame(games, gameInput, limits);
        setGameError(next.error);
        if (next.error) return;
        setGames(next.games);
        setGameInput("");
    }

    async function save() {
        // a name still in the input counts: the dialog must not drop it without a word
        const pending = addTwitchGame(games, gameInput, limits);
        setGameError(pending.error);
        if (pending.error) return;
        setBusy(true);
        try {
            const input = { login: login.trim(), channelId, roleId, text, games: pending.games };
            const view = streamer ? await updateTwitchStreamer(guildId, input) : await addTwitchStreamer(guildId, input);
            onSaved(view, login.trim());
        } catch (e) {
            const err = e as ApiError;
            if (err.code === "server_switched") onSwitched();
            toast(twitchErrorText(err), "err");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open
            onClose={onClose}
            icon="twitch"
            tone="settings"
            title={streamer ? t("settings.twitch.modal.editTitle") : t("settings.twitch.modal.addTitle")}
            width={480}
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} onClick={() => void save()} disabled={busy || !login.trim() || !channelId || textOver}>
                        {busy ? t("settings.saving") : t("common.save")}
                    </Button>
                </>
            )}
        >
            <Field label={t("settings.twitch.modal.login")} htmlFor="tws-login" className="dlg-field tws-field">
                <input
                    id="tws-login"
                    value={login}
                    readOnly={!!streamer}
                    placeholder={t("settings.twitch.modal.loginPlaceholder")}
                    onChange={(e) => setLogin(e.target.value)}
                />
            </Field>
            <Field label={t("settings.twitch.modal.channel")} htmlFor="tws-channel" className="dlg-field tws-field">
                <ChannelPicker id="tws-channel" value={channelId} channels={channels} onChange={setChannelId} placeholder={t("settings.twitch.modal.channelPlaceholder")} />
            </Field>
            <Field label={t("settings.twitch.modal.role")} htmlFor="tws-role" className="dlg-field tws-field">
                <RolePicker id="tws-role" value={roleId} roles={roles} onChange={setRoleId} placeholder={t("settings.twitch.modal.rolePlaceholder")} />
                {twitchRoleWontPing(mention, roleId) && <p className="tws-noping-hint" role="status">{t("settings.twitch.modal.roleNoPing")}</p>}
            </Field>
            <Field
                label={t("settings.twitch.modal.text")}
                htmlFor="tws-text"
                className="dlg-field tws-field"
                hint={t("settings.twitch.modal.textHint", { placeholders: TWITCH_PLACEHOLDERS })}
            >
                <textarea id="tws-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                <span className={`tws-counter${textOver ? " tws-counter-over" : ""}`}>
                    {t("settings.twitch.modal.textCount", { count: text.length, max: limits.textLength })}
                </span>
            </Field>
            <Field
                label={t("settings.twitch.modal.games")}
                htmlFor="tws-game"
                className="dlg-field tws-field"
                hint={t("settings.twitch.modal.gamesHint")}
                error={gameError || undefined}
            >
                <div className="tws-game-add">
                    <input
                        id="tws-game"
                        value={gameInput}
                        placeholder={t("settings.twitch.modal.gamesPlaceholder")}
                        onChange={(e) => {
                            setGameInput(e.target.value);
                            setGameError("");
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                addGame();
                            }
                        }}
                    />
                    <Button variant="ghost" icon={<PlusIcon />} onClick={addGame} disabled={!gameInput.trim()}>{t("settings.twitch.modal.gamesAdd")}</Button>
                </div>
                {games.length > 0 && (
                    <div className="tws-games">
                        {games.map((game) => (
                            <Chip
                                key={game}
                                className="tws-game"
                                removeLabel={t("settings.twitch.modal.gamesRemove", { game })}
                                onRemove={() => setGames(games.filter((g) => g !== game))}
                            >
                                {game}
                            </Chip>
                        ))}
                    </div>
                )}
                <span className="tws-counter">{t("settings.twitch.modal.gamesCount", { count: games.length, max: limits.games })}</span>
            </Field>
        </Modal>
    );
}
