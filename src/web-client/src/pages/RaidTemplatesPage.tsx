import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getRaidTemplates, getGameVersions, saveRaidTemplate, deleteRaidTemplate, importRaidTemplates, canAccess,
    type ApiError, type GameVersion, type RaidTemplate, type RaidTemplateInput } from "../api";
import { useApi } from "../hooks/useApi";
import { useCollectionEditor } from "../lib/collectionEditor";
import { usePersistedState } from "../lib/persistedState";
import {
    allowedSizes, draftOf, emojiStyleOf, filterByVersion, instancesOf, newDraft, proposeComposition, templateLabel, validateDraft } from "../lib/raidTemplates";
import { AppearanceFields, BuffPicker, FieldLabel, InstancePicker, NumberInput, RoleRanges, SizePicker, SwitchRow } from "../components/RaidPlanFields";
import type { ShellContext } from "../components/Shell";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Segment from "../components/ui/Segment";
import Badge from "../components/ui/Badge";
import WowIcon from "../components/ui/WowIcon";
import RaidLoader from "../components/ui/RaidLoader";
import CompositionEditor from "../components/CompositionEditor";
import { RefreshIcon } from "../components/icons";
import { WarnIcon } from "../components/settings/settingsUi";
import "../styles/raid-templates.css";
import { tParts, useT } from "../i18n";

// Raid-Vorlagen (#266): what an evening looks like. One compact row per
// template — instance icons, the name large, version and "Standard für …"
// small, and on the right the three numbers that matter: size, tanks, healers.
// Everything else waits in the modal, and there behind "Mehr".
//
// Instances come only from the rule set (GET /api/game-versions). The open
// editor lives in the url (?edit=<id|new>) like every collection editor. The
// plan fields are the shared ones of components/RaidPlanFields.tsx, the same the
// "Event anlegen" dialog uses (#261).

const NO_ICON = "inv_misc_note_01";

function InstanceIcons({ icons }: { icons: string[] }) {
    return (
        <span className="rt-icons" aria-hidden="true">
            {(icons.length ? icons : [NO_ICON]).map((icon, i) => <WowIcon key={`${icon}-${i}`} name={icon} size={40} />)}
        </span>
    );
}

function Value({ label, value }: { label: string; value: number | null }) {
    return (
        <div className="rt-val">
            <div className="rt-lbl">{label}</div>
            <div className="rt-num">{value === null ? "–" : value}</div>
        </div>
    );
}

// ---- editor -----------------------------------------------------------------------

