import type { SetupLootCheck, SetupLootItem, SetupLootStatus } from "../../../api";
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

type T = ReturnType<typeof useT>;

/** "Softres nicht erreichbar – alte Daten von 20:15 bleiben" (#1037): what the last load could not reach. */
function unreachableLine(t: T, status: SetupLootStatus): string {
    const failed = status.failed || [];
    if (!failed.length) return "";
    const sources = failed.map((s) => t(`setup.loot.source.${s}`)).join(", ");
    return status.keptAt
        ? t("setup.loot.unreachable", { sources, time: clock(status.keptAt) })
        : t("setup.loot.unreachableNoKept", { sources });
}

/** "Kara 1: Heilbert softres, Berserker bis · Kara 3: …" - who wants the item in which raid. */
function ItemRaids({ item, t }: { item: SetupLootItem; t: T }) {
    return (
        <span className="se-loot-raids" aria-label={t("setup.loot.raidsAria")}>
            {item.raids.map((raid, r) => (
                <span key={raid.eventId} className="se-loot-raid">
                    {r > 0 && <span className="se-loot-sep" aria-hidden="true"> · </span>}
                    <b className={raid.raiders.length > 1 ? "se-loot-mid" : undefined}>{raid.title}</b>
                    {": "}
                    {raid.raiders.map((p, i) => (
                        <span key={`${p.userId}:${p.character}`}>
                            {i > 0 && ", "}
                            {p.character}
                            {p.source && <small className="se-loot-src"> {t(`setup.loot.source.${p.source}`)}</small>}
                        </span>
                    ))}
                </span>
            ))}
        </span>
    );
}

/**
 * "Loot verteilen" (#1037) in the details of a raid group: the items more than one placed
 * raider wants in the same raid, who wants them in which raid, where the wishes come from -
 * and "Loot-Daten laden", the background job that gathers Softres, BiS and the worn gear.
 * The proposal itself never asks an API, and a finished load only offers a new proposal.
 */
export function LootPanel({ status, check, busy, onLoad, ready = false, onPropose }: {
    status: SetupLootStatus;
    check: SetupLootCheck | undefined;
    busy: boolean;
    onLoad: () => void;
    /** the load just finished: show the hint setup.loot.loaded with its button */
    ready?: boolean;
    onPropose?: () => void;
}) {
    const t = useT();
    const running = status.job?.status === "running";
    const counts = status.counts;
    const items = check?.items || [];
    const shown = items.slice(0, MAX_ITEMS);
    const unreachable = unreachableLine(t, status);
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
            {!running && unreachable && <p className="se-loot-cap se-loot-bad">{unreachable}</p>}
            {!running && !unreachable && status.job?.status === "error" && <p className="se-loot-cap se-loot-bad">{t("setup.loot.failed", { error: status.job.error })}</p>}
            {ready && !running && onPropose && (
                <div className="se-loot-ready">
                    <span>{t("setup.loot.loaded")}</span>
                    <Button size="sm" disabled={busy} onClick={onPropose} data-tip={t("setup.loot.proposeSub")}>{t("setup.loot.propose")}</Button>
                </div>
            )}
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
                                <span className="se-loot-item">
                                    <ItemLink id={Number(item.itemId)} name={item.name} iconUrl={item.icon || undefined} quality={item.quality} />
                                    <span className="se-loot-meta">{t("setup.loot.wanted", { count: item.count })}</span>
                                </span>
                                <ItemRaids item={item} t={t} />
                            </li>
                        ))}
                    </ul>
                    {items.length > shown.length && <p className="se-loot-cap">{t("setup.loot.more", { count: items.length - shown.length })}</p>}
                </WowheadPathProvider>
            )}
        </section>
    );
}
