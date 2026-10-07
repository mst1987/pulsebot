import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LayoutTemplate, Link2, MoreHorizontal, RotateCw, Send } from "lucide-react";
import {
    applyRaidplanTemplate, getRaidplan, publishRaidplan, saveRaidplan, saveRaidplanGroups,
    type ApiError, type IncludedGroups, type RaidplanBoard, type RaidplanPlayer, type RaidplanView, type RaidplanProfile, type RaidplanTemplateSummary } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Button, IconButton, Modal, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import { useOnFocus } from "../../hooks/useOnFocus";
import { useRaidProgress } from "../../hooks/useRaidProgress";
import { useT } from "../../i18n";
import {
    boardCount, boardOf, dirtyKeys, ensureBesetzung, rememberSection, rememberedSection, startSection, objectCount, planHasContent, sameBosses, sheetIncluded, toSave,
} from "../../lib/raidplan";
import { hasSectionDeepLink, sectionFromUrl, showSectionInUrl } from "../../lib/raidplan/sectionUrl";
import type { RaidCtx } from "./meta";
import { missingNames, openAssignments, type OpenRow } from "../../lib/raidplan/assignLine";
import { DEFAULTS_KEY } from "../../lib/raidplan/inherit";
import BoardWorkspace from "./raidplan/BoardWorkspace";
import SectionStrip from "./raidplan/SectionStrip";
import ToolMenu from "./raidplan/ToolMenu";
import { LibraryModal, ProfilesModal } from "./raidplan/ProfileModals";
import { SaveButton, UnsavedBar, useUnsavedGuard, type SaveStateKind } from "./raidplan/SaveState";
import { applyTactic, stepsOf } from "../../lib/raidplan/steps";
import ShareModal from "./raidplan/ShareModal";
import type { MapRow } from "./raidplan/MapPanel";
import { useDraftHistory } from "./raidplan/useDraftHistory";
import { useTankOrderFollow } from "./raidplan/useTankOrderFollow";
import "../../styles/raidplan/index.css";
import RaidplanBoundary from "../../components/raidplan/RaidplanBoundary";
import RhSource from "./raidplan/RhSource";
import PlanGroups from "./raidplan/PlanGroups";
import { includedGroups, splitRoster } from "../../lib/raidplan/planGroups";
import { ofVersion, splitByVersion, versionLabel } from "../../lib/raidplan/versions";

/** The players a plan picks from ("Gruppen im Plan", #529) and the rest of the lineup (only to name a raider a row still holds). */
function rosterOfView(v: RaidplanView | null): { roster: RaidplanPlayer[]; outside: RaidplanPlayer[] } {
    if (!v) return { roster: [], outside: [] };
    return splitRoster(v.roster, includedGroups(v.plan.includedGroups, v.besetzung ? v.besetzung.groups : 5));
}

