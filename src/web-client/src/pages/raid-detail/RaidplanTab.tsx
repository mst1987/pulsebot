import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, RotateCw, Save, Share2 } from "lucide-react";
import {
    applyRaidplanTemplate, getRaidplan, publishRaidplan, saveRaidplan,
    type ApiError, type RaidplanBoard, type RaidplanProfile, type RaidplanTemplateSummary, type RaidplanView,
} from "../../api";
import { Badge, IconButton, Modal, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { useOnFocus } from "../../lib/useOnFocus";
import { useT } from "../../i18n";
import {
    applyProfile, boardOf, ensureBesetzung, hasContent, objectCount, openSlots, planHasContent, profileRows, sameBosses, toSave,
} from "../../lib/raidplan";
import type { RaidCtx } from "./meta";
import BoardWorkspace from "./raidplan/BoardWorkspace";
import BossNav from "./raidplan/BossNav";
import { ProfilePickerModal, ProfilesModal } from "./raidplan/ProfileModals";
import ShareModal from "./raidplan/ShareModal";
import type { MapRow } from "./raidplan/MapPanel";
import { useDraftHistory } from "./raidplan/useDraftHistory";
import "../../styles/raidplan.css";

/**
 * Raid-Detail › Raidplan (an own event, docs/raidplan.md), inside the raid detail's
 * normal frame. The working area (BoardWorkspace) has a sticky tool bar with undo /
 * redo, quick inserts and this page's actions as icons (template, share, save), the
 * boss chips, the players not placed yet, the palette, the board and the properties
 * / background / layers panel.
 *
 * A plan can start from a raid plan template ("Vorlage"): the server copies it in
 * as a snapshot and fills its open slots from the approved setup; from then on
 * everything is adjusted here, and a later change to the template does not reach
 * this plan. Nothing is written until "Speichern", which sends the version that
 * was read — a plan somebody else saved meanwhile is a conflict, never silently
 * overwritten.
 */
export default function RaidplanTab({ ctx }: { ctx: RaidCtx }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { eventId, csrfToken } = ctx;

    const [view, setView] = useState<RaidplanView | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const { draft, edit: histEdit, reset, undo, redo, canUndo, canRedo } = useDraftHistory();
    const [selected, setSelected] = useState("");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [modal, setModal] = useState<"" | "pick" | "profiles" | "save" | "share" | "template">("");
    const [profiles, setProfiles] = useState<RaidplanProfile[]>([]);
    const selectedRef = useRef("");
    selectedRef.current = selected;

    const load = useCallback(() => {
        setError(null);
        getRaidplan(eventId)
            .then((v) => {
                setView(v);
                reset(v.plan.bosses);
                setProfiles(v.profiles);
                setConflict(false);
                setSelected((cur) => (v.bosses.some((b) => b.key === cur) ? cur : (v.bosses[0] && v.bosses[0].key) || ""));
            })
            .catch((err: ApiError) => setError(err));
    }, [eventId, reset]);
    useEffect(load, [load]);

    /** Only the maps (uploads/removals) changed: refresh them without losing the unsaved draft. */
    const reloadMaps = () => {
        getRaidplan(eventId).then((v) => setView((cur) => (cur ? { ...cur, bosses: v.bosses } : v))).catch(() => {});
    };

    /** The setup may have changed elsewhere (another tab, another orga): fetch the lineup again when this window comes back, keep the draft. */
    useOnFocus(() => {
        getRaidplan(eventId).then((v) => setView((cur) => (cur ? { ...cur, roster: v.roster, besetzung: v.besetzung, catalog: v.catalog } : cur))).catch(() => {});
    });

    const bossKeys = useMemo(() => (view ? view.bosses.map((b) => b.key) : []), [view]);
    const roster = useMemo(() => (view ? view.roster : []), [view]);
    const boss = view ? view.bosses.find((b) => b.key === selected) || null : null;
    const besetzung = view ? view.besetzung : null;
    const board = useMemo(() => ensureBesetzung(boardOf(draft, selected), besetzung, roster), [draft, selected, besetzung, roster]);
    const dirty = !!view && !sameBosses(draft, view.plan.bosses, bossKeys);
    const canWrite = !!view && view.canWrite;

    /** Applies a change to the selected boss's board (stable: the workspace's drag listens through it). */
    const editBoard = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        histEdit(selectedRef.current, (b) => fn(ensureBesetzung(b, besetzung, roster)), coalesce);
    }, [histEdit, besetzung, roster]);

    // ---- save / publish -----------------------------------------------------------------------
    const save = async () => {
        if (!view || saving) return;
        setSaving(true);
        try {
            const v = await saveRaidplan(csrfToken, { event: eventId, version: view.plan.version, bosses: toSave(draft, bossKeys) });
            setView(v);
            reset(v.plan.bosses);
            setConflict(false);
            toast(v.dropped ? t("raidBoard.bar.savedDropped", { count: v.dropped }) : t("raidBoard.bar.saved"));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
        } finally {
            setSaving(false);
        }
    };

    const publish = async (published: boolean, rotate = false) => {
        setSaving(true);
        try {
            const v = await publishRaidplan(csrfToken, { event: eventId, published, rotate });
            // Only the publishing state changes here: the unsaved draft stays.
            setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, status: v.plan.status, publicPath: v.plan.publicPath } } : v));
            toast(rotate ? t("raidBoard.share.rotated") : published ? t("raidBoard.share.published") : t("raidBoard.share.unpublished"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    // ---- templates ----------------------------------------------------------------------------
    const applyTemplate = async (tpl: RaidplanTemplateSummary) => {
        if (!view) return;
        const needsAsk = dirty || planHasContent(view.plan.bosses, bossKeys);
        if (needsAsk && !(await ask({ title: t("raidBoard.template.applyTitle", { name: tpl.name }), text: t("raidBoard.template.applyText"), action: t("raidBoard.template.applyAction"), tone: "primary", icon: "inv_misc_map02" }))) return;
        setSaving(true);
        try {
            // The server copies the template onto the *saved* plan; unsaved edits are replaced by it (asked above).
            const v = await applyRaidplanTemplate(csrfToken, { event: eventId, templateId: tpl.id, version: view.plan.version });
            setView(v);
            reset(v.plan.bosses);
            setConflict(false);
            setModal("");
            toast(t("raidBoard.template.applied", { name: tpl.name }));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
            setModal("");
        } finally {
            setSaving(false);
        }
    };

    // ---- tactic profiles ----------------------------------------------------------------------
    const pickProfile = async (profile: RaidplanProfile) => {
        if (hasContent({ ...board, tokens: [], slots: [], marks: [], zones: [], lines: [], texts: [], assignments: board.assignments.filter((a) => a.type === "other"), mapOpacity: 1 }) && !(await ask({ title: t("raidBoard.profile.applyTitle", { name: profile.name }), text: t("raidBoard.profile.applyText"), action: t("raidBoard.profile.applyAction"), tone: "primary", icon: "inv_scroll_03" }))) return;
        editBoard((b) => applyProfile(b, profile));
        setModal("");
        toast(t("raidBoard.profile.applied", { name: profile.name }));
    };
    const categories = useMemo(() => [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [profiles]);
    const profile = profiles.find((p) => p.id === board.profileId) || null;

    if (error) return <div className="empty">{t("raidDetail.page.loadError", { message: error.message })}</div>;
    if (!view) return <RaidLoader text={t("raidDetail.page.loading")} />;
    if (view.bosses.length === 0) {
        return (
            <div className="rp-empty">
                <strong>{t("raidBoard.noInstance.title")}</strong>
                <p className="rp-muted">{t("raidBoard.noInstance.text")}</p>
            </div>
        );
    }

    const published = view.plan.status === "published";
    const mapRows: MapRow[] = boss ? [
        { key: `e/${eventId}/${boss.key}`, label: t("raidBoard.board.mapForPlan"), has: !!boss.eventMap, override: true },
        { key: boss.key, label: `${t("raidBoard.board.mapForBoss")}: ${boss.name}`, has: boss.ownMap, override: false },
        { key: boss.instanceId, label: `${t("raidBoard.board.mapForInstance")}: ${boss.instanceName}`, has: boss.instanceMap, override: false },
    ] : [];
    const open = openSlots(board);
    const empty = objectCount(board) === 0;

    return (
        <div className="rp-editor" data-rp-editor>
            {conflict && (
                <div className="flash flash-err rp-conflict">
                    <span>{t("raidBoard.conflict.text")}</span>
                    <IconButton size="sm" icon={<RotateCw size={16} />} tip={t("raidBoard.conflict.reload")} onClick={load} />
                </div>
            )}
            {canWrite && !view.hasApprovedSetup && (
                <p className="rp-warn">{roster.length === 0 ? t("raidBoard.setupHint.none") : t("raidBoard.setupHint.notApproved")}</p>
            )}

            {boss && (
                <BoardWorkspace
                    mode="event" eventId={eventId} besetzung={view.besetzung} catalog={view.catalog} boss={boss} allBosses={view.bosses} board={board} edit={editBoard} roster={roster} canWrite={canWrite} limits={view.limits}
                    profileName={profile ? profile.name : ""} onPickProfile={() => setModal("pick")}
                    history={{ undo, redo, canUndo, canRedo }}
                    csrfToken={csrfToken} mapRows={mapRows} onMapsChanged={reloadMaps}
                    bossNav={<BossNav bosses={view.bosses} selected={selected} draft={draft} onSelect={setSelected} />}
                    status={(
                        <>
                            <Badge tone={published ? "ok" : undefined}>{published ? t("raidBoard.bar.published") : t("raidBoard.bar.draft")}</Badge>
                            <Badge tone={dirty ? "mid" : "ok"}>{dirty ? t("raidBoard.bar.dirty") : t("raidBoard.bar.savedState")}</Badge>
                            {!canWrite && <Badge>{t("raidBoard.bar.readOnly")}</Badge>}
                            {canWrite && open > 0 && <Badge tone="mid" tip={t("raidBoard.slot.openTip")}>{t("raidBoard.slot.openCount", { count: open })}</Badge>}
                            {view.plan.templateName && <span className="rp-muted rp-bar-template">{t("raidBoard.template.current", { name: view.plan.templateName })}</span>}
                            {canWrite && empty && !view.plan.templateName && view.templates.length > 0 && <span className="rp-muted">{t("raidBoard.template.hintEmpty")}</span>}
                        </>
                    )}
                    actions={canWrite ? (
                        <>
                            <IconButton size="sm" icon={<LayoutTemplate size={17} />} tip={t("raidBoard.template.pick")} onClick={() => setModal("template")} />
                            <IconButton size="sm" icon={<Share2 size={17} />} tip={t("raidBoard.bar.share")} onClick={() => setModal("share")} />
                            <IconButton size="sm" className="rp-save" icon={<Save size={17} />} tip={saving ? t("raidBoard.bar.saving") : t("raidBoard.bar.save")} disabled={!dirty || conflict || saving} onClick={save} />
                        </>
                    ) : undefined}
                />
            )}

            <Modal open={modal === "template"} onClose={() => setModal("")} icon="inv_misc_map02" title={t("raidBoard.template.pickTitle")} width={520} hint={t("raidBoard.template.hint")}>
                <ul className="rp-pick">
                    <li>
                        <div className={`rp-pick-row rp-pick-profile${view.plan.templateId ? "" : " is-on"}`}>
                            <span className="rp-pick-name">{t("raidBoard.template.empty")}</span>
                            <span className="rp-muted">{t("raidBoard.template.emptyText")}</span>
                        </div>
                    </li>
                    {view.templates.map((tpl) => (
                        <li key={tpl.id}>
                            <button type="button" className={`rp-pick-row rp-pick-profile${tpl.id === view.plan.templateId ? " is-on" : ""}`} disabled={saving} onClick={() => applyTemplate(tpl)}>
                                <span className="rp-pick-name">{tpl.name}{tpl.category ? ` · ${tpl.category}` : ""}</span>
                                <span className="rp-muted">{tpl.description || t("raidBoard.template.bosses", { count: tpl.bossCount })}</span>
                            </button>
                        </li>
                    ))}
                    {view.templates.length === 0 && <li className="rp-muted">{t("raidBoard.template.noneYet")}</li>}
                </ul>
            </Modal>
            <ProfilePickerModal
                open={modal === "pick"} onClose={() => setModal("")} profiles={profiles} bosses={view.bosses} bossKey={selected}
                currentId={board.profileId} onPick={pickProfile}
                onSaveAs={() => setModal(profileRows(board).length ? "save" : "profiles")}
                onManage={() => setModal("profiles")}
            />
            <ProfilesModal
                open={modal === "profiles" || modal === "save"} onClose={() => setModal("")} csrfToken={csrfToken}
                profiles={profiles} categories={categories} bosses={view.bosses} bossKey={selected}
                draft={modal === "save" ? board : null} limits={view.limits}
                onChanged={(list, saved) => {
                    setProfiles(list);
                    // "Als Taktik speichern": the board now belongs to the profile it was saved as.
                    if (saved && modal === "save") editBoard((b) => ({ ...b, profileId: saved.id }));
                }}
            />
            <ShareModal
                open={modal === "share"} onClose={() => setModal("")} published={published} publicPath={view.plan.publicPath}
                dirty={dirty} hasApprovedSetup={view.hasApprovedSetup} busy={saving}
                onPublish={(p) => publish(p)} onRotate={() => publish(true, true)}
            />
        </div>
    );
}
