import type { ReactNode } from "react";

// An on/off switch with its label (the admin menu has no bare checkboxes): a
// sliding track, the label beside it, the explanation in the tooltip. Under it
// sits a native checkbox with role="switch", so Tab, Space, a click on the label
// and screen readers work as with any form control. Styled by the shared
// `.switch` / `.switch-row` classes (styles/shared.css).

export default function Switch({ checked, onChange, label, tip, disabled, className }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: ReactNode;
    tip?: string;
    disabled?: boolean;
    className?: string;
}) {
    const cls = ["switch-row", disabled ? "is-disabled" : "", className || ""].filter(Boolean).join(" ");
    return (
        <label className={cls} data-tip={tip && typeof label === "string" ? label : undefined} data-tip-sub={tip}>
            <span className="switch">
                <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            <span className="switch-text">{label}</span>
        </label>
    );
}
