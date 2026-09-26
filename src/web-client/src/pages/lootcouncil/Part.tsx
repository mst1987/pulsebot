import type { ReactNode } from "react";
import { PartHead } from "../../components/ui";

/**
 * One part of a tab: the tinted part head (icon tile, title, at most one
 * action) over a panel. What used to be a hint paragraph under the heading is
 * the title's tooltip.
 */
export function Part({ icon, crumb, title, hint, actions, tone = "", children }: {
    icon: string;
    crumb?: string;
    title: string;
    hint?: string;
    actions?: ReactNode;
    children: ReactNode;
    /** "accent" lifts the one part that carries the answer. */
    tone?: "" | "accent";
}) {
    return (
        <section className={`lc-part${tone ? ` lc-part-${tone}` : ""}`}>
            <PartHead icon={icon} title={title} crumb={crumb} tip={hint ? title : undefined} tipSub={hint} action={actions} />
            <div className="lc-panel lc-part-body">{children}</div>
        </section>
    );
}
