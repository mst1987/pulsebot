import { useEffect, useRef, type ReactNode } from "react";

// An on/off switch with its label (the admin menu has no single checkboxes; a checkbox
// is only for marking rows of a list): a sliding track, the label beside it (text, or
// an icon plus text), the explanation in the tooltip. Under it sits a native checkbox
// with role="switch", so Tab, Space, a click on the label and screen readers work as
// with any form control. `mixed` (a selection where some have it, some not) puts the
// thumb in the middle; a click then switches all on. Styled by the shared `.switch` /
// `.switch-row` classes (styles/shared.css).

export default function Switch({ checked, onChange, label, tip, tipHead, mixed = false, disabled, className }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: ReactNode;
    /** the explanation in the tooltip, under the label (or under `tipHead`) */
    tip?: string;
    /** the tooltip's first line when it is not the label (e.g. why the switch is disabled) */
    tipHead?: string;
    mixed?: boolean;
    disabled?: boolean;
    className?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
    const cls = ["switch-row", disabled ? "is-disabled" : "", className || ""].filter(Boolean).join(" ");
    const head = tipHead || (tip && typeof label === "string" ? label : undefined);
    return (
        <label className={cls} data-tip={head} data-tip-sub={tip}>
            <span className="switch">
                <input ref={ref} type="checkbox" role="switch" checked={checked && !mixed} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            <span className="switch-text">{label}</span>
        </label>
    );
}