function RaidTemplateModal({ template, versions, canWrite, onSaved, onClose }: {
    template: RaidTemplate | null;
    versions: GameVersion[];
    canWrite: boolean;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const firstVersion = versions[0] || null;
    const [draft, setDraft] = useState<RaidTemplateInput>(() => (template ? draftOf(template) : newDraft(firstVersion)));
    const [freeSize, setFreeSize] = useState(false);
    const [saving, setSaving] = useState(false);
    const version = versions.find((v) => v.id === draft.versionId) || null;
    const chosen = instancesOf(version, draft.instanceIds);
    const problem = validateDraft(draft);
    const patch = (fields: Partial<RaidTemplateInput>) => setDraft((d) => ({ ...d, ...fields }));

    // A size change proposes tanks and healers; they stay editable afterwards.
    const changeSize = (size: number | null, instanceIds = draft.instanceIds) => {
        if (size === null) return patch({ size: null, instanceIds });
        const c = proposeComposition(version, instanceIds, size);
        patch({ size, instanceIds, composition: { ...draft.composition, tank: c.tank, healer: c.healer } });
    };

    const toggleInstance = (id: string) => {
        const next = draft.instanceIds.includes(id) ? draft.instanceIds.filter((x) => x !== id) : [...draft.instanceIds, id];
        const nextSizes = allowedSizes(version, next);
        const inst = version?.instances.find((i) => i.id === id);
        // An instance that does not come in the current size brings its own default.
        if (draft.size === null || (nextSizes.length && !nextSizes.includes(draft.size) && !freeSize)) {
            changeSize(inst && next.includes(id) ? inst.defaultSize : (nextSizes[0] || draft.size), next);
        } else {
            patch({ instanceIds: next });
        }
    };

    const changeVersion = (versionId: string) => {
        const v = versions.find((x) => x.id === versionId) || null;
        setFreeSize(false);
        // A hand-picked look is not tied to the version, so it survives the switch (#307).
        setDraft((d) => ({ ...newDraft(v), id: d.id, name: d.name, raidhelperTemplateId: d.raidhelperTemplateId, fairness: d.fairness, wishes: d.wishes, color: d.color, image: d.image, emojiStyle: d.emojiStyle }));
    };

    const toggleBuff = (key: string) => patch({
        requiredBuffs: draft.requiredBuffs.includes(key) ? draft.requiredBuffs.filter((b) => b !== key) : [...draft.requiredBuffs, key],
    });

    const save = async () => {
        setSaving(true);
        try {
            await saveRaidTemplate(draft);
            onSaved(template ? t("raidTemplates.toast.saved") : t("raidTemplates.toast.created"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!template) return;
        if (!(await ask({ title: t("raidTemplates.delete.title"), text: t("raidTemplates.delete.text", { name: template.name }), action: t("common.delete") }))) return;
        try {
            await deleteRaidTemplate(template.id);
            onSaved(t("raidTemplates.toast.deleted"));
        } catch (err) {
            // 409: a category uses it as its default — the message names it.
            toast((err as ApiError).message, "err");
        }
    };

    const moreCount = [draft.composition.melee, draft.composition.ranged, draft.signupDeadline, draft.durationMinutes].filter(Boolean).length
        + draft.requiredBuffs.length + (draft.fairness ? 1 : 0) + (draft.wishes ? 1 : 0)
        + (draft.overflow === "off" ? 1 : 0) + (draft.lockAtLimit ? 1 : 0) + (draft.raidhelperTemplateId ? 1 : 0)
        + (draft.color ? 1 : 0) + (draft.image && draft.image.url ? 1 : 0) + (emojiStyleOf(draft.emojiStyle) !== "arcane" ? 1 : 0);

    return (
        <Modal
            open
            onClose={onClose}
            icon={chosen[0]?.icon || NO_ICON}
            tone="raids"
            // Short names: "TBC · SSC + TK" — the full instance names sit in the chips' tooltips.
            kicker={[version?.short || draft.versionId, chosen.map((i) => i.short).join(" + ")].filter(Boolean).join(" · ")}
            title={draft.name.trim() || (template ? t("raidTemplates.noName") : t("raidTemplates.editor.newTitle"))}
            width={640}
            hint={template && canWrite ? <Button variant="danger" size="sm" onClick={remove}>{t("common.delete")}</Button> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    {canWrite && <Button running={saving} disabled={!!problem} onClick={save} data-tip={problem || undefined}>{t("common.save")}</Button>}
                </>
            )}
        >
            <div className="field">
                <label htmlFor="rt-name">{t("common.name")}</label>
                <input id="rt-name" type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t("raidTemplates.editor.namePlaceholder")} />
            </div>
            <div className="rt-field">
                <FieldLabel text={t("raidTemplates.version")} />
                <Segment size="sm" ariaLabel={t("raidTemplates.version")} value={draft.versionId} onChange={changeVersion}
                    options={versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))} />
            </div>
            <InstancePicker version={version} value={draft.instanceIds} onToggle={toggleInstance} />
            <SizePicker version={version} instanceIds={draft.instanceIds} size={draft.size} free={freeSize} onFree={setFreeSize} onSize={(size) => changeSize(size)}>
                {draft.size === null && <Badge tone="mid" icon={<WarnIcon />}>{t("raidTemplates.addSize")}</Badge>}
            </SizePicker>
            <CompositionEditor
                size={draft.size}
                value={{ tank: draft.composition.tank, healer: draft.composition.healer }}
                onChange={(c) => patch({ composition: { ...draft.composition, ...c } })}
            />
            <details className="rt-more">
                <summary>{t("raidTemplates.editor.more")}{moreCount ? <Badge count>{moreCount}</Badge> : null}</summary>
                <div className="rt-more-body">
                    <AppearanceFields idPrefix="rt" version={version} instanceIds={draft.instanceIds}
                        color={draft.color || ""} image={draft.image || { mode: "thumbnail", url: "" }} emojiStyle={emojiStyleOf(draft.emojiStyle)}
                        onChange={(look) => patch(look)} />
                    <RoleRanges idPrefix="rt" melee={draft.composition.melee} ranged={draft.composition.ranged}
                        onChange={(r) => patch({ composition: { ...draft.composition, ...r } })} />
                    <BuffPicker version={version} value={draft.requiredBuffs} onToggle={toggleBuff} />
                    <div className="rt-row2">
                        <NumberInput id="rt-deadline" label={t("raidTemplates.editor.deadline")} value={draft.signupDeadline ? draft.signupDeadline.hoursBefore : null}
                            onChange={(h) => patch({ signupDeadline: h === null ? null : { hoursBefore: h } })} placeholder={t("raidTemplates.editor.deadlinePlaceholder")} max={336} />
                        <NumberInput id="rt-duration" label={t("raidTemplates.editor.duration")} value={draft.durationMinutes}
                            onChange={(d) => patch({ durationMinutes: d })} placeholder="180" max={600} />
                        <div className="rt-num-field">
                            <label htmlFor="rt-rh">{t("raidTemplates.editor.raidHelperId")}</label>
                            <input id="rt-rh" type="text" className="inp-sm mono" value={draft.raidhelperTemplateId} placeholder={t("raidTemplates.editor.raidHelperIdPlaceholder")}
                                onChange={(e) => patch({ raidhelperTemplateId: e.target.value })} />
                        </div>
                    </div>
                    <div className="rt-switches">
                        <SwitchRow label={t("raidTemplates.editor.fairness")} tip={t("raidTemplates.editor.fairnessTip")} checked={draft.fairness} onChange={(fairness) => patch({ fairness })} />
                        <SwitchRow label={t("raidTemplates.editor.wishes")} tip={t("raidTemplates.editor.wishesTip")} checked={draft.wishes} onChange={(wishes) => patch({ wishes })} />
                        <SwitchRow label={t("raidTemplates.editor.overflow")} tip={t("raidTemplates.editor.overflowTip")} checked={draft.overflow !== "off"} onChange={(on) => patch({ overflow: on ? "bench" : "off" })} />
                        <SwitchRow label={t("raidTemplates.editor.lockAtLimit")} tip={t("raidTemplates.editor.lockAtLimitTip")} checked={!!draft.lockAtLimit} onChange={(lockAtLimit) => patch({ lockAtLimit })} />
                    </div>
                </div>
            </details>
            {/* An empty name on a fresh draft is not worth a red line — Speichern is simply off. */}
            {canWrite && problem && (draft.name.trim() || template) && <div className="rt-problem" role="alert">{problem}</div>}
        </Modal>
    );
}

