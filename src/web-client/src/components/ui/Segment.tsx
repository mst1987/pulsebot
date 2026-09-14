import WowIcon from "./WowIcon";

// A segmented switch: one choice out of a few, all visible at once (role
// filter, gear source, analysis kind). Options can carry a WoW icon.

export type SegmentOption<V extends string> = { value: V; label: string; icon?: string; tip?: string; disabled?: boolean };

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
                        {o.icon && <WowIcon name={o.icon} size={18} />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
