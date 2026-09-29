import Segment from "../../components/ui/Segment";
import { FieldLabel } from "../../components/ui/Field";
import { useT } from "../../i18n";

export type GameVersionOption = { id: string; label: string; short: string };

/**
 * Einstellungen → Spielversion (#541): the guild's main version and the
 * categories that play another one. Part of the page's draft — the save bar
 * sends `mainVersion` and `categoryVersion` (a category on "Hauptversion" is
 * left out of the map).
 */
export default function GameVersionSection({ versions, categories, activeIds, mainVersion, categoryVersion, onMainVersion, onCategoryVersion }: {
    versions: GameVersionOption[];
    categories: { id: string; name: string }[];
    /** The raid categories switched on under Kategorien — only they get a row. */
    activeIds: string[];
    mainVersion: string;
    categoryVersion: Record<string, string>;
    onMainVersion: (versionId: string) => void;
    onCategoryVersion: (categoryId: string, versionId: string) => void;
}) {
    const t = useT();
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const mainShort = versions.find((v) => v.id === mainVersion)?.short || mainVersion;
    return (
        <div className="set-card set-form">
            <div className="set-field">
                <FieldLabel tip={t("settings.gameVersion.main")} tipSub={t("settings.gameVersion.mainSub")}>{t("settings.gameVersion.main")}</FieldLabel>
                <Segment
                    ariaLabel={t("settings.gameVersion.main")}
                    value={mainVersion}
                    onChange={onMainVersion}
                    options={versions.map((v) => ({ value: v.id, label: v.short || v.label, tip: v.label }))}
                />
            </div>
            <div className="set-field">
                <FieldLabel tip={t("settings.gameVersion.categories")} tipSub={t("settings.gameVersion.categoriesSub")}>{t("settings.gameVersion.categories")}</FieldLabel>
                {activeIds.length === 0 ? (
                    <p className="gv-empty">{t("settings.gameVersion.noCategories")}</p>
                ) : (
                    <div className="gv-cats">
                        {activeIds.map((id) => {
                            const name = names.get(id) || id;
                            return (
                                <div className="gv-cat" key={id}>
                                    <label htmlFor={`catversion-${id}`}>{name}</label>
                                    <select
                                        id={`catversion-${id}`}
                                        aria-label={t("settings.gameVersion.categoryAria", { name })}
                                        value={categoryVersion[id] || ""}
                                        onChange={(e) => onCategoryVersion(id, e.target.value)}
                                    >
                                        <option value="">{t("settings.gameVersion.followMain", { version: mainShort })}</option>
                                        {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
