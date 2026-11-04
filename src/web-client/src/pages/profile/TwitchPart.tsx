import { useState } from "react";
import {
    getProfileTwitch, removeOwnTwitch, requestTwitch, withdrawTwitch,
    type ApiError, type ProfileTwitch, type ProfileTwitchServer, type ProfileTwitchStatus,
} from "../../api";
import { Button, DataTable, useConfirm, type Column } from "../../components/ui";
import { useToast } from "../../components/shell/Jobs";
import { SendIcon, TrashIcon, XIcon } from "../../components/ui/icons/icons";
import { useTableSort } from "../../lib/ui/tableSort";
import { tOr, useT } from "../../i18n";

/**
 * Own Twitch announcements (docs/twitch.md, "Raider requests"): one name, one row per server
 * the person is a member of. They only ask: channel, role and text are the orga's, so nobody
 * can ping through a request. The status lives here alone, there is no DM.
 */
type SortKey = "server" | "status";

const STATUS_RANK: Record<ProfileTwitchStatus, number> = { pending: 0, rejected: 1, approved: 2, none: 3 };

/** The refusals (404 and 409) that mean the rows on screen are out of date. */
const STALE_CODES = new Set(["not_found", "already_open", "already_approved", "already_listed"]);

function serverKey(s: ProfileTwitchServer): string {
    return s.name || s.guildId;
}

export function TwitchPart({ data, onChange }: {
    data: ProfileTwitch;
    onChange: (next: ProfileTwitch) => void;
}) {
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const [name, setName] = useState(data.lastLogin);
    const [busy, setBusy] = useState("");
    const sort = useTableSort<SortKey>("profile-twitch-sort", { server: "asc", status: "asc" }, "server");

    /** One action on one server at a time; a refusal that shows the rows are stale reloads them. */
    const run = async (guildId: string, action: () => Promise<ProfileTwitch>, done: string) => {
        setBusy(guildId);
        try {
            const next = await action();
            onChange(next);
            if (next.lastLogin) setName(next.lastLogin);
            toast(done);
        } catch (e) {
            const err = e as ApiError;
            toast(tOr(`profile.twitch.error.${err.code}`, err.message), "err");
            if (STALE_CODES.has(err.code)) await getProfileTwitch().then(onChange).catch(() => undefined);
        } finally {
            setBusy("");
        }
    };

    const request = (s: ProfileTwitchServer) => run(s.guildId, () => requestTwitch(s.guildId, name.trim()), t("profile.twitch.requested"));
    const withdraw = (s: ProfileTwitchServer) => run(s.guildId, () => withdrawTwitch(s.guildId), t("profile.twitch.withdrawn"));
    const removeOwn = async (s: ProfileTwitchServer) => {
        const sure = await ask({
            title: t("profile.twitch.removeTitle"),
            text: t("profile.twitch.removeText", { login: s.login, server: serverKey(s) }),
            action: t("profile.twitch.remove"),
            tone: "danger",
        });
        if (sure) await run(s.guildId, () => removeOwnTwitch(s.guildId), t("profile.twitch.removed"));
    };

    const action = (s: ProfileTwitchServer) => {
        const off = busy === s.guildId;
        if (s.status === "pending") return <Button size="sm" variant="ghost" icon={<XIcon />} disabled={off} onClick={() => void withdraw(s)}>{t("profile.twitch.withdraw")}</Button>;
        if (s.status === "approved") return <Button size="sm" variant="danger" icon={<TrashIcon />} disabled={off} onClick={() => void removeOwn(s)}>{t("profile.twitch.remove")}</Button>;
        return <Button size="sm" variant="go" icon={<SendIcon />} disabled={off || !name.trim()} onClick={() => void request(s)}>{t("profile.twitch.request")}</Button>;
    };

    const columns: Column<ProfileTwitchServer, SortKey>[] = [
        {
            id: "server", label: t("profile.twitch.colServer"), sortKey: "server",
            // the name sits under the server: the part is only half a page wide, a column of its own hides the button
            cell: (s) => (
                <span className="pf-twitch-server">
                    <span className="pf-sync-device" data-tip={serverKey(s)}>{serverKey(s)}</span>
                    {s.login && <span className="pf-sync-device pf-muted" data-tip={s.login}>{s.login}</span>}
                </span>
            ),
        },
        {
            id: "status", label: t("profile.twitch.colStatus"), sortKey: "status",
            cell: (s) => <span className={`pf-twitch-status pf-twitch-${s.status}`}>{t(`profile.twitch.status.${s.status}`)}</span>,
        },
        { id: "action", label: t("profile.twitch.colAction"), actions: true, className: "pf-sync-act", cell: action },
    ];

    const sortValue = (s: ProfileTwitchServer, key: SortKey) => (key === "server" ? serverKey(s).toLowerCase() : STATUS_RANK[s.status]);

    return (
        <div className="pf-cal">
            <p className="pf-muted">{t("profile.twitch.intro")}</p>
            {data.unknown && <p className="pf-muted" role="status">{t("profile.twitch.unknown")}</p>}
            <div className="pf-sync-new">
                <input
                    type="text"
                    value={name}
                    maxLength={200}
                    aria-label={t("profile.twitch.name")}
                    placeholder={t("profile.twitch.namePlaceholder")}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
            <DataTable
                rows={data.servers}
                columns={columns}
                rowKey={(s) => s.guildId}
                sort={sort}
                sortValue={sortValue}
                wrapClassName="pf-sync-wrap"
                empty={data.unknown ? null : <p className="pf-muted">{t("profile.twitch.empty")}</p>}
            />
        </div>
    );
}
