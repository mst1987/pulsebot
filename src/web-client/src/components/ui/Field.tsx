import type { ReactNode } from "react";
import { InfoMarkIcon } from "../icons";

// A form field's parts (#439): the name, the round "i" that carries what used
// to be a paragraph of explanation, a hint line and an error line. The field
// wrappers keep their module's class (`field`, `set-field`, `dlg-field`, …) —
// pass it as `className`; the parts inside look the same everywhere.

/** The round "i": focusable, explains itself in the tooltip box. */
export function InfoTip({ head, sub }: { head: string; sub?: string }) {
    return (
        <span className="info" tabIndex={0} role="img" aria-label={head} data-tip={head} data-tip-sub={sub}>
            <InfoMarkIcon />
        </span>
    );
}

/** A field's name with the hint that used to sit under the input as a tooltip. */
export function FieldLabel({ children, htmlFor, tip, tipSub }: {
    children: ReactNode;
    htmlFor?: string;
    tip?: string;
    tipSub?: string;
}) {
    return (
        <div className="field-label">
            {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
            {tip && <InfoTip head={tip} sub={tipSub} />}
        </div>
    );
}

/**
 * Label (with its tooltip), the control, then an optional hint and error line.
 * `className` is the wrapper's class — `field` by default, or the module's own
 * variant (`set-field`, `dlg-field`, …) so a page keeps its spacing.
 */
export default function Field({ label, htmlFor, tip, tipSub, hint, error, className = "field", children }: {
    label: ReactNode;
    htmlFor?: string;
    tip?: string;
    tipSub?: string;
    hint?: ReactNode;
    error?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={className}>
            <FieldLabel htmlFor={htmlFor} tip={tip} tipSub={tipSub}>{label}</FieldLabel>
            {children}
            {hint && <div className="hint">{hint}</div>}
            {error && <div className="field-error" role="alert">{error}</div>}
        </div>
    );
}
