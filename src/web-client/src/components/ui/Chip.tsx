import type { ReactNode } from "react";
import { RemoveX, type Tone } from "./Badge";

// A chip: the larger, clickable sibling of a badge (#439) — a value in a list
// that can be switched on and off (`pressed` + `onClick`, e.g. a raider role of
// a category) or taken out again (`onRemove`, e.g. a log channel). Several go
// in a `.chip-row`. A plain label is a Badge, not a chip.

export default function Chip({ tone, icon, pressed, onClick, onRemove, removeLabel, tip, tipSub, className = "", children }: {
    tone?: Tone;
    /** A line icon before the text (e.g. the check of a chip that is on). */
    icon?: ReactNode;
    /** For a toggle chip: whether it is on (aria-pressed). */
    pressed?: boolean;
    onClick?: () => void;
    onRemove?: () => void;
    removeLabel?: string;
    tip?: string;
    tipSub?: string;
    className?: string;
    children: ReactNode;
}) {
    const cls = ["badge", "chip", tone || "", className].filter(Boolean).join(" ");
    if (onClick) {
        return (
            <button type="button" className={cls} aria-pressed={pressed} data-tip={tip} data-tip-sub={tipSub} onClick={onClick}>
                {icon}{children}
            </button>
        );
    }
    return (
        <span className={cls} data-tip={tip} data-tip-sub={tipSub}>
            {icon}{children}
            {onRemove && <RemoveX label={removeLabel || ""} onRemove={onRemove} />}
        </span>
    );
}
