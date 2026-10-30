import Icon from "../ui/Icon";
import { useT } from "../../i18n";
import { NOTE_REASONS, type NoteReason } from "../../api/vermerke";

// The reason of a note (#980) as a grey line icon; the word is its tooltip.
// With a count above one a small "×2" follows (the list's reasons column).
const ICON: Record<NoteReason, "reasonLateSignoff" | "reasonNoShow" | "reasonLeftEarly" | "reasonLeftServer" | "reasonBehavior" | "reasonLoot" | "reasonOther"> = {
    late_signoff: "reasonLateSignoff",
    no_show: "reasonNoShow",
    left_early: "reasonLeftEarly",
    left_server: "reasonLeftServer",
    behavior: "reasonBehavior",
    loot: "reasonLoot",
    other: "reasonOther",
};

export default function ReasonIcon({ reason, count, withWord = false, decorative = false, size = 16 }: {
    reason: NoteReason;
    count?: number;
    /** the word beside the icon (drawer entries), else only as tooltip */
    withWord?: boolean;
    /** only the icon, the word is already there (a chip): no name, no tooltip */
    decorative?: boolean;
    size?: number;
}) {
    const t = useT();
    if (decorative) return <span className="nm-reason" data-reason={reason} aria-hidden="true"><Icon name={ICON[reason]} size={size} /></span>;
    const word = t(`vermerke.reason.${reason}`);
    const sub = count ? t("vermerke.reasonTimes", { count }) : undefined;
    return (
        <span className="nm-reason" data-reason={reason} data-tip={word} data-tip-sub={sub} {...(withWord ? {} : { role: "img", "aria-label": count && count > 1 ? `${word} ×${count}` : word })}>
            <Icon name={ICON[reason]} size={size} />
            {withWord && <span className="nm-reason-word">{word}</span>}
            {count !== undefined && count > 1 && <span className="nm-reason-n" aria-hidden={withWord ? undefined : true}>×{count}</span>}
        </span>
    );
}

/** The reasons of a person in the fixed order, each with its count. */
export function ReasonIcons({ reasons }: { reasons: Partial<Record<NoteReason, number>> }) {
    const present = NOTE_REASONS.filter((r) => (reasons[r] || 0) > 0);
    if (!present.length) return null;
    return (
        <span className="nm-reasons">
            {present.map((r) => <ReasonIcon key={r} reason={r} count={reasons[r]} />)}
        </span>
    );
}
