import { useEffect, useState, type KeyboardEvent } from "react";
import { formatNumber, parseNumberText, stepNumber } from "../../lib/raidplan/numberField";

/**
 * The one number field of the raid plan: a fixed width, right-aligned digits, the unit INSIDE the field (px, %, °), no
 * browser spinner. The text stays as typed until the field is left or Enter is pressed; then it is clamped to min..max
 * and shown as a clean number (an empty field goes back to the last valid value). Arrow up / down step (Shift = ten steps).
 */
export function NumberField({ value, min, max, step = 1, unit = "", decimals = 0, disabled = false, label, onChange }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    decimals?: number;
    disabled?: boolean;
    /** the accessible name (there is no visible label right beside the digits) */
    label: string;
    onChange: (v: number) => void;
}) {
    const [text, setText] = useState(formatNumber(value, decimals));
    const [focused, setFocused] = useState(false);
    // follows the value from outside (a slider, an undo) as long as the field is not being typed in
    useEffect(() => { if (!focused) setText(formatNumber(value, decimals)); }, [value, focused, decimals]);
    const commit = () => {
        const v = parseNumberText(text, min, max, value, decimals);
        setText(formatNumber(v, decimals));
        if (v !== value) onChange(v);
    };
    const key = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = parseNumberText(text, min, max, value, decimals);
            const v = stepNumber(base, e.key === "ArrowUp" ? 1 : -1, step, e.shiftKey, min, max, decimals);
            setText(formatNumber(v, decimals));
            if (v !== value) onChange(v);
        }
    };
    return (
        <span className={`rp-num${disabled ? " is-inert" : ""}`}>
            <input
                type="text" inputMode={decimals > 0 ? "decimal" : "numeric"} value={text} disabled={disabled} aria-label={label}
                onChange={(e) => setText(e.target.value)} onFocus={(e) => { setFocused(true); e.target.select(); }} onBlur={() => { setFocused(false); commit(); }} onKeyDown={key}
            />
            {unit && <i aria-hidden="true">{unit}</i>}
        </span>
    );
}

/** A label, a slider (flexible) and the number field (fixed width) side by side, same height, centred on one line. */
export function SliderField({ label, value, min, max, step = 1, unit = "", decimals = 0, disabled = false, onChange }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    decimals?: number;
    disabled?: boolean;
    onChange: (v: number) => void;
}) {
    return (
        <div className={`rp-field${disabled ? " rp-disabled" : ""}`}>
            <span className="rp-kicker">{label}</span>
            <div className="rp-sf">
                <input type="range" min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
                <NumberField value={value} min={min} max={max} step={step} unit={unit} decimals={decimals} disabled={disabled} label={`${label} (${unit || "#"})`} onChange={onChange} />
            </div>
        </div>
    );
}
