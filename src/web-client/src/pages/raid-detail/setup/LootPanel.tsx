import type { SetupLootCheck, SetupLootStatus } from "../../../api";
import { useT } from "../../../i18n";
import Badge from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { ItemLink } from "../../lootcouncil/ItemBits";
import { WowheadPathProvider } from "../../../lib/settings/versionLinks";
import { clock } from "./setupText";
import "../../../styles/loot.css";
// ItemLink's classes (lc-*) live in the loot council's stylesheet: load it with the raid page (stylesheetReach)
import "../../../styles/loot-council.css";

// the list stays short: the worst overlaps first (the server sorts), the rest as a count
const MAX_ITEMS = 8;

/**
 * "Loot verteilen" (#1037) in the details of a raid group: the overlaps of the
 * proposal, where the wishes come from, the items more than one placed raider
 * wants — and "Loot-Daten laden", the background job that gathers Softres, BiS
 * and the worn gear. The proposal itself never asks an API.
 */
export function LootPanel({ status, check, busy, onLoad }: {
    status: SetupLootStatus;
    check: SetupLootCheck | undefined;
    busy: boolean;
    onLoad: () => void;
}) {
    const t = useT();
    const running = status.job?.status === "running";
    const counts = status.counts;
    const items = check?.items || [];
    const shown = items.slice(0, MAX_ITEMS);
    return (
        <section className="se-loot" aria-label={t("setup.loot.title")}>
            <div className="se-side-row se-loot-head">
                <span className="kicker" data-tip={t("setup.loot.lineTip")} data-tip-sub={t("setup.loot.lineSub")}>{t("setup.loot.title")}</span>
                {check?.on && (
                    <Badge tone={check.conflicts ? "mid" : "ok"} tip={t("setup.loot.lineTip")} tipSub={t("setup.loot.lineSub")}>
                        {t("setup.loot.conflicts", { count: check.conflicts })}
                    </Badge>
                )}
                <Button size="sm" variant="ghost" disabled={busy || running} onClick={onLoad} data-tip={t("setup.loot.loadSub")}>
                    {running ? t("setup.loot.loading") : counts ? t("setup.loot.reload") : t("setup.loot.load")}
                </Button>
            </div>
            <p className="se-loot-cap" role="status">
                {running && status.progress
                    ? t("setup.loot.progress", { done: status.progress.done, total: status.progress.total })
                    : counts
                        ? <>{t("setup.loot.status", { gear: counts.gear, signups: counts.signups })}{status.at ? <> · {t("setup.loot.statusAt", { time: clock(status.at) })}</> : null}</>
                        : t("setup.loot.notLoaded")}
            </p>
            {status.job?.status === "error" && <p className="se-loot-cap se-loot-bad">{t("setup.loot.failed", { error: status.job.error })}</p>}
            {check?.on && (
                <p className="se-loot-cap" data-tip={t("setup.loot.sourcesTip")} data-tip-sub={t("setup.loot.sourcesSub")}>
                    {t("setup.loot.sources", check.sources)}
                </p>
            )}
            {shown.length > 0 && (
                <WowheadPathProvider path={status.wowheadPath ?? ""}>
                    <ul className="se-loot-list" aria-label={t("setup.loot.listAria")}>
                        {shown.map((item) => (
                            <li key={String(item.itemId)}>
                                {item.spec
                                    ? <span className="se-loot-spec" data-tip={t("setup.loot.specItem")} data-tip-sub={t("setup.loot.specItemSub")}>{t("setup.loot.specItem")}: {item.name}</span>
                                    : <ItemLink id={Number(item.itemId)} name={item.name} iconUrl={item.icon || undefined} quality={item.quality} />}
                                <span className="se-loot-meta">
                                    {t("setup.loot.wanted", { count: item.count })}
                                    {" · "}
                                    {item.conflictIn.length
                                        ? <b className="se-loot-mid">{t("setup.loot.conflictIn", { count: item.conflictIn.length })}</b>
                                        : <span className="se-loot-ok">{t("setup.loot.spread")}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {items.length > shown.length && <p className="se-loot-cap">{t("setup.loot.more", { count: items.length - shown.length })}</p>}
                </WowheadPathProvider>
            )}
        </section>
    );
}
