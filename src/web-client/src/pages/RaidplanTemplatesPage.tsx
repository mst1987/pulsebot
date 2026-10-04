import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Copy, RotateCw, Search, Settings2, Trash2 } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, createRaidplanTemplate, deleteRaidplanTemplate, duplicateRaidplanTemplate, getGameVersions, getRaidplanProfiles, getRaidplanTemplates, getSession,
    updateRaidplanTemplate,
    type ApiError, type GameVersion, type RaidplanBoard, type RaidplanProfile, type RaidplanTemplate, type SessionGuild,
} from "../api";
import { useApi } from "../hooks/useApi";
import { useCollectionEditor } from "../lib/collectionEditor";
import {
    boardOf, dirtyKeys, ensureBesetzung, rememberSection, rememberedSection, sameBosses, startSection, toSave,
} from "../lib/raidplan";
import type { ShellContext } from "../components/Shell";
import { MenuRailPage } from "../components/SectionRail";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Badge from "../components/ui/Badge";
import RaidLoader from "../components/ui/RaidLoader";
import WowIcon from "../components/ui/WowIcon";
import { InfoTip } from "../components/ui/Field";
import Switch from "../components/ui/Switch";
import RoleGlyph from "../components/raidplan/RoleGlyph";
import CompositionEditor from "../components/CompositionEditor";
import { MinusIcon, PlusIcon } from "../components/icons";
import { InstancePicker, SizePicker } from "../components/RaidPlanFields";
import PlanBoard from "../components/raidplan/PlanBoard";
import { formatDate } from "../lib/format";
import { rolePluralLabel } from "../lib/wowNames";
import type { BesetzungCounts } from "../api";
import { bossIconOf, scopeOf, sectionMobs as sectionMobsOf } from "../lib/raidplan/assign";
import { DEFAULTS_KEY, copyDefaultsToAll, differs } from "../lib/raidplan/inherit";
import { besetzungFor } from "../lib/raidplan";
import { useT } from "../i18n";
import BoardWorkspace from "./raid-detail/raidplan/BoardWorkspace";
import { LibraryModal, ProfilesModal } from "./raid-detail/raidplan/ProfileModals";
import { SaveButton, UnsavedBar, useUnsavedGuard, type SaveStateKind } from "./raid-detail/raidplan/SaveState";
import { applyTactic, stepsOf } from "../lib/raidplan/steps";
import SectionStrip from "./raid-detail/raidplan/SectionStrip";
import type { MapRow } from "./raid-detail/raidplan/MapPanel";
import { useDraftHistory } from "./raid-detail/raidplan/useDraftHistory";
import "../styles/raidplan/index.css";
import RaidplanBoundary from "../components/raidplan/RaidplanBoundary";
import { useContentVersion } from "../hooks/useContentVersion";
import { ofVersion } from "../lib/raidplan/versions";

type Fields = { name: string; category: string; description: string; guildId: string; versionId: string; instanceIds: string[]; size: number; counts: BesetzungCounts | null };

