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

const DAY_MS = 86400000;

function daysAgo(ms: number): string {
    const days = Math.floor((Date.now() - ms) / DAY_MS);
    if (days <= 0) return "heute";
    if (days === 1) return "gestern";
    return `vor ${days} Tagen`;
}

export default function PlayerModal({ ctx, player, onClose }: { ctx: RaidCtx; player: PlayerRef | null; onClose: () => void }) {
    const summary = player ? ctx.data.playerSummaries?.[player.name.trim().toLowerCase()] : undefined;
    const status = player?.status;
    const kicker = player ? [player.specName, player.className, player.discordName ? `@${player.discordName}` : ""].filter(Boolean).join(" · ") : "";

    return (
        <Modal
            open={!!player} onClose={onClose}
            icon={player ? <SpecTile iconUrl={player.iconUrl} classColor={player.classColor} size="lg" /> : undefined}
            tone="none" kicker={kicker || "Raider"} title={player?.name || ""} width={560}
            footer={player && (
                <>
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    <Link className={buttonClass("primary", "md", true)} to={`/history/char?name=${encodeURIComponent(player.name)}`} onClick={onClose}>
                        <WowIcon name="achievement_guildperk_everybodysfriend" size={22} />Charakterseite
                    </Link>
                </>
            )}
        >
            {player && (
                <div className="rd-dlg-stack">
                    <div className="rd-badges">
                        {status === "missing" && <Badge tone="bad">ohne Reaktion</Badge>}
                        {status && status !== "missing" && <Badge tone={SIGNUP_META[status].tone}>{SIGNUP_META[status].label}</Badge>}
                        {player.group && <Badge tone="accent">{player.group}{player.role ? ` · ${ROLE_META[player.role].label}` : ""}</Badge>}
                        {!player.group && <Badge>nicht im Setup</Badge>}
                        {ctx.data.categoryName && <Badge>{ctx.data.categoryName}</Badge>}
                    </div>

                    {summary && (
                        <div className="rd-kpis">
                            <div data-tip="Raids der letzten 8 Wochen" data-tip-sub="Raids dieser Kategorie mit gespeichertem Raidplan, in denen der Raider stand.">
                                <span className="kicker">Raids 8 Wochen</span>
                                <span className="rd-kpi-v">{summary.raids === null ? "—" : summary.raids}{summary.raids !== null && <small> / {summary.raidsOf}</small>}</span>
                            </div>
                            <div data-tip="Loot der letzten 8 Wochen" data-tip-sub="Nur was zählt: ohne Offspec, Entzaubert und Bank.">
                                <span className="kicker">Loot 8 Wochen</span>
                                <span className="rd-kpi-v">{summary.loot}<small> Items</small></span>
                            </div>
                            <div data-tip="Letztes Item" data-tip-sub={summary.lastLootAt ? fmtMs(summary.lastLootAt) : "Noch nie etwas bekommen."}>
                                <span className="kicker">Letztes Item</span>
                                <span className={`rd-kpi-v${summary.lastLootAt && Date.now() - summary.lastLootAt > 28 * DAY_MS ? " mid" : ""}`}>{summary.lastLootAt ? daysAgo(summary.lastLootAt) : "—"}</span>
                            </div>
                        </div>
                    )}

                    {!!summary?.recent.length && (
                        <div>
                            <div className="kicker rd-sec-kicker">Zuletzt erhalten</div>
                            <div className="rd-glist">
                                {summary.recent.map((it, i) => (
                                    <div key={`${it.itemId}-${i}`} className="rd-recent">
                                        <span className="rd-item">
                                            {it.itemIconUrl ? <img src={it.itemIconUrl} alt="" loading="lazy" /> : <span className="rd-item-ph" />}
                                            {it.itemLink
                                                ? <a {...itemQualityProps(it.itemQuality, "rd-item-name")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                                : <span {...itemQualityProps(it.itemQuality, "rd-item-name")}>{it.itemName || `Item ${it.itemId}`}</span>}
                                        </span>
                                        <span className={reasonToneClass(it.reasonTone)}>{it.response || it.reasonLabel}</span>
                                        <span className="rd-mono">{fmtMs(it.awardedAt, false)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {summary && !summary.recent.length && (
                        <p className="rd-empty"><span {...classColorProps(player.classColor)}>{player.name}</span> hat noch kein Item bekommen.</p>
                    )}
                </div>
            )}
        </Modal>
    );
}
