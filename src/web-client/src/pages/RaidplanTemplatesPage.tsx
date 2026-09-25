import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, RotateCw, Search, Settings2, Trash2 } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, createRaidplanTemplate, deleteRaidplanTemplate, duplicateRaidplanTemplate, getGameVersions, getRaidplanProfiles, getRaidplanTemplates, getSession,
    updateRaidplanTemplate,
    type ApiError, type GameVersion, type RaidplanBoard, type RaidplanProfile, type RaidplanTemplate, type SessionGuild,
} from "../api";
import { useCollectionEditor } from "../lib/collectionEditor";
import {
    boardOf, dirtyKeys, ensureBesetzung, rememberSection, rememberedSection, sameBosses, startSection, toSave,
} from "../lib/raidplan";
import type { ShellContext } from "../components/Shell";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Badge from "../components/ui/Badge";
import RaidLoader from "../components/ui/RaidLoader";
import WowIcon from "../components/ui/WowIcon";
import { InstancePicker, NumberInput, SizePicker } from "../components/RaidPlanFields";
import PlanBoard from "../components/raidplan/PlanBoard";
import { formatDate } from "../lib/format";
import type { BesetzungCounts } from "../api";
import { ROLE_ICON, bossIconOf, scopeOf, sectionMobs as sectionMobsOf } from "../lib/assign";
import { DEFAULTS_KEY, copyDefaultsToAll, differs } from "../lib/inherit";
import { besetzungFor } from "../lib/raidplan";
import { useT } from "../i18n";
import BoardWorkspace from "./raid-detail/raidplan/BoardWorkspace";
import { LibraryModal, ProfilesModal } from "./raid-detail/raidplan/ProfileModals";
import { SaveButton, UnsavedBar, useUnsavedGuard, type SaveStateKind } from "./raid-detail/raidplan/SaveState";
import { applyTactic, stepsOf } from "../lib/steps";
import BossNav from "./raid-detail/raidplan/BossNav";
import type { MapRow } from "./raid-detail/raidplan/MapPanel";
import { useDraftHistory } from "./raid-detail/raidplan/useDraftHistory";
import "../styles/raidplan.css";
import RaidplanBoundary from "../components/raidplan/RaidplanBoundary";

type Fields = { name: string; category: string; description: string; guildId: string; instanceIds: string[]; size: number; counts: BesetzungCounts | null };

const blankFields = (): Fields => ({ name: "", category: "", description: "", guildId: "", instanceIds: [], size: 0, counts: null });
const fieldsOf = (tpl: RaidplanTemplate): Fields => ({ name: tpl.name, category: tpl.category, description: tpl.description, guildId: tpl.guildId, instanceIds: tpl.instanceIds, size: tpl.size, counts: tpl.counts });

/**
 * Raid plan templates ("Raidplan-Vorlagen", docs/raidplan.md): a named layout the
 * orga makes once — "Montags-Raid" — and picks when an event's plan is made. A
 * template holds no players: per boss a board of placeholder slots (tank 1..n,
 * healer 1..n, dps, group n, free labels), raid marks, zones and target rows.
 * Applying it to an event copies it as a snapshot and fills the slots from the
 * event's approved setup; later changes here never reach an existing plan.
 *
 * List first, one editor at a time (docs/web-admin.md): `?edit=<id>` is the
 * editor of a template, `?edit=new` the dialog that makes one.
 */