const blankFields = (versionId: string): Fields => ({ name: "", category: "", description: "", guildId: "", versionId, instanceIds: [], size: 0, counts: null });
const fieldsOf = (tpl: RaidplanTemplate): Fields => ({ name: tpl.name, category: tpl.category, description: tpl.description, guildId: tpl.guildId, versionId: tpl.versionId, instanceIds: tpl.instanceIds, size: tpl.size, counts: tpl.counts });

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
    const { user } = useOutletContext<ShellContext>();
    const editor = useCollectionEditor("edit");
    const canWrite = canAccess(user, "raidplan", "write");
    // the game versions (#544): the list shows one at a time, the main version first (/api/game-versions' defaultVersion, a setting with #541)
    const [versions, setVersions] = useState<GameVersion[]>([]);
    const [mainVersion, setMainVersion] = useState("tbc");
    // The game version shown (#563): the menu's content switch.
    const { version: picked } = useContentVersion();
    const [guilds, setGuilds] = useState<SessionGuild[]>([]);
    const [profiles, setProfiles] = useState<RaidplanProfile[]>([]);
    // One round trip for the page: the templates are its data, the rest is read along with them.
    const loaded = useApi(() => Promise.all([getRaidplanTemplates(), getGameVersions(), getRaidplanProfiles(), getSession()])
        .then(([tpls, versions, profs, session]) => {
            setVersions(versions.versions);
            setMainVersion(versions.defaultVersion || (versions.versions[0] ? versions.versions[0].id : "tbc"));
            setProfiles(profs.profiles);
            setGuilds(session.guilds);
            return tpls.templates;
        }), []);
    const templates = loaded.data;
    const setTemplates = loaded.setData;

    // The list sits beside the rail of Raid-Events' pages (components/SectionRail.tsx);
    // the editor of one template takes the whole width without it.
    const inRail = (page: ReactNode) => <MenuRailPage user={user} parent="raids">{page}</MenuRailPage>;
    const editing = !!editor.editId && !editor.isNew;
    if (loaded.error) {
        const msg = <div className="empty">{t("planTemplates.loadError", { message: loaded.error.message })}</div>;
        return editing ? msg : inRail(msg);
    }
    if (!templates) return editing ? <RaidLoader text={t("planTemplates.loading")} /> : inRail(<RaidLoader text={t("planTemplates.loading")} />);

    const current = editor.editId ? templates.find((x) => x.id === editor.editId) || null : null;
    const versionOf = (id: string) => versions.find((v) => v.id === id) || null;
    const shownVersion = picked || mainVersion;

    if (current) {
        return (
            <TemplateEditor
                key={current.id} template={current} canWrite={canWrite} version={versionOf(current.versionId)} guilds={guilds}
                profiles={ofVersion(profiles, current.versionId)} onProfiles={setProfiles} onSaved={setTemplates} onBack={editor.close}
            />
        );
    }

    return inRail(
        <TemplateList
            templates={ofVersion(templates, shownVersion)} version={versionOf(shownVersion)} versionOf={versionOf} guilds={guilds} canWrite={canWrite}
            isNew={editor.isNew} onNew={editor.startNew} onCloseNew={editor.close} onOpen={editor.startEdit} onTemplates={setTemplates}
        />,
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
                <div className="rp-thumb-inner" style={{ "--rp-thumb-w": `${THUMB_W}px`, "--rp-thumb-k": String(k) } as CSSProperties}>
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
function TemplateList({ templates, version, versionOf, guilds, canWrite, isNew, onNew, onCloseNew, onOpen, onTemplates }: {
    /** the templates of the version shown (#544) */
    templates: RaidplanTemplate[];
    /** the game version shown: its instances, and the version a new template is made for */
    version: GameVersion | null;
    versionOf: (id: string) => GameVersion | null;
    /** the version switch (null with a single version) */
    guilds: SessionGuild[];
    canWrite: boolean;
    /** the link back to the raid list, only for who may open it (the raid plan is its own area) */
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
            const r = await deleteRaidplanTemplate(tpl.id);
            onTemplates(r.templates);
            toast(t("planTemplates.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };
    const duplicate = async (tpl: RaidplanTemplate) => {
        try {
            const r = await duplicateRaidplanTemplate(tpl.id);
            onTemplates(r.templates);
            toast(t("planTemplates.duplicated", { name: r.template ? r.template.name : tpl.name }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <div className="rp-templates">
            <PageHead
                icon="inv_misc_map02" tone="raids" kicker={t("planTemplates.kicker")} title={t("planTemplates.title")}
                meta={<Badge count>{templates.length}</Badge>}
                action={canWrite ? <Button onClick={onNew}>{t("planTemplates.new")}</Button> : undefined}
            />
            <p className="rp-muted">{t("planTemplates.intro")}</p>

            {templates.length === 0 ? (
                <div className="rp-empty">
                    <WowIcon name="inv_misc_map02" size={40} />
                    <strong>{version ? t("planTemplates.noneOfVersion", { version: version.short }) : t("planTemplates.emptyTitle")}</strong>
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
                                                        <RoleGlyph role={kind} size={18} />{tpl.besetzung.counts[kind as keyof BesetzungCounts]}
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
                    title={t("planTemplates.newTitle")} initial={blankFields(version ? version.id : "tbc")} version={version} guilds={guilds}
                    onClose={onCloseNew}
                    onSave={async (fields) => {
                        try {
                            const r = await createRaidplanTemplate(fields);
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
                    title={t("planTemplates.rename")} initial={fieldsOf(renaming)} version={versionOf(renaming.versionId)} guilds={guilds}
                    onClose={() => setRenaming(null)}
                    onSave={async (fields) => {
                        try {
                            const r = await updateRaidplanTemplate(renaming.id, fields);
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

/** Melee or ranged as a card like CompositionEditor's tanks and healers: icon, name, the large number, − and +. */
function SplitCard({ role, value, max, onChange }: { role: "melee" | "ranged"; value: number; max: number; onChange: (value: number) => void }) {
    const t = useT();
    const name = rolePluralLabel(role);
    return (
        <div className="comp-card">
            <RoleGlyph role={role} size={32} />
            <div className="comp-text">
                <div className="comp-lbl">{name}</div>
                <div className="comp-num" aria-live="polite">{value}</div>
            </div>
            <IconButton icon={<MinusIcon strokeWidth={2.4} />} tip={t("planTemplates.stepLess", { role: name })} disabled={value <= 0} onClick={() => onChange(value - 1)} />
            <IconButton icon={<PlusIcon strokeWidth={2.4} />} tip={t("planTemplates.stepMore", { role: name })} disabled={value >= max} onClick={() => onChange(value + 1)} />
        </div>
    );
}

/**
 * Name, category, description, server and instances of a template — creating one and editing its details.
 * Three sections (the template, the raid, the Besetzung), every label in one style, tanks and healers with
 * − and + as in the event dialog, and the melee / ranged split as a switch.
 */
export function FieldsModal({ title, initial, version, guilds, onClose, onSave }: {
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
            <div className="rp-form rp-tform">
                <section className="rp-tform-sec" aria-labelledby="tform-general">
                    <h3 className="rp-tform-h" id="tform-general">{t("planTemplates.sectionGeneral")}</h3>
                    <div className="rp-tform-field">
                        <label className="rp-kicker" htmlFor="tform-name">{t("raidBoard.profile.name")}</label>
                        <input id="tform-name" className="rp-form-name" value={f.name} maxLength={40} placeholder={t("planTemplates.namePlaceholder")} onChange={(e) => setF({ ...f, name: e.target.value })} />
                    </div>
                    <div className="rp-tform-pair">
                        <div className="rp-tform-field">
                            <label className="rp-kicker" htmlFor="tform-category">{t("raidBoard.profile.category")}</label>
                            <input id="tform-category" value={f.category} maxLength={30} onChange={(e) => setF({ ...f, category: e.target.value })} />
                        </div>
                        <div className="rp-tform-field">
                            <span className="rp-tform-lbl">
                                <label className="rp-kicker" htmlFor="tform-server">{t("planTemplates.server")}</label>
                                <InfoTip head={t("planTemplates.server")} sub={t("planTemplates.serverHint")} />
                            </span>
                            <select id="tform-server" value={f.guildId} onChange={(e) => setF({ ...f, guildId: e.target.value })}>
                                <option value="">{t("planTemplates.allServers")}</option>
                                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                {f.guildId && !guilds.some((g) => g.id === f.guildId) && <option value={f.guildId}>{t("planTemplates.otherServer")}</option>}
                            </select>
                        </div>
                    </div>
                    <div className="rp-tform-field">
                        <label className="rp-kicker" htmlFor="tform-description">{t("planTemplates.description")}</label>
                        <textarea id="tform-description" value={f.description} rows={2} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
                    </div>
                </section>
                <section className="rp-tform-sec is-picks" aria-labelledby="tform-raid">
                    <h3 className="rp-tform-h" id="tform-raid">{t("planTemplates.sectionRaid")}</h3>
                    <InstancePicker version={version} value={f.instanceIds} onToggle={toggle} />
                    <SizePicker version={version} instanceIds={f.instanceIds} size={f.size || derived.size} free={freeSize} onFree={setFreeSize} onSize={(n) => setF({ ...f, size: n || 0, counts: null })} />
                </section>
                <section className="rp-tform-sec" aria-labelledby="tform-besetzung">
                    <h3 className="rp-tform-h" id="tform-besetzung">
                        {t("planTemplates.besetzung")}
                        <span className="rp-tform-hsub">{t("planTemplates.besetzungSum", { size: derived.size, groups: derived.groups })}</span>
                        <InfoTip head={t("planTemplates.besetzung")} sub={t("planTemplates.besetzungHint", { groups: derived.groups })} />
                    </h3>
                    <CompositionEditor size={derived.size} value={{ tank: counts.tank, healer: counts.healer }} onChange={(c) => setCounts(c)} />
                    <Switch checked={split} label={t("planTemplates.splitDps")} tip={t("planTemplates.dpsHint")}
                        onChange={(on) => { setShowSplit(on); if (!on) setF({ ...f, counts: { ...counts, melee: 0, ranged: 0 } }); }} />
                    {split && (
                        <div className="comp-ed">
                            <div className="comp-grid">
                                <SplitCard role="melee" value={counts.melee} max={counts.dps - counts.ranged} onChange={(v) => setCounts({ melee: v })} />
                                <SplitCard role="ranged" value={counts.ranged} max={counts.dps - counts.melee} onChange={(v) => setCounts({ ranged: v })} />
                            </div>
                            <div className="comp-hint">{t("planTemplates.splitRest", { n: Math.max(0, counts.dps - counts.melee - counts.ranged) })}</div>
                        </div>
                    )}
                </section>
            </div>
        </Modal>
    );
}

/** The editor of one template: the shared board workspace (sticky tool bar, boss chips, palette, board, properties / background / layers panel). */
function TemplateEditor({ template, canWrite, version, guilds, profiles, onProfiles, onSaved, onBack }: {
    template: RaidplanTemplate;
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
            const r = await updateRaidplanTemplate(tpl.id, { bosses: toSave(draft, bossKeys), version: tpl.version });
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
            const r = await deleteRaidplanTemplate(tpl.id);
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
                    mode="template" eventId="" versionId={tpl.versionId} besetzung={tpl.besetzung} catalog={tpl.catalog} boss={boss} allBosses={tpl.bossList} board={board} edit={edit} editAll={editAllBoards} roster={[]} canWrite={canWrite} limits={limits}
                    profileName={profile ? profile.name : ""} onPickProfile={() => setModal("pick")} onSaveTactic={() => setModal("save")}
                    history={{ undo, redo, canUndo, canRedo }}
                    mapRows={mapRows} onMapsChanged={reloadMaps}
                    defaultRows={boardOf(draft, DEFAULTS_KEY).assignments} onCopyDefaults={copyDefaults}
                    bossNav={<SectionStrip dirtyKeys={unsavedKeys} bosses={tpl.bossList} selected={selected} draft={draft} onSelect={setSelected} onSheet={canWrite ? (k, on) => histEdit(k, (b) => ({ ...b, inSheet: on })) : undefined} onMap={canWrite ? (k, on) => histEdit(k, (b) => ({ ...b, showMap: on })) : undefined} />}
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
                            const r = await updateRaidplanTemplate(tpl.id, fields);
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
                open={modal === "profiles" || modal === "save"} onClose={() => setModal("")}
                profiles={profiles} categories={categories} bosses={tpl.bossList} bossKey={selected} versionId={tpl.versionId}
                draft={modal === "save" ? board : null} limits={limits}
                onChanged={(list, saved) => {
                    onProfiles(list);
                    if (saved && modal === "save") edit((b) => ({ ...b, profileId: saved.id }));
                }}
            />
        </div>
    );
}
