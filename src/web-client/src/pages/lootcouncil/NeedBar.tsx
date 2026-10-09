import type { CSSProperties } from "react";
import { RichTip, WowIcon } from "../../components/ui";
import { tParts, useT } from "../../i18n";
import type { NeedParts } from "../../api";
import { fmtPoints, pct, useNeedWeights } from "./needWeights";

/** Everything the need bar needs, from a roster row or a candidate alike. */
export type NeedSubject = {
    needScore: number;
    needParts: NeedParts;
    daysSinceLoot: number | null;
    lootCount: number;
    bisOwned: number;
    bisTotal: number;
    /** #668: the same items in loot points, the wait as it counts, belonging. */
    lootPoints?: number;
    droughtDays?: number;
    tenureDays?: number;
};

/**
 * The need score as a bar stacked in the weights the score itself uses (the
 * council's, default 45 / 30 / 10 / 15 — they come with the council answer,
 * needWeights.ts), with the number on it — the bar orders the list, the number
 * lets two raiders be compared out loud. What drives it sits in the tooltip.
 */
export function NeedBar({ subject, width = 150 }: { subject: NeedSubject; width?: number }) {
    const t = useT();
    const { shares } = useNeedWeights();
    const score = Math.round(subject.needScore * 100);
    const p = subject.needParts;
    const w = { drought: pct(shares.drought), share: pct(shares.share), need: pct(shares.need), tenure: pct(shares.tenure) };
    // The wait counts less than the calendar says when small items reset it only partly.
    const counted = subject.droughtDays;
    const waitText = subject.daysSinceLoot === null
        ? t("lootcouncil.need.waitNever")
        : counted !== undefined && Math.round(counted) < Math.min(30, subject.daysSinceLoot)
            ? t("lootcouncil.need.waitCounted", { count: subject.daysSinceLoot, counted: fmtPoints(counted) })
            : t("lootcouncil.need.wait", { count: subject.daysSinceLoot });
    const parts = [
        { cls: "s1", icon: "inv_misc_pocketwatch_02", w: p.drought * w.drought, max: w.drought, text: waitText },
        { cls: "s2", icon: "inv_misc_bag_10", w: p.share * w.share, max: w.share,
            text: subject.lootPoints !== undefined
                ? t("lootcouncil.need.sharePoints", { count: subject.lootCount, points: fmtPoints(subject.lootPoints) })
                : t("lootcouncil.need.share", { count: subject.lootCount }) },
        { cls: "s3", icon: "inv_misc_gem_variety_02", w: p.need * w.need, max: w.need,
            text: subject.bisTotal ? t("lootcouncil.need.bisGap", { owned: subject.bisOwned, total: subject.bisTotal }) : t("lootcouncil.need.bisGapNone") },
        { cls: "s4", icon: "achievement_reputation_01", w: (p.tenure || 0) * w.tenure, max: w.tenure,
            text: subject.tenureDays ? t("lootcouncil.need.tenure", { count: subject.tenureDays }) : t("lootcouncil.need.tenureNone") },
    ].filter((s) => s.max > 0);
    return (
        <RichTip className="lc-rtip"
            label={t("lootcouncil.need.score", { score })}
            trigger={
                <span className="lc-needbar" style={{ "--lc-nb": `${width}px` } as CSSProperties}>
                    {parts.map((s) => <i key={s.cls} className={s.cls} style={{ "--fill": `${s.w}%` } as CSSProperties} />)}
                    <b>{t("lootcouncil.need.bar", { score })}</b>
                </span>
            }
        >
            <b>{tParts("lootcouncil.need.score", { score })}</b>
            <span className="lc-need-rows">
                {parts.map((s) => (
                    <span key={s.cls} className="lc-need-row">
                        <span className={`lc-need-dot ${s.cls}`} />
                        <WowIcon name={s.icon} size={18} />
                        <span>{s.text}</span>
                        <span className="lc-need-val">{Math.round(s.w)}/{s.max}</span>
                    </span>
                ))}
            </span>
            <i>{t("lootcouncil.need.weighted", { drought: w.drought, share: w.share, need: w.need, tenure: w.tenure })}</i>
        </RichTip>
    );
}
