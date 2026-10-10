import Switch from "../../components/ui/Switch";
import { FieldLabel } from "../../components/ui/Field";
import { VersionDot } from "../../components/shell/ContentSwitch";
import { useT } from "../../i18n";
import { cellState, reasonKeys, setFeature, type CapabilityMatrix } from "../../lib/settings/versionFeatures";
import type { GameVersionOption } from "./SettingsGameVersion";

/**
 * Einstellungen → Spielversion, "Funktionen je Version" (#761): what each game
 * version can do, in one matrix — features as rows, versions as columns. A cell
 * is "an", "aus" or "nicht möglich"; the reason sits in its tooltip. A switch
 * only where the feature is possible (the server's matrix, from the saved
 * settings); switching it is part of the page draft and goes with the save bar
 * as `versionSettings[<id>].disabled`. A feature switched off behaves like one
 * that is not possible, with its own hint.
 */
export default function VersionFeaturesCard({ versions, matrix, disabled, onChange }: {
    versions: GameVersionOption[];
    /** GET /api/settings `versionCapabilities`; missing (an older server) = no card */
    matrix?: CapabilityMatrix;
    /** the draft's features switched off, per version */
    disabled: Record<string, string[]>;
    onChange: (versionId: string, disabled: string[]) => void;
}) {
    const t = useT();
    if (!matrix || !matrix.features.length) return null;
    const cols = versions.filter((v) => matrix.versions[v.id]);
    const featureName = (f: string) => t(`settings.versionFeatures.features.${f}`);
    return (
        <div className="set-card set-form vf-card">
            <FieldLabel tip={t("settings.versionFeatures.title")} tipSub={t("settings.versionFeatures.titleSub")}>{t("settings.versionFeatures.title")}</FieldLabel>
            <div className="table-scroll">
                <table className="vf-table" aria-label={t("settings.versionFeatures.title")}>
                    <thead>
                        <tr>
                            <th scope="col" className="vf-feature-head">{t("settings.versionFeatures.feature")}</th>
                            {cols.map((v) => (
                                <th key={v.id} scope="col" className="vf-version">
                                    <span className="vf-version-name tip-anchor" data-tip={v.label}><VersionDot id={v.id} />{v.short || v.label}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.features.map((f) => (
                            <tr key={f}>
                                <th scope="row" className="vf-feature">
                                    <span className="tip-anchor" data-tip={featureName(f)} data-tip-sub={t(`settings.versionFeatures.featureSub.${f}`)}>{featureName(f)}</span>
                                </th>
                                {cols.map((v) => {
                                    const cell = matrix.versions[v.id][f];
                                    const list = disabled[v.id] || [];
                                    const state = cellState(cell, f, list);
                                    const why = reasonKeys(cell, state)
                                        .map((key) => t(key, { version: v.label, count: (cell?.missing || []).length }))
                                        .join(" ");
                                    const aria = t("settings.versionFeatures.cellAria", { feature: featureName(f), version: v.short || v.label });
                                    if (state === "impossible") {
                                        return (
                                            <td key={v.id} className="vf-cell">
                                                <span
                                                    className="vf-none" tabIndex={0} aria-label={`${aria}: ${t("settings.versionFeatures.impossible")}. ${why}`}
                                                    data-tip={t("settings.versionFeatures.impossible")} data-tip-sub={why}
                                                >
                                                    <span className="vf-none-mark" aria-hidden="true">–</span>
                                                    <span className="vf-state" aria-hidden="true">{t("settings.versionFeatures.impossible")}</span>
                                                </span>
                                            </td>
                                        );
                                    }
                                    return (
                                        <td key={v.id} className={`vf-cell vf-${state}`}>
                                            <Switch
                                                className="vf-switch"
                                                checked={state === "on"}
                                                onChange={(on) => onChange(v.id, setFeature(list, f, on, matrix.features))}
                                                label={(
                                                    <>
                                                        <span className="vf-sr">{aria}: </span>
                                                        <span className="vf-state">{t(state === "on" ? "settings.versionFeatures.on" : "settings.versionFeatures.off")}</span>
                                                    </>
                                                )}
                                                tipHead={aria}
                                                tip={state === "on" ? t("settings.versionFeatures.onSub") : why}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="gv-hint">{t("settings.versionFeatures.hint")}</p>
        </div>
    );
}
