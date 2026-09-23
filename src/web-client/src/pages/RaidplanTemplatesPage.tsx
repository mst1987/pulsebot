import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, createRaidplanTemplate, deleteRaidplanTemplate, getGameVersions, getRaidplanProfiles, getRaidplanTemplates, getSession,
    updateRaidplanTemplate,
    type ApiError, type GameVersion, type RaidplanBoard, type RaidplanProfile, type RaidplanTemplate, type SessionGuild,
} from "../api";
import { useCollectionEditor } from "../lib/collectionEditor";
import {
    applyProfile, boardCount, boardOf, hasContent, profileRows, sameBosses, toSave, withBoard,
} from "../lib/raidplan";
import type { ShellContext } from "../components/Shell";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import PageHead from "../components/ui/PageHead";
import Badge from "../components/ui/Badge";
import RaidLoader from "../components/ui/RaidLoader";
import WowIcon from "../components/ui/WowIcon";
import { InstancePicker } from "../components/RaidPlanFields";
import { useT } from "../i18n";
import BoardWorkspace from "./raid-detail/raidplan/BoardWorkspace";
import { ProfilePickerModal, ProfilesModal } from "./raid-detail/raidplan/ProfileModals";
import MapModal, { type MapRow } from "./raid-detail/raidplan/MapModal";
import "../styles/raidplan.css";

type Bosses = Record<string, Partial<RaidplanBoard>>;
type Fields = { name: string; category: string; description: string; guildId: string; instanceIds: string[] };

