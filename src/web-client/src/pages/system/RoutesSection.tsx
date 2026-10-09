import { useState } from "react";
import type { SystemRoute, SystemStatus } from "../../api";
import { useT } from "../../i18n";
import { PartHead } from "../../components/ui/PartHead";
import DataTable, { type Column } from "../../components/ui/DataTable";
import Segment from "../../components/ui/Segment";
import Expand from "../../components/ui/Expand";
import Badge from "../../components/ui/Badge";
import { useTableSort } from "../../lib/ui/tableSort";
import { usePersistedState } from "../../lib/ui/persistedState";
import { formatTime } from "../../lib/format";
import { millis, num } from "../../lib/system/systemFormat";

// "Langsamste Seiten/Anfragen": every route pattern with its count, mean, p95,
// maximum and slow requests - for the last hour or since the start - sortable,
// slowest p95 first. Below it, folded, the last slow requests one by one.

type Window = "hour" | "total";
type SortKey = "route" | "count" | "avg" | "p95" | "max" | "slow";

const SORTS: Record<SortKey, "asc" | "desc"> = { route: "asc", count: "desc", avg: "desc", p95: "desc", max: "desc", slow: "desc" };

export default function RoutesSection({ requests }: { requests: SystemStatus["requests"] }) {
    const t = useT();
    const [win, setWin] = usePersistedState<Window>("system-routes-window", "hour");
    const sort = useTableSort<SortKey>("system-routes-sort", SORTS, "p95");
    const [openSlow, setOpenSlow] = useState(false);
    const rows = requests.routes.filter((r) => r[win].count > 0);
    const fig = (r: SystemRoute) => r[win];
    const slowTone = (r: SystemRoute) => (fig(r).slow > 0 ? "bad" : undefined);
    const columns: Column<SystemRoute, SortKey>[] = [
        { id: "route", label: t("system.routes.route"), sortKey: "route", className: "sy-route", cell: (r) => <code>{r.route}</code> },
        { id: "count", label: t("system.routes.count"), sortKey: "count", className: "sy-num", tip: t("system.routes.countTip"), cell: (r) => num(fig(r).count) },
        { id: "avg", label: t("system.routes.avg"), sortKey: "avg", className: "sy-num sy-wide-only", tip: t("system.routes.avgTip"), cell: (r) => millis(fig(r).avg) },
        { id: "p95", label: t("system.routes.p95"), sortKey: "p95", className: "sy-num", tip: t("system.routes.p95Tip"), cell: (r) => <strong>{millis(fig(r).p95)}</strong> },
        { id: "max", label: t("system.routes.max"), sortKey: "max", className: "sy-num sy-wide-only", tip: t("system.routes.maxTip"), cell: (r) => millis(fig(r).max) },
        {
            id: "slow", label: t("system.routes.slow"), sortKey: "slow", className: "sy-num", tip: t("system.routes.slowTip", { ms: num(requests.threshold) }),
            cell: (r) => (fig(r).slow ? <Badge size="sm" tone={slowTone(r)}>{num(fig(r).slow)}</Badge> : "0"),
        },
    ];
    const value = (r: SystemRoute, key: SortKey) => (key === "route" ? r.route.toLowerCase() : fig(r)[key]);
    return (
        <section className="sy-section">
            <PartHead
                icon="inv_misc_pocketwatch_01"
                tone="system"
                title={t("system.routes.title")}
                crumb={t("system.routes.since", { time: formatTime(requests.since) })}
                tip={t("system.routes.title")}
                tipSub={t("system.routes.tip", { ms: num(requests.threshold) })}
                action={(
                    <Segment
                        ariaLabel={t("system.routes.window")}
                        size="sm"
                        value={win}
                        onChange={setWin}
                        options={[{ value: "hour", label: t("system.routes.hour") }, { value: "total", label: t("system.routes.total") }]}
                    />
                )}
            />
            <DataTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.route}
                sort={sort}
                sortValue={value}
                className="idx sy-table"
                pageSize={15}
                empty={<p className="hint sy-empty">{t("system.routes.empty")}</p>}
            />
            <div className="sy-slow">
                <Expand open={openSlow} onToggle={() => setOpenSlow(!openSlow)} label={t("system.routes.slowList", { count: requests.slow.length })} />
                {openSlow && (requests.slow.length === 0
                    ? <p className="hint">{t("system.routes.noSlow", { ms: num(requests.threshold) })}</p>
                    : (
                        <ul className="sy-slow-list">
                            {requests.slow.map((s, i) => (
                                <li key={`${s.t}-${i}`}>
                                    <span className="sy-label">{formatTime(s.t)}</span>
                                    <code>{s.method} {s.path}</code>
                                    <Badge size="sm" tone={s.status >= 500 ? "bad" : undefined}>{s.status}</Badge>
                                    <strong>{millis(s.ms)}</strong>
                                </li>
                            ))}
                        </ul>
                    ))}
            </div>
        </section>
    );
}
