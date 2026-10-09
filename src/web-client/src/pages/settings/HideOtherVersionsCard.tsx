import { FieldLabel } from "../../components/ui/Field";
import { buttonClass } from "../../components/ui/Button";
import { VersionDot } from "../../components/shell/ContentSwitch";
import { otherUpcoming, type UpcomingRaidRef } from "../../lib/contentVersion";
import { formatDayDate } from "../../lib/format";
import { useT } from "../../i18n";
import type { GameVersionOption } from "./SettingsGameVersion";

// How many dates the warning names before it stops listing.
const MAX_DATES = 4;

function WarnIcon() {
    return (
        <svg className="gv-hide-warn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg className="gv-hide-export-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
        </svg>
    );
}

/**
 * Einstellungen → Spielversion, "Andere Versionen ausblenden" (#563, design
 * "Einstellung"): one switch in the page's draft (the save bar sends
 * `hideOtherVersions`). On, every list, loot view and picker shows only the
 * main version and the menu's content switch gives way to a quiet hint; a
 * direct link still opens an event of another version, read only. Nothing is
 * deleted. Before switching it on: a warning with the coming raids of the other
 * versions, and the archive export (loot and attendance of those versions).
 */
export default function HideOtherVersionsCard({ versions, mainVersion, hidden, upcoming, dataVersions, canExport, onChange }: {
    versions: GameVersionOption[];
    mainVersion: string;
    hidden: boolean;
    upcoming?: Record<string, UpcomingRaidRef[]>;
    /** The versions something is stored for; the export names only those (missing = every version). */
    dataVersions?: string[];
    /** The export is for full admins (it carries every raider's history). */
    canExport: boolean;
    onChange: (hidden: boolean) => void;
}) {
    const t = useT();
    const main = versions.find((v) => v.id === mainVersion) || { id: mainVersion, label: mainVersion, short: mainVersion };
    const others = versions.filter((v) => v.id !== mainVersion);
    const othersShort = others.map((v) => v.short || v.label).join(", ") || t("settings.gameVersion.hideOthersNone");
    const archived = others.filter((v) => !dataVersions || dataVersions.includes(v.id));
    const coming = otherUpcoming(upcoming, mainVersion);
    const dates = coming.slice(0, MAX_DATES).map((r) => formatDayDate(r.startTime * 1000)).join(", ") + (coming.length > MAX_DATES ? ", …" : "");
    return (
        <div className="set-card set-form gv-hide">
            <div className="gv-hide-row">
                <label className="switch" htmlFor="gv-hide-others">
                    <input id="gv-hide-others" type="checkbox" checked={hidden} onChange={(e) => onChange(e.target.checked)} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
                <div className="gv-hide-text">
                    <FieldLabel htmlFor="gv-hide-others">{t("settings.gameVersion.hideOthers")}</FieldLabel>
                    <p className="gv-hint">{t("settings.gameVersion.hideOthersText", { version: main.short || main.label, others: othersShort })}</p>
                </div>
            </div>
            {hidden && coming.length > 0 && (
                <div className="gv-hide-warn" role="status">
                    <WarnIcon />
                    <p>{t("settings.gameVersion.upcoming", { count: coming.length, dates })}</p>
                </div>
            )}
            {canExport && archived.length > 0 && (
                <div className="gv-hide-export">
                    <a
                        className={buttonClass("ghost", "md", true)} href="/api/settings/archive-export?format=csv" download
                        data-tip={t("settings.gameVersion.exportTip")} data-tip-sub={t("settings.gameVersion.exportSub")}
                    >
                        <DownloadIcon />{t("settings.gameVersion.export", { versions: archived.map((v) => v.short || v.label).join(", ") })}
                    </a>
                    <a className="mlink" href="/api/settings/archive-export?format=json" download>{t("settings.gameVersion.exportJson")}</a>
                </div>
            )}
            <div className="gv-hide-preview">
                <span className="gv-group-title">{t("settings.gameVersion.preview")}</span>
                <div className="gv-hide-bar" aria-hidden="true">
                    {hidden ? (
                        <span className="cswitch-quiet"><VersionDot id={main.id} />{main.short || main.label}</span>
                    ) : (
                        <span className="seg cswitch-seg">
                            {[main, ...others].map((v) => (
                                <span key={v.id} className={`seg-opt${v.id === main.id ? " active" : ""}`}><VersionDot id={v.id} />{v.short || v.label}</span>
                            ))}
                        </span>
                    )}
                </div>
                <p className="gv-hint">{hidden ? t("settings.gameVersion.previewOn") : t("settings.gameVersion.previewOff")}</p>
            </div>
        </div>
    );
}