// ---- page -----------------------------------------------------------------------

export default function RaidTemplatesPage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const editor = useCollectionEditor("edit");
    const toast = useToast();
    const canWrite = canAccess(user, "raids", "write");
    const loaded = useApi(() => Promise.all([getRaidTemplates(), getGameVersions()]).then(([templates, v]) => ({ templates, versions: v.versions })), []);
    const data = loaded.data?.templates ?? null;
    const versions = loaded.data?.versions ?? null;
    const [versionFilter, setVersionFilter] = usePersistedState("raid-templates-version", "");
    const [importing, setImporting] = useState(false);

    if (loaded.error) return <div className="empty">{tParts("raidTemplates.page.loadError", { message: loaded.error.message })}</div>;
    if (!data || !versions) return <RaidLoader text={t("raidTemplates.page.loading")} />;

    const shortOf = (id: string) => versions.find((v) => v.id === id)?.short || id;
    // A remembered filter for a version that has no template shows everything instead of nothing.
    const filter = versionFilter && versions.some((v) => v.id === versionFilter) ? versionFilter : "";
    const shown = filterByVersion(data.templates, filter);
    const entry = editor.editId ? data.templates.find((tpl) => tpl.id === editor.editId) || null : null;

    const afterChange = (msg: string) => {
        toast(msg);
        editor.close();
        loaded.reload();
    };

    const importFromRaidHelper = async () => {
        setImporting(true);
        try {
            const r = await importRaidTemplates();
            toast(t("raidTemplates.toast.imported", { added: r.added, updated: r.updated }));
            loaded.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setImporting(false);
        }
    };

    const iconsOf = (tpl: RaidTemplate) => instancesOf(versions.find((v) => v.id === tpl.versionId), tpl.instanceIds).map((i) => i.icon);

    return (
        <div className="rt-page">
            <PageHead
                icon="inv_misc_note_02"
                tone="raids"
                kicker={t("raidTemplates.page.kicker")}
                title={t("raidTemplates.page.title")}
                action={(
                    <>
                        <Segment size="sm" ariaLabel={t("raidTemplates.version")} value={filter} onChange={setVersionFilter}
                            options={[{ value: "", label: t("common.all") }, ...versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))]} />
                        {canWrite && (
                            <IconButton icon={<RefreshIcon />} tip={t("raidTemplates.page.import")} tipSub={t("raidTemplates.page.importSub")} disabled={importing} onClick={importFromRaidHelper} />
                        )}
                        {canWrite && <Button icon="inv_misc_note_05" onClick={editor.startNew}>{t("raidTemplates.page.new")}</Button>}
                    </>
                )}
            />

            <div className="rt-list">
                {shown.map((tpl) => (
                    <button key={tpl.id} type="button" className="rt-row" onClick={() => editor.startEdit(tpl.id)}>
                        <InstanceIcons icons={iconsOf(tpl)} />
                        <div className="rt-main">
                            <div className="rt-name">{tpl.name || t("raidTemplates.noName")}</div>
                            <div className="rt-sub">
                                <span className="rt-lbl">{templateLabel(tpl, shortOf(tpl.versionId), data.categoryNames)}</span>
                                {tpl.incomplete && <Badge tone="mid" icon={<WarnIcon />}>{t("raidTemplates.page.incomplete")}</Badge>}
                                {tpl.needsSize && <Badge tone="mid" icon={<WarnIcon />}>{t("raidTemplates.addSize")}</Badge>}
                            </div>
                        </div>
                        <div className="rt-vals">
                            <Value label={t("raidTemplates.page.size")} value={tpl.size} />
                            <Value label={t("raidTemplates.page.tanks")} value={tpl.needsSize ? null : tpl.composition.tank} />
                            <Value label={t("raidTemplates.page.healers")} value={tpl.needsSize ? null : tpl.composition.healer} />
                        </div>
                    </button>
                ))}
                {!shown.length && (
                    <div className="empty">
                        {data.templates.length ? t("raidTemplates.page.emptyVersion") : t("raidTemplates.page.empty")}
                    </div>
                )}
            </div>

            {editor.open && (
                <RaidTemplateModal
                    key={editor.open}
                    template={entry}
                    versions={versions}
                    canWrite={canWrite}
                    onSaved={afterChange}
                    onClose={editor.close}
                />
            )}
        </div>
    );
}
