import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image as ImageIcon, ImageOff } from "lucide-react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer, Besetzung as BesetzungData } from "../../../api";
import PlanBoard, { TokenIcon } from "../../../components/raidplan/PlanBoard";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { useBoardView } from "../../../hooks/useBoardView";
import { viewFromSaved } from "../../../lib/raidplan/boardView";
import MiniMap from "../../../components/raidplan/MiniMap";
import { useViewPrefs } from "../../../hooks/useViewPrefs";
import { useToast } from "../../../components/Jobs";
import { inheritedRows } from "../../../lib/raidplan/inherit";
import { autoPlaces, deriveAuto } from "../../../lib/raidplan/autoPlace";
import { addItems, selectionBox, toggleItem, type SelItem } from "../../../lib/raidplan/multiSelect";
import { useT } from "../../../i18n";
import { layerList, slotTally, insertObject, objectName, placeSlot, rosterMap, unplaced, type InsertSpec, type Selection } from "../../../lib/raidplan";
import TargetsPanel from "./TargetsPanel";
import StepsCard from "./StepsCard";
import MyTasksPreview from "./MyTasksPreview";
import Palette from "./Palette";
import type { MapRow } from "./MapPanel";
import ContextMenu from "./ContextMenu";
import AssignPanel from "./AssignPanel";
import Besetzung from "./Besetzung";
import MobsBar from "./MobsBar";
import AssignRosterModal from "./AssignRosterModal";
import { expandClassRefs } from "../../../lib/raidplan/classRefs";
import { assignmentLinks, bossIconOf, scopeOf, sectionMobs as sectionMobsOf } from "../../../lib/raidplan/assign";
import { NO_AUTO, boardPxOf, toBoardPoint, type Menu } from "./workspace/types";
import { useMapSize } from "./workspace/useMapSize";
import { useBoardSelection, useSelectionEdits } from "./workspace/useBoardSelection";
import { useBoardDrag } from "./workspace/useBoardDrag";
import { useRubberBand, useSelectionScale } from "./workspace/useRubberBand";
import { useBoardKeys } from "./workspace/useBoardKeys";
import { useBoardMenu } from "./workspace/useBoardMenu";
import { tankRowActions } from "./workspace/tankRows";
import { WorkspaceToolbar } from "./workspace/WorkspaceToolbar";
import { WorkspaceSide, type DockTab } from "./workspace/WorkspaceSide";

/**
 * The working area of one boss, shared by the event plan and the raid plan
 * template (one component, so both behave the same). Everything one edits is in
 * view at once, inside the menu's normal page frame:
 *
 *   a sticky tool bar (undo / redo, quick inserts, the parent's status and actions)
 *   the boss chips (the parent's)
 *   the players not placed yet (an event plan)
 *   [ palette | the board | properties + background + layers ]
 *   the target rows and the note
 *
 * The palette and the right panel can be folded away for a bigger board. Everything
 * on the board is dragged with Pointer Events on window (no HTML5 drag and drop, so a
 * finger works like a mouse): palette entries and players from the list onto the
 * board or a slot, objects around the board, a zone's corners and a line's ends to
 * scale them. Right click (long press on touch) opens the board's own menu. A
 * selected object moves with the arrow keys (Shift = bigger steps), Delete removes it,
 * Enter jumps to its properties; Ctrl+Z / Ctrl+Y undo and redo.
 */
