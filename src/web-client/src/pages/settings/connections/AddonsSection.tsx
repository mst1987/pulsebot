import { useState } from "react";
import { Link } from "react-router-dom";
import { updateSettings, type AddonSetting, type AdminConfig, type ApiError, type SettingsData } from "../../../api";
import { ListSection } from "../../../components/ui/layout/ListSection";
import { useCollectionEditor } from "../../../lib/ui/collectionEditor";
import { useToast } from "../../../components/shell/Jobs";
import { useConfirm } from "../../../components/ui/overlay/Modal";
import { Button, IconButton, buttonClass } from "../../../components/ui/Button";
import Field from "../../../components/ui/form/Field";
import Switch from "../../../components/ui/form/Switch";
import Chip from "../../../components/ui/Chip";
import Badge from "../../../components/ui/Badge";
import WowIcon from "../../../components/ui/icons/WowIcon";
import { CheckMark, PenIcon, TrashIcon, WarnIcon, SaveIcon } from "../../../components/ui/icons/icons";
import { splitList } from "../settingsDraft";
import { useTableSort, type Dir } from "../../../lib/ui/tableSort";
import { SortTh } from "../../../components/ui/table/SortTh";
import { useT } from "../../../i18n";
import AddonCenterCard from "./AddonCenterCard";
import "../../../styles/addon.css";

// Einstellungen → Module → Addons (#818): the addons of the page "Addons" —
// one row each, one editor at a time (docs/web-admin.md, "Editing a
// collection"). The list is saved whole and alone (PATCH /api/settings
// { addonDownloads } - the server refuses it next to anything else, so no other
// save can ever wipe it), full admins only like the GitHub token it is fetched
// with. "Standard wiederherstellen" sends { addonDownloadsReset: true }. The
// token itself lives under Verbindungen; this section only says whether it is set.
// Under the list: the download centre in Discord (AddonCenterCard, its own route).

type Version = { id: string; label: string; short: string };

type AddonSortKey = "name" | "repo" | "versions" | "assets" | "status";
const ADDON_SORT_DEFAULTS: Record<AddonSortKey, Dir> = { name: "asc", repo: "asc", versions: "asc", assets: "asc", status: "desc" };

// What the server's normalizeCurseforge (services/addons/addonConfig.js) accepts: a project page
// curseforge.com/wow/addons/<slug>, with www./legacy., anything after the slug. Browsers compile
// `pattern` with the v flag, hence the escaped "-" and "/" inside the classes; the server also
// takes upper case in scheme and host, the field only the usual spelling.
const CURSEFORGE_PATTERN = "https?://(www\\.|legacy\\.)?curseforge\\.com/wow/addons/[A-Za-z0-9\\-]{1,100}([\\/?#].*)?";

const EMPTY: AddonSetting = {
    id: "", name: "", description: "", repo: "", private: false, assets: [], versions: [], install: "", icon: "", enabled: true, orgaOnly: false, curseforge: "",
};

