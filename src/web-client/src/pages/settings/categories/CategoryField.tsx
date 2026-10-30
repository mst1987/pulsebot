import type { ReactNode } from "react";
import { IconButton } from "../../../components/ui/Button";
import { InfoMarkIcon } from "../../../components/ui/icons";
import { useT } from "../../../i18n";

// One setting of a raid category in its expanded card (Einstellungen → Kategorien),
// design "A · Sechs Tabs, jede Einstellung eine Karte": a card of its own with the
// name and a one-line summary on the left and the control on the right. The full
// explanation sits behind the (i) beside the name, so a tab reads at a glance.
// Below 760 px the two stack (styles/settings.css, .cat-field).

/** The name, its one-line summary and the (i) with the full explanation. */
function FieldHead({ label, htmlFor, sub, more }: { label: string; htmlFor?: string; sub?: ReactNode; more?: string }) {
    const t = useT();
    return (
        <div className="cat-field-head">
            <div className="cat-field-label">
                {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
                {more && <IconButton className="cat-field-more" size="sm" icon={<InfoMarkIcon />} tip={label} tipSub={more}
                    aria-label={t("settings.categories.moreAbout", { label })} />}
            </div>
            {sub ? <div className="cat-field-sub">{sub}</div> : null}
        </div>
    );
}

export default function CategoryField({ label, htmlFor, sub, more, children }: {
    label: string;
    /** The control's id, when there is one input the name belongs to. */
    htmlFor?: string;
    /** One line under the name: what the setting does, in short. */
    sub?: ReactNode;
    /** The full explanation, behind the (i). */
    more?: string;
    children: ReactNode;
}) {
    return (
        <div className="cat-field">
            <FieldHead label={label} htmlFor={htmlFor} sub={sub} more={more} />
            <div className="cat-field-control">{children}</div>
        </div>
    );
}

/** One of several settings that share a card (Anwesenheit: shown, quota, overview), divided by a line. */
export function CategorySubField({ label, htmlFor, sub, more, children }: {
    label: string;
    htmlFor?: string;
    sub?: ReactNode;
    more?: string;
    children: ReactNode;
}) {
    return (
        <div className="cat-subfield">
            <FieldHead label={label} htmlFor={htmlFor} sub={sub} more={more} />
            <div className="cat-subfield-control">{children}</div>
        </div>
    );
}
