import type { ReactNode } from "react";
import IconTile, { type TileTone } from "./IconTile";

// The first of the three head levels: which page this is. A 48-px icon tile in
// the section's colour, a kicker, the title, badges as the meta line, and at
// most one primary action on the right. Replaces `.page-title`.
export default function PageHead({ icon, tone, kicker, title, meta, action }: {
    icon: string | ReactNode;
    tone?: TileTone;
    kicker?: string;
    title: string;
    /** Badges — never a sentence. */
    meta?: ReactNode;
    /** The page's one primary action. */
    action?: ReactNode;
}) {
    return (
        <div className="page-head">
            <IconTile icon={icon} tone={tone} size="lg" />
            <div className="ph-text">
                {kicker && <div className="kicker">{kicker}</div>}
                <h1>{title}</h1>
                {meta && <div className="ph-meta">{meta}</div>}
            </div>
            {action && <div className="ph-act">{action}</div>}
        </div>
    );
}
