import type { ReactNode } from "react";
import IconTile, { type TileTone } from "./IconTile";

// The second head level: which part of the page. A tinted bar with an icon tile,
// the title, a breadcrumb/kicker under it and at most one action (a button, a
// segment or an Expand). A longer explanation does not become a paragraph above
// the table — it goes into the title's tooltip (`tip`/`tipSub`).
//
// variant "plain" (Discord-Server, design B): no bar and no icon tile, only the
// title with a hairline under it and a muted count beside it; the content
// follows right below.
export function PartHead({ icon, tone, title, crumb, tip, tipSub, action, variant, count }: {
    icon?: string | ReactNode;
    tone?: TileTone;
    title: string;
    /** Breadcrumb or short kicker under the title. */
    crumb?: ReactNode;
    tip?: string;
    tipSub?: string;
    action?: ReactNode;
    variant?: "plain";
    /** Plain variant only: a muted count with its noun after the title ("2 Server"). */
    count?: ReactNode;
}) {
    const plain = variant === "plain";
    return (
        <div className={plain ? "part-head is-plain" : "part-head"}>
            <div className="part-title">
                {icon && !plain && <IconTile icon={icon} tone={tone} />}
                <div>
                    <span className={tip ? "tipped" : undefined} data-tip={tip} data-tip-sub={tipSub} tabIndex={tip ? 0 : undefined}>{title}</span>
                    {plain && count !== undefined && count !== null && <span className="ph-count">{count}</span>}
                    {crumb && <span className="kicker">{crumb}</span>}
                </div>
            </div>
            {action && <div className="ph-act">{action}</div>}
        </div>
    );
}

export default PartHead;
