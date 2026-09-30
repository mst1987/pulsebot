import type { ReactNode } from "react";
import WowIcon from "./WowIcon";

// A segmented switch: one choice out of a few, all visible at once (role
// filter, gear source, analysis kind). An option can carry an icon: a WoW icon
// by name, or a line icon node from ../icons (like Button's `icon`).

export type SegmentOption<V extends string> = { value: V; label: string; icon?: string | ReactNode; tip?: string; disabled?: boolean };

export default function Segment<V extends string>({ options, value, onChange, ariaLabel, size = "md" }: {
    options: SegmentOption<V>[];
    value: V;
    onChange: (value: V) => void;
    ariaLabel: string;
    size?: "md" | "sm";
}) {
    return (
        <div className={`seg${size === "sm" ? " sm" : ""}`} role="radiogroup" aria-label={ariaLabel}>
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`seg-opt${active ? " active" : ""}`}
                        disabled={o.disabled}
                        data-tip={o.tip}
                        onClick={() => onChange(o.value)}
                    >
                        {typeof o.icon === "string" ? <WowIcon name={o.icon} size={18} /> : o.icon}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
