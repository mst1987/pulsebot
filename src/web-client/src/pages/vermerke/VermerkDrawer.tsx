import { useEffect, useState } from "react";
import {
    archiveVermerk, getVermerkPerson, hideVermerk,
    type VermerkEntry, type VermerkHistory,
} from "../../api/vermerke";
import { useApi } from "../../hooks/useApi";
import { Button, IconButton, useConfirm } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { ChevronDownIcon, EditIcon, EyeIcon, EyeOffIcon, LockIcon, PlusIcon, RefreshIcon, XIcon } from "../../components/ui/icons";
import LevelMark from "../../components/vermerke/LevelMark";
import ReasonIcon from "../../components/vermerke/ReasonIcon";
import type { VermerkDialogPerson } from "../../components/vermerke/VermerkDialog";
import { formatDate, formatDateTime } from "../../lib/format";
import { initialsOf } from "../../lib/discord/serverRoles";
import "../../styles/vermerke.css";
import { useT } from "../../i18n";

// The drawer of one person (A): the entries that count, newest first, with the
// text right there and the history to fold out. A shared entry of another server
// carries a lock and that server's name and is read only — this server may only
// hide it for itself (write). Below, folded: what was hidden here and the archive.

export default function VermerkDrawer({ userId, guildName, fallbackName, canWrite, version, onClose, onChanged, onAdd, onEdit }: {
    userId: string;
    guildName: string;
    /** the name from the list, until the person is loaded */
    fallbackName: string;
    canWrite: boolean;
    /** bumped by the page after every change: load again */
    version: number;
    onClose: () => void;
    onChanged: () => void;
    onAdd: (person: VermerkDialogPerson) => void;
    onEdit: (person: VermerkDialogPerson, entry: VermerkEntry) => void;
}) {
    const t = useT();
    const state = useApi(() => getVermerkPerson(userId), [userId, version]);
    const [busy, setBusy] = useState("");
    const [failed, setFailed] = useState("");
    const ask = useConfirm();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
            onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const data = state.data;
    const name = (data && data.name) || fallbackName || userId;
    const person: VermerkDialogPerson = { userId, name };
    const entries = data ? data.entries : [];
    const active = entries.filter((e) => e.active);
    const hidden = entries.filter((e) => e.hidden);
    const archive = entries.filter((e) => !e.active && !e.hidden);

    const run = async (id: string, job: () => Promise<unknown>) => {
        setBusy(id);
        setFailed("");
        try {
            await job();
            onChanged();
        } catch (err) {
            setFailed(t("vermerke.drawer.failed", { message: (err as Error).message || String(err) }));
        } finally {
            setBusy("");
        }
    };
    const actions: EntryActions = {
        busy,
        canWrite,
        edit: (e) => onEdit(person, e),
        archive: async (e) => {
            const yes = await ask({ title: t("vermerke.drawer.archiveIt"), text: t("vermerke.drawer.archiveSub"), action: t("vermerke.drawer.archiveIt"), tone: "danger" });
            if (yes) await run(e.id, () => archiveVermerk(userId, e.id, true));
        },
        restore: (e) => run(e.id, () => archiveVermerk(userId, e.id, false)),
        hide: (e, hide) => run(e.id, () => hideVermerk(e.id, hide)),
    };

    return (
        <>
            <div className="vmk-backdrop" aria-hidden="true" onClick={onClose} />
            <aside className="vmk-drawer" aria-label={name}>
                <div className="vmk-drawer-head">
                    <span className="vmk-av vmk-av-lg" aria-hidden="true">{initialsOf(name)}</span>
                    <div className="vmk-drawer-title">
                        <span className="kicker">{t("vermerke.drawer.kicker", { guild: guildName })}</span>
                        <h2>{name}</h2>
                        {data && <LevelMark level={data.level} />}
                    </div>
                    <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
                </div>
                <div className="vmk-drawer-body">
                    {canWrite && (
                        <div className="vmk-drawer-acts">
                            <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => onAdd(person)}>{t("vermerke.drawer.add")}</Button>
                        </div>
                    )}
                    {failed && <p className="vmk-error" role="alert">{failed}</p>}
                    {state.error && !data && <p className="vmk-empty">{t("vermerke.drawer.loadError", { message: state.error.message })}</p>}
                    {!data && !state.error && <RaidLoader compact text={t("vermerke.drawer.loading")} />}
                    {data && (
                        <>
                            <section className="vmk-sec">
                                <div className="vmk-sec-head">
                                    <h3>{active.length ? t("vermerke.drawer.active", { count: active.length }) : t("vermerke.drawer.noneActive")}</h3>
                                </div>
                                {active.map((e) => <Entry key={e.id} entry={e} actions={actions} />)}
                            </section>
                            {hidden.length > 0 && (
                                <details className="vmk-fold">
                                    <summary><ChevronDownIcon />{t("vermerke.drawer.hiddenSection", { count: hidden.length })}</summary>
                                    {hidden.map((e) => <Entry key={e.id} entry={e} actions={actions} off />)}
                                </details>
                            )}
                            {archive.length > 0 && (
                                <details className="vmk-fold">
                                    <summary><ChevronDownIcon />{t("vermerke.drawer.archive", { count: archive.length })}</summary>
                                    {archive.map((e) => <Entry key={e.id} entry={e} actions={actions} off />)}
                                </details>
                            )}
                        </>
                    )}
                </div>
            </aside>
        </>
    );
}