const blankFields = (): Fields => ({ name: "", category: "", description: "", guildId: "", instanceIds: [] });
const fieldsOf = (tpl: RaidplanTemplate): Fields => ({ name: tpl.name, category: tpl.category, description: tpl.description, guildId: tpl.guildId, instanceIds: tpl.instanceIds });

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
    const toast = useToast();
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
        <div className="rp-wide rp-templates">
            <p className="note"><Link className="mlink" to="/raids">{t("planTemplates.back")}</Link></p>
            <PageHead
                icon="inv_misc_map02" tone="raids" kicker={t("planTemplates.kicker")} title={t("planTemplates.title")}
                meta={<Badge count>{templates.length}</Badge>}
                action={canWrite ? <Button onClick={editor.startNew}>{t("planTemplates.new")}</Button> : undefined}
            />
            <p className="rp-muted">{t("planTemplates.intro")}</p>
            {templates.length === 0 && <div className="rp-empty"><p className="rp-muted">{t("planTemplates.empty")}</p></div>}
            <ul className="rp-tlist">
                {templates.map((tpl) => {
                    const guild = guilds.find((g) => g.id === tpl.guildId);
                    return (
                        <li key={tpl.id} className="rp-tcard">
                            <div className="rp-tcard-main">
                                <strong className="rp-tcard-name">{tpl.name}</strong>
                                {tpl.category && <Badge>{tpl.category}</Badge>}
                                {tpl.guildId && <Badge tone="accent">{guild ? guild.name : t("planTemplates.otherServer")}</Badge>}
                                <div className="rp-tcard-insts">
                                    {tpl.instanceIds.map((id) => {
                                        const inst = version ? version.instances.find((i) => i.id === id) : null;
                                        return inst ? <span key={id} className="rp-tinst"><WowIcon name={inst.icon} size={18} />{inst.short}</span> : null;
                                    })}
                                </div>
                                <span className="rp-muted">{tpl.description || t("planTemplates.bossCount", { count: Object.keys(tpl.bosses).length })}</span>
                            </div>
                            <Link className="btn btn-ghost" to={`?edit=${tpl.id}`}>{canWrite ? t("planTemplates.edit") : t("planTemplates.view")}</Link>
                        </li>
                    );
                })}
            </ul>
            {editor.isNew && (
                <FieldsModal
                    title={t("planTemplates.newTitle")} initial={blankFields()} version={version} guilds={guilds}
                    onClose={editor.close}
                    onSave={async (fields) => {
                        try {
                            const r = await createRaidplanTemplate(csrfToken, fields);
                            setTemplates(r.templates);
                            toast(t("planTemplates.created", { name: fields.name }));
                            if (r.template) editor.startEdit(r.template.id);
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
    const toggle = (id: string) => setF((cur) => ({ ...cur, instanceIds: cur.instanceIds.includes(id) ? cur.instanceIds.filter((x) => x !== id) : [...cur.instanceIds, id] }));
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
            </div>
        </Modal>
    );
}

/** The editor of one template: boss list on the left, the shared board workspace filling the rest. */
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
    const [draft, setDraft] = useState<Bosses>(template.bosses);
    const [selected, setSelected] = useState((template.bossList[0] && template.bossList[0].key) || "");
    const [modal, setModal] = useState<"" | "fields" | "pick" | "profiles" | "save" | "map" | "delete">("");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    const bossKeys = useMemo(() => tpl.bossList.map((b) => b.key), [tpl]);
    const boss = tpl.bossList.find((b) => b.key === selected) || null;
    const board = boardOf(draft, selected);
    const dirty = !sameBosses(draft, tpl.bosses, bossKeys);
    const edit = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard) => {
        setDraft((prev) => withBoard(prev, selectedRef.current, fn(boardOf(prev, selectedRef.current))));
    }, []);
    const categories = useMemo(() => [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [profiles]);
    const profile = profiles.find((p) => p.id === board.profileId) || null;

    /** A change that comes back as the fresh template (fields, maps): keep the unsaved draft. */
    const adopt = (r: { templates: RaidplanTemplate[]; template?: RaidplanTemplate }, keepDraft: boolean) => {
        onSaved(r.templates);
        if (r.template) {
            setTpl(r.template);
            if (!keepDraft) setDraft(r.template.bosses);
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

    const reload = async () => {
        const r = await getRaidplanTemplates();
        onSaved(r.templates);
        const fresh = r.templates.find((x) => x.id === tpl.id);
        if (fresh) { setTpl(fresh); setDraft(fresh.bosses); setConflict(false); }
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

    const pickProfile = async (p: RaidplanProfile) => {
        if (hasContent({ ...board, slots: [], marks: [], zones: [], tokens: [] }) && !(await ask({ title: t("raidBoard.profile.applyTitle", { name: p.name }), text: t("raidBoard.profile.applyText"), action: t("raidBoard.profile.applyAction"), tone: "primary", icon: "inv_scroll_03" }))) return;
        edit((b) => applyProfile(b, p));
        setModal("");
        toast(t("raidBoard.profile.applied", { name: p.name }));
    };

    const mapRows: MapRow[] = boss ? [
        { key: `t/${tpl.id}/${boss.key}`, label: t("planTemplates.mapForTemplate"), has: !!boss.templateMap, override: true },
        { key: boss.key, label: `${t("raidBoard.board.mapForBoss")}: ${boss.name}`, has: boss.ownMap, override: false },
        { key: boss.instanceId, label: `${t("raidBoard.board.mapForInstance")}: ${boss.instanceName}`, has: boss.instanceMap, override: false },
    ] : [];
    const limits = { targetsPerBoss: 30, title: 80, notes: 1000, profileName: 40, profileCategory: 30 };

    return (
        <div className="rp-editor rp-wide">
            <p className="note"><button type="button" className="mlink rp-linkbtn" onClick={onBack}>{t("planTemplates.backToList")}</button></p>
            <div className="rp-bar">
                <strong className="rp-tcard-name">{tpl.name}</strong>
                {tpl.category && <Badge>{tpl.category}</Badge>}
                {dirty && <Badge tone="mid">{t("raidBoard.bar.dirty")}</Badge>}
                {!canWrite && <Badge>{t("raidBoard.bar.readOnly")}</Badge>}
                <div className="rp-bar-act">
                    {canWrite && <Button variant="ghost" onClick={() => setModal("fields")}>{t("planTemplates.details")}</Button>}
                    {canWrite && <Button variant="danger" onClick={remove}>{t("raidBoard.profile.delete")}</Button>}
                    {canWrite && <Button onClick={save} disabled={!dirty || conflict} running={saving}>{t("raidBoard.bar.save")}</Button>}
                </div>
            </div>
            {conflict && (
                <div className="flash flash-err rp-conflict">
                    <span>{t("planTemplates.conflict")}</span>
                    <Button variant="ghost" size="sm" onClick={reload}>{t("raidBoard.conflict.reload")}</Button>
                </div>
            )}
            <p className="rp-muted">{t("planTemplates.editorHint")}</p>

            <div className="rp-layout">
                <nav className="rp-bosses" aria-label={t("raidBoard.bosses.title")}>
                    <h3 className="rp-kicker">{t("raidBoard.bosses.title")}</h3>
                    {tpl.bossList.map((b, i) => (
                        <button key={b.key} type="button" className={`rp-boss${b.key === selected ? " is-on" : ""}`} aria-current={b.key === selected ? "true" : undefined} onClick={() => setSelected(b.key)}>
                            <img src={b.iconUrl} alt="" width={26} height={26} loading="lazy" />
                            <span className="rp-boss-name">{i + 1} · {b.name}</span>
                            {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                        </button>
                    ))}
                </nav>
                {boss && (
                    <BoardWorkspace
                        mode="template" boss={boss} board={board} edit={edit} roster={[]} canWrite={canWrite} limits={limits}
                        profileName={profile ? profile.name : ""} onPickProfile={() => setModal("pick")}
                        toolbar={canWrite ? (
                            <Button variant="ghost" size="sm" icon="inv_misc_map02" onClick={() => setModal("map")}>
                                {boss.mapUrl ? t("raidBoard.board.mapReplace") : t("raidBoard.board.mapUpload")}
                            </Button>
                        ) : undefined}
                    />
                )}
            </div>

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
            <ProfilePickerModal
                open={modal === "pick"} onClose={() => setModal("")} profiles={profiles} bosses={tpl.bossList} bossKey={selected}
                currentId={board.profileId} onPick={pickProfile}
                onSaveAs={() => setModal(profileRows(board).length ? "save" : "profiles")}
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
            <MapModal open={modal === "map"} onClose={() => setModal("")} csrfToken={csrfToken} rows={mapRows} onChanged={reloadMaps} />
        </div>
    );
}
