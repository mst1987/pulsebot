import { useState, type KeyboardEvent, type ReactNode } from "react";
import { MinusIcon, PlusIcon } from "./icons";

// A number with − and + joined into one control (no checkbox, no slider): the
// attendance quota and the characters per signup in the category settings, the
// hour and the profession skill in "Mein Profil".
//
//   - `editable`: the value is also typed (a number field between the buttons,
//     kept within min..max). `commit="input"` hands every valid keystroke over
//     (a draft with a save bar); `commit="blur"` only on leaving the field or
//     Enter (a value that saves itself) - an invalid entry falls back to the
//     value that counts.
//   - without `editable` the middle shows `display` (e.g. "ab 19:30").
//   - `onLess` / `onMore` override the plain ± step (an hour without a value
//     starts at a default); `null` disables the button, leaving it out keeps the plain step.

export default function NumberStepper({
    value, min, max, step = 1, onChange, ariaLabel, lessLabel, moreLabel,
    editable = false, commit = "blur", id, display, onLess, onMore, size = "md",
}: {
    value: number | null;
    min: number;
    max: number;
    step?: number;
    onChange: (next: number) => void;
    /** The name of the whole group (and of the number field). */
    ariaLabel: string;
    lessLabel: string;
    moreLabel: string;
    editable?: boolean;
    commit?: "input" | "blur";
    id?: string;
    /** What the middle shows when it is not a number field. */
    display?: ReactNode;
    /** Own steps instead of value -/+ step; `null` disables the button. */
    onLess?: (() => void) | null;
    onMore?: (() => void) | null;
    size?: "md" | "sm";
}) {
    const [typing, setTyping] = useState<string | null>(null);
    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;
    const plainLess = value !== null && value > min ? () => { setTyping(null); onChange(clamp(value - step)); } : undefined;
    const plainMore = value !== null && value < max ? () => { setTyping(null); onChange(clamp(value + step)); } : undefined;
    const less = onLess === undefined ? plainLess : onLess || undefined;
    const more = onMore === undefined ? plainMore : onMore || undefined;
    const settle = () => {
        if (typing !== null && valid(typing) && Math.round(Number(typing)) !== value) onChange(Math.round(Number(typing)));
        setTyping(null);
    };
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); settle(); }
        if (e.key === "Escape") setTyping(null);
    };
    return (
        <span className={`num-stepper${size === "sm" ? " sm" : ""}`} role="group" aria-label={ariaLabel}>
            <button type="button" aria-label={lessLabel} data-tip={lessLabel} disabled={!less} onClick={() => less?.()}><MinusIcon /></button>
            {editable ? (
                <input
                    id={id} type="number" inputMode="numeric" min={min} max={max} step={1} aria-label={ariaLabel}
                    value={typing ?? (value === null ? "" : String(value))}
                    onChange={(e) => {
                        const text = e.target.value;
                        setTyping(text);
                        if (commit === "input" && valid(text)) onChange(Math.round(Number(text)));
                    }}
                    onBlur={settle}
                    onKeyDown={onKey}
                />
            ) : (
                <output className="num-stepper-value" aria-live="polite">{display ?? value}</output>
            )}
            <button type="button" aria-label={moreLabel} data-tip={moreLabel} disabled={!more} onClick={() => more?.()}><PlusIcon /></button>
        </span>
    );
}