export default function RaidplanTemplatesPage() {
    const t = useT();
    const { csrfToken, user } = useOutletContext<ShellContext>();
    const editor = useCollectionEditor("edit");
    const canWrite = canAccess(user, "raids", "write");
    const [templates, setTemplates] = useState<RaidplanTemplate[] | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [version, setVersion] = useState<GameVersion | null>(null);
    const [guilds, setGuilds] = useState<SessionGuild[]>([]);
    const [profiles, setProfiles] = useState<RaidplanProfile[]>([]);

    useEffect(() => {
        Promise.all([getRaidplanTemplates(), getGameVersions(), getRaidplanProfiles(), getSession()])
            .then(([tpls, versions, profs, session]) => {
                setTemplates(tpls.templates);
                setVersion(versions.versions.find((v) => v.id === versions.defaultVersion) || versions.versions[0] || null);
                setProfiles(profs.profiles);
                setGuilds(session.guilds);
            })
            .catch((err: ApiError) => setError(err));
    }, []);

    if (error) return <div className="empty">{t("planTemplates.loadError", { message: error.message })}</div>;
    if (!templates) return <RaidLoader text={t("planTemplates.loading")} />;

    const current = editor.editId ? templates.find((x) => x.id === editor.editId) || null : null;


    if (current) {
        return (
            <TemplateEditor
                key={current.id} template={current} csrfToken={csrfToken} canWrite={canWrite} version={version} guilds={guilds}
                profiles={profiles} onProfiles={setProfiles} onSaved={setTemplates} onBack={editor.close}
            />
        );
    }

    return (
        <TemplateList
            templates={templates} version={version} guilds={guilds} canWrite={canWrite} csrfToken={csrfToken}
            isNew={editor.isNew} onNew={editor.startNew} onCloseNew={editor.close} onOpen={editor.startEdit} onTemplates={setTemplates}
        />
    );
}

/** The instance's icon (as the raid list shows it) for a template, or "". */
function instanceIcon(version: GameVersion | null, id: string): string {
    const inst = version ? version.instances.find((i) => i.id === id) : null;
    return inst ? inst.icon : "";
}

const THUMB_W = 900;

/**
 * A small preview of a template: the first boss that has a board, drawn by the
 * board itself (the same PlanBoard as the editor, read-only) at 900 px and scaled
 * down to the card. A template without a filled boss shows its first boss' icon.
 */
function TemplateThumb({ tpl }: { tpl: RaidplanTemplate }) {
    const ref = useRef<HTMLDivElement>(null);
    const [k, setK] = useState(0.3);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const read = () => setK(el.clientWidth / THUMB_W);
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const boss = tpl.bossList.find((x) => !!tpl.bosses[x.key]) || null;
    const board = boss ? boardOf(tpl.bosses, boss.key) : null;
    return (
        <div className="rp-thumb" ref={ref} aria-hidden="true">
            {boss && board ? (
                <div className="rp-thumb-inner" style={{ width: THUMB_W, transform: `scale(${k})` }}>
                    <PlanBoard
                        bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} mapOpacity={board.mapOpacity} objectScale={board.objectScale}
                        tokens={[]} assignments={board.assignments} slots={board.slots} marks={board.marks} icons={board.icons} zones={board.zones} lines={board.lines} texts={board.texts}
                        players={new Map()} roster={[]}
                    />
                </div>
            ) : (
                <img className="rp-thumb-icon" src={tpl.bossList[0] ? tpl.bossList[0].iconUrl : ""} alt="" />
            )}
        </div>
    );
}

