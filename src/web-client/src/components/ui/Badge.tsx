import type { ReactNode } from "react";
import WowIcon from "./WowIcon";

// A badge instead of a half-sentence: one word or number, optionally an icon,
// and a tone. `count` makes it the round counter form. Same classes as the
// report pages' badge() in src/web/render.js.

export type Tone = "ok" | "mid" | "bad" | "accent";

export default function Badge({ tone, icon, count = false, tip, tipSub, className = "", children }: {
    tone?: Tone;
    /** A WoW icon name, or a line icon node. */
    icon?: string | ReactNode;
    count?: boolean;
    tip?: string;
    tipSub?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <span
            className={["badge", tone || "", count ? "count" : "", className].filter(Boolean).join(" ")}
            data-tip={tip}
            data-tip-sub={tipSub}
        >
            {typeof icon === "string" ? <WowIcon name={icon} size={14} /> : icon}
            {children}
        </span>
    );
}
