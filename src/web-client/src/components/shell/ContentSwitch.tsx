import { useState } from "react";
import { useContentVersion } from "../../hooks/useContentVersion";
import { canSwitch, versionRef } from "../../lib/app/contentVersion";
import { useT } from "../../i18n";
import WowIcon from "../ui/WowIcon";

// The content switch in the top bar (#563, design "Content-Umschalter"): one
// segment "Forever | TBC" next to the server select, each version with its
// coloured dot, for the whole web admin. On a phone it folds into a chip that
// opens the segment on a tap. Only versions with data are offered; with one
// version there is nothing to switch and it stays away, and with "Andere
// Versionen ausblenden" only a quiet hint says which version is shown.

/**
 * The mark of a version (#951): the icon its Battle.net launcher shows, a file
 * under public/versions, as a plain image of at most 48 px - never recoloured
 * or cropped. Classic Era and TBC Anniversary share that icon, so the version's
 * label always stands beside it: the alt text names the version, but the image
 * stays out of the accessible name (the label next to it carries it). Without
 * an icon the coloured dot (tokens --ver-<id>).
 */
export function VersionDot({ id, icon, label = "", size = 16 }: { id: string; icon?: string; label?: string; size?: number }) {
    if (icon) return <WowIcon name={icon} size={size} alt={label} className={`ver-${id}`} />;
    return <span className={`ver-dot ver-${id}`} aria-hidden="true" />;
}

export default function ContentSwitch() {
    const t = useT();
    const state = useContentVersion();
    const [open, setOpen] = useState(false);
    const info = { mainVersion: state.mainVersion, hideOtherVersions: state.hidden, versions: state.versions };
    if (!state.version) return null;
    const current = versionRef(info, state.version);

    if (!canSwitch(info)) {
        // Hidden on purpose: say which version everything is, without a control.
        if (!state.hidden) return null;
        return (
            <span className="cswitch-quiet" data-tip={t("shell.content.hiddenTip")} data-tip-sub={t("shell.content.hiddenSub")}>
                <VersionDot id={current.id} icon={current.icon} label={current.label} />{current.short}
            </span>
        );
    }

    const pick = (id: string) => {
        state.setVersion(id);
        setOpen(false);
    };
    const segment = (extra: string) => (
        <div className={`seg cswitch-seg ${extra}`} role="radiogroup" aria-label={t("shell.content.aria")}>
            {state.versions.map((v) => (
                <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={v.id === current.id}
                    className={`seg-opt${v.id === current.id ? " active" : ""}`}
                    data-tip={v.label}
                    onClick={() => pick(v.id)}
                >
                    <VersionDot id={v.id} icon={v.icon} label={v.label} />{v.short}
                </button>
            ))}
        </div>
    );

    return (
        <>
            {segment("cswitch-wide")}
            <button
                type="button"
                className="cswitch-chip"
                aria-expanded={open}
                aria-label={t("shell.content.chipAria", { version: current.label })}
                onClick={() => setOpen((o) => !o)}
            >
                <VersionDot id={current.id} icon={current.icon} label={current.label} />{current.short}
            </button>
            {open && (
                <div className="cswitch-panel">
                    <span className="kicker">{t("shell.content.panel")}</span>
                    {segment("cswitch-full")}
                </div>
            )}
        </>
    );
}