function AddonForm({ addon, versions, onSave, onCancel }: {
    addon: AddonSetting | null;
    versions: Version[];
    onSave: (next: AddonSetting) => Promise<boolean>;
    onCancel: () => void;
}) {
    const t = useT();
    const start = addon || EMPTY;
    const [value, setValue] = useState<AddonSetting>(start);
    const [assets, setAssets] = useState(start.assets.join(", "));
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<AddonSetting>) => setValue({ ...value, ...patch });
    const toggleVersion = (id: string) => set({ versions: value.versions.includes(id) ? value.versions.filter((v) => v !== id) : [...value.versions, id] });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSave({ ...value, assets: splitList(assets) });
        setBusy(false);
        if (ok) onCancel();
    };

    return (
        <form className="set-card set-form" onSubmit={submit}>
            <div className="set-grid">
                <Field className="set-field" htmlFor="dlp-name" label={t("addon.settings.name")}>
                    <input id="dlp-name" type="text" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="LevelHelper" required />
                </Field>
                <Field className="set-field" htmlFor="dlp-repo" label={t("addon.settings.repo")} tip={t("addon.settings.repo")} tipSub={t("addon.settings.repoSub")}>
                    <input id="dlp-repo" type="text" className="mono" value={value.repo} onChange={(e) => set({ repo: e.target.value })} placeholder="mst1987/levelhelper" required />
                </Field>
            </div>
            <Field className="set-field" htmlFor="dlp-desc" label={t("addon.settings.description")}>
                <textarea id="dlp-desc" rows={2} value={value.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("addon.settings.descriptionPlaceholder")} />
            </Field>
            <div className="set-grid">
                <Field className="set-field" htmlFor="dlp-assets" label={t("addon.settings.assets")} tip={t("addon.settings.assets")} tipSub={t("addon.settings.assetsSub")}>
                    <input id="dlp-assets" type="text" className="mono" value={assets} onChange={(e) => setAssets(e.target.value)} placeholder="LevelHelper-*.zip" />
                </Field>
                <Field className="set-field" htmlFor="dlp-icon" label={t("addon.settings.icon")} tip={t("addon.settings.icon")} tipSub={t("addon.settings.iconSub")}>
                    <span className="dlp-icon-field">
                        <WowIcon name={value.icon || "inv_misc_questionmark"} size={28} />
                        <input id="dlp-icon" type="text" className="mono" value={value.icon} onChange={(e) => set({ icon: e.target.value })} placeholder="addons" />
                    </span>
                </Field>
            </div>
            <div className="set-field">
                <span className="field-label">{t("addon.settings.versions")}</span>
                <div className="chip-row">
                    {versions.map((v) => (
                        <Chip key={v.id} pressed={value.versions.includes(v.id)} icon={value.versions.includes(v.id) ? <CheckMark /> : undefined} onClick={() => toggleVersion(v.id)}>
                            {v.label}
                        </Chip>
                    ))}
                </div>
            </div>
            <Field className="set-field" htmlFor="dlp-install" label={t("addon.settings.install")} tip={t("addon.settings.install")} tipSub={t("addon.settings.installSub")}>
                <textarea id="dlp-install" rows={2} value={value.install} onChange={(e) => set({ install: e.target.value })} />
            </Field>
            <Field className="set-field" htmlFor="dlp-curseforge" label={t("addon.settings.curseforge")} tip={t("addon.settings.curseforge")} tipSub={t("addon.settings.curseforgeSub")}>
                <input id="dlp-curseforge" type="url" className="mono" pattern={CURSEFORGE_PATTERN} value={value.curseforge || ""} onChange={(e) => set({ curseforge: e.target.value })} placeholder="https://www.curseforge.com/wow/addons/pulse-aurakit" />
            </Field>
            <div className="set-grid">
                <Switch checked={value.private} onChange={(v) => set({ private: v })} label={t("addon.settings.private")} tip={t("addon.settings.privateSub")} />
                <Switch checked={value.orgaOnly} onChange={(v) => set({ orgaOnly: v })} label={t("addon.settings.orgaOnly")} tip={t("addon.settings.orgaOnlySub")} />
                <Switch checked={value.enabled} onChange={(v) => set({ enabled: v })} label={t("addon.settings.enabled")} tip={t("addon.settings.enabledSub")} />
            </div>
            <div className="row-actions">
                <Button type="submit" variant="go" icon={<SaveIcon />} disabled={busy}>{busy ? t("settings.saving") : t("common.save")}</Button>
                <Button variant="ghost" disabled={busy} onClick={onCancel}>{t("common.cancel")}</Button>
            </div>
        </form>
    );
}

