// The small building blocks of "Neues Event": the labelled field head, the
// step bar, a radio card of the start step, an event's channel/category line,
// the stacked instance icons and a large figure of the review.
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { stepLabel, type StepKey } from "../../lib/eventPlan";
import WowIcon from "../ui/WowIcon";
import { CheckIcon } from "../icons";
import { EMPTY_ICON } from "./createHelpers";

/** A label with its explanation in the tooltip instead of a hint paragraph under the field. */
export function Label({ text, tip, htmlFor }: { text: string; tip?: string; htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="re-label">
            {text}
            {tip && <span className="re-info" tabIndex={0} data-tip={text} data-tip-sub={tip}>i</span>}
        </label>
    );
}

export function Stepper({ steps, current }: { steps: StepKey[]; current: StepKey }) {
    const t = useT();
    const at = steps.indexOf(current);
    return (
        <ol className="re-steps" aria-label={t("raidCreate.progress")}>
            {steps.map((s, i) => (
                <li key={s} className={`re-step${i === at ? " on" : ""}${i < at ? " done" : ""}`} aria-current={i === at ? "step" : undefined}>
                    {i > 0 && <span className="re-step-line" aria-hidden="true" />}
                    <span className="n">{i < at ? <CheckIcon /> : i + 1}</span>
                    <span className="re-step-lbl">{stepLabel(s)}</span>
                </li>
            ))}
        </ol>
    );
}

export function OptionCard({ selected, onSelect, icon, title, sub }: {
    selected: boolean; onSelect: () => void; icon: ReactNode; title: string; sub: ReactNode;
}) {
    return (
        <button type="button" role="radio" aria-checked={selected} className={`re-opt${selected ? " on" : ""}`} onClick={onSelect}>
            {icon}
            <span className="re-opt-text"><span className="re-title">{title}</span><span className="re-sub">{sub}</span></span>
            <span className="re-radio" aria-hidden="true" />
        </button>
    );
}

export function EventSub({ ev }: { ev: { channelName?: string; categoryName?: string } }) {
    return (
        <>
            {ev.channelName && <span className="re-chan">#{ev.channelName}</span>}
            {ev.channelName && ev.categoryName && <span aria-hidden="true">·</span>}
            {ev.categoryName && <span>{ev.categoryName}</span>}
        </>
    );
}

/** The icons of a raid's instances, overlapping like the template list. */
export function IconStack({ icons }: { icons: string[] }) {
    return (
        <span className="raid-ic re-icstack" aria-hidden="true">
            {(icons.length ? icons : [EMPTY_ICON]).slice(0, 3).map((icon, i) => <WowIcon key={`${icon}-${i}`} name={icon} size={36} className="a" />)}
        </span>
    );
}

/** A large value with a small label — the numbers the raid is about. */
export function Figure({ label, value }: { label: string; value: ReactNode }) {
    return <div className="re-fig"><span className="re-fig-lbl">{label}</span><span className="re-fig-val">{value}</span></div>;
}