type EntryActions = {
    busy: string;
    canWrite: boolean;
    edit: (e: VermerkEntry) => void;
    archive: (e: VermerkEntry) => void;
    restore: (e: VermerkEntry) => void;
    hide: (e: VermerkEntry, hide: boolean) => void;
};

function Entry({ entry: e, actions, off = false }: { entry: VermerkEntry; actions: EntryActions; off?: boolean }) {
    const t = useT();
    const busy = actions.busy === e.id;
    const now = Date.now();
    const expired = e.expiresAt != null && e.expiresAt <= now;
    // a server the bot no longer sees has no name; never show a bare "?"
    const origin = e.originName || t("vermerke.drawer.otherServer");
    return (
        <article className={`vmk-entry${off ? " vmk-entry-off" : ""}`} data-entry={e.id}>
            <div className="vmk-entry-top">
                <LevelMark level={e.level} />
                <ReasonIcon reason={e.reason} withWord />
                {actions.canWrite && (
                    <span className="vmk-entry-acts">
                        {e.own && !e.archived && !expired && (
                            <IconButton icon={<EditIcon />} tip={t("vermerke.drawer.edit")} size="sm" onClick={() => actions.edit(e)} disabled={busy} />
                        )}
                        {e.own && !e.archived && (
                            <IconButton icon={<XIcon />} tip={t("vermerke.drawer.archiveIt")} tipSub={t("vermerke.drawer.archiveSub")} size="sm" onClick={() => actions.archive(e)} disabled={busy} />
                        )}
                        {e.own && e.archived && (
                            <IconButton icon={<RefreshIcon />} tip={t("vermerke.drawer.restore")} tipSub={t("vermerke.drawer.restoreSub")} size="sm" onClick={() => actions.restore(e)} disabled={busy} />
                        )}
                        {!e.own && (
                            e.hidden
                                ? <IconButton icon={<EyeIcon />} tip={t("vermerke.drawer.unhide")} size="sm" onClick={() => actions.hide(e, false)} disabled={busy} />
                                : <IconButton icon={<EyeOffIcon />} tip={t("vermerke.drawer.hide")} tipSub={t("vermerke.drawer.hideSub")} size="sm" onClick={() => actions.hide(e, true)} disabled={busy} />
                        )}
                    </span>
                )}
            </div>
            {e.text ? <p className="vmk-entry-text">{e.text}</p> : <p className="vmk-entry-text vmk-muted">{t("vermerke.drawer.noText")}</p>}
            <div className="vmk-entry-meta">
                <span>{t("vermerke.drawer.by", { name: e.byName || e.by, date: formatDate(e.at) })}</span>
                {!e.own && (
                    <span
                        className="vmk-lock" data-tip={t("vermerke.drawer.fromServer", { server: origin })}
                        data-tip-sub={t("vermerke.drawer.fromServerSub", { server: origin })}
                    >
                        <LockIcon />{t("vermerke.drawer.fromServer", { server: origin })}
                    </span>
                )}
                {e.own && e.shared && (
                    <span className="vmk-lock" data-tip={t("vermerke.drawer.shared")} data-tip-sub={t("vermerke.drawer.sharedOwnSub")}>
                        <LockIcon />{t("vermerke.drawer.shared")}
                    </span>
                )}
                {e.eventIds.length > 0 && <span>{t("vermerke.drawer.raids", { count: e.eventIds.length })}</span>}
                {e.archived && e.archivedAt ? <span>{t("vermerke.drawer.archivedOn", { date: formatDate(e.archivedAt) })}</span>
                    : e.expiresAt != null && <span>{t(expired ? "vermerke.drawer.expired" : "vermerke.drawer.expires", { date: formatDate(e.expiresAt) })}</span>}
            </div>
            {e.history.length > 1 && <History items={e.history} />}
        </article>
    );
}

function History({ items }: { items: VermerkHistory[] }) {
    const t = useT();
    const sorted = [...items].sort((a, b) => b.at - a.at);
    return (
        <details className="vmk-fold vmk-hist">
            <summary><ChevronDownIcon />{t("vermerke.drawer.history", { count: items.length })}</summary>
            <ul>
                {sorted.map((h, i) => (
                    <li key={`${h.at}-${i}`}>
                        {formatDateTime(h.at)} · {h.byName || h.by} · {t(`vermerke.drawer.action.${h.action}`)}
                        {h.changes && h.changes.length > 0 && ` (${h.changes.map((c) => fieldLabel(t, c)).join(", ")})`}
                    </li>
                ))}
            </ul>
        </details>
    );
}

const FIELDS = ["level", "reason", "text", "eventIds", "expiresAt", "shared"] as const;
function fieldLabel(t: ReturnType<typeof useT>, field: string): string {
    return (FIELDS as readonly string[]).includes(field) ? t(`vermerke.drawer.field.${field}`) : field;
}