export default function AddonsSection({ data, onConfig }: {
    data: SettingsData;
    onConfig: (config: AdminConfig) => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const editor = useCollectionEditor("addon");
    const list = data.config.addonDownloads || [];
    const versions: Version[] = data.gameVersions || [];
    const labelOf = (id: string) => (versions.find((v) => v.id === id) || { short: id }).short || id;
    const tokenSet = !!data.config.github?.hasToken;
    const needsToken = list.some((a) => a.private && a.enabled);
    const { sort, dir, onSort, apply } = useTableSort<AddonSortKey>("addons-sort", ADDON_SORT_DEFAULTS, "name");
    const sorted = apply(list, (a, key) => {
        switch (key) {
            case "repo": return a.repo.toLowerCase();
            case "versions": return a.versions.map(labelOf).join(", ").toLowerCase();
            case "assets": return a.assets.join(", ").toLowerCase();
            case "status": return a.enabled ? 1 : 0;
            default: return a.name.toLowerCase();
        }
    });

    const save = async (next: AddonSetting[], message: string): Promise<boolean> => {
        try {
            const { config } = await updateSettings({ addonDownloads: next });
            onConfig(config);
            toast(message);
            return true;
        } catch (err) {
            toast((err as ApiError).message, "err");
            return false;
        }
    };

    const saveOne = (original: AddonSetting | null) => (next: AddonSetting) => {
        const rest = original ? list.map((a) => (a.id === original.id ? { ...next, id: original.id } : a)) : [...list, next];
        return save(rest, t(original ? "addon.settings.saved" : "addon.settings.created", { name: next.name }));
    };

    const remove = async (addon: AddonSetting) => {
        if (!(await ask({ title: t("addon.settings.deleteAsk", { name: addon.name }), text: t("addon.settings.deleteText"), action: t("common.delete"), tone: "danger" }))) return;
        await save(list.filter((a) => a.id !== addon.id), t("addon.settings.deleted", { name: addon.name }));
    };

    // "Standard wiederherstellen": the server puts its default list back (sent alone, like every save here).
    const restore = async () => {
        if (!(await ask({ title: t("addon.settings.restoreAsk"), text: t("addon.settings.restoreText"), action: t("addon.settings.restoreAction"), tone: "danger" }))) return;
        try {
            const { config } = await updateSettings({ addonDownloadsReset: true });
            onConfig(config);
            editor.close();
            toast(t("addon.settings.restored"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            {needsToken && !tokenSet && (
                <div className="conn-status mid dlp-token-hint">
                    <Badge tone="mid" icon={<WarnIcon />}>{t("settings.state.tokenMissing")}</Badge>
                    <span>{t("addon.settings.tokenHint")}</span>
                    <Link className={buttonClass("ghost", "sm")} to="/settings/all?section=verbindungen">{t("addon.settings.toConnections")}</Link>
                </div>
            )}
            <ListSection
                editor={editor}
                entries={list}
                idOf={(a) => a.id}
                newLabel={t("addon.settings.new")}
                note={t("addon.settings.note")}
                editorTitle={(a) => (a ? t("addon.settings.editTitle", { name: a.name }) : t("addon.settings.new"))}
                editorFor={(a) => <AddonForm addon={a} versions={versions} onSave={saveOne(a)} onCancel={editor.close} />}
            >
                {list.length ? (
                    <div className="set-card table-scroll">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label={t("addon.settings.name")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="repo" label={t("addon.settings.repo")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="versions" label={t("addon.settings.versions")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="assets" label={t("addon.settings.assets")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="status" label={t("addon.settings.status")} sort={sort} dir={dir} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((a) => (
                                    <tr key={a.id}>
                                        <td><span className="dlp-name-cell"><WowIcon name={a.icon} size={22} /><strong>{a.name}</strong></span></td>
                                        <td className="small mono">{a.repo}{a.private ? ` · ${t("addon.settings.privateShort")}` : ""}{a.orgaOnly ? ` · ${t("addon.settings.orgaOnlyShort")}` : ""}</td>
                                        <td className="small">{a.versions.length ? a.versions.map(labelOf).join(", ") : t("addon.settings.noVersion")}</td>
                                        <td className="small mono">{a.assets.length ? a.assets.join(", ") : t("addon.settings.allFiles")}</td>
                                        <td>
                                            <Badge tone={a.enabled ? "ok" : undefined} size="sm">{a.enabled ? t("addon.settings.on") : t("addon.settings.off")}</Badge>
                                        </td>
                                        <td className="cell-act">
                                            <IconButton icon={<PenIcon />} tip={t("common.edit")} size="sm" onClick={() => editor.startEdit(a.id)} />
                                            <IconButton icon={<TrashIcon />} tip={t("common.delete")} size="sm" tone="danger" onClick={() => { void remove(a); }} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <div className="empty">{t("addon.settings.empty")}</div>}
            </ListSection>
            <div className="dlp-restore">
                <Button variant="ghost" size="sm" data-tip={t("addon.settings.restore")} data-tip-sub={t("addon.settings.restoreTip")} onClick={() => { void restore(); }}>
                    {t("addon.settings.restore")}
                </Button>
            </div>
            <AddonCenterCard />
        </>
    );
}
