import Badge from "../../../components/ui/Badge";
import { VersionDot } from "../../../components/shell/ContentSwitch";
import { useT } from "../../../i18n";
import type { CategoryEra } from "../../../api";
import { formatDayDate } from "../../../lib/format";
import { categoryVersionOf } from "../../../lib/settings/categoryVersions";
import type { GameVersionOption } from "../versions/SettingsGameVersion";

// Which version a raid category plays (#738), as a column of the Kategorien list.
// Settings writers change it, so it stays with the server's categories. A category
// switched on just now starts with the main version (badge "neu"), and the save
// writes it down. Picking another version for a category that was active already
// is a switch: the page opens the confirmation dialog (CategorySwitchDialog)
// before the draft changes.

export type CategoryVersions = {
    options: GameVersionOption[];
    /** The default of a category without its own version (read only here). */
    mainVersion: string;
    value: Record<string, string>;
    /** The categories active when the page was loaded; another one is new (no section starts). */
    savedIds: string[];
    /** The sections per category: the row says since when the current one runs. */
    eras: Record<string, CategoryEra[]>;
    onChange: (categoryId: string, versionId: string) => void;
};

/** The line under the category's name: new, or since when its current version runs. */
export function CategoryVersionNote({ categoryId, versions }: { categoryId: string; versions: CategoryVersions }) {
    const t = useT();
    if (!versions.savedIds.includes(categoryId)) {
        const main = versions.options.find((v) => v.id === versions.mainVersion);
        return <Badge tone="accent">{t("settings.gameVersion.newCategory", { version: main?.short || versions.mainVersion })}</Badge>;
    }
    const eras = versions.eras[categoryId] || [];
    const last = eras[eras.length - 1];
    if (eras.length < 2 || !last || !last.from) return null;
    return <span className="cat-version-since">{t("settings.gameVersion.since", { date: formatDayDate(last.from) })}</span>;
}

export default function CategoryVersionPick({ categoryId, name, versions }: { categoryId: string; name: string; versions: CategoryVersions }) {
    const t = useT();
    const current = categoryVersionOf(versions.value, categoryId, versions.mainVersion);
    const version = versions.options.find((v) => v.id === current);
    return (
        <div className="cat-cell cat-version" data-tip={t("settings.gameVersion.categories")} data-tip-sub={t("settings.gameVersion.categoriesSub")}>
            <VersionDot id={current} icon={version?.icon} label={version?.label} size={20} />
            <select
                aria-label={t("settings.gameVersion.categoryAria", { name })}
                value={current}
                onChange={(e) => versions.onChange(categoryId, e.target.value)}
            >
                {versions.options.map((v) => <option key={v.id} value={v.id}>{v.short || v.label}</option>)}
            </select>
        </div>
    );
}
