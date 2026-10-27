import type { ReactNode } from "react";
import { t } from "../../i18n";
import Switch from "./Switch";

// A setting that all servers share, with an own value for one server (#918, Epic
// #926 "Daten je Server"): the switch "Eigener Wert auf <Server>" on top; while it
// is on, the field for the server's own value (children) shows under it. The line
// "Standard (alle Server): …" always stays below, so it is clear what the server
// gets with the switch off and what it differs from with it on.
//
// Built and tested on its own; the settings that use it follow with the issues
// that split them per server.

export default function OwnValue({ server, own, onOwnChange, fallback, children, disabled, className }: {
    /** the active server's name, e.g. "Pulse Raids" */
    server: string;
    /** whether this server has its own value */
    own: boolean;
    onOwnChange: (own: boolean) => void;
    /** the shared default, as the reader should see it; empty means none is set */
    fallback: ReactNode;
    /** the field for the server's own value, shown while `own` is on */
    children: ReactNode;
    disabled?: boolean;
    className?: string;
}) {
    const empty = fallback === null || fallback === undefined || fallback === "";
    return (
        <div className={["own-value", own ? "is-own" : "", className || ""].filter(Boolean).join(" ")}>
            <Switch
                checked={own}
                onChange={onOwnChange}
                disabled={disabled}
                label={t("common.ownValue.label", { server })}
                tip={t("common.ownValue.tip", { server })}
            />
            {own && <div className="own-value-field">{children}</div>}
            <div className="own-value-def">
                <span className="own-value-key">{t("common.ownValue.default")}</span>
                <span className="own-value-val">{empty ? t("common.ownValue.unset") : fallback}</span>
            </div>
        </div>
    );
}
