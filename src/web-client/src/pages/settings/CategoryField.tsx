import type { ReactNode } from "react";

// One setting of a raid category in its expanded card (Einstellungen → Kategorien):
// the name on the left, the control in the middle and what it does on the right —
// visible, not only behind an "i" (the old tooltip text). Below 760 px the three
// stack (styles/settings.css, .cat-field).

export default function CategoryField({ label, htmlFor, sub, children }: {
    label: ReactNode;
    /** The control's id, when there is one input the name belongs to. */
    htmlFor?: string;
    /** The explanation shown beside the control. */
    sub?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="cat-field">
            <div className="cat-field-label">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}</div>
            <div className="cat-field-control">{children}</div>
            {sub ? <div className="cat-field-sub">{sub}</div> : <span />}
        </div>
    );
}
