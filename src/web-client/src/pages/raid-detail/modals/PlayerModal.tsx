// "Spieler": one raider of this raid — spec, reaction, group and role, how many
// of the category's recent raids they were in and what they got lately.
import { Link } from "react-router-dom";
import { fmtMs } from "../../../lib/format";
import { itemQualityProps } from "../../../lib/itemQuality";
import { Modal } from "../../../components/ui/Modal";
import { Button, buttonClass } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import WowIcon from "../../../components/ui/WowIcon";
import { reasonToneClass } from "../../../components/LootBadges";
import { classColorProps } from "../../../components/ClassSpec";
import { ROLE_META, SIGNUP_META, type PlayerRef, type RaidCtx } from "../meta";
import SpecTile from "../SpecTile";
import { useT, type TFunction } from "../../../i18n";

const DAY_MS = 86400000;

function daysAgo(ms: number, t: TFunction): string {
    const days = Math.floor((Date.now() - ms) / DAY_MS);
    if (days <= 0) return t("common.relDay.today");
    if (days === 1) return t("common.relDay.yesterday");
    return t("common.relDay.daysAgo", { count: days });
}

export default function PlayerModal({ ctx, player, onClose }: { ctx: RaidCtx; player: PlayerRef | null; onClose: () => void }) {
    const t = useT();
    const summary = player ? ctx.data.playerSummaries?.[player.name.trim().toLowerCase()] : undefined;
    const status = player?.status;
    const kicker = player ? [player.specName, player.className, player.discordName ? `@${player.discordName}` : ""].filter(Boolean).join(" · ") : "";

    return (
        <Modal
            open={!!player} onClose={onClose}
            icon={player ? <SpecTile iconUrl={player.iconUrl} classColor={player.classColor} size="lg" /> : undefined}
            tone="none" kicker={kicker || t("raidModals.player.kicker")} title={player?.name || ""} width={560}
            footer={player && (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
                    <Link className={buttonClass("primary", "md", true)} to={`/history/char?name=${encodeURIComponent(player.name)}`} onClick={onClose}>
                        <WowIcon name="achievement_guildperk_everybodysfriend" size={22} />{t("raidModals.player.charPage")}
                    </Link>
                </>
            )}
        >
            {player && (
                <div className="rd-dlg-stack">
                    <div className="rd-badges">
                        {status === "missing" && <Badge tone="bad">{t("raidModals.player.noReaction")}</Badge>}
                        {status && status !== "missing" && <Badge tone={SIGNUP_META[status].tone}>{SIGNUP_META[status].label}</Badge>}
                        {player.group && <Badge tone="accent">{player.group}{player.role ? ` · ${ROLE_META[player.role].label}` : ""}</Badge>}
                        {!player.group && <Badge>{t("raidModals.player.notInSetup")}</Badge>}
                        {ctx.data.categoryName && <Badge>{ctx.data.categoryName}</Badge>}
                    </div>

                    {summary && (
                        <div className="rd-kpis">
                            <div data-tip={t("raidModals.player.raidsTip")} data-tip-sub={t("raidModals.player.raidsTipSub")}>
                                <span className="kicker">{t("raidModals.player.raidsKicker")}</span>
                                <span className="rd-kpi-v">{summary.raids === null ? "—" : summary.raids}{summary.raids !== null && <small> / {summary.raidsOf}</small>}</span>
                            </div>
                            <div data-tip={t("raidModals.player.lootTip")} data-tip-sub={t("raidModals.player.lootTipSub")}>
                                <span className="kicker">{t("raidModals.player.lootKicker")}</span>
                                <span className="rd-kpi-v">{summary.loot}<small> {t("raidModals.player.items")}</small></span>
                            </div>
                            <div data-tip={t("raidModals.player.lastItem")} data-tip-sub={summary.lastLootAt ? fmtMs(summary.lastLootAt) : t("raidModals.player.never")}>
                                <span className="kicker">{t("raidModals.player.lastItem")}</span>
                                <span className={`rd-kpi-v${summary.lastLootAt && Date.now() - summary.lastLootAt > 28 * DAY_MS ? " mid" : ""}`}>{summary.lastLootAt ? daysAgo(summary.lastLootAt, t) : "—"}</span>
                            </div>
                        </div>
                    )}

                    {!!summary?.recent.length && (
                        <div>
                            <div className="kicker rd-sec-kicker">{t("raidModals.player.recent")}</div>
                            <div className="rd-glist">
                                {summary.recent.map((it, i) => (
                                    <div key={`${it.itemId}-${i}`} className="rd-recent">
                                        <span className="rd-item">
                                            {it.itemIconUrl ? <img src={it.itemIconUrl} alt="" loading="lazy" /> : <span className="rd-item-ph" />}
                                            {it.itemLink
                                                ? <a {...itemQualityProps(it.itemQuality, "rd-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || t("raidModals.player.itemFallback", { id: it.itemId })}</a>
                                                : <span {...itemQualityProps(it.itemQuality, "rd-item-name")}>{it.itemName || t("raidModals.player.itemFallback", { id: it.itemId })}</span>}
                                        </span>
                                        <span className={reasonToneClass(it.reasonTone)}>{it.response || it.reasonLabel}</span>
                                        <span className="rd-mono">{fmtMs(it.awardedAt, false)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {summary && !summary.recent.length && (
                        <p className="rd-empty"><span {...classColorProps(player.classColor)}>{player.name}</span> {t("raidModals.player.noItemYet")}</p>
                    )}
                </div>
            )}
        </Modal>
    );
}
