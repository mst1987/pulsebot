import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getRaidTemplates, getGameVersions, saveRaidTemplate, deleteRaidTemplate, importRaidTemplates, canAccess,
    type ApiError, type GameVersion, type RaidTemplate, type RaidTemplateInput, type RaidTemplatesData, type RoleRange,
} from "../api";
import { useCollectionEditor } from "../lib/collectionEditor";
import { usePersistedState } from "../lib/persistedState";
import {
    allowedSizes, draftOf, filterByVersion, instancesOf, newDraft, proposeComposition, templateLabel, validateDraft,
} from "../lib/raidTemplates";
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
// editor lives in the url (?edit=<id|new>) like every collection editor.

const NO_ICON = "inv_misc_note_01";
const FREE = "free";

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

function NumberField({ id, label, value, onChange, placeholder }: {
    id: string;
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    placeholder?: string;
}) {
    return (
        <div className="rt-num-field">
            <label htmlFor={id}>{label}</label>
            <input id={id} type="number" min={0} max={40} value={value === null ? "" : value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
    );
}

function RangeField({ label, idPrefix, value, onChange }: {
    label: string;
    idPrefix: string;
    value: RoleRange | null;
    onChange: (value: RoleRange | null) => void;
}) {
    const set = (min: number | null, max: number | null) => onChange(min === null && max === null ? null : { min: min || 0, max });
    return (
        <div className="rt-range">
            <span className="rt-range-lbl">{label}</span>
            <NumberField id={`${idPrefix}-min`} label="min" value={value ? value.min : null} onChange={(min) => set(min, value ? value.max : null)} placeholder="–" />
            <NumberField id={`${idPrefix}-max`} label="max" value={value ? value.max : null} onChange={(max) => set(value ? value.min : null, max)} placeholder="–" />
        </div>
    );
}

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
    const sizes = allowedSizes(version, draft.instanceIds);
    const sizeIsFree = freeSize || (draft.size !== null && !sizes.includes(draft.size));
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

    const buffs = version ? [...version.raidBuffs, ...version.partyBuffs] : [];
    const moreCount = [draft.composition.melee, draft.composition.ranged, draft.signupDeadline].filter(Boolean).length
        + draft.requiredBuffs.length + (draft.fairness ? 1 : 0) + (draft.wishes ? 1 : 0) + (draft.raidhelperTemplateId ? 1 : 0);

    return (
        <Modal
            open
            onClose={onClose}
            icon={chosen[0]?.icon || NO_ICON}
            tone="raids"
            kicker={[version?.short || draft.versionId, chosen.map((i) => i.name).join(" + ")].filter(Boolean).join(" · ")}
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
                <span className="rt-flabel">Spielversion</span>
                <Segment size="sm" ariaLabel="Spielversion" value={draft.versionId} onChange={changeVersion}
                    options={versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))} />
            </div>
            <div className="rt-field">
                <span className="rt-flabel">Instanzen</span>
                <div className="rt-insts" role="group" aria-label="Instanzen">
                    {(version?.instances || []).map((inst) => {
                        const on = draft.instanceIds.includes(inst.id);
                        return (
                            <button key={inst.id} type="button" className={`rt-inst${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleInstance(inst.id)}
                                data-tip={inst.name} data-tip-sub={inst.status === "incomplete" ? "Infos fehlen: Bosse und Endboss sind noch nicht bekannt." : `${inst.sizes.join("/")} Spieler`}>
                                <WowIcon name={inst.icon} size={20} />{inst.short}
                                {inst.status === "incomplete" && <WarnIcon />}
                            </button>
                        );
                    })}
                </div>
                {chosen.some((i) => i.status === "incomplete") && <Badge tone="mid" icon={<WarnIcon />}>Infos fehlen</Badge>}
            </div>
            <div className="rt-field">
                <span className="rt-flabel">Größe</span>
                <div className="rt-sizes">
                    <Segment
                        size="sm"
                        ariaLabel="Größe"
                        value={draft.size === null ? "" : (sizeIsFree ? FREE : String(draft.size))}
                        onChange={(v) => {
                            if (v === FREE) { setFreeSize(true); return; }
                            setFreeSize(false);
                            changeSize(Number(v));
                        }}
                        options={[...sizes.map((s) => ({ value: String(s), label: String(s) })), { value: FREE, label: "frei" }]}
                    />
                    {sizeIsFree && (
                        <input className="rt-size-input" type="number" min={1} max={40} aria-label="Freie Größe" value={draft.size === null ? "" : draft.size}
                            onChange={(e) => changeSize(e.target.value === "" ? null : Math.floor(Number(e.target.value) || 0))} />
                    )}
                    {draft.size === null && <Badge tone="mid" icon={<WarnIcon />}>Größe ergänzen</Badge>}
                </div>
            </div>
            <CompositionEditor
                size={draft.size}
                value={{ tank: draft.composition.tank, healer: draft.composition.healer }}
                onChange={(c) => patch({ composition: { ...draft.composition, ...c } })}
            />
            <details className="rt-more">
                <summary>Mehr: Nahkampf/Fernkampf, Pflicht-Buffs, Anmeldeschluss, Raid-Helper-Vorlage{moreCount ? <Badge count>{moreCount}</Badge> : null}</summary>
                <div className="rt-more-body">
                    <div className="rt-ranges">
                        <RangeField label="Nahkampf" idPrefix="rt-melee" value={draft.composition.melee}
                            onChange={(melee) => patch({ composition: { ...draft.composition, melee } })} />
                        <RangeField label="Fernkampf" idPrefix="rt-ranged" value={draft.composition.ranged}
                            onChange={(ranged) => patch({ composition: { ...draft.composition, ranged } })} />
                    </div>
                    <div className="rt-field">
                        <span className="rt-flabel" data-tip="Pflicht-Buffs" data-tip-sub="Buffs, die der Raid dabeihaben soll — die Aufstellung warnt, wenn keiner sie mitbringt.">Pflicht-Buffs</span>
                        <div className="rt-buffs">
                            {buffs.map((b) => {
                                const on = draft.requiredBuffs.includes(b.key);
                                return (
                                    <button key={`${b.scope}-${b.key}`} type="button" className={`rt-buff${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleBuff(b.key)}
                                        data-tip={b.label} data-tip-sub={b.scope === "party" ? "Gruppen-Buff" : "Raid-Buff"}>
                                        <WowIcon name={b.icon} size={24} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="rt-row2">
                        <NumberField id="rt-deadline" label="Anmeldeschluss (Stunden vor Start)" value={draft.signupDeadline ? draft.signupDeadline.hoursBefore : null}
                            onChange={(h) => patch({ signupDeadline: h === null ? null : { hoursBefore: h } })} placeholder="keiner" />
                        <div className="rt-num-field">
                            <label htmlFor="rt-rh">Raid-Helper-Vorlage (ID)</label>
                            <input id="rt-rh" type="text" className="mono" value={draft.raidhelperTemplateId} placeholder="z. B. 3"
                                onChange={(e) => patch({ raidhelperTemplateId: e.target.value })} />
                        </div>
                    </div>
                    <div className="rt-switches">
                        <label className="switch-row" data-tip="Fairness" data-tip-sub="Wer zuletzt auf der Bank saß, wird bei der Aufstellung bevorzugt.">
                            <span className="switch">
                                <input type="checkbox" checked={draft.fairness} onChange={(e) => patch({ fairness: e.target.checked })} />
                                <span className="switch-track"><span className="switch-thumb" /></span>
                            </span>
                            Fairness
                        </label>
                        <label className="switch-row" data-tip="Wünsche" data-tip-sub="Raider können bei der Anmeldung Wunsch-Rolle und Charakter angeben.">
                            <span className="switch">
                                <input type="checkbox" checked={draft.wishes} onChange={(e) => patch({ wishes: e.target.checked })} />
                                <span className="switch-track"><span className="switch-thumb" /></span>
                            </span>
                            Wünsche
                        </label>
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