export default function BoardWorkspace({
    mode, eventId, besetzung, catalog, boss, allBosses, board, edit, editAll, roster, canWrite, limits, profileName, onPickProfile, onSaveTactic, saveState, notice, history, status, actions, bossNav, mapRows, onMapsChanged, defaultRows, onCopyDefaults, me,
}: {
    mode: "event" | "template";
    /** the event whose plan this is ("" in a template): suggestions read its lineup */
    eventId: string;
    /** the role slots of this raid (Tank 1..n ...): shown as the Besetzung, assignable without being on the map */
    besetzung: BesetzungData;
    /** the mobs and spells the assignments can name */
    catalog: Catalog | null;
    boss: RaidplanBoss;
    /** every boss of the plan: the palette offers their icons */
    allBosses: RaidplanBoss[];
    board: RaidplanBoard;
    /** Applies a change to this boss's board; `coalesce` = one step of undo with the change right before (a drag, a slider). */
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    /** The players of the setup (empty in a template). */
    roster: RaidplanPlayer[];
    canWrite: boolean;
    /** the same change on every board of the plan (colours and marks of the groups are plan-wide); without it only this board */
    editAll?: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    limits: { targetsPerBoss: number; title: number; notes: number };
    profileName: string;
    /** opens the tactic library ("Aus Bibliothek wählen") */
    onPickProfile: () => void;
    /** "Als Taktik speichern": the section's steps into the library */
    onSaveTactic?: () => void;
    /** unsaved changes / a conflict: the sticky tool bar glows (amber / red) */
    saveState?: "clean" | "dirty" | "conflict";
    /** the unsaved strip at the top of the sticky tool bar */
    notice?: ReactNode;
    history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
    /** Badges at the left of the tool bar (published, unsaved …). */
    status?: ReactNode;
    /** Icon buttons at the right of the tool bar (template, share, save …). */
    actions?: ReactNode;
    /** The boss chips, under the tool bar. */
    bossNav: ReactNode;
    mapRows: MapRow[];
    onMapsChanged: () => void;
    /** template editor: the rows of the Standard (inherited by every boss) and the action that writes them into every boss */
    defaultRows?: RaidplanAssignment[];
    onCopyDefaults?: () => void;
    /** the logged-in user's own characters in the lineup (highlighted on the board and in the lines) */
    me?: string[];
}) {
    const t = useT();
    const toast = useToast();
    const [menu, setMenu] = useState<Menu | null>(null);
    const [tab, setTab] = useState<DockTab>("props");
    const { mapSize, mapPx, chooseMapSize, startSplit } = useMapSize();
    const [showBes, setShowBes] = useState(true);
    const [rosterOpen, setRosterOpen] = useState(false);
    // the read view's picture without editor chrome (no grips, chips, selection): a check of how the sheet will look
    const [preview, setPreview] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [showPalette, setShowPalette] = useState(() => window.innerHeight > 1000);
    const [showPanel, setShowPanel] = useState(true);
    const [showLinks, setShowLinks] = useState(true);
    /** the group the map highlights (the others dim): a view setting, not part of the plan */
    const [focusGroup, setFocusGroup] = useState(0);
    /** a request to AssignPanel to open a row's dialog (from the map: "Tank wählen …", "Zeile bearbeiten …") */
    const [rowReq, setRowReq] = useState<{ id: string; n: number } | null>(null);
    const boardRef = useRef<HTMLDivElement>(null);
    const frameEl = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLElement>(null);
    const workRef = useRef<HTMLDivElement>(null);
    const players = useMemo(() => rosterMap(roster), [roster]);
    const isEvent = mode === "event";
    const scope = scopeOf(boss);
    /** no map board: "Allgemein" (raid-wide rows) and the Standard (the basics every boss inherits) are only assignments */
    const noBoard = scope === "general" || scope === "defaults";
    // a boss / trash section can do without its map ("Karte anzeigen" off): only the assignments, the tactic and the Besetzung, in the
    // full width; the objects on the map stay stored and come back when it is switched on again
    const mapOff = !noBoard && board.showMap === false;
    const noMap = noBoard || mapOff;
    const mobs = useMemo(() => sectionMobsOf(scope, boss.key, boss.name, bossIconOf(boss.iconUrl), boss.instanceId, board, catalog), [scope, boss.key, boss.name, boss.iconUrl, boss.instanceId, board, catalog]);
    const inherited = useMemo(() => (defaultRows && !noBoard ? inheritedRows(defaultRows, board.inheritOff, { bossMob: scope === "boss" ? mobs.find((m) => m.id.indexOf("b:") === 0) || null : null, mobs }) : []), [defaultRows, noBoard, board.inheritOff, mobs, scope]);
    // the EFFECTIVE rows of the section: its own and the ones it inherits from the Standard, class references resolved - what the lines and the facing of icons follow
    const filledRows = useMemo(() => expandClassRefs([...board.assignments, ...inherited], board.slots, roster, board.roles), [board.assignments, inherited, board.slots, board.roles, roster]);
    // what the tank rows put on the map by themselves: the mobs they name and their tanks (lib/raidplan/autoPlace.ts); nothing without a map
    const auto = useMemo(() => (noMap ? NO_AUTO : deriveAuto(filledRows, board, { template: !isEvent, roster })), [noMap, filledRows, board, isEvent, roster]);
    // a raider the tank rows put on the map is placed (not in the list, not in his group ring)
    const missing = useMemo(() => unplaced(roster, { ...board, autoUsers: auto.users }), [roster, board, auto]);
    const links = useMemo(() => (showLinks ? assignmentLinks({ ...board, assignments: filledRows, places: autoPlaces(auto) }, me || []) : []), [showLinks, board, filledRows, me, auto]);
    // where the objects of the tank rows stand now: handed to the selection code (rubber band, Ctrl+A, moving / scaling / aligning a selection)
    // as the transient `autoAt`, and taken off again before the board is kept
    const autoAt = useMemo(() => {
        const at: Record<string, { x: number; y: number }> = {};
        for (const m of auto.mobs) if (!m.iconId) at[m.key] = { x: m.x, y: m.y };
        for (const k of auto.tanks) if (!k.existing) at[k.key] = { x: k.x, y: k.y };
        return at;
    }, [auto]);
    const withAuto = (b: RaidplanBoard): RaidplanBoard => ({ ...b, autoAt });
    const noAuto = (b: RaidplanBoard): RaidplanBoard => { const out = { ...b }; delete out.autoAt; return out; };
    const groupCount = Math.max(besetzung.groups, ...roster.map((p) => p.group));
    const boardNow = useRef(board);
    boardNow.current = board;
    const toBoard = (x: number, y: number) => toBoardPoint(boardRef.current, frameEl.current, x, y);
    /** The board's size in px (for the boxes of text and group markers). */
    const boardPx = () => boardPxOf(boardRef.current);

    const { selected, setSelected, multi, setMulti, currentSel, chooseItems } = useBoardSelection({ board, bossKey: boss.key, withAuto, onBossChange: () => setMenu(null) });
    // zoom and pan: a view setting; the frame is what shows the picture, boardRef its (transformed) canvas: dragging measures the canvas, so it is exact at any zoom
    const bv = useBoardView({ touchPan: !selectMode, arrows: !selected && multi.length === 0, onEmptyClick: () => chooseItems([]) });
    const [prefs, setPref] = useViewPrefs("eh.raidplan.viewPrefs");
    const setFrame = useCallback((el: HTMLDivElement | null) => { frameEl.current = el; bv.frame(el); }, [bv.frame]); // eslint-disable-line react-hooks/exhaustive-deps
    // the board opens with the cutout saved for it - exactly what the sheet (/p/<token>) opens with; saving, removing or undoing it shows at once
    const savedKey = board.view ? `${board.view.zoom}:${board.view.cx}:${board.view.cy}` : "";
    useEffect(() => { bv.set(viewFromSaved(board.view)); }, [boss.key, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // The workspace is one screen: opening it scrolls the page so the tool bar sits under the header (wide screens only).
    useEffect(() => {
        const el = workRef.current;
        if (el && window.innerWidth >= 1000 && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    }, []);

    const edits = useSelectionEdits({ edit, boardNow, currentSel, chooseItems, withAuto, noAuto, boardPx, onSkipped: (n) => toast(t("raidBoard.multi.skipped", { n })) });
    const frame = multi.length > 1 ? selectionBox(withAuto(board), multi, boardPx()) : null;
    const tanks = tankRowActions({ board, edit, inherited, auto, mobs, scope, players, t, requestRow: (id) => setRowReq({ id, n: Date.now() }) });
    const blocked = (kind: string) => toast(t("raidBoard.slot.allPlaced", { what: t(`raidBoard.slot.kind.${kind}`) }));

    const specLabel = (spec: InsertSpec): string => {
        if (spec.type === "mark") return t(`raidBoard.mark.${spec.mark}`);
        if (spec.type === "place") { const s = board.slots.find((x) => x.id === spec.slotId); return s ? t(`raidBoard.slot.${s.kind}`, { n: s.n }) : ""; }
        if (spec.type === "slot") return t(`raidBoard.slot.kind.${spec.kind}`);
        if (spec.type === "zone") return spec.zoneType === "role" ? t(`raidBoard.roleGroup.${spec.role || "melee"}`) : t(`raidBoard.zone.${spec.zoneType}`);
        if (spec.type === "line") return t(`raidBoard.line.${spec.kind}`);
        return t("raidBoard.tool.text");
    };

    /** Puts something new on the board, selects it and shows its properties. */
    const insert = (spec: InsertSpec, at: { x: number; y: number } | null) => {
        if (spec.type === "place") {
            // a slot of the Besetzung goes onto the map
            edit((b) => placeSlot(b, spec.slotId, at));
            setSelected({ kind: "slot", id: spec.slotId });
            return;
        }
        const r = insertObject(boardNow.current, spec, at);
        if (r.blocked) { blocked(r.blocked); return; }
        edit(() => r.board);
        setSelected(r.sel);
        setTab("props");
    };

    // ---- the properties panel ------------------------------------------------------------
    const focusProperties = (selector = "input, select") => {
        setTab("props");
        setShowPanel(true);
        window.setTimeout(() => {
            const el = panelRef.current ? panelRef.current.querySelector<HTMLElement>(selector) : null;
            if (el) el.focus();
        }, 0);
    };

    // ---- right click / long press, dragging, the rubber band, scaling, keys ---------------
    const { openMenu, onContext, menuItems, menuLabel, pickMenu, menuTitle } = useBoardMenu({
        menu, setMenu, canWrite, isEvent, board, auto, mobs, players, t, toBoard, boardPx, multi, setMulti, setSelected, chooseItems, edit,
        multiAction: edits.multiAction, doDuplicate: edits.doDuplicate, doDelete: edits.doDelete, focusProperties, tanks, onBlocked: blocked, onInserted: () => setTab("props"),
    });
    const { drag, startDrag, startPalette, startFrameDrag, cancelDrag } = useBoardDrag({
        board, boardNow, edit, canWrite, multi, selectMode, currentSel, chooseItems, setSelected, setMulti, toBoard, boardPx, withAuto, noAuto, insert,
    });
    const { band, boardWrapDown, boardWrapMove, boardWrapEnd } = useRubberBand({
        canWrite, noMap, selectMode, boardNow, toBoard, boardPx, withAuto, currentSel, chooseItems, openMenu, cancelDrag,
    });
    const { startScale } = useSelectionScale({ multi, boardEl: () => boardRef.current, boardNow, withAuto, noAuto, centerOf: edits.centerOf, edit });
    const { onKey } = useBoardKeys({
        canWrite, noMap, boardNow, boardRef, bossKey: boss.key, selected, setSelected, multi, auto, edit, history, clip: edits.clip, currentSel, chooseItems, withAuto,
        multiAction: edits.multiAction, centerOf: edits.centerOf, boardPx, doDelete: edits.doDelete, doDuplicate: edits.doDuplicate, doCopy: edits.doCopy, doPaste: edits.doPaste,
        focusProperties, onNoDelete: () => toast(t("raidBoard.auto.noDelete")),
    });

    /** A placed chip of the Besetzung was clicked: select the slot on the map and let it blink for a moment. */
    const showSlot = (slotId: string) => {
        setSelected({ kind: "slot", id: slotId });
        // after the re-render of the selection (it would rewrite the class)
        window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-slot="${slotId}"]`);
            if (!el) return;
            el.classList.add("is-flash");
            window.setTimeout(() => el.classList.remove("is-flash"), 1300);
        }, 30);
    };

    /** A click in the layer list: one row, Ctrl adds / removes it, Shift takes the rows between it and the last one. */
    const onLayerSelect = (sel: Selection, mods?: { toggle: boolean; range: boolean }) => {
        if (!sel) { chooseItems([]); return; }
        const item = sel as SelItem;
        if (mods && mods.range && currentSel().length > 0) {
            const rows = layerList(boardNow.current, players).map((r) => ({ kind: r.kind, id: r.id }));
            const last = currentSel()[currentSel().length - 1];
            const a = rows.findIndex((r) => r.kind === last.kind && r.id === last.id);
            const b = rows.findIndex((r) => r.kind === item.kind && r.id === item.id);
            if (a >= 0 && b >= 0) { chooseItems(addItems(currentSel(), rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter((r) => r.kind !== "member"))); return; }
        }
        if (mods && mods.toggle) { chooseItems(toggleItem(currentSel(), item)); return; }
        chooseItems([item]);
    };

    const dragPlayer = drag && drag.kind === "tray" ? players.get(drag.id) || null : null;
    const dragKey = drag && drag.moved && drag.handle !== "size" && drag.handle !== "rot" && drag.kind !== "tray" && drag.kind !== "palette" ? `${drag.kind}:${drag.id}` : "";
    const toggle = (on: boolean, set: (fn: (v: boolean) => boolean) => void) => ({ on, toggle: () => set((v) => !v) });

    return (
        <div className="rp-work" ref={workRef}>
            <WorkspaceToolbar
                canWrite={canWrite} saveState={saveState} notice={notice} history={history} onInsert={(spec) => insert(spec, null)}
                palette={toggle(showPalette, setShowPalette)} selectMode={toggle(selectMode, setSelectMode)} bes={toggle(showBes, setShowBes)} panel={toggle(showPanel, setShowPanel)} preview={toggle(preview, setPreview)}
                onRoster={() => setRosterOpen(true)} board={board} edit={edit} noBoard={noBoard} noMap={noMap} mapOff={mapOff}
                onMapOff={(off) => { edit((b) => ({ ...b, showMap: !off })); if (off) toast(t("raidBoard.map.hiddenKept")); }}
                bv={bv} prefs={prefs} setPref={setPref} links={showLinks} onLinks={setShowLinks} mapSize={mapSize} chooseMapSize={chooseMapSize}
                status={status} actions={actions} bossNav={bossNav}
            />

            {(showPalette || showBes) && (
                <div className="rp-bands">
                    {showPalette && canWrite && !noMap && (
                        <Palette onStart={startPalette} onInsert={(spec) => insert(spec, null)} bosses={allBosses} currentBoss={boss.key} tally={slotTally(board)} />
                    )}
                    {showBes && (
                        <Besetzung
                            board={board} besetzung={besetzung} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite} edit={edit} editAll={editAll || edit}
                            onPlaceDown={(e, slotId) => startPalette(e, { type: "place", slotId })}
                            onChipDown={(e, slotId) => startPalette(e, { type: "place", slotId }, true)}
                            onShow={showSlot} onAssign={() => setRosterOpen(true)}
                        />
                    )}
                </div>
            )}

            {mapOff && (
                <p className="rp-mapoff" role="status">
                    <ImageOff size={16} aria-hidden="true" /><span>{t("raidBoard.map.offNote")}</span>
                    {canWrite && <button type="button" className="rp-acard-add" onClick={() => edit((b) => ({ ...b, showMap: true }))}><ImageIcon size={14} aria-hidden="true" />{t("raidBoard.map.show")}</button>}
                </p>
            )}
            {!noMap && (
            <div className={`rp-stage2${showPanel && !noBoard ? "" : " no-dock"}`}>
                {!noBoard && (
                <div
                    className={`rp-board-wrap${bv.hand ? " is-hand" : ""}${bv.panning ? " is-panning" : ""}${bv.view.z > 1 ? " is-pannable" : ""}`}
                    onPointerDown={boardWrapDown} onPointerMove={boardWrapMove} onPointerUp={boardWrapEnd} onPointerCancel={boardWrapEnd}
                >
                    <PlanBoard
                        boardRef={boardRef} frameRef={setFrame} view={bv.view}
                        showNames={board.showNames !== false} showBadges={board.showBadges !== false} showRoleRings={board.showRoleRings !== false} highlightMe={prefs.highlight} showSelection={prefs.selection}
                        bossName={boss.name}
                        bossIcon={boss.iconUrl}
                        mapUrl={boss.mapUrl}
                        mapOpacity={board.mapOpacity}
                        tokens={board.tokens}
                        slots={board.slots}
                        marks={board.marks}
                        icons={board.icons}
                        objectScale={board.objectScale}
                        zones={board.zones}
                        lines={board.lines}
                        assignments={filledRows}
                        texts={board.texts}
                        players={players}
                        roster={roster}
                        selected={selected}
                        dragKey={dragKey}
                        onObjectDown={canWrite && !preview ? (e, kind, id, handle) => startDrag(e, kind, id, handle) : undefined}
                        onObjectKey={canWrite && !preview ? onKey : undefined}
                        onObjectOpen={canWrite && !preview ? (kind, id) => { setSelected({ kind, id }); focusProperties(); } : undefined}
                        onContext={canWrite && !preview ? onContext : undefined}
                        links={links}
                        maxHeight={mapPx}
                        me={me} showRings={board.showRings !== false} groupColors={board.groupColors} groupMarks={board.groupMarks} focusGroup={focusGroup}
                        multi={multi} multiBox={frame} band={band} onMultiScale={canWrite && !preview ? startScale : undefined} onMultiMove={canWrite && !preview ? startFrameDrag : undefined} auto={auto}
                        emptyText={canWrite ? `${t("raidBoard.board.noMapTitle")} · ${t("raidBoard.board.noMapText")}` : t("raidBoard.board.noMapTitle")}
                    />
                    {prefs.minimap && bv.view.z > 1 && <MiniMap mapUrl={boss.mapUrl} view={bv.view} onCenter={bv.centerAt} label={t("raidBoard.zoom.minimap")} />}
                </div>
                )}
                {!noBoard && (showPanel || (isEvent && roster.length >= 0)) && (
                    <WorkspaceSide
                        isEvent={isEvent} showPanel={showPanel} roster={roster} missing={missing} overTray={!!drag && drag.overTray} canWrite={canWrite}
                        onTrayDown={(e, userId) => startDrag(e, "tray", userId)} panelRef={panelRef} tab={tab} setTab={setTab}
                        board={board} edit={edit} editAll={editAll || edit} withAuto={withAuto} noAuto={noAuto} boardPx={boardPx} players={players}
                        selected={selected} setSelected={setSelected} multi={multi} auto={auto} rows={filledRows} focusGroup={focusGroup} setFocusGroup={setFocusGroup}
                        onLayerSelect={onLayerSelect} tanks={tanks} mapRows={mapRows} onMapsChanged={onMapsChanged}
                    />
                )}
            </div>
            )}
            {!noMap && (
                <div
                    className="rp-splitter" role="separator" aria-orientation="horizontal" tabIndex={0} aria-label={t("raidBoard.split.label")} aria-valuenow={mapPx} data-tip={t("raidBoard.split.tip")}
                    onPointerDown={startSplit}
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); chooseMapSize({ step: "C", px: mapPx + (e.key === "ArrowDown" ? 30 : -30) }); } }}
                ><span aria-hidden="true" /></div>
            )}
            <div className="rp-below-map">
                {!noBoard && <MobsBar mobs={mobs} board={board} catalog={catalog} bossKey={boss.key} instanceId={boss.instanceId} canWrite={canWrite} edit={edit} />}
                <AssignPanel
                    scope={scope} board={board} edit={edit} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite}
                    eventId={eventId} groupCount={groupCount} links={showLinks} onLinks={setShowLinks}
                    profileName={profileName} onPickProfile={onPickProfile} catalog={catalog} sectionMobs={mobs}
                    inherited={inherited} defaultRows={defaultRows} onCopyDefaults={onCopyDefaults} openRequest={rowReq}
                />
                {isEvent && !noBoard && <MyTasksPreview rows={filledRows} board={board} players={players} catalog={catalog} me={me || []} />}
                <StepsCard
                    board={board} edit={edit} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite} catalog={catalog} sectionMobs={mobs}
                    groupCount={groupCount} bossName={boss.name} onLibrary={onPickProfile} onSaveAs={onSaveTactic || onPickProfile}
                />
                <TargetsPanel board={board} canWrite={canWrite} maxNotes={limits.notes} onChange={(b) => edit(() => b)} />
            </div>
            {rosterOpen && <AssignRosterModal board={board} roster={roster} isEvent={isEvent} canWrite={canWrite} edit={edit} onClose={() => setRosterOpen(false)} />}
            {canWrite && !noMap && <p className="rp-muted rp-hint">{t(isEvent ? "raidBoard.board.hint" : "raidBoard.board.hintTemplate")}</p>}

            {drag && drag.kind === "tray" && dragPlayer && (
                <div className="rp-ghost" style={{ "--rp-x": `${drag.x}px`, "--rp-y": `${drag.y}px` } as React.CSSProperties} aria-hidden="true">
                    <TokenIcon player={dragPlayer} />
                </div>
            )}
            {drag && drag.kind === "palette" && drag.spec && drag.moved && (
                <div className="rp-ghost rp-ghost-pal" style={{ "--rp-x": `${drag.x}px`, "--rp-y": `${drag.y}px` } as React.CSSProperties} aria-hidden="true">
                    {drag.spec.type === "mark" ? <MarkIcon mark={drag.spec.mark as never} size={34} /> : specLabel(drag.spec)}
                </div>
            )}
            {menu && (
                <ContextMenu
                    x={menu.x} y={menu.y}
                    title={menuTitle((kind, id) => objectName(board, kind, id, players), tanks.autoName)}
                    items={menuItems()} labelFor={menuLabel} onPick={pickMenu} onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}