/** The overview: search and filters, then one card per template — newest change first. */
function TemplateList({ templates, version, guilds, canWrite, csrfToken, isNew, onNew, onCloseNew, onOpen, onTemplates }: {
    templates: RaidplanTemplate[];
    version: GameVersion | null;
    guilds: SessionGuild[];
    canWrite: boolean;
    csrfToken: string | null;
    isNew: boolean;
    onNew: () => void;
    onCloseNew: () => void;
    onOpen: (id: string) => void;
    onTemplates: (list: RaidplanTemplate[]) => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const [q, setQ] = useState("");
    const [inst, setInst] = useState("");
    const [cat, setCat] = useState("");
    const [renaming, setRenaming] = useState<RaidplanTemplate | null>(null);

    const instances = useMemo(() => [...new Set(templates.flatMap((x) => x.instanceIds))], [templates]);
    const categories = useMemo(() => [...new Set(templates.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [templates]);
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return templates
            .filter((x) => (!inst || x.instanceIds.includes(inst)) && (!cat || x.category === cat)
                && (!needle || `${x.name} ${x.category} ${x.description}`.toLowerCase().includes(needle)))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }, [templates, q, inst, cat]);

    const remove = async (tpl: RaidplanTemplate) => {
        if (!(await ask({ title: t("planTemplates.deleteTitle", { name: tpl.name }), text: t("planTemplates.deleteText"), action: t("raidBoard.profile.delete"), tone: "danger" }))) return;
        try {
            const r = await deleteRaidplanTemplate(csrfToken, tpl.id);
            onTemplates(r.templates);
            toast(t("planTemplates.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };
    const duplicate = async (tpl: RaidplanTemplate) => {
        try {
            const r = await duplicateRaidplanTemplate(csrfToken, tpl.id);
            onTemplates(r.templates);
            toast(t("planTemplates.duplicated", { name: r.template ? r.template.name : tpl.name }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <div className="rp-templates">
            <p className="note"><Link className="mlink" to="/raids">{t("planTemplates.back")}</Link></p>
            <PageHead
                icon="inv_misc_map02" tone="raids" kicker={t("planTemplates.kicker")} title={t("planTemplates.title")}
                meta={<Badge count>{templates.length}</Badge>}
                action={canWrite ? <Button onClick={onNew}>{t("planTemplates.new")}</Button> : undefined}
            />
            <p className="rp-muted">{t("planTemplates.intro")}</p>

            {templates.length === 0 ? (
                <div className="rp-empty">
                    <WowIcon name="inv_misc_map02" size={40} />
                    <strong>{t("planTemplates.emptyTitle")}</strong>
                    <p className="rp-muted">{t("planTemplates.empty")}</p>
                    {canWrite && <Button onClick={onNew}>{t("planTemplates.new")}</Button>}
                </div>
            ) : (
                <>
                    <div className="rp-tfilters">
                        <label className="rp-tsearch">
                            <Search size={15} aria-hidden="true" />
                            <input value={q} placeholder={t("planTemplates.search")} aria-label={t("planTemplates.search")} onChange={(e) => setQ(e.target.value)} />
                        </label>
                        {instances.length > 1 && (
                            <select value={inst} aria-label={t("planTemplates.filterInstance")} onChange={(e) => setInst(e.target.value)}>
                                <option value="">{t("planTemplates.allInstances")}</option>
                                {instances.map((id) => {
                                    const i = version ? version.instances.find((x) => x.id === id) : null;
                                    return <option key={id} value={id}>{i ? i.name : id}</option>;
                                })}
                            </select>
                        )}
                        {categories.length > 0 && (
                            <select value={cat} aria-label={t("planTemplates.filterCategory")} onChange={(e) => setCat(e.target.value)}>
                                <option value="">{t("planTemplates.allCategories")}</option>
                                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                    </div>
                    {shown.length === 0 && <p className="rp-muted">{t("planTemplates.noMatch")}</p>}
                    <ul className="rp-tlist">
                        {shown.map((tpl) => {
                            const guild = guilds.find((g) => g.id === tpl.guildId);
                            const filled = tpl.bossList.filter((b) => !!tpl.bosses[b.key]).length;
                            return (
                                <li key={tpl.id} className="rp-tcard">
                                    <Link className="rp-tcard-body" to={`?edit=${tpl.id}`} onClick={(e) => { e.preventDefault(); onOpen(tpl.id); }}>
                                        <TemplateThumb tpl={tpl} />
                                        <div className="rp-tcard-info">
                                            <div className="rp-tcard-title">
                                                {tpl.instanceIds.slice(0, 1).map((id) => <WowIcon key={id} name={instanceIcon(version, id) || "inv_misc_map02"} size={34} />)}
                                                <strong className="rp-tcard-name">{tpl.name}</strong>
                                            </div>
                                            <div className="rp-tchips">
                                                {tpl.category && <Badge>{tpl.category}</Badge>}
                                                {tpl.guildId && <Badge tone="accent">{guild ? guild.name : t("planTemplates.otherServer")}</Badge>}
                                                {tpl.instanceIds.map((id) => {
                                                    const i = version ? version.instances.find((x) => x.id === id) : null;
                                                    return <Badge key={id}>{i ? i.short : id}</Badge>;
                                                })}
                                            </div>
                                            <div className="rp-tcounts" aria-label={t("planTemplates.besetzung")}>
                                                <span className="rp-tsize" data-tip={t("planTemplates.besetzungHint", { groups: tpl.besetzung.groups })}>{tpl.besetzung.size}</span>
                                                {["tank", "healer", "dps", ...(tpl.besetzung.split ? ["melee", "ranged"] : [])].map((kind) => (
                                                    <span key={kind} className="rp-tcount" data-tip={t(`raidBoard.slot.kind.${kind}`)}>
                                                        <WowIcon name={ROLE_ICON[kind]} size={16} />{tpl.besetzung.counts[kind as keyof BesetzungCounts]}
                                                    </span>
                                                ))}
                                            </div>
                                            {tpl.description && <span className="rp-muted rp-tdesc">{tpl.description}</span>}
                                            <div className="rp-tprogress" role="img" aria-label={t("planTemplates.bossesFilled", { count: filled })} data-tip={`${t("planTemplates.bossesFilled", { count: filled })} / ${tpl.bossList.length}`}>
                                                {tpl.bossList.map((b) => <span key={b.key} className={tpl.bosses[b.key] ? "on" : ""} />)}
                                            </div>
                                            <span className="rp-muted rp-tmeta">{t("planTemplates.bossesFilled", { count: filled })} · {t("planTemplates.updated", { date: formatDate(tpl.updatedAt) })}</span>
                                        </div>
                                    </Link>
                                    {canWrite && (
                                        <div className="rp-tcard-actions">
                                            <IconButton size="sm" icon={<Settings2 size={16} />} tip={t("planTemplates.rename")} onClick={() => setRenaming(tpl)} />
                                            <IconButton size="sm" icon={<Copy size={16} />} tip={t("planTemplates.duplicate")} onClick={() => duplicate(tpl)} />
                                            <IconButton size="sm" tone="danger" icon={<Trash2 size={16} />} tip={t("planTemplates.delete")} onClick={() => remove(tpl)} />
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {isNew && (
                <FieldsModal
                    title={t("planTemplates.newTitle")} initial={blankFields()} version={version} guilds={guilds}
                    onClose={onCloseNew}
                    onSave={async (fields) => {
                        try {
                            const r = await createRaidplanTemplate(csrfToken, fields);
                            onTemplates(r.templates);
                            toast(t("planTemplates.created", { name: fields.name }));
                            if (r.template) onOpen(r.template.id);
                        } catch (err) {
                            toast((err as ApiError).message, "err");
                        }
                    }}
                />
            )}
            {renaming && (
                <FieldsModal
                    title={t("planTemplates.rename")} initial={fieldsOf(renaming)} version={version} guilds={guilds}
                    onClose={() => setRenaming(null)}
                    onSave={async (fields) => {
                        try {
                            const r = await updateRaidplanTemplate(csrfToken, renaming.id, fields);
                            onTemplates(r.templates);
                            setRenaming(null);
                        } catch (err) {
                            toast((err as ApiError).message, "err");
                        }
                    }}
                />
            )}
        </div>
    );
}

/** Name, category, description, server and instances of a template — creating one and editing its details. */
function FieldsModal({ title, initial, version, guilds, onClose, onSave }: {
    title: string;
    initial: Fields;
    version: GameVersion | null;
    guilds: SessionGuild[];
    onClose: () => void;
    onSave: (fields: Fields) => void | Promise<void>;
}) {
    const t = useT();
    const [f, setF] = useState<Fields>(initial);
    const [busy, setBusy] = useState(false);
    const [freeSize, setFreeSize] = useState(false);
    // the raid type (instances + size) decides the Besetzung; the counts stay editable
    const chosen = (version ? version.instances : []).filter((i) => f.instanceIds.includes(i.id));
    const derived = besetzungFor(chosen, f.size);
    const [showSplit, setShowSplit] = useState(false);
    const counts = f.counts || derived.counts;
    const split = showSplit || counts.melee > 0 || counts.ranged > 0;
    // tanks and healers are set, the DPS is what is left of the size
    const setCounts = (patch: Partial<BesetzungCounts>) => {
        const next = { ...counts, ...patch };
        setF({ ...f, counts: { ...next, dps: Math.max(next.melee + next.ranged, derived.size - next.tank - next.healer) } });
    };
    const toggle = (id: string) => setF((cur) => ({ ...cur, counts: null, instanceIds: cur.instanceIds.includes(id) ? cur.instanceIds.filter((x) => x !== id) : [...cur.instanceIds, id] }));
    const ok = !!f.name.trim() && f.instanceIds.length > 0;
    return (
        <Modal
            open onClose={onClose} icon="inv_misc_map02" title={title} width={560}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("raidBoard.profile.cancel")}</Button>
                    <Button disabled={!ok} running={busy} onClick={async () => { setBusy(true); try { await onSave({ ...f, name: f.name.trim() }); } finally { setBusy(false); } }}>{t("raidBoard.profile.save")}</Button>
                </>
            )}
        >
            <div className="rp-form">
                <label>
                    <span className="rp-kicker">{t("raidBoard.profile.name")}</span>
                    <input className="rp-form-name" value={f.name} maxLength={40} placeholder={t("planTemplates.namePlaceholder")} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </label>
                <label>
                    <span className="rp-kicker">{t("raidBoard.profile.category")}</span>
                    <input value={f.category} maxLength={30} onChange={(e) => setF({ ...f, category: e.target.value })} />
                </label>
                <label>
                    <span className="rp-kicker">{t("planTemplates.description")}</span>
                    <textarea value={f.description} rows={2} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
                </label>
                <label>
                    <span className="rp-kicker">{t("planTemplates.server")}</span>
                    <select value={f.guildId} onChange={(e) => setF({ ...f, guildId: e.target.value })}>
                        <option value="">{t("planTemplates.allServers")}</option>
                        {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        {f.guildId && !guilds.some((g) => g.id === f.guildId) && <option value={f.guildId}>{t("planTemplates.otherServer")}</option>}
                    </select>
                    <span className="rp-muted">{t("planTemplates.serverHint")}</span>
                </label>
                <InstancePicker version={version} value={f.instanceIds} onToggle={toggle} />
                <SizePicker version={version} instanceIds={f.instanceIds} size={f.size || derived.size} free={freeSize} onFree={setFreeSize} onSize={(n) => setF({ ...f, size: n || 0, counts: null })} />
                <div className="rt-field">
                    <span className="rp-kicker">{t("planTemplates.besetzung")} · {derived.size}</span>
                    <div className="rp-bes-fields">
                        <span className="rp-bes-field">
                            <WowIcon name={ROLE_ICON.tank} size={22} />
                            <NumberInput id="bes-tank" label={t("raidBoard.slot.kind.tank")} value={counts.tank} onChange={(v) => setCounts({ tank: v || 0 })} />
                        </span>
                        <span className="rp-bes-field">
                            <WowIcon name={ROLE_ICON.healer} size={22} />
                            <NumberInput id="bes-healer" label={t("raidBoard.slot.kind.healer")} value={counts.healer} onChange={(v) => setCounts({ healer: v || 0 })} />
                        </span>
                        <span className="rp-bes-field rp-bes-dps">
                            <WowIcon name={ROLE_ICON.dps} size={22} />
                            <span className="rp-bes-dpsval" data-tip={t("planTemplates.dpsHint")}><span className="rp-kicker">{t("raidBoard.bes.dpsTotal")}</span><strong>{counts.dps}</strong></span>
                        </span>
                    </div>
                    <label className="rp-check">
                        <input type="checkbox" checked={split} onChange={(e) => { setShowSplit(e.target.checked); if (!e.target.checked) setF({ ...f, counts: { ...counts, melee: 0, ranged: 0 } }); }} /> {t("planTemplates.splitDps")}
                    </label>
                    {split && (
                        <div className="rp-bes-fields">
                            <span className="rp-bes-field"><WowIcon name={ROLE_ICON.melee} size={22} /><NumberInput id="bes-melee" label={t("raidBoard.slot.kind.melee")} value={counts.melee} onChange={(v) => setCounts({ melee: Math.min(v || 0, counts.dps - counts.ranged) })} /></span>
                            <span className="rp-bes-field"><WowIcon name={ROLE_ICON.ranged} size={22} /><NumberInput id="bes-ranged" label={t("raidBoard.slot.kind.ranged")} value={counts.ranged} onChange={(v) => setCounts({ ranged: Math.min(v || 0, counts.dps - counts.melee) })} /></span>
                            <span className="rp-muted">{t("planTemplates.splitRest", { n: Math.max(0, counts.dps - counts.melee - counts.ranged) })}</span>
                        </div>
                    )}
                    <span className="rp-muted">{t("planTemplates.besetzungHint", { groups: derived.groups })}</span>
                </div>
            </div>
        </Modal>
    );
}

/** The editor of one template: the shared board workspace (sticky tool bar, boss chips, palette, board, properties / background / layers panel). */
function TemplateEditor({ template, csrfToken, canWrite, version, guilds, profiles, onProfiles, onSaved, onBack }: {
    template: RaidplanTemplate;
    csrfToken: string | null;
    canWrite: boolean;
    version: GameVersion | null;
    guilds: SessionGuild[];
    profiles: RaidplanProfile[];
    onProfiles: (p: RaidplanProfile[]) => void;
    onSaved: (list: RaidplanTemplate[]) => void;
    onBack: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const [tpl, setTpl] = useState(template);
    const { draft, edit: histEdit, editAll: histEditAll, reset, undo, redo, canUndo, canRedo } = useDraftHistory();
    // "Allgemein" first (or the section last open in this template, or a deep link)
    const [selected, setSelected] = useState(() => startSection(template.bossList, new URLSearchParams(window.location.search).get("section") || "", rememberedSection(`t:${template.id}`), []));
    useEffect(() => { if (selected) rememberSection(`t:${template.id}`, selected); }, [template.id, selected]);
    const [modal, setModal] = useState<"" | "fields" | "pick" | "profiles" | "save">("");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    useEffect(() => { reset(template.bosses); }, [reset, template.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const bossKeys = useMemo(() => tpl.bossList.map((b) => b.key), [tpl]);
    const boss = tpl.bossList.find((b) => b.key === selected) || null;
    const besetzung = tpl.besetzung;
    const board = useMemo(() => ensureBesetzung(boardOf(draft, selected), besetzung, []), [draft, selected, besetzung]);
    const dirty = !sameBosses(draft, tpl.bosses, bossKeys);
    const editAllBoards = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        histEditAll(template.bossList.filter((b) => !b.general && !b.defaults).map((b) => b.key), fn, coalesce);
    }, [histEditAll, template.bossList]);
    const edit = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        histEdit(selectedRef.current, (b) => fn(ensureBesetzung(b, besetzung, [])), coalesce);
    }, [histEdit, besetzung]);
    /** "Standard auf alle Bosse anwenden (kopieren)": the Standard's rows become the own rows of every boss that does not differ (one undo step). */
    const copyDefaults = async () => {
        const rows = boardOf(draft, DEFAULTS_KEY).assignments;
        if (rows.length === 0) { toast(t("raidBoard.defaults.copyEmpty")); return; }
        if (!(await ask({ title: t("raidBoard.defaults.copyTitle"), text: t("raidBoard.defaults.copyText", { count: rows.length }), action: t("raidBoard.defaults.copy") }))) return;
        let n = 0;
        for (const b of tpl.bossList) {
            if (b.general || b.defaults) continue;
            const cur = boardOf(draft, b.key);
            if (differs(cur)) continue;
            const scope = scopeOf(b);
            const mobs = sectionMobsOf(scope, b.key, b.name, bossIconOf(b.iconUrl), b.instanceId, cur, tpl.catalog);
            const section = { bossMob: scope === "boss" ? mobs.find((m) => m.id.indexOf("b:") === 0) || null : null, mobs };
            histEdit(b.key, (x) => copyDefaultsToAll({ [b.key]: x }, rows, { [b.key]: section })[b.key] as RaidplanBoard, true);
            n += 1;
        }
        toast(t("raidBoard.defaults.copied", { count: n }));
    };
    const categories = useMemo(() => [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [profiles]);
    const profile = profiles.find((p) => p.id === board.profileId) || null;

    /** A change that comes back as the fresh template (fields, maps): keep the unsaved draft unless told otherwise. */
    const adopt = (r: { templates: RaidplanTemplate[]; template?: RaidplanTemplate }, keepDraft: boolean) => {
        onSaved(r.templates);
        if (r.template) {
            setTpl(r.template);
            if (!keepDraft) reset(r.template.bosses);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const r = await updateRaidplanTemplate(csrfToken, tpl.id, { bosses: toSave(draft, bossKeys), version: tpl.version });
            adopt(r, false);
            setConflict(false);
            toast(r.dropped ? t("raidBoard.bar.savedDropped", { count: r.dropped }) : t("planTemplates.saved"));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
        } finally {
            setSaving(false);
        }
    };

    // unsaved changes stand out: glowing tool bar and save button, a strip, marked boss chips, "● " in the tab title, Ctrl+S, a warning on leaving
    const saveState: SaveStateKind = conflict ? "conflict" : dirty ? "dirty" : "clean";
    const savedFlash = useUnsavedGuard(canWrite ? saveState : "clean", saving, () => { save(); });
    const unsavedKeys = useMemo(() => (dirty ? dirtyKeys(draft, tpl.bosses, bossKeys) : []), [dirty, draft, tpl.bosses, bossKeys]);

    const reload = async () => {
        const r = await getRaidplanTemplates();
        onSaved(r.templates);
        const fresh = r.templates.find((x) => x.id === tpl.id);
        if (fresh) { setTpl(fresh); reset(fresh.bosses); setConflict(false); }
    };

    const reloadMaps = async () => {
        const r = await getRaidplanTemplates();
        onSaved(r.templates);
        const fresh = r.templates.find((x) => x.id === tpl.id);
        if (fresh) setTpl((cur) => ({ ...cur, bossList: fresh.bossList }));
    };

    const remove = async () => {
        if (!(await ask({ title: t("planTemplates.deleteTitle", { name: tpl.name }), text: t("planTemplates.deleteText"), action: t("raidBoard.profile.delete"), tone: "danger" }))) return;
        try {
            const r = await deleteRaidplanTemplate(csrfToken, tpl.id);
            onSaved(r.templates);
            toast(t("planTemplates.deleted"));
            onBack();
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // a library tactic ADDS its steps under the section's (nothing is replaced, so nothing to ask)
    const pickProfile = (p: RaidplanProfile) => {
        edit((b) => applyTactic(b, p));
        setModal("");
        toast(t("raidBoard.steps.library.applied", { name: p.name, n: (p.steps || []).length }));
    };

    const mapRows: MapRow[] = boss ? [
        { key: `t/${tpl.id}/${boss.key}`, label: t("planTemplates.mapForTemplate"), has: !!boss.templateMap, override: true },
        { key: boss.key, label: `${t("raidBoard.board.mapForBoss")}: ${boss.name}`, has: boss.ownMap, override: false },
        { key: boss.instanceId, label: `${t("raidBoard.board.mapForInstance")}: ${boss.instanceName}`, has: boss.instanceMap, override: false },
    ] : [];
    const limits = { targetsPerBoss: 30, title: 80, notes: 1000, profileName: 40, profileCategory: 30 };

    return (
        <div className="rp-editor" data-rp-editor>
            <p className="note"><button type="button" className="mlink rp-linkbtn" onClick={onBack}>{t("planTemplates.backToList")}</button></p>
            <PageHead
                icon="inv_misc_map02" tone="raids" kicker={t("planTemplates.kicker")} title={tpl.name}
                meta={<>{tpl.category && <Badge>{tpl.category}</Badge>}{!canWrite && <Badge>{t("raidBoard.bar.readOnly")}</Badge>}</>}
            />
            {conflict && (
                <div className="flash flash-err rp-conflict">
                    <span>{t("planTemplates.conflict")}</span>
                    <IconButton size="sm" icon={<RotateCw size={16} />} tip={t("raidBoard.conflict.reload")} onClick={reload} />
                </div>
            )}
            <p className="rp-muted">{t("planTemplates.editorHint")}</p>

            {boss && (
                <RaidplanBoundary resetKey={selected}>
                <BoardWorkspace
                    mode="template" eventId="" besetzung={tpl.besetzung} catalog={tpl.catalog} boss={boss} allBosses={tpl.bossList} board={board} edit={edit} editAll={editAllBoards} roster={[]} canWrite={canWrite} limits={limits}
                    profileName={profile ? profile.name : ""} onPickProfile={() => setModal("pick")} onSaveTactic={() => setModal("save")}
                    history={{ undo, redo, canUndo, canRedo }}
                    csrfToken={csrfToken} mapRows={mapRows} onMapsChanged={reloadMaps}
                    defaultRows={boardOf(draft, DEFAULTS_KEY).assignments} onCopyDefaults={copyDefaults}
                    bossNav={<BossNav dirtyKeys={unsavedKeys} bosses={tpl.bossList} selected={selected} draft={draft} onSelect={setSelected} onSheet={canWrite ? (k, on) => histEdit(k, (b) => ({ ...b, inSheet: on })) : undefined} />}
                    saveState={canWrite ? saveState : "clean"} notice={canWrite ? <UnsavedBar state={saveState} sections={unsavedKeys.length} busy={saving} onSave={save} conflictText={t("planTemplates.conflict")} /> : undefined}
                    actions={canWrite ? (
                        <>
                            <IconButton size="sm" icon={<Settings2 size={17} />} tip={t("planTemplates.details")} onClick={() => setModal("fields")} />
                            <IconButton size="sm" tone="danger" icon={<Trash2 size={17} />} tip={t("raidBoard.profile.delete")} onClick={remove} />
                            <SaveButton state={saveState} busy={saving} flash={savedFlash} onSave={save} />
                        </>
                    ) : undefined}
                />
                </RaidplanBoundary>
            )}

            {modal === "fields" && (
                <FieldsModal
                    title={t("planTemplates.details")} initial={fieldsOf(tpl)} version={version} guilds={guilds} onClose={() => setModal("")}
                    onSave={async (fields) => {
                        try {
                            const r = await updateRaidplanTemplate(csrfToken, tpl.id, fields);
                            adopt(r, true);
                            setModal("");
                        } catch (err) {
                            toast((err as ApiError).message, "err");
                        }
                    }}
                />
            )}
            <LibraryModal
                open={modal === "pick"} onClose={() => setModal("")} profiles={profiles} bosses={tpl.bossList} bossKey={selected} bossName={(tpl.bossList.find((b) => b.key === selected) || { name: "" }).name}
                onPick={pickProfile} canSave={stepsOf(board).length > 0}
                onSaveAs={() => setModal("save")}
                onManage={() => setModal("profiles")}
            />
            <ProfilesModal
                open={modal === "profiles" || modal === "save"} onClose={() => setModal("")} csrfToken={csrfToken}
                profiles={profiles} categories={categories} bosses={tpl.bossList} bossKey={selected}
                draft={modal === "save" ? board : null} limits={limits}
                onChanged={(list, saved) => {
                    onProfiles(list);
                    if (saved && modal === "save") edit((b) => ({ ...b, profileId: saved.id }));
                }}
            />
        </div>
    );
}
