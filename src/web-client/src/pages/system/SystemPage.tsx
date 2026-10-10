// "Systemstatus" (docs/system-status.md): where the load on the server comes
// from, and whether the server is too small. Full admins only - the menu
// entry, the route guard in App.tsx and, for real, the API (adminOnly).
//
// From the top: the verdict in one to three sentences, five tiles (server CPU,
// bot CPU, memory, event-loop delay, disk) with a sparkline of the last hour or
// 24 hours, then the slowest requests, the busiest processes of the host (only
// where the server could measure them) and what takes the space under data/.
// Refreshes every 15 s while the tab is visible; the processes and the disk
// walk are measured anew only on opening and on the refresh button.
import { useState } from "react";
import { getSystemStatus } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useVisiblePoll } from "../../hooks/useVisiblePoll";
import { usePersistedState } from "../../lib/ui/persistedState";
import AsyncView from "../../components/ui/AsyncView";
import PageHead from "../../components/ui/PageHead";
import Badge from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { RefreshIcon } from "../../components/ui/icons";
import RaidLoader from "../../components/ui/RaidLoader";
import { useT } from "../../i18n";
import { POLL_MS, mergePoll, uptime, type Range } from "../../lib/system/systemFormat";
import Verdict from "./Verdict";
import { Tiles, HostDetails } from "./Tiles";
import BackupSection from "./BackupSection";
import RoutesSection from "./RoutesSection";
import { DiskSection, ProcessesSection } from "./HostSections";
import "../../styles/system.css";

export default function SystemPage() {
    const t = useT();
    const status = useApi(() => getSystemStatus({ processes: true }), []);
    const [range, setRange] = usePersistedState<Range>("system-range", "hour");
    const [refreshing, setRefreshing] = useState(false);

    useVisiblePoll(() => {
        getSystemStatus()
            .then((next) => status.setData((prev) => mergePoll(prev, next)))
            // a failed poll keeps the figures on screen; the next one tries again in 15 s
            .catch(() => undefined);
    }, POLL_MS, !!status.data);

    const refresh = () => {
        setRefreshing(true);
        getSystemStatus({ processes: true, disk: true })
            .then((next) => status.setData(next))
            .catch(() => status.reload())
            .finally(() => setRefreshing(false));
    };

    const data = status.data;
    const runtime = data?.info.runtime;
    return (
        <div className="sy-page">
            <PageHead
                icon="inv_gizmo_02"
                tone="system"
                kicker={t("system.kicker")}
                title={t("system.title")}
                meta={data && (
                    <>
                        <Badge tip={t("system.meta.uptimeTip")} tipSub={t("system.meta.uptimeSub", { host: uptime(data.info.hostUptime) })}>
                            {t("system.meta.uptime", { time: uptime(data.info.processUptime) })}
                        </Badge>
                        {runtime && runtime.kind !== "node" && (
                            <Badge tip={t("system.meta.runtimeTip")}>{runtime.kind === "pm2" ? t("system.meta.pm2") : t("system.meta.docker")}</Badge>
                        )}
                        <Badge tip={t("system.meta.liveTip")}>{t("system.meta.live")}</Badge>
                    </>
                )}
                action={(
                    <Button variant="ghost" icon={<RefreshIcon />} running={refreshing} disabled={refreshing || !data} onClick={refresh} data-tip={t("system.refreshTip")}>
                        {t("system.refresh")}
                    </Button>
                )}
            />
            <AsyncView state={status} loading={<RaidLoader text={t("system.loading")} />}>
                {(d) => (
                    <>
                        <Verdict status={d} />
                        <Tiles status={d} range={range} onRange={setRange} />
                        <HostDetails status={d} />
                        <BackupSection />
                        <RoutesSection requests={d.requests} />
                        {d.processes && d.processes.list.length > 0 && <ProcessesSection processes={d.processes} />}
                        {d.disk && <DiskSection disk={d.disk} />}
                    </>
                )}
            </AsyncView>
        </div>
    );
}
