// Who conducts an interview, made visible: LeadAvatar (the initial in the lead's
// colour, the same one the Kader header shows), LeadBadge (avatar plus name, or
// the warning "Niemand" when nobody is assigned) and LeadMenu, the small menu
// that picks one of them — the "Gespräch führt" select of the interview and the
// filter of the Gespräche list. The colour never stands alone: initial and name
// are always there.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, UserQuestionIcon } from "../../components/icons";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { nameOf } from "../../lib/kader/model";
import { leadHue } from "../../lib/kader/leads";
import { Count } from "./parts";
import { useKader } from "./kaderContext";

/** The initial of a lead in a circle of their colour; `size` in px. */
export function LeadAvatar({ userId, size = 20 }: { userId: string; size?: number }) {
    const { view, kader } = useKader();
    if (!userId) return <span className="kp-avatar kp-avatar-sized kp-avatar-none" style={{ "--av": `${size}px` } as CSSProperties} aria-hidden="true"><UserQuestionIcon /></span>;
    const name = nameOf(view, userId);
    const hue = leadHue(kader.leads, userId);
    return (
        <span className={`kp-avatar kp-avatar-sized kp-hue-${hue}`} data-lead-hue={hue} style={{ "--av": `${size}px` } as CSSProperties} aria-hidden="true">
            {(name.trim()[0] || "?").toUpperCase()}
        </span>
    );
}

/**
 * The interviewer of a player: coloured initial plus name; an empty `userId` is "Niemand" with a
 * person-question icon. `you` adds "(du)" for the signed-in account; `label` shows other words than the
 * name ("Ich" in the filter); `detail` goes into the tooltip.
 */
export function LeadBadge({ userId, you = false, label = "", detail = "", className = "" }: { userId: string; you?: boolean; label?: string; detail?: string; className?: string }) {
    const t = useT();
    const { view, me } = useKader();
    if (!userId) {
        const tip = t("kader.lead.nobodyTip");
        return (
            <span className={`kp-lead kp-lead-none ${className}`.trim()} role="img" aria-label={tip} data-tip={tip}>
                <LeadAvatar userId="" />
                <span className="kp-lead-name">{t("kader.lead.nobody")}</span>
            </span>
        );
    }
    const name = nameOf(view, userId);
    const tip = t("kader.lead.tip", { name }) + (detail ? ` · ${detail}` : "");
    return (
        <span className={`kp-lead ${className}`.trim()} role="img" aria-label={tip} data-tip={tip}>
            <LeadAvatar userId={userId} />
            <span className="kp-lead-name">{label || name}{you && userId === me ? <span className="kp-lead-you"> {t("kader.lead.you")}</span> : null}</span>
        </span>
    );
}

export type LeadOption = { value: string; label: string; badge: ReactNode; count?: number };

/**
 * A one-of-many menu whose options are lead badges. The button shows the current one (after an
 * optional `prefix` word); each option names its count of players when it has one.
 */
export function LeadMenu({ label, prefix, value, options, onChange, disabled = false, className = "" }: {
    label: string;
    prefix?: string;
    value: string;
    options: LeadOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, open, () => setOpen(false));
    const current = options.find((o) => o.value === value) || options[0];
    return (
        <div className={`kp-menuwrap kp-leadmenu ${className}`.trim()} ref={ref}>
            <button type="button" className={`kp-menubtn${open ? " kp-open" : ""}`} aria-haspopup="true" aria-expanded={open} aria-label={`${label}: ${current ? current.label : ""}`}
                disabled={disabled} onClick={() => setOpen(!open)}>
                {prefix && <span className="kp-leadmenu-prefix">{prefix}</span>}
                {current && current.badge}
                <ChevronDownIcon />
            </button>
            {open && (
                <div className="kp-menu" role="menu" aria-label={label}>
                    {options.map((o) => {
                        const on = o.value === value;
                        return (
                            <button key={o.value} type="button" role="menuitemradio" aria-checked={on} className={`kp-menuopt${on ? " kp-current" : ""}`}
                                onClick={() => { setOpen(false); onChange(o.value); }}>
                                <span className={`kp-check${on ? " kp-on" : ""}`}>{on && <CheckIcon />}</span>
                                <span className="kp-grow kp-leadmenu-opt">{o.badge}</span>
                                {o.count !== undefined && <Count n={o.count} tip={t("kader.playersN", { count: o.count })} className="kp-count-quiet" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
