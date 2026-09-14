import type { ReactNode } from "react";

// A WCL-style bar for numbers a reader compares down a column: the value sits on
// a bar whose length is its share of `max`. The width is fixed by the class, so
// a short label never makes a longer bar. Same markup idea as barCell() on the
// report pages.
export default function Bar({ value, max = 100, tone, label, tip, wide = false }: {
    value: number;
    max?: number;
    tone?: "ok" | "mid" | "bad";
    /** What is written on the bar; the rounded value by default. */
    label?: ReactNode;
    tip?: string;
    wide?: boolean;
}) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (
        <span className={["bar", tone || "", wide ? "wide" : ""].filter(Boolean).join(" ")} data-tip={tip}>
            <i style={{ width: `${pct}%` }} />
            <span>{label ?? Math.round(value)}</span>
        </span>
    );
}
