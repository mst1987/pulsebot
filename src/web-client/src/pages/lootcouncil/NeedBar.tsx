import { WowIcon } from "../../components/ui";
import { RichTip } from "./RichTip";

/** Everything the need bar needs, from a roster row or a candidate alike. */
export type NeedSubject = {
    needScore: number;
    needParts: { drought: number; share: number; need: number };
    daysSinceLoot: number | null;
    lootCount: number;
    bisOwned: number;
    bisTotal: number;
};

/**
 * The need score as a bar stacked in the weights the score itself uses
 * (50 / 40 / 10), with the number on it — the bar orders the list, the number
 * lets two raiders be compared out loud. What drives it sits in the tooltip.
 */
export function NeedBar({ subject, width = 150 }: { subject: NeedSubject; width?: number }) {
    const score = Math.round(subject.needScore * 100);
    const p = subject.needParts;
    const parts = [
        { cls: "s1", icon: "inv_misc_pocketwatch_02", w: p.drought * 50, max: 50,
            text: subject.daysSinceLoot === null ? "Wartezeit · noch nie etwas" : `Wartezeit · ${subject.daysSinceLoot} Tage` },
        { cls: "s2", icon: "inv_misc_bag_10", w: p.share * 40, max: 40,
            text: `Loot-Anteil · ${subject.lootCount} ${subject.lootCount === 1 ? "Item" : "Items"}` },
        { cls: "s3", icon: "inv_misc_gem_variety_02", w: p.need * 10, max: 10,
            text: subject.bisTotal ? `BiS-Lücke · ${subject.bisOwned}/${subject.bisTotal}` : "BiS-Lücke · keine Liste" },
    ];
    return (
        <RichTip
            label={`Bedarf ${score} von 100`}
            trigger={
                <span className="lc-needbar" style={{ width }}>
                    {parts.map((s) => <i key={s.cls} className={s.cls} style={{ width: `${s.w}%` }} />)}
                    <b>{score}</b>
                </span>
            }
        >
            <b>Bedarf {score} von 100</b>
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
            <i>Gewichtet 50 / 40 / 10: wer lange wartet, zählt am meisten.</i>
        </RichTip>
    );
}
