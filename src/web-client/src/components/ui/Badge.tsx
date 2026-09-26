import type { ReactNode } from "react";
import WowIcon from "./WowIcon";
import { XIcon } from "../icons";

// A badge instead of a half-sentence: one word or number, optionally an icon,
// and a tone. `count` makes it the round counter form, `size="sm"` the compact
// one for dense rows, `onRemove` adds the small × that takes it away (an active
// filter). Same classes as the report pages' badge() in src/web/render.js.

export type Tone = "ok" | "mid" | "bad" | "accent";
export type BadgeSize = "sm" | "md";

/** The × of a removable badge or chip. */
export function RemoveX({ label, tip, onRemove }: { label: string; tip?: string; onRemove: () => void }) {
    return (
        <button type="button" className="badge-x" aria-label={label} data-tip={tip} onClick={onRemove}>
            <XIcon />
        </button>
    );
}

export default function Badge({ tone, icon, count = false, size = "md", tip, tipSub, onRemove, removeLabel, removeTip, className = "", children }: {
    tone?: Tone;
    /** A WoW icon name, or a line icon node. */
    icon?: string | ReactNode;
    count?: boolean;
    size?: BadgeSize;
    tip?: string;
    tipSub?: string;
    /** Makes it removable: a small × after the text. */
    onRemove?: () => void;
    /** What a screen reader hears on the ×. */
    removeLabel?: string;
    /** The ×'s tooltip. */
    removeTip?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <span
            className={["badge", tone || "", count ? "count" : "", size === "sm" ? "sm" : "", className].filter(Boolean).join(" ")}
            data-tip={tip}
            data-tip-sub={tipSub}
        >
            {typeof icon === "string" ? <WowIcon name={icon} size={14} /> : icon}
            {children}
            {onRemove && <RemoveX label={removeLabel || removeTip || ""} tip={removeTip} onRemove={onRemove} />}
        </span>
    );
}
