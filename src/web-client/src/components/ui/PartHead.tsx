import type { ReactNode } from "react";
import IconTile, { type TileTone } from "./IconTile";

// The second head level: which part of the page. A tinted bar with an icon tile,
// the title, a breadcrumb/kicker under it and at most one action (a button, a
// segment or an Expand). A longer explanation does not become a paragraph above
// the table — it goes into the title's tooltip (`tip`/`tipSub`).
export function PartHead({ icon, tone, title, crumb, tip, tipSub, action }: {
    icon?: string | ReactNode;
    tone?: TileTone;
    title: string;
    /** Breadcrumb or short kicker under the title. */
    crumb?: ReactNode;
    tip?: string;
    tipSub?: string;
    action?: ReactNode;
}) {
    return (
        <div className="part-head">
            <div className="part-title">
                {icon && <IconTile icon={icon} tone={tone} />}
                <div>
                    <span className={tip ? "tipped" : undefined} data-tip={tip} data-tip-sub={tipSub} tabIndex={tip ? 0 : undefined}>{title}</span>
                    {crumb && <span className="kicker">{crumb}</span>}
                </div>
            </div>
            {action && <div className="ph-act">{action}</div>}
        </div>
    );
}

/** The same head under the name the design issue's module list uses for it. */
export const SectionHead = PartHead;

export default PartHead;
