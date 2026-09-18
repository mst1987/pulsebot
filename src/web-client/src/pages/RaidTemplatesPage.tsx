import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getRaidTemplates, getGameVersions, saveRaidTemplate, deleteRaidTemplate, importRaidTemplates, canAccess,
    type ApiError, type GameVersion, type RaidTemplate, type RaidTemplateInput, type RaidTemplatesData,
} from "../api";
import { useCollectionEditor } from "../lib/collectionEditor";
import { usePersistedState } from "../lib/persistedState";
import {
    allowedSizes, draftOf, filterByVersion, instancesOf, newDraft, proposeComposition, templateLabel, validateDraft,
} from "../lib/raidTemplates";
import { BuffPicker, FieldLabel, InstancePicker, NumberInput, RoleRanges, SizePicker, SwitchRow } from "../components/RaidPlanFields";
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
import { WarnIcon } from "../components/settingsUi";
import "../styles/raid-templates.css";

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

function RaidTemplateModal({ template, versions, canWrite, csrfToken, onSaved, onClose }: {
    template: RaidTemplate | null;
    versions: GameVersion[];
    canWrite: boolean;
    csrfToken: string | null;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
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
        setDraft((d) => ({ ...newDraft(v), id: d.id, name: d.name, raidhelperTemplateId: d.raidhelperTemplateId, fairness: d.fairness, wishes: d.wishes }));
    };

    const toggleBuff = (key: string) => patch({
        requiredBuffs: draft.requiredBuffs.includes(key) ? draft.requiredBuffs.filter((b) => b !== key) : [...draft.requiredBuffs, key],
    });

    const save = async () => {
        setSaving(true);
        try {
            await saveRaidTemplate(csrfToken, draft);
            onSaved(template ? "Vorlage gespeichert." : "Vorlage angelegt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!template) return;
        if (!(await ask({ title: "Vorlage löschen?", text: `„${template.name}“ wird gelöscht. In Raid-Helper bleibt eine verknüpfte Vorlage bestehen.`, action: "Löschen" }))) return;
        try {
            await deleteRaidTemplate(csrfToken, template.id);
            onSaved("Vorlage gelöscht.");
        } catch (err) {
            // 409: a category uses it as its default — the message names it.
            toast((err as ApiError).message, "err");
        }
    };

    const moreCount = [draft.composition.melee, draft.composition.ranged, draft.signupDeadline, draft.durationMinutes].filter(Boolean).length
        + draft.requiredBuffs.length + (draft.fairness ? 1 : 0) + (draft.wishes ? 1 : 0)
        + (draft.overflow === "off" ? 1 : 0) + (draft.lockAtLimit ? 1 : 0) + (draft.raidhelperTemplateId ? 1 : 0);

    return (
        <Modal
            open
            onClose={onClose}
            icon={chosen[0]?.icon || NO_ICON}
            tone="raids"
            // Short names: "TBC · SSC + TK" — the full instance names sit in the chips' tooltips.
            kicker={[version?.short || draft.versionId, chosen.map((i) => i.short).join(" + ")].filter(Boolean).join(" · ")}
            title={draft.name.trim() || (template ? "(ohne Name)" : "Neue Vorlage")}
            width={640}
            hint={template && canWrite ? <Button variant="danger" size="sm" onClick={remove}>Löschen</Button> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    {canWrite && <Button running={saving} disabled={!!problem} onClick={save} data-tip={problem || undefined}>Speichern</Button>}
                </>
            )}
        >
            <div className="field">
                <label htmlFor="rt-name">Name</label>
                <input id="rt-name" type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="z. B. SSC + TK 25er" />
            </div>
            <div className="rt-field">
                <FieldLabel text="Spielversion" />
                <Segment size="sm" ariaLabel="Spielversion" value={draft.versionId} onChange={changeVersion}
                    options={versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))} />
            </div>
            <InstancePicker version={version} value={draft.instanceIds} onToggle={toggleInstance} />
            <SizePicker version={version} instanceIds={draft.instanceIds} size={draft.size} free={freeSize} onFree={setFreeSize} onSize={(size) => changeSize(size)}>
                {draft.size === null && <Badge tone="mid" icon={<WarnIcon />}>Größe ergänzen</Badge>}
            </SizePicker>
            <CompositionEditor
                size={draft.size}
                value={{ tank: draft.composition.tank, healer: draft.composition.healer }}
                onChange={(c) => patch({ composition: { ...draft.composition, ...c } })}
            />
            <details className="rt-more">
                <summary>Mehr: Nahkampf/Fernkampf, Pflicht-Buffs, Anmeldeschluss, Dauer, Warteliste, Raid-Helper-Vorlage{moreCount ? <Badge count>{moreCount}</Badge> : null}</summary>
                <div className="rt-more-body">
                    <RoleRanges idPrefix="rt" melee={draft.composition.melee} ranged={draft.composition.ranged}
                        onChange={(r) => patch({ composition: { ...draft.composition, ...r } })} />
                    <BuffPicker version={version} value={draft.requiredBuffs} onToggle={toggleBuff} />
                    <div className="rt-row2">
                        <NumberInput id="rt-deadline" label="Anmeldeschluss (Stunden vor Start)" value={draft.signupDeadline ? draft.signupDeadline.hoursBefore : null}
                            onChange={(h) => patch({ signupDeadline: h === null ? null : { hoursBefore: h } })} placeholder="keiner" max={336} />
                        <NumberInput id="rt-duration" label="Dauer (Minuten)" value={draft.durationMinutes}
                            onChange={(d) => patch({ durationMinutes: d })} placeholder="180" max={600} />
                        <div className="rt-num-field">
                            <label htmlFor="rt-rh">Raid-Helper-Vorlage (ID)</label>
                            <input id="rt-rh" type="text" className="inp-sm mono" value={draft.raidhelperTemplateId} placeholder="z. B. 3"
                                onChange={(e) => patch({ raidhelperTemplateId: e.target.value })} />
                        </div>
                    </div>
                    <div className="rt-switches">
                        <SwitchRow label="Fairness" tip="Wer zuletzt auf der Bank saß, wird beim Setup-Vorschlag bevorzugt." checked={draft.fairness} onChange={(fairness) => patch({ fairness })} />
                        <SwitchRow label="Wünsche" tip="„Gerne zusammen raiden mit“ aus den Profilen fließt in den Setup-Vorschlag ein." checked={draft.wishes} onChange={(wishes) => patch({ wishes })} />
                        <SwitchRow label="Warteliste bei vollem Raid" tip="Ist der Raid voll, wird aus jeder neuen Anmeldung, die einen Platz belegt („Dabei“ und „Spät“), die Bank. Aus: die Anmeldung wird abgelehnt." checked={draft.overflow !== "off"} onChange={(on) => patch({ overflow: on ? "bench" : "off" })} />
                        <SwitchRow label="Anmeldung schließen, wenn voll" tip="Sobald die Plätze belegt sind, schließt die Anmeldung. Abmelden öffnet sie nicht wieder." checked={!!draft.lockAtLimit} onChange={(lockAtLimit) => patch({ lockAtLimit })} />
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
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const editor = useCollectionEditor("edit");
    const toast = useToast();
    const canWrite = canAccess(user, "raids", "write");
    const [data, setData] = useState<RaidTemplatesData | null>(null);
    const [versions, setVersions] = useState<GameVersion[] | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [versionFilter, setVersionFilter] = usePersistedState("raid-templates-version", "");
    const [importing, setImporting] = useState(false);

    const load = () => {
        Promise.all([getRaidTemplates(), getGameVersions()])
            .then(([t, v]) => { setData(t); setVersions(v.versions); })
            .catch((err: ApiError) => setError(err));
    };
    useEffect(load, []);

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data || !versions) return <RaidLoader text="Raid-Vorlagen werden geladen" />;

    const shortOf = (id: string) => versions.find((v) => v.id === id)?.short || id;
    // A remembered filter for a version that has no template shows everything instead of nothing.
    const filter = versionFilter && versions.some((v) => v.id === versionFilter) ? versionFilter : "";
    const shown = filterByVersion(data.templates, filter);
    const entry = editor.editId ? data.templates.find((t) => t.id === editor.editId) || null : null;

    const afterChange = (msg: string) => {
        toast(msg);
        editor.close();
        load();
    };

    const importFromRaidHelper = async () => {
        setImporting(true);
        try {
            const r = await importRaidTemplates(csrfToken);
            toast(`${r.added} neu, ${r.updated} schon vorhanden.`);
            load();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setImporting(false);
        }
    };

    const iconsOf = (t: RaidTemplate) => instancesOf(versions.find((v) => v.id === t.versionId), t.instanceIds).map((i) => i.icon);

    return (
        <div className="rt-page">
            <PageHead
                icon="inv_misc_note_02"
                tone="raids"
                kicker="Raid-Events"
                title="Raid-Vorlagen"
                action={(
                    <>
                        <Segment size="sm" ariaLabel="Spielversion" value={filter} onChange={setVersionFilter}
                            options={[{ value: "", label: "Alle" }, ...versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))]} />
                        {canWrite && (
                            <IconButton icon={<RefreshIcon />} tip="Aus Raid-Helper laden" tipSub="Übernimmt die Raid-Helper-Vorlagen der aktuellen Events als Vorlagen ohne Größe." disabled={importing} onClick={importFromRaidHelper} />
                        )}
                        {canWrite && <Button icon="inv_misc_note_05" onClick={editor.startNew}>Vorlage</Button>}
                    </>
                )}
            />

            <div className="rt-list">
                {shown.map((t) => (
                    <button key={t.id} type="button" className="rt-row" onClick={() => editor.startEdit(t.id)}>
                        <InstanceIcons icons={iconsOf(t)} />
                        <div className="rt-main">
                            <div className="rt-name">{t.name || "(ohne Name)"}</div>
                            <div className="rt-sub">
                                <span className="rt-lbl">{templateLabel(t, shortOf(t.versionId), data.categoryNames)}</span>
                                {t.incomplete && <Badge tone="mid" icon={<WarnIcon />}>Infos fehlen</Badge>}
                                {t.needsSize && <Badge tone="mid" icon={<WarnIcon />}>Größe ergänzen</Badge>}
                            </div>
                        </div>
                        <div className="rt-vals">
                            <Value label="Größe" value={t.size} />
                            <Value label="Tanks" value={t.needsSize ? null : t.composition.tank} />
                            <Value label="Heiler" value={t.needsSize ? null : t.composition.healer} />
                        </div>
                    </button>
                ))}
                {!shown.length && (
                    <div className="empty">
                        {data.templates.length ? "Keine Vorlage für diese Spielversion." : "Noch keine Raid-Vorlage."}
                    </div>
                )}
            </div>

            {editor.open && (
                <RaidTemplateModal
                    key={editor.open}
                    template={entry}
                    versions={versions}
                    canWrite={canWrite}
                    csrfToken={csrfToken}
                    onSaved={afterChange}
                    onClose={editor.close}
                />
            )}
        </div>
    );
}
