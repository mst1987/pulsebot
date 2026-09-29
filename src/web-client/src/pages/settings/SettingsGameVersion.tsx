import { useState } from "react";
import Segment from "../../components/ui/Segment";
import Field, { FieldLabel } from "../../components/ui/Field";
import Badge from "../../components/ui/Badge";
import { useT } from "../../i18n";
import {
    BLIZZARD_REGIONS, SOFTRES_EDITIONS, blockOf, blockProblems, versionLinks,
    type VersionSettingsBlock,
} from "../../lib/versionLinks";

const SOFTRES_LABELS: Record<string, string> = { classic: "Classic", tbc: "The Burning Crusade", wotlk: "Wrath of the Lich King" };
// A name to show the links with, so the orga sees where a template leads before saving.
const SAMPLE_CHARACTER = "Devihra";
const SAMPLE_ITEM = 32837;

/**
 * Einstellungen → Spielversion, second card (#542): per game version where a
 * character is looked up (Battle.net realm, armory, Warcraft Logs) and where
 * items link to (Wowhead), the softres edition and the default raidsheet. One
 * version at a time behind a switcher; part of the page's draft, so the save
 * bar sends the blocks. An empty field means "not there for this version" —
 * the app then leaves the link out.
 */
export function VersionSettingsCard({ versions, mainVersion, value, raidsheets, onChange }: {
    versions: GameVersionOption[];
    mainVersion: string;
    value: Record<string, VersionSettingsBlock>;
    raidsheets: { id: string; name: string }[];
    onChange: (versionId: string, block: VersionSettingsBlock) => void;
}) {
    const t = useT();
    const [picked, setPicked] = useState(mainVersion);
    const version = versions.find((v) => v.id === picked) || versions[0];
    if (!version) return null;
    const block = blockOf(value[version.id]);
    const set = (patch: Partial<VersionSettingsBlock>) => onChange(version.id, { ...block, ...patch });
    const problems = new Set(blockProblems(block));
    const links = versionLinks(block);
    const id = (field: string) => `vs-${version.id}-${field}`;
    const error = (field: keyof VersionSettingsBlock) => (problems.has(field) ? t(`settings.versionLinks.invalid.${field}`) : undefined);
    const input = (field: keyof VersionSettingsBlock, placeholder: string) => (
        <input
            id={id(field)} value={block[field]} placeholder={placeholder} spellCheck={false}
            aria-invalid={problems.has(field) || undefined}
            onChange={(e) => set({ [field]: e.target.value })}
        />
    );
    const preview = [
        { key: "armory", url: links.armory(SAMPLE_CHARACTER) },
        { key: "wcl", url: links.wcl(SAMPLE_CHARACTER) },
        { key: "wowhead", url: links.wowheadItem(SAMPLE_ITEM) },
    ];
    return (
        <div className="set-card set-form gv-links">
            <div className="gv-links-head">
                <FieldLabel tip={t("settings.versionLinks.title")} tipSub={t("settings.versionLinks.titleSub")}>{t("settings.versionLinks.title")}</FieldLabel>
                <Segment
                    ariaLabel={t("settings.versionLinks.switch")}
                    size="sm"
                    value={version.id}
                    onChange={setPicked}
                    options={versions.map((v) => ({ value: v.id, label: v.short || v.label, tip: v.label }))}
                />
                {version.id === mainVersion && <Badge tone="accent">{t("settings.gameVersion.main")}</Badge>}
            </div>
            <p className="gv-hint">{t("settings.versionLinks.emptyHint", { version: version.label })}</p>

            <div className="gv-group">
                <div className="gv-group-title">{t("settings.versionLinks.armory")}</div>
                <div className="set-grid">
                    <Field className="set-field" label={t("settings.versionLinks.region")} htmlFor={id("blizzardRegion")}>
                        <select id={id("blizzardRegion")} value={block.blizzardRegion} onChange={(e) => set({ blizzardRegion: e.target.value })}>
                            <option value="">{t("settings.versionLinks.none")}</option>
                            {BLIZZARD_REGIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                        </select>
                    </Field>
                    <Field className="set-field" label={t("settings.versionLinks.realm")} htmlFor={id("blizzardRealmSlug")} error={error("blizzardRealmSlug")}>
                        {input("blizzardRealmSlug", "realm-slug")}
                    </Field>
                    <Field
                        className="set-field" label={t("settings.versionLinks.namespace")} htmlFor={id("blizzardNamespace")}
                        tip={t("settings.versionLinks.namespace")} tipSub={t("settings.versionLinks.namespaceSub")} error={error("blizzardNamespace")}
                    >
                        {input("blizzardNamespace", "profile-…-eu")}
                    </Field>
                </div>
                <Field
                    className="set-field" label={t("settings.versionLinks.armoryUrl")} htmlFor={id("armoryUrlTemplate")}
                    tip={t("settings.versionLinks.armoryUrl")} tipSub={t("settings.versionLinks.templateSub")} error={error("armoryUrlTemplate")}
                >
                    {input("armoryUrlTemplate", "https://…/{char}")}
                </Field>
            </div>

            <div className="gv-group">
                <div className="gv-group-title">{t("settings.versionLinks.logsAndItems")}</div>
                <Field
                    className="set-field" label={t("settings.versionLinks.wclUrl")} htmlFor={id("wclUrlTemplate")}
                    tip={t("settings.versionLinks.wclUrl")} tipSub={t("settings.versionLinks.templateSub")} error={error("wclUrlTemplate")}
                >
                    {input("wclUrlTemplate", "https://…warcraftlogs.com/character/…/{char}")}
                </Field>
                <div className="set-grid">
                    <Field
                        className="set-field" label={t("settings.versionLinks.wowhead")} htmlFor={id("wowheadPath")}
                        tip={t("settings.versionLinks.wowhead")} tipSub={t("settings.versionLinks.wowheadSub")} error={error("wowheadPath")}
                    >
                        {input("wowheadPath", "tbc · classic · …")}
                    </Field>
                    <Field
                        className="set-field" label={t("settings.versionLinks.softres")} htmlFor={id("softresEdition")}
                        tip={t("settings.versionLinks.softres")} tipSub={t("settings.versionLinks.softresSub")}
                    >
                        <select id={id("softresEdition")} value={block.softresEdition} onChange={(e) => set({ softresEdition: e.target.value })}>
                            <option value="">{t("settings.versionLinks.none")}</option>
                            {SOFTRES_EDITIONS.map((ed) => <option key={ed} value={ed}>{SOFTRES_LABELS[ed] || ed}</option>)}
                        </select>
                    </Field>
                    <Field
                        className="set-field" label={t("settings.versionLinks.raidsheet")} htmlFor={id("raidsheetId")}
                        tip={t("settings.versionLinks.raidsheet")} tipSub={t("settings.versionLinks.raidsheetSub")}
                    >
                        <select id={id("raidsheetId")} value={block.raidsheetId} onChange={(e) => set({ raidsheetId: e.target.value })}>
                            <option value="">{t("settings.versionLinks.byKeyword")}</option>
                            {raidsheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </Field>
                </div>
            </div>

            <div className="gv-preview" aria-label={t("settings.versionLinks.preview")}>
                <span className="gv-preview-label">{t("settings.versionLinks.preview")}</span>
                {preview.map((p) => (p.url
                    ? <a key={p.key} href={p.url} target="_blank" rel="noopener noreferrer">{t(`settings.versionLinks.previewLink.${p.key}`)}</a>
                    : <span key={p.key} className="gv-preview-off">{t(`settings.versionLinks.previewNone.${p.key}`)}</span>))}
            </div>
        </div>
    );
}

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
    // Every active category, like the Kategorien matrix: one Discord no longer
    // knows (or another server's) keeps its row, named by its id.
    const rows = activeIds;
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
                {rows.length === 0 ? (
                    <p className="gv-empty">{t("settings.gameVersion.noCategories")}</p>
                ) : (
                    <div className="gv-cats">
                        {rows.map((id) => {
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