/**
 * Raid-Detail › Raidplan (an own event, docs/raidplan.md), inside the raid detail's
 * normal frame. The working area (BoardWorkspace) has a sticky strip: the section choice
 * (SectionStrip), the views "Aufgaben | Karte" (never side by side), the status (draft /
 * published, saved) and this page's actions (Link kopieren, Freigeben, Mehr ▾: template,
 * posting the link, the open assignments) - docs/raidplan/editor.md, "Two views".
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
    const { eventId } = ctx;

    const { draft, edit: histEdit, editAll: histEditAll, reset, undo, redo, canUndo, canRedo } = useDraftHistory();
    const [selected, setSelected] = useState("");
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [modal, setModal] = useState<"" | "pick" | "profiles" | "save" | "share" | "template" | "open">("");
    const [profiles, setProfiles] = useState<RaidplanProfile[]>([]);
    const [reloading, setReloading] = useState(false);
    const [groupsBusy, setGroupsBusy] = useState(false);
    const selectedRef = useRef("");
    selectedRef.current = selected;

    const plan = useApi(() => getRaidplan(eventId).then((v) => {
        reset(v.plan.bosses);
        setProfiles(v.profiles);
        setConflict(false);
        // the section it opens on: the address (#boss= of a reload, else a deep link ?section=), else the one last open for this plan,
        // else "Allgemein" (it comes first)
        setSelected((cur) => (v.bosses.some((b) => b.key === cur) ? cur : startSection(v.bosses, sectionFromUrl(), rememberedSection(eventId), [])));
        return v;
    }), [eventId, reset]);
    const { data: view, setData: setView } = plan;

    /** Only the maps (uploads/removals) changed: refresh them without losing the unsaved draft. */
    const reloadMaps = () => {
        getRaidplan(eventId).then((v) => setView((cur) => (cur ? { ...cur, bosses: v.bosses } : v))).catch(() => {});
    };

    /** The setup may have changed elsewhere (another tab, another orga): fetch the lineup again when this window comes back, keep the draft. */
    useOnFocus(() => {
        getRaidplan(eventId).then((v) => setView((cur) => (cur ? { ...cur, roster: v.roster, besetzung: v.besetzung, catalog: v.catalog, rosterSource: v.rosterSource, meIds: v.meIds, hasApprovedSetup: v.hasApprovedSetup } : cur))).catch(() => {});
    });

    /** A Raid-Helper event: ask Raid-Helper again now ("Neu laden"); the draft stays. */
    const reloadRoster = () => {
        setReloading(true);
        getRaidplan(eventId, true)
            .then((v) => {
                setView((cur) => (cur ? { ...cur, roster: v.roster, rosterSource: v.rosterSource, meIds: v.meIds, hasApprovedSetup: v.hasApprovedSetup } : v));
                toast(v.rosterSource && v.rosterSource.stale ? t("raidBoard.rh.reloadStale") : t("raidBoard.rh.reloaded"), v.rosterSource && v.rosterSource.stale ? "err" : undefined);
            })
            .catch((err: ApiError) => toast(err.message, "err"))
            .finally(() => setReloading(false));
    };

    const bossKeys = useMemo(() => (view ? view.bosses.map((b) => b.key) : []), [view]);
    // the plan follows the raid (#534): during the raid window the linked log turns it to the boss being pulled, else the next one -
    // until the organiser picks a section himself
    const progress = useRaidProgress({
        source: view ? { event: eventId } : null, startTime: view ? view.event.startTime : 0, keys: bossKeys, select: setSelected,
        initialFollow: !hasSectionDeepLink(),
    });
    // remember the open section per plan (this browser) and show it in the address (#boss=, #555), so a reload opens it again
    useEffect(() => {
        if (!selected) return;
        rememberSection(eventId, selected);
        showSectionInUrl(selected);
    }, [eventId, selected]);
    // "Gruppen im Plan" (#529): every consumer below gets only the raiders of the plan's groups; the rest only names a raider a row holds
    const split = useMemo(() => rosterOfView(view || null), [view]);
    const roster = split.roster;
    const outside = split.outside;
    const included = useMemo(() => includedGroups(view ? view.plan.includedGroups : null, view && view.besetzung ? view.besetzung.groups : 5), [view]);
    const boss = view ? view.bosses.find((b) => b.key === selected) || null : null;
    const besetzung = view ? view.besetzung : null;
    const mine = useMemo(() => (view ? view.meIds || [] : []), [view]);
    const board = useMemo(() => ensureBesetzung(boardOf(draft, selected), besetzung, roster), [draft, selected, besetzung, roster]);
    const dirty = !!view && !sameBosses(draft, view.plan.bosses, bossKeys);
    // every row of the plan with a place the setup does not fill (a class missing in the raid, or all of it already on the task)
    const openSummary = (list: OpenRow[]) => { const names = missingNames(list).join(", "); return list.length === 1 ? t("raidBoard.aline.openSummaryOne", { names }) : t("raidBoard.aline.openSummary", { n: list.length, names }); };
    // each section with its Besetzung as the editor shows it (a slot reference names whoever stands in that slot); a row of the Standard
    // counts once, in the Standard (#524), not again in every boss that inherits it
    const openRows = useMemo(() => (view ? openAssignments(view.bosses.map((b) => ({ key: b.key, name: b.name, board: ensureBesetzung(boardOf(draft, b.key), besetzung, roster) })), roster, outside) : []), [view, draft, besetzung, roster, outside]);
    // per section: the strip's badge "2 offen" and the counts in its list
    const openCounts = useMemo(() => { const out: Record<string, number> = {}; for (const o of openRows) out[o.key] = (out[o.key] || 0) + 1; return out; }, [openRows]);
    const canWrite = !!view && view.canWrite;
    // "Einteilungen posten" (#502) publishes a draft plan on the way: the page's reload after the post brings the new state here
    const postedPath = ctx.data.raidplanPost?.publicPath || "";
    const loaded = !!view;
    useEffect(() => {
        if (!postedPath || !loaded) return;
        setView((cur) => (cur && cur.plan.publicPath !== postedPath ? { ...cur, plan: { ...cur.plan, status: "published", publicPath: postedPath } } : cur));
    }, [postedPath, loaded, setView]);
    /** The dialog lives on the page (the cockpit opens it too); the page's data is read again first, so it knows the last save. */
    const openPost = () => {
        ctx.onChanged("");
        ctx.openModal("raidplan");
    };

    /** Applies a change to the selected boss's board (stable: the workspace's drag listens through it). */
    // the colours and marks of the groups are the plan's, not one boss's: one step over every board with a map
    const editAllBoards = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        histEditAll(view ? view.bosses.filter((b) => !b.general && !b.defaults).map((b) => b.key) : [], fn, coalesce);
    }, [histEditAll, view]);
    // the sections that come with the shared sheet: switched on/off for one section or for several (share dialog); two steps at most (in, out)
    const setSheet = useCallback((changes: Record<string, boolean>) => {
        const on = Object.keys(changes).filter((k) => changes[k]);
        const off = Object.keys(changes).filter((k) => !changes[k]);
        if (on.length > 0) histEditAll(on, (b) => ({ ...b, inSheet: true }));
        if (off.length > 0) histEditAll(off, (b) => ({ ...b, inSheet: false }));
    }, [histEditAll]);
    const editBoard = useCallback((fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        histEdit(selectedRef.current, (b) => fn(ensureBesetzung(b, besetzung, roster)), coalesce);
    }, [histEdit, besetzung, roster]);

    // a new tank order in the Standard: asked on leaving it (or saving on it) whether the bosses and trash follow
    const fillBoard = useCallback((b: RaidplanBoard) => ensureBesetzung(b, besetzung, roster), [besetzung, roster]);
    const followSections = useMemo(() => (view ? view.bosses.filter((b) => !b.general && !b.defaults).map((b) => ({ key: b.key, name: b.name })) : []), [view]);
    const tankOrder = useTankOrderFollow({
        draft, selected, version: view ? view.plan.version : 0, sections: followSections, fill: fillBoard, editAll: histEditAll, roster, canWrite: !!view && view.canWrite,
    });
    const choose = (key: string) => {
        tankOrder.leaving(key);
        progress.choose(key);
    };

    // ---- save / publish -----------------------------------------------------------------------
    // a ref, not `saving`: a second Ctrl+S while the tank order question is open must not save past it
    const saveBusy = useRef(false);
    const save = async () => {
        if (!view || saving || saveBusy.current) return;
        saveBusy.current = true;
        setSaving(true);
        try {
            const followed = await tankOrder.beforeSave();
            const v = await saveRaidplan({ event: eventId, version: view.plan.version, bosses: toSave(followed || draft, bossKeys) });
            setView(v);
            reset(v.plan.bosses);
            setConflict(false);
            toast(v.dropped ? t("raidBoard.bar.savedDropped", { count: v.dropped }) : t("raidBoard.bar.saved"));
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
        } finally {
            saveBusy.current = false;
            setSaving(false);
        }
    };

    // unsaved changes stand out: glowing tool bar and save button, a strip, marked boss chips, "● " in the tab title, Ctrl+S, a warning on leaving
    const saveState: SaveStateKind = conflict ? "conflict" : dirty ? "dirty" : "clean";
    const savedFlash = useUnsavedGuard(saveState, saving, () => { save(); });
    const unsavedKeys = useMemo(() => (view && dirty ? dirtyKeys(draft, view.plan.bosses, bossKeys) : []), [view, dirty, draft, bossKeys]);

    const publish = async (published: boolean, rotate = false) => {
        setSaving(true);
        try {
            const v = await publishRaidplan({ event: eventId, published, rotate });
            // Only the publishing state changes here: the unsaved draft stays.
            setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, status: v.plan.status, publicPath: v.plan.publicPath } } : v));
            toast(rotate ? t("raidBoard.share.rotated") : published ? t("raidBoard.share.published") : t("raidBoard.share.unpublished"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    /** "Gruppen im Plan" (#529): written at once (no version step, the draft stays); shown at once, back on an error. */
    const setGroups = async (next: IncludedGroups | null) => {
        if (!view || groupsBusy) return;
        const before = view.plan.includedGroups ?? null;
        setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, includedGroups: next } } : cur));
        setGroupsBusy(true);
        try {
            const r = await saveRaidplanGroups({ event: eventId, includedGroups: next });
            setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, includedGroups: r.includedGroups } } : cur));
        } catch (err) {
            setView((cur) => (cur ? { ...cur, plan: { ...cur.plan, includedGroups: before } } : cur));
            toast((err as ApiError).message, "err");
        } finally {
            setGroupsBusy(false);
        }
    };

    // ---- templates ----------------------------------------------------------------------------
    const applyTemplate = async (tpl: RaidplanTemplateSummary) => {
        if (!view) return;
        // a template of another game version (#544) is only applied after a warning
        const otherVersion = (tpl.versionId || "tbc") !== view.versionId;
        if (otherVersion && !(await ask({ title: t("raidBoard.template.otherTitle"), text: t("raidBoard.template.otherText", { name: tpl.name, version: versionLabel([], tpl.versionId || "tbc"), event: versionLabel([], view.versionId) }), action: t("raidBoard.template.otherAction"), tone: "danger", icon: "inv_misc_map02" }))) return;
        const needsAsk = dirty || planHasContent(view.plan.bosses, bossKeys);
        if (needsAsk && !(await ask({ title: t("raidBoard.template.applyTitle", { name: tpl.name }), text: t("raidBoard.template.applyText"), action: t("raidBoard.template.applyAction"), tone: "primary", icon: "inv_misc_map02" }))) return;
        setSaving(true);
        try {
            // The server copies the template onto the *saved* plan; unsaved edits are replaced by it (asked above).
            const v = await applyRaidplanTemplate({ event: eventId, templateId: tpl.id, version: view.plan.version, ...(otherVersion ? { otherVersion: true } : {}) });
            setView(v);
            reset(v.plan.bosses);
            setConflict(false);
            setModal("");
            toast(t("raidBoard.template.applied", { name: tpl.name }));
            // what the setup could not fill, in one sentence ("2 Einteilungen offen: Magier, Jäger fehlen")
            const vr = rosterOfView(v);
            const open = openAssignments(v.bosses.map((b) => ({ key: b.key, name: b.name, board: ensureBesetzung(boardOf(v.plan.bosses, b.key), v.besetzung, vr.roster) })), vr.roster, vr.outside);
            if (open.length > 0) toast(openSummary(open), "err");
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "conflict") setConflict(true); else toast(e.message, "err");
            setModal("");
        } finally {
            setSaving(false);
        }
    };

    // ---- tactic profiles ----------------------------------------------------------------------
    // a library tactic ADDS its steps under the section's (nothing is replaced, so nothing to ask)
    const pickProfile = (profile: RaidplanProfile) => {
        editBoard((b) => applyTactic(b, profile));
        setModal("");
        toast(t("raidBoard.steps.library.applied", { name: profile.name, n: (profile.steps || []).length }));
    };
    // the tactics of the plan's game version only (#544); the name of an applied one is looked up in all of them
    const planVersion = view ? view.versionId : "";
    const versionProfiles = useMemo(() => (planVersion ? ofVersion(profiles, planVersion) : profiles), [profiles, planVersion]);
    const categories = useMemo(() => [...new Set(versionProfiles.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [versionProfiles]);
    const profile = profiles.find((p) => p.id === board.profileId) || null;
    const offered = useMemo(() => splitByVersion(view ? view.templates : [], planVersion), [view, planVersion]);

    if (plan.error) return <div className="empty">{t("raidDetail.page.loadError", { message: plan.error.message })}</div>;
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
    const empty = objectCount(board) === 0;
    // "Link kopieren": the read view's address, once the plan is shared (before that the button says so instead)
    const linkReady = published && !!view.plan.publicPath;
    const copyLink = async () => {
        if (!linkReady) { toast(t("raidBoard.views.copyLinkOff")); return; }
        try {
            await navigator.clipboard.writeText(`${window.location.origin}${view.plan.publicPath}`);
            toast(t("raidBoard.share.copied"));
        } catch {
            // no clipboard permission: the share dialog shows the link to copy by hand
            setModal("share");
        }
    };

    return (
        <div className="rp-editor" data-rp-editor>
            {conflict && (
                <div className="flash flash-err rp-conflict">
                    <span>{t("raidBoard.conflict.text")}</span>
                    <IconButton size="sm" icon={<RotateCw size={16} />} tip={t("raidBoard.conflict.reload")} onClick={plan.reload} />
                </div>
            )}
            {view.rosterSource && <RhSource src={view.rosterSource} busy={reloading} onReload={reloadRoster} />}
            {canWrite && !view.rosterSource && !view.hasApprovedSetup && (
                <p className="rp-warn">{roster.length === 0 ? t("raidBoard.setupHint.none") : t("raidBoard.setupHint.notApproved")}</p>
            )}
            {canWrite && empty && !view.plan.templateName && offered.own.length > 0 && (
                <p className="rp-muted rp-tpl-hint"><span>{t("raidBoard.template.hintEmpty")}</span> <Button variant="ghost" size="sm" onClick={() => setModal("template")}>{t("raidBoard.template.pick")}</Button></p>
            )}

            {boss && (
                <RaidplanBoundary resetKey={selected}>
                <BoardWorkspace
                    mode="event" eventId={eventId} besetzung={view.besetzung} catalog={view.catalog} boss={boss} allBosses={view.bosses} board={board} edit={editBoard} editAll={editAllBoards} roster={roster} outside={outside} canWrite={canWrite} limits={view.limits}
                    profileName={profile ? profile.name : ""} onPickProfile={() => setModal("pick")} onSaveTactic={() => setModal("save")}
                    history={{ undo, redo, canUndo, canRedo }}
                    mapRows={mapRows} onMapsChanged={reloadMaps} me={mine}
                    defaultRows={boardOf(draft, DEFAULTS_KEY).assignments}
                    saveState={canWrite ? saveState : "clean"} notice={canWrite ? <UnsavedBar state={saveState} sections={unsavedKeys.length} busy={saving} onSave={save} conflictText={t("raidBoard.conflict.text")} /> : undefined}
                    urlView
                    bossNav={<SectionStrip dirtyKeys={unsavedKeys} bosses={view.bosses} selected={selected} draft={draft} onSelect={choose}killedKeys={progress.killed} follow={progress.chip} onSheet={canWrite ? (k, on) => setSheet({ [k]: on }) : undefined} onMap={canWrite ? (k, on) => histEditAll([k], (b) => ({ ...b, showMap: on })) : undefined} openCounts={canWrite ? openCounts : undefined} />}
                    besetzungTools={<PlanGroups roster={view.roster} groupCount={view.besetzung ? view.besetzung.groups : 5} included={included} canWrite={canWrite} busy={groupsBusy} onChange={setGroups} />}
                    status={(
                        <>
                            <Badge tone={published ? "ok" : undefined} tip={published ? t("raidBoard.views.publishedTip") : t("raidBoard.views.draftTip")}>{published ? t("raidBoard.bar.published") : t("raidBoard.bar.draft")}</Badge>
                            {!canWrite && <Badge>{t("raidBoard.bar.readOnly")}</Badge>}
                            {canWrite && <SaveButton state={saveState} busy={saving} flash={savedFlash} onSave={save} />}
                        </>
                    )}
                    actions={(
                        <>
                            <Button
                                variant="ghost" size="sm" icon={<Link2 size={15} aria-hidden="true" />} aria-disabled={!linkReady || undefined} className={linkReady ? "" : "rp-copylink-off"}
                                data-tip={linkReady ? t("raidBoard.views.copyLinkTip") : t("raidBoard.views.copyLinkOff")} onClick={copyLink}
                            >
                                {t("raidBoard.views.copyLink")}
                            </Button>
                            {canWrite && <Button size="sm" data-tip={published ? t("raidBoard.views.shareTip") : t("raidBoard.views.publishTip")} onClick={() => setModal("share")}>{published ? t("raidBoard.views.share") : t("raidBoard.views.publish")}</Button>}
                            {canWrite && (
                                <ToolMenu
                                    label={t("raidBoard.views.more")} icon={<MoreHorizontal size={16} aria-hidden="true" />} iconOnly align="end" tip={t("raidBoard.views.more")} tipSub={t("raidBoard.views.moreSub")}
                                    items={[
                                        { id: "template", label: t("raidBoard.template.pick"), sub: view.plan.templateName ? t("raidBoard.template.current", { name: view.plan.templateName }) : t("raidBoard.template.emptyText"), icon: <LayoutTemplate size={16} />, onSelect: () => setModal("template") },
                                        { id: "post", label: t("raidBoard.bar.postLink"), sub: dirty ? t("raidBoard.bar.postLinkUnsaved") : t("raidBoard.bar.postLinkSub"), icon: <Send size={16} />, onSelect: openPost },
                                        { id: "open", label: openRows.length === 1 ? t("raidBoard.aline.openPlanOne") : t("raidBoard.aline.openPlan", { n: openRows.length }), sub: t("raidBoard.views.openListSub"), icon: <AlertTriangle size={16} />, disabled: openRows.length === 0, onSelect: () => setModal("open") },
                                    ]}
                                />
                            )}
                        </>
                    )}
                />
                </RaidplanBoundary>
            )}

            <Modal open={modal === "open"} onClose={() => setModal("")} icon={<AlertTriangle size={20} />} tone="mid" title={t("raidBoard.aline.openTitle")} width={560} hint={t("raidBoard.aline.openHint")}>
                <ul className="rp-openlist">
                    {groupOpen(openRows).map((sec) => (
                        <li key={sec.key}>
                            <button type="button" className="rp-openlist-sec" onClick={() => { choose(sec.key); setModal(""); }}>{sec.name}</button>
                            <ul>
                                {sec.rows.map((o) => <li key={o.rowId}><span className="rp-openlist-type">{t(`raidBoard.assign.type.${o.type}`)}</span> {t("raidBoard.aline.missing", { what: o.missing.join(", ") })}</li>)}
                            </ul>
                        </li>
                    ))}
                </ul>
            </Modal>

            <Modal open={modal === "template"} onClose={() => setModal("")} icon="inv_misc_map02" title={t("raidBoard.template.pickTitle")} width={520} hint={t("raidBoard.template.hint")}>
                <ul className="rp-pick">
                    <li>
                        <div className={`rp-pick-row rp-pick-profile${view.plan.templateId ? "" : " is-on"}`}>
                            <span className="rp-pick-name">{t("raidBoard.template.empty")}</span>
                            <span className="rp-muted">{t("raidBoard.template.emptyText")}</span>
                        </div>
                    </li>
                    {offered.own.map((tpl) => (
                        <li key={tpl.id}>
                            <button type="button" className={`rp-pick-row rp-pick-profile${tpl.id === view.plan.templateId ? " is-on" : ""}`} disabled={saving} onClick={() => applyTemplate(tpl)}>
                                <span className="rp-pick-name">{tpl.name}{tpl.category ? ` · ${tpl.category}` : ""}</span>
                                <span className="rp-muted">{tpl.description || t("raidBoard.template.bosses", { count: tpl.bossCount })}</span>
                            </button>
                        </li>
                    ))}
                    {view.templates.length === 0 && <li className="rp-muted">{t("raidBoard.template.noneYet")}</li>}
                    {view.templates.length > 0 && offered.own.length === 0 && <li className="rp-muted rp-pick-note">{t("raidBoard.template.noneOfVersion", { version: versionLabel([], view.versionId) })}</li>}
                </ul>
                {offered.other.length > 0 && (
                    <details className="rp-pick-other">
                        <summary className="rp-muted">{t("raidBoard.template.otherVersions", { count: offered.other.length })}</summary>
                        <ul className="rp-pick">
                            {offered.other.map((tpl) => (
                                <li key={tpl.id}>
                                    <button type="button" className={`rp-pick-row rp-pick-profile${tpl.id === view.plan.templateId ? " is-on" : ""}`} disabled={saving} onClick={() => applyTemplate(tpl)}>
                                        <span className="rp-pick-name">{tpl.name} <Badge>{t("raidBoard.template.otherVersionTag", { version: versionLabel([], tpl.versionId || "tbc") })}</Badge></span>
                                        <span className="rp-muted">{tpl.description || t("raidBoard.template.bosses", { count: tpl.bossCount })}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
            </Modal>
            <LibraryModal
                open={modal === "pick"} onClose={() => setModal("")} profiles={versionProfiles} bosses={view.bosses} bossKey={selected} bossName={boss ? boss.name : ""}
                onPick={pickProfile} canSave={stepsOf(board).length > 0}
                onSaveAs={() => setModal("save")}
                onManage={() => setModal("profiles")}
            />
            <ProfilesModal
                open={modal === "profiles" || modal === "save"} onClose={() => setModal("")}
                profiles={versionProfiles} categories={categories} bosses={view.bosses} bossKey={selected} versionId={view.versionId}
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
                sections={view.bosses.filter((b) => !b.defaults && (boardCount(draft, b.key) > 0 || !sheetIncluded(draft, b.key)))} draft={draft} onSheet={setSheet}
                onPublish={(p) => publish(p)} onRotate={() => publish(true, true)}
            />
        </div>
    );
}

/** The open rows grouped by their section, in the plan's order. */
function groupOpen(list: OpenRow[]): { key: string; name: string; rows: OpenRow[] }[] {
    const out: { key: string; name: string; rows: OpenRow[] }[] = [];
    for (const o of list) {
        let sec = out.find((x) => x.key === o.key);
        if (!sec) { sec = { key: o.key, name: o.name, rows: [] }; out.push(sec); }
        sec.rows.push(o);
    }
    return out;
}
