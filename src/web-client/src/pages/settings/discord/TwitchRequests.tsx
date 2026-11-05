import { useT } from "../../../i18n";
import type { TwitchRequest } from "../../../api";
import { Button } from "../../../components/ui/Button";
import DataTable, { type Column } from "../../../components/ui/table/DataTable";
import { CheckIcon, XIcon } from "../../../components/ui/icons/icons";
import { formatDateTime } from "../../../lib/format";
import { useTableSort, type Dir } from "../../../lib/ui/tableSort";
import { twitchUrl } from "../../../lib/settings/twitch";

type SortKey = "raider" | "login" | "since";
const SORT_DEFAULTS: Record<SortKey, Dir> = { raider: "asc", login: "asc", since: "asc" };

/**
 * Raiders' waiting requests above the list of the Twitch section (docs/twitch.md), oldest
 * first. Nothing shows without a request. A full list blocks the approval, not the rejection:
 * a waiting request does not count against the limit, an approved one does.
 */
export default function TwitchRequests({ requests, writable, full, onApprove, onReject }: {
    requests: TwitchRequest[];
    writable: boolean;
    full: boolean;
    onApprove: (request: TwitchRequest) => void;
    onReject: (request: TwitchRequest) => void;
}) {
    const t = useT();
    const sort = useTableSort<SortKey>("twitch-requests-sort", SORT_DEFAULTS, "since");
    if (!requests.length) return null;

    const columns: Column<TwitchRequest, SortKey>[] = [
        {
            id: "raider", label: t("settings.twitch.requests.col.raider"), sortKey: "raider",
            cell: (r) => <span className="tws-cut" data-tip={r.userName || r.userId}>{r.userName || r.userId}</span>,
        },
        {
            id: "login", label: t("settings.twitch.requests.col.login"), sortKey: "login",
            cell: (r) => (
                <a className="tws-name" href={twitchUrl(r.login)} target="_blank" rel="noopener noreferrer" data-tip={t("settings.twitch.openOnTwitch")} data-tip-sub={r.login}>
                    {r.login}
                </a>
            ),
        },
        { id: "since", label: t("settings.twitch.requests.col.since"), sortKey: "since", cell: (r) => formatDateTime(r.requestedAt) },
    ];
    if (writable) {
        columns.push({
            id: "actions", className: "cell-act", actions: true,
            cell: (r) => (
                <span className="tws-actions">
                    <Button size="sm" variant="yes" icon={<CheckIcon />} disabled={full} onClick={() => onApprove(r)}>{t("settings.twitch.requests.approve")}</Button>
                    <Button size="sm" variant="no" icon={<XIcon />} onClick={() => onReject(r)}>{t("settings.twitch.requests.reject")}</Button>
                </span>
            ),
        });
    }

    const sortValue = (r: TwitchRequest, key: SortKey) => {
        if (key === "raider") return (r.userName || r.userId).toLowerCase();
        if (key === "login") return r.login;
        return r.requestedAt;
    };

    return (
        <section className="tws-requests" aria-label={t("settings.twitch.requests.aria")}>
            <h3 className="tws-requests-title">{t("settings.twitch.requests.title", { count: requests.length })}</h3>
            {writable && full && <p className="tws-hint">{t("settings.twitch.requests.full")}</p>}
            <DataTable
                rows={requests}
                columns={columns}
                rowKey={(r) => r.userId}
                sort={sort}
                sortValue={sortValue}
                className="idx tws-table tws-req-table"
                wrapClassName="table-scroll"
            />
        </section>
    );
}
