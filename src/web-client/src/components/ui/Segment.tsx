import type { ReactNode } from "react";
import WowIcon from "./WowIcon";

// A segmented switch: one choice out of a few, all visible at once (role
// filter, gear source, analysis kind). An option can carry an icon: a WoW icon
// by name, or a line icon node from ../icons (like Button's `icon`).
// `iconOnly` draws just the icons (a switch in every row of a list): the label
// is then the option's accessible name, and its tooltip when it has no `tip`.

export type SegmentOption<V extends string> = { value: V; label: string; icon?: string | ReactNode; tip?: string; tipSub?: string; disabled?: boolean };

export default function Segment<V extends string>({ options, value, onChange, ariaLabel, size = "md", iconOnly = false }: {
    options: SegmentOption<V>[];
    value: V;
    onChange: (value: V) => void;
    ariaLabel: string;
    size?: "md" | "sm";
    iconOnly?: boolean;
}) {
    const cls = ["seg", size === "sm" ? "sm" : "", iconOnly ? "icon-only" : ""].filter(Boolean).join(" ");
    return (
        <div className={cls} role="radiogroup" aria-label={ariaLabel}>
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={iconOnly ? o.label : undefined}
                        className={`seg-opt${active ? " active" : ""}`}
                        disabled={o.disabled}
                        data-tip={o.tip || (iconOnly ? o.label : undefined)}
                        data-tip-sub={o.tipSub}
                        onClick={() => onChange(o.value)}
                    >
                        {typeof o.icon === "string" ? <WowIcon name={o.icon} size={18} /> : o.icon}
                        {iconOnly ? null : o.label}
                    </button>
                );
            })}
        </div>
    );
}
