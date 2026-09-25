import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Eye, BoxSelect, Circle, CircleDashed, ListChecks, Minus, MoveUpRight, PanelLeft, PanelRight, Redo2, Square, Type, Undo2, Users } from "lucide-react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer, Besetzung as BesetzungData } from "../../../api";
import PlanBoard, { PlayerName, TokenIcon, type Handle } from "../../../components/raidplan/PlanBoard";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { IconButton } from "../../../components/ui";
import { useBoardView } from "../../../lib/useBoardView";
import { savedView } from "../../../lib/boardView";
import MiniMap from "../../../components/raidplan/MiniMap";
import { useViewPrefs } from "../../../lib/useViewPrefs";
import { ViewOptions, ZoomControls } from "./ViewControls";
import { useToast } from "../../../components/Jobs";
import { inheritedRows } from "../../../lib/inherit";
import { addItems, alignSelection, bandBox, copySelection, deleteSelection, duplicateSelection, hasItem, hitObjects, liveItems, moveSelection, pasteSnapshot, reorderSelection, scaleSelection, setRingSelection, selectableItems, selectionBox, setLookSelection, toggleItem, type Box, type SelItem, type Snapshot } from "../../../lib/multiSelect";
import { useT } from "../../../i18n";
import {
    angleTo, layerList, DEFAULT_MAP_SIZE, mapHeight, parseMapSize, type MapSize, applyMenuAction, assignSlot, placeSlot, slotTally, dropChip, canFace, compassName, snapAngle, turnIcon, updateIcon, contextMenuItems, insertObject, isLocked, lookOf, moveLineEnd, moveObject, moveRect, nudgeObject, objectName, scaleObject, setObjectSize, sizeOf,
    placeToken, ownBadgeGroup, removeObject, removeToken, resizeRect, rosterMap, unplaced, updateLine, updateZone, moveLine, type Corner, type InsertSpec, type MenuItem,
    type ObjectKind, type Rect, type Selection,
} from "../../../lib/raidplan";
import TargetsPanel from "./TargetsPanel";
import StepsCard from "./StepsCard";
import MyTasksPreview from "./MyTasksPreview";
import Palette from "./Palette";
import Inspector, { MapOpacityField, ObjectScaleField } from "./Inspector";
import LayerList from "./LayerList";
import MapPanel, { type MapRow } from "./MapPanel";
import ContextMenu from "./ContextMenu";
import AssignPanel from "./AssignPanel";
import Besetzung from "./Besetzung";
import MobsBar from "./MobsBar";
import AssignRosterModal from "./AssignRosterModal";
import { expandClassRefs } from "../../../lib/classRefs";
import { assignmentLinks, bossIconOf, scopeOf, sectionMobs as sectionMobsOf } from "../../../lib/assign";

type Drag = {
    kind: ObjectKind | "tray" | "palette";
    id: string;
    spec?: InsertSpec;
    /** a chip of the Besetzung is dragged (a click on it must stay a click; the drop does the work) */
    chip?: boolean;
    handle?: Handle;
    /** pointer, in client px (the ghost of a list chip follows it) */
    x: number;
    y: number;
    /** where the pointer went down (a palette entry that never moved is a click) */
    x0: number;
    y0: number;
    moved: boolean;
    /** grip offset, px: the token does not jump under the pointer */
    ox: number;
    oy: number;
    /** where a zone / line and the pointer were when the drag began */
    rect0?: Rect;
    line0?: { id: string; x1: number; y1: number; x2: number; y2: number };
    p0?: { x: number; y: number };
    /** where a slot stood when it was picked up: it goes back there when it is dropped on the list */
    origin?: { x: number; y: number };
    /** scaling by the grip: the size it had, the object's centre on screen and how far the pointer was from it */
    size0?: number;
    center?: { x: number; y: number };
    d0?: number;
    /** Shift was held: a zone keeps its proportions */
    keepRatio?: boolean;
    /** the whole selection is dragged: the board as it was and who moves */
    multi?: { board0: RaidplanBoard; sel: SelItem[] };
    overTray: boolean;
};

type Menu = { x: number; y: number; target: Selection | "board"; at: { x: number; y: number } | null };

const LONG_PRESS_MS = 550;

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
    mode, eventId, besetzung, catalog, boss, allBosses, board, edit, editAll, roster, canWrite, limits, profileName, onPickProfile, onSaveTactic, saveState, notice, history, status, actions, bossNav, csrfToken, mapRows, onMapsChanged, defaultRows, onCopyDefaults, me,
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
    csrfToken: string | null;
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
    const [selected, setSelected] = useState<Selection>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [menu, setMenu] = useState<Menu | null>(null);
    const [tab, setTab] = useState<"props" | "layers" | "bg">("props");
    const [mapSize, setMapSize] = useState<MapSize>(() => { try { const raw = window.localStorage.getItem("eh.raidplan.mapSize"); return raw === null && window.innerHeight <= 1000 ? { step: "S" as const, px: 0 } : parseMapSize(raw); } catch { return DEFAULT_MAP_SIZE; } });
    const [winH, setWinH] = useState(() => window.innerHeight);
    const [splitting, setSplitting] = useState(false);
    const splitRef = useRef({ y: 0, h: 0 });
    const mapPx = mapHeight(mapSize, winH);
    /** Sets and remembers the map's height. */
    const chooseMapSize = (size: MapSize) => {
        const next = size.step === "C" ? { step: "C" as const, px: mapHeight(size, winH) } : size;
        setMapSize(next);
        try { window.localStorage.setItem("eh.raidplan.mapSize", JSON.stringify(next)); } catch { /* private window */ }
    };
    const startSplit = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        splitRef.current = { y: e.clientY, h: mapPx };
        setSplitting(true);
    };
    useEffect(() => {
        const size = () => setWinH(window.innerHeight);
        window.addEventListener("resize", size);
        return () => window.removeEventListener("resize", size);
    }, []);
    useEffect(() => {
        if (!splitting) return undefined;
        const move = (e: globalThis.PointerEvent) => setMapSize({ step: "C", px: mapHeight({ step: "C", px: splitRef.current.h + e.clientY - splitRef.current.y }, window.innerHeight) });
        const up = (e: globalThis.PointerEvent) => { setSplitting(false); chooseMapSize({ step: "C", px: splitRef.current.h + e.clientY - splitRef.current.y }); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [splitting]);
    const [showBes, setShowBes] = useState(true);
    const [rosterOpen, setRosterOpen] = useState(false);
    const [multi, setMulti] = useState<SelItem[]>([]);
    const [band, setBand] = useState<Box | null>(null);
    const [banding, setBanding] = useState(false);
    // a long press on empty ground with a finger arms the rubber band; released without moving it opens the menu
    const menuTapRef = useRef<{ x: number; y: number } | null>(null);
    // the read view's picture without editor chrome (no grips, chips, selection): a check of how the sheet will look
    const [preview, setPreview] = useState(false);
    const [scaling, setScaling] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const bandRef = useRef<{ x0: number; y0: number; add: boolean; base: SelItem[]; moved: boolean; cx: number; cy: number }>({ x0: 0, y0: 0, add: false, base: [], moved: false, cx: 0, cy: 0 });
    const scaleRef = useRef<{ board0: RaidplanBoard; sel: SelItem[]; center: { x: number; y: number }; d0: number; cx: number; cy: number }>({ board0: null as unknown as RaidplanBoard, sel: [], center: { x: 0, y: 0 }, d0: 1, cx: 0, cy: 0 });
    const clip = useRef<{ snap: Snapshot; pastes: number } | null>(null);
    const [showPalette, setShowPalette] = useState(() => window.innerHeight > 1000);
    const [showPanel, setShowPanel] = useState(true);
    const [showLinks, setShowLinks] = useState(true);
    /** the group the map highlights (the others dim): a view setting, not part of the plan */
    const [focusGroup, setFocusGroup] = useState(0);
    const boardRef = useRef<HTMLDivElement>(null);
    // zoom and pan: a view setting; the frame is what shows the picture, boardRef its (transformed) canvas: dragging measures the canvas, so it is exact at any zoom
    const bv = useBoardView({ touchPan: !selectMode, arrows: !selected && multi.length === 0, onEmptyClick: () => chooseItems([]) });
    const [prefs, setPref] = useViewPrefs("eh.raidplan.viewPrefs");
    const frameEl = useRef<HTMLDivElement | null>(null);
    const setFrame = useCallback((el: HTMLDivElement | null) => { frameEl.current = el; bv.frame(el); }, [bv.frame]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { bv.fit(); }, [boss.key]); // eslint-disable-line react-hooks/exhaustive-deps
    const panelRef = useRef<HTMLElement>(null);
    const workRef = useRef<HTMLDivElement>(null);
    // The workspace is one screen: opening it scrolls the page so the tool bar sits under the header (wide screens only).
    useEffect(() => {
        const el = workRef.current;
        if (el && window.innerWidth >= 1000 && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    }, []);
    const dragRef = useRef<Drag | null>(null);
    const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
    const players = useMemo(() => rosterMap(roster), [roster]);
    const missing = useMemo(() => unplaced(roster, board), [roster, board]);
    const isEvent = mode === "event";
    const scope = scopeOf(boss);
    /** no map board: "Allgemein" (raid-wide rows) and the Standard (the basics every boss inherits) are only assignments */
    const noBoard = scope === "general" || scope === "defaults";
    const mobs = useMemo(() => sectionMobsOf(scope, boss.key, boss.name, bossIconOf(boss.iconUrl), boss.instanceId, board, catalog), [scope, boss.key, boss.name, boss.iconUrl, boss.instanceId, board, catalog]);
    const inherited = useMemo(() => (defaultRows && !noBoard ? inheritedRows(defaultRows, board.inheritOff, { bossMob: scope === "boss" ? mobs.find((m) => m.id.indexOf("b:") === 0) || null : null, mobs }) : []), [defaultRows, noBoard, board.inheritOff, mobs, scope]);
    // the EFFECTIVE rows of the section: its own and the ones it inherits from the Standard, class references resolved - what the lines and the facing of icons follow
    const filledRows = useMemo(() => expandClassRefs([...board.assignments, ...inherited], board.slots, roster, board.roles), [board.assignments, inherited, board.slots, board.roles, roster]);
    const links = useMemo(() => (showLinks ? assignmentLinks({ ...board, assignments: filledRows }, me || []) : []), [showLinks, board, filledRows, me]);
    const groupCount = Math.max(besetzung.groups, ...roster.map((p) => p.group));
    const boardNow = useRef(board);
    boardNow.current = board;

    // Another boss: nothing is selected any more.
    useEffect(() => { setSelected(null); setMulti([]); setMenu(null); }, [boss.key]);

    const toBoard = (x: number, y: number) => {
        const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
        if (!rect || !rect.width || !rect.height) return null;
        // "inside" = on the visible part of the picture (zoomed in, the canvas reaches beyond its frame)
        const fr = frameEl.current ? frameEl.current.getBoundingClientRect() : rect;
        return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, w: rect.width, h: rect.height, inside: x >= Math.max(rect.left, fr.left) && x <= Math.min(rect.right, fr.right) && y >= Math.max(rect.top, fr.top) && y <= Math.min(rect.bottom, fr.bottom) };
    };

    /** The board's size in px (for the boxes of text and group markers). */
    const boardPx = () => {
        const r = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
        return { w: r && r.width ? r.width : 1000, h: r && r.height ? r.height : 625 };
    };
    /** Everything that is selected, whether it is one object or several. */
    const currentSel = (): SelItem[] => (multi.length > 1 ? multi : selected ? [selected as SelItem] : []);
    /** Sets the selection: none, one (the inspector shows it) or several (the shared frame). */
    const chooseItems = (items: SelItem[]) => {
        setMulti(items.length > 1 ? items : []);
        setSelected(items.length === 1 ? items[0] : null);
    };
    // what an undo, a delete elsewhere ... took away is no longer selected
    useEffect(() => {
        if (multi.length === 0) return;
        const live = liveItems(board, multi);
        if (live.length !== multi.length) chooseItems(live);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [board]);
    const frame = multi.length > 1 ? selectionBox(board, multi, boardPx()) : null;
    const centerOf = (b: RaidplanBoard, sel: SelItem[]) => {
        const box = selectionBox(b, sel, boardPx());
        return box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0.5, y: 0.5 };
    };
    /** One undo step for whatever the selection does. */
    const multiAction = (fn: (b: RaidplanBoard, sel: SelItem[]) => RaidplanBoard, merge = false) => {
        const sel = currentSel();
        if (sel.length === 0) return;
        edit((b) => fn(b, sel), merge);
    };
    const doDuplicate = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        const r = duplicateSelection(boardNow.current, sel);
        if (r.skipped > 0) toast(t("raidBoard.multi.skipped", { n: r.skipped }));
        if (r.sel.length === 0) return;
        edit(() => r.board);
        chooseItems(r.sel);
    };
    const doCopy = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        const r = copySelection(boardNow.current, sel);
        if (r.skipped > 0) toast(t("raidBoard.multi.skipped", { n: r.skipped }));
        clip.current = { snap: r.snap, pastes: 0 };
    };
    const doPaste = () => {
        if (!clip.current) return;
        clip.current.pastes += 1;
        const r = pasteSnapshot(boardNow.current, clip.current.snap, 0.03 * clip.current.pastes);
        if (r.sel.length === 0) return;
        edit(() => r.board);
        chooseItems(r.sel);
    };
    const doDelete = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        edit((b) => deleteSelection(b, sel));
        chooseItems([]);
    };

    const specLabel = (spec: InsertSpec): string => {
        if (spec.type === "mark") return t(`raidBoard.mark.${spec.mark}`);
        if (spec.type === "place") { const s = board.slots.find((x) => x.id === spec.slotId); return s ? t(`raidBoard.slot.${s.kind}`, { n: s.n }) : ""; }
        if (spec.type === "slot") return t(`raidBoard.slot.kind.${spec.kind}`);
        if (spec.type === "zone") return t(`raidBoard.zone.${spec.zoneType}`);
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
        if (r.blocked) { toast(t("raidBoard.slot.allPlaced", { what: t(`raidBoard.slot.kind.${r.blocked}`) })); return; }
        edit(() => r.board);
        setSelected(r.sel);
        setTab("props");
    };

    // ---- dragging (Pointer Events on window) ------------------------------------------
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 5;
            const next = { ...d, x: e.clientX, y: e.clientY, moved, overTray: !!(el && el.closest("[data-rp-tray]")) };
            dragRef.current = next;
            setDrag(next);
            if (d.kind === "tray" || d.kind === "palette" || !moved) return;
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            if (d.multi && d.p0) {
                const m = d.multi;
                edit(() => moveSelection(m.board0, m.sel, p.x - d.p0!.x, p.y - d.p0!.y, boardPx()), true);
            } else if (d.handle === "rot" && d.center) {
                const a = angleTo(d.center.x, d.center.y, e.clientX, e.clientY);
                edit((b) => updateIcon(b, d.id, { rotation: e.shiftKey ? snapAngle(a, 15) : a, autoFace: false }), true);
            } else if (d.handle === "size" && d.size0 && d.center && d.d0) {
                const dist = Math.hypot(e.clientX - d.center.x, e.clientY - d.center.y);
                const next2 = d.size0 * (dist / d.d0);
                edit((b) => setObjectSize(b, d.kind as ObjectKind, d.id, next2), true);
            } else if (d.kind === "zone" && d.rect0 && d.p0) {
                const dx = p.x - d.p0.x;
                let dy = p.y - d.p0.y;
                if (d.keepRatio && d.handle) {
                    // proportions kept: the height follows the width
                    const ratio = d.rect0.h / d.rect0.w;
                    dy = (d.handle === "nw" || d.handle === "se" ? 1 : -1) * dx * ratio;
                }
                const r = d.handle ? resizeRect(d.rect0, d.handle as Corner, dx, dy) : moveRect(d.rect0, dx, dy);
                edit((b) => updateZone(b, d.id, r), true);
            } else if (d.kind === "line" && d.line0 && d.p0) {
                if (d.handle === "end1" || d.handle === "end2") edit((b) => moveLineEnd(b, d.id, d.handle === "end1" ? 1 : 2, p.x, p.y), true);
                else edit((b) => updateLine(b, d.id, moveLine(d.line0!, p.x - d.p0!.x, p.y - d.p0!.y)), true);
            } else {
                // the object follows the pointer live, keeping the grip it was taken with
                const bx = p.x + d.ox / p.w;
                const by = p.y + d.oy / p.h;
                edit((b) => moveObject(b, d.kind as ObjectKind, d.id, bx, by), true);
            }
        };
        const up = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const overTray = !!(el && el.closest("[data-rp-tray]"));
            const slotEl = el ? el.closest("[data-slot]") : null;
            const slotId = slotEl ? slotEl.getAttribute("data-slot") || "" : "";
            const p = toBoard(e.clientX, e.clientY);
            const slotOk = (b: RaidplanBoard) => b.slots.some((s) => s.id === slotId && s.kind !== "group");
            if (d.kind === "palette" && d.spec && d.spec.type === "place" && d.chip) {
                // a chip of the Besetzung: no move = a click (it opens its picker), else the drop decides
                if (!d.moved) return;
                const target = p && p.inside ? "map" : el && el.closest("[data-rp-bes]") ? "bar" : "none";
                const sid = d.spec.slotId;
                if (target !== "none") edit((b) => dropChip(b, sid, target, p && p.inside ? { x: p.x, y: p.y } : null));
                if (target === "map") setSelected({ kind: "slot", id: sid });
            } else if (d.kind === "palette" && d.spec) {
                if (!d.moved) insert(d.spec, null);
                else if (p && p.inside) insert(d.spec, { x: p.x, y: p.y });
            } else if (d.kind === "tray") {
                if (slotId) edit((b) => (slotOk(b) ? assignSlot(b, slotId, d.id) : (p && p.inside ? placeToken(b, d.id, p.x, p.y) : b)));
                else if (p && p.inside) edit((b) => placeToken(b, d.id, p.x, p.y));
            } else if (d.kind === "token") {
                if (overTray) edit((b) => removeToken(b, d.id));
                else if (slotId) edit((b) => (slotOk(b) ? assignSlot(b, slotId, d.id) : b));
            } else if (d.kind === "slot" && overTray) {
                // a slot dragged onto the list gives up its player; the slot itself goes back where it was
                edit((b) => assignSlot(d.origin ? moveObject(b, "slot", d.id, d.origin.x, d.origin.y) : b, d.id, ""));
            }
        };
        // Esc gives up a drag of the palette, a chip or a listed player: nothing happens
        const esc = (e: globalThis.KeyboardEvent) => {
            const d = dragRef.current;
            if (e.key !== "Escape" || !d || (d.kind !== "palette" && d.kind !== "tray")) return;
            e.preventDefault();
            dragRef.current = null;
            setDrag(null);
        };
        window.addEventListener("keydown", esc);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("keydown", esc);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging, edit]);

    const startDrag = (e: PointerEvent<HTMLElement | SVGElement>, kind: ObjectKind | "tray", id: string, handle?: Handle) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        const startsMulti = kind !== "tray" && kind !== "member" && !handle && multi.length > 1 && hasItem(multi, { kind, id });
        // Ctrl / Cmd / Shift + click (or the selection mode) adds the object to the selection or takes it out again: no drag
        if (kind !== "tray" && kind !== "member" && !handle && (e.ctrlKey || e.metaKey || e.shiftKey || selectMode)) {
            chooseItems(toggleItem(currentSel(), { kind, id }));
            if (target.focus) target.focus();
            return;
        }
        // preventDefault keeps the browser from focusing the button: do it by hand, or Delete / arrows would go nowhere
        if (kind !== "tray" && !startsMulti) { setMulti([]); setSelected({ kind, id }); if (target.focus) target.focus(); }
        if (startsMulti && target.focus) target.focus();
        // a locked object is selected but does not move
        if (kind !== "tray" && isLocked(board, kind, id)) return;
        let ox = 0;
        let oy = 0;
        let rect0: Rect | undefined;
        let line0: Drag["line0"];
        let p0: { x: number; y: number } | undefined;
        const p = toBoard(e.clientX, e.clientY);
        if (p) p0 = { x: p.x, y: p.y };
        if (kind === "zone") {
            const z = board.zones.find((k) => k.id === id);
            if (z) rect0 = { x: z.x, y: z.y, w: z.w, h: z.h };
        } else if (kind === "line") {
            const l = board.lines.find((k) => k.id === id);
            if (l) line0 = { id, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
        } else if (kind !== "tray") {
            const r = target.getBoundingClientRect();
            ox = r.left + r.width / 2 - e.clientX;
            oy = r.top + r.height / 2 - e.clientY;
        }
        let size0: number | undefined;
        let center: { x: number; y: number } | undefined;
        let d0: number | undefined;
        if (handle === "size" || handle === "rot") {
            const wrap = target.closest(".rp-token, .rp-text");
            const cr = wrap ? wrap.getBoundingClientRect() : null;
            const cur = sizeOf(board, kind as ObjectKind, id);
            if (cr && cur) {
                size0 = cur;
                center = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
                d0 = Math.max(8, Math.hypot(e.clientX - center.x, e.clientY - center.y));
            }
        }
        const origin = kind === "slot" ? { x: (board.slots.find((s) => s.id === id) || { x: 0 }).x, y: (board.slots.find((s) => s.id === id) || { y: 0 }).y } : undefined;
        const d: Drag = { kind, id, handle, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox, oy, rect0, line0, p0, origin, size0, center, d0, keepRatio: e.shiftKey, overTray: false, multi: startsMulti ? { board0: boardNow.current, sel: multi } : undefined };
        dragRef.current = d;
        setDrag(d);
    };

    const startPalette = (e: PointerEvent<HTMLElement>, spec: InsertSpec, chip = false) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const d: Drag = { kind: "palette", id: "", spec, chip, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox: 0, oy: 0, overTray: false };
        dragRef.current = d;
        setDrag(d);
    };

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

    // the rubber band: Pointer Events on window, the hits are what it touches
    useEffect(() => {
        if (!banding) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const b = bandRef.current;
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            if (!b.moved && Math.abs(e.clientX - b.cx) + Math.abs(e.clientY - b.cy) < 5) return;
            b.moved = true;
            setBand(bandBox(b.x0, b.y0, Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y))));
        };
        const up = (e: globalThis.PointerEvent) => {
            const b = bandRef.current;
            setBanding(false);
            setBand(null);
            const tap = menuTapRef.current;
            menuTapRef.current = null;
            if (!b.moved) { if (tap) openMenu(tap.x, tap.y, "board"); return; }
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            const box = bandBox(b.x0, b.y0, Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y)));
            const hits = hitObjects(boardNow.current, box, boardPx());
            chooseItems(b.add ? addItems(b.base, hits) : hits);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [banding]);

    /** The edge of the shared frame: drags the whole selection like any object of it. */
    const startFrameDrag = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || multi.length < 2 || !canWrite) return;
        e.preventDefault();
        const p = toBoard(e.clientX, e.clientY);
        if (!p) return;
        const d: Drag = { kind: "zone", id: "", x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox: 0, oy: 0, p0: { x: p.x, y: p.y }, overTray: false, multi: { board0: boardNow.current, sel: multi } };
        dragRef.current = d;
        setDrag(d);
    };

    /** A corner grip of the shared frame: scales the whole selection around the frame's middle (the pointer's distance from it decides). */
    const startScale = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || multi.length < 2) return;
        e.preventDefault();
        const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
        if (!rect) return;
        const c = centerOf(boardNow.current, multi);
        const cx = rect.left + c.x * rect.width;
        const cy = rect.top + c.y * rect.height;
        scaleRef.current = { board0: boardNow.current, sel: multi, center: c, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), cx, cy };
        setScaling(true);
    };
    useEffect(() => {
        if (!scaling) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const s = scaleRef.current;
            const f = Math.max(0.1, Math.min(8, Math.hypot(e.clientX - s.cx, e.clientY - s.cy) / s.d0));
            edit(() => scaleSelection(s.board0, s.sel, f, s.center), true);
        };
        const up = () => setScaling(false);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scaling]);

    // ---- the properties panel ------------------------------------------------------------
    const focusProperties = (selector = "input, select") => {
        setTab("props");
        setShowPanel(true);
        window.setTimeout(() => {
            const el = panelRef.current ? panelRef.current.querySelector<HTMLElement>(selector) : null;
            if (el) el.focus();
        }, 0);
    };

    const onKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => {
        if (!canWrite) return;
        const step = e.shiftKey ? 0.05 : 0.01;
        if (multi.length > 1 && hasItem(multi, { kind, id })) {
            const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (dirs[e.key]) { e.preventDefault(); multiAction((b, sel) => moveSelection(b, sel, dirs[e.key][0], dirs[e.key][1], boardPx()), true); }
            else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
            else if (e.key === "+" || e.key === "=") { e.preventDefault(); multiAction((b, sel) => scaleSelection(b, sel, 1.1, centerOf(b, sel)), true); }
            else if (e.key === "-") { e.preventDefault(); multiAction((b, sel) => scaleSelection(b, sel, 1 / 1.1, centerOf(b, sel)), true); }
            return;
        }
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            edit((b) => nudgeObject(b, kind, id, moves[e.key][0], moves[e.key][1]), true);
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            edit((b) => removeObject(b, kind, id));
            setSelected(null);
        } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            edit((b) => scaleObject(b, kind, id, 1.1), true);
        } else if (e.key === "-") {
            e.preventDefault();
            edit((b) => scaleObject(b, kind, id, 1 / 1.1), true);
        } else if ((e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") && kind === "icon") {
            const ic = boardNow.current.icons.find((k) => k.id === id);
            if (ic && canFace(ic.iconKey)) {
                e.preventDefault();
                const dir = e.key === "q" || e.key === "Q" ? -1 : 1;
                edit((b) => turnIcon(b, id, dir * (e.shiftKey ? 45 : 15)), true);
            }
        } else if (e.key === "Enter") {
            setSelected({ kind, id });
            focusProperties();
        }
    };

    // Ctrl+Z / Ctrl+Y anywhere but in a text field; Delete removes the selection when nothing else has the focus
    useEffect(() => {
        const onWindowKey = (e: globalThis.KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;
            const mod = e.ctrlKey || e.metaKey;
            if (canWrite && mod && e.key.toLowerCase() === "a" && !e.shiftKey && !noBoard) { e.preventDefault(); chooseItems(selectableItems(boardNow.current)); }
            else if (canWrite && mod && e.key.toLowerCase() === "d") { e.preventDefault(); doDuplicate(); }
            else if (canWrite && mod && e.key.toLowerCase() === "c") { if (currentSel().length > 0) { e.preventDefault(); doCopy(); } }
            else if (canWrite && mod && e.key.toLowerCase() === "v") { if (clip.current) { e.preventDefault(); doPaste(); } }
            else if (e.key === "Escape" && (multi.length > 0 || selected) && !document.querySelector("dialog[open]")) { chooseItems([]); }
            else if (canWrite && multi.length > 1 && !e.defaultPrevented && !document.querySelector("dialog[open]") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                // the whole selection by one step, also when no object has the focus
                const st = e.shiftKey ? 0.05 : 0.01;
                const dirs: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
                e.preventDefault();
                multiAction((b, sel) => moveSelection(b, sel, dirs[e.key][0], dirs[e.key][1], boardPx()), true);
            }
            else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
            else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); history.redo(); }
        };
        window.addEventListener("keydown", onWindowKey);
        return () => window.removeEventListener("keydown", onWindowKey);
    });

    // Alt + mouse wheel scales the selected object (a native listener: a wheel handler of React's is passive and could not stop the page from scrolling)
    const selectedNow = useRef<Selection>(null);
    selectedNow.current = selected;
    useEffect(() => {
        const el = boardRef.current;
        if (!el || !canWrite) return undefined;
        const onWheel = (e: WheelEvent) => {
            const sel = selectedNow.current;
            if (!e.altKey || !sel) return;
            e.preventDefault();
            edit((b) => scaleObject(b, sel.kind, sel.id, e.deltaY < 0 ? 1.08 : 1 / 1.08), true);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [canWrite, edit, boss.key]);

    // ---- right click / long press ----------------------------------------------------------
    const openMenu = (x: number, y: number, target: Selection | "board") => {
        if (!canWrite) return;
        const p = toBoard(x, y);
        // a right click on one of several selected objects keeps the selection (the menu then acts on all of them)
        if (target !== "board" && target && multi.length > 1 && hasItem(multi, target as SelItem)) { /* keep */ }
        else if (target !== "board" && target) { setMulti([]); setSelected(target); }
        else chooseItems([]);
        setMenu({ x, y, target, at: p ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) } : null });
    };
    const onContext = (e: MouseEvent<HTMLElement>, target: Selection) => openMenu(e.clientX, e.clientY, target || "board");

    const inMulti = (target: Selection | "board") => !!target && target !== "board" && multi.length > 1 && hasItem(multi, target as SelItem);
    const multiMenu = (): MenuItem[] => {
        const it = (id: string, section: string, danger = false): MenuItem => ({ id, section, disabled: false, danger });
        return [
            it("m:duplicate", "main"), it("m:front", "order"), it("m:back", "order"), it("m:lock", "order"), it("m:unlock", "order"), it("m:hide", "order"),
            it("m:alignLeft", "align"), it("m:alignRight", "align"), it("m:alignTop", "align"), it("m:alignBottom", "align"), it("m:alignCenterH", "align"), it("m:alignCenterV", "align"),
            it("m:distH", "align"), it("m:distV", "align"), it("m:ringHide", "order"), it("m:ringShow", "order"), it("m:delete", "end", true),
        ];
    };
    const menuItems = (): MenuItem[] => {
        if (!menu) return [];
        if (inMulti(menu.target)) return multiMenu();
        if (menu.target === "board") return contextMenuItems("board", { locked: false, hasPlayer: false, isEvent, kind: "" });
        const sel = menu.target;
        if (!sel) return [];
        const look = lookOf(board, sel.kind, sel.id);
        const slot = sel.kind === "slot" ? board.slots.find((s) => s.id === sel.id) : undefined;
        const ic = sel.kind === "icon" ? board.icons.find((s) => s.id === sel.id) : undefined;
        return contextMenuItems(sel.kind, { locked: !!look && look.lock, hasPlayer: !!slot && !!slot.userId, isEvent, kind: slot ? slot.kind : "", hideMembers: !!slot && slot.hideMembers, split: !!slot && slot.split, ringOff: !!slot && slot.showRing === false, faces: !!ic && canFace(ic.iconKey), inGroup: sel.kind === "token" && ownBadgeGroup(board, players.get(sel.id) || ({ group: 0 } as RaidplanPlayer)) > 0 });
    };
    const menuLabel = (item: MenuItem): string => {
        const parts = item.id.split(":");
        if (parts[0] === "size") return t("raidBoard.ctx.sizeTo", { pct: parts[1] });
        if (parts[0] === "face") return t("raidBoard.ctx.face", { dir: t(`raidBoard.compass.${compassName(Number(parts[1]))}`) });
        if (parts[0] === "insert") {
            if (parts[1] === "mark") return t(`raidBoard.mark.${parts[2]}`);
            const what = parts[1] === "slot" ? t(`raidBoard.slot.kind.${parts[2]}`) : parts[1] === "zone" ? t(`raidBoard.zone.${parts[2]}`) : parts[1] === "line" ? t(`raidBoard.line.${parts[2]}`) : parts[1] === "icon" ? t(`raidBoard.icon.${parts[2]}`) : t("raidBoard.tool.text");
            return t("raidBoard.ctx.insertHere", { what });
        }
        return t(`raidBoard.ctx.${item.id.replace(":", "_")}`);
    };
    const pickMenu = (id: string) => {
        if (!menu) return;
        const target = menu.target;
        if (id === "properties") { focusProperties(); return; }
        if (id === "assign") { focusProperties("[data-insp-player]"); return; }
        if (id === "deselect") { chooseItems([]); return; }
        if (id.startsWith("m:")) {
            const px = boardPx();
            const act = id.slice(2);
            if (act === "duplicate") doDuplicate();
            else if (act === "delete") doDelete();
            else if (act === "front" || act === "back") multiAction((b, sel) => reorderSelection(b, sel, act));
            else if (act === "lock") multiAction((b, sel) => setLookSelection(b, sel, { lock: true }));
            else if (act === "unlock") multiAction((b, sel) => setLookSelection(b, sel, { lock: false }));
            else if (act === "ringHide") multiAction((b, sel) => setRingSelection(b, sel, false));
            else if (act === "ringShow") multiAction((b, sel) => setRingSelection(b, sel, true));
            else if (act === "hide") { multiAction((b, sel) => setLookSelection(b, sel, { hidden: true })); chooseItems([]); }
            else {
                const modes: Record<string, string> = { alignLeft: "left", alignRight: "right", alignTop: "top", alignBottom: "bottom", alignCenterH: "centerH", alignCenterV: "centerV", distH: "distH", distV: "distV" };
                if (modes[act]) multiAction((b, sel) => alignSelection(b, sel, modes[act], px));
            }
            return;
        }
        const sel = target === "board" ? null : target;
        const r = applyMenuAction(board, id, sel ? sel.kind : "", sel ? sel.id : "", menu.at);
        if (r.blocked) { toast(t("raidBoard.slot.allPlaced", { what: t(`raidBoard.slot.kind.${r.blocked}`) })); return; }
        edit(() => r.board);
        setSelected(r.sel);
        if (id.startsWith("insert:") || id === "duplicate") setTab("props");
    };

    const boardWrapDown = (e: PointerEvent<HTMLDivElement>) => {
        const el = e.target as HTMLElement;
        const onObject = !!el.closest(".rp-token, .rp-zone, .rp-text, .rp-line-hit, .rp-handle, .rp-multibox");
        const add = e.ctrlKey || e.metaKey || e.shiftKey;
        // a rubber band from empty ground (a finger needs the selection mode; long press stays the context menu)
        if (!onObject && canWrite && e.button === 0 && !noBoard && (e.pointerType !== "touch" || selectMode)) {
            const p = toBoard(e.clientX, e.clientY);
            if (p && p.inside) {
                bandRef.current = { x0: p.x, y0: p.y, add, base: add ? currentSel() : [], moved: false, cx: e.clientX, cy: e.clientY };
                setBanding(true);
            }
        }
        if (!onObject && !add) chooseItems([]);
        // long press = right click on touch
        if (e.pointerType === "touch" && canWrite) {
            const x = e.clientX;
            const y = e.clientY;
            const holder = el.closest("[data-obj]");
            const raw = holder ? holder.getAttribute("data-obj") || "" : "";
            const at = raw.indexOf(":");
            const target: Selection = at > 0 ? { kind: raw.slice(0, at) as ObjectKind, id: raw.slice(at + 1) } : null;
            if (pressRef.current) window.clearTimeout(pressRef.current.timer);
            pressRef.current = {
                x, y,
                timer: window.setTimeout(() => {
                    pressRef.current = null;
                    dragRef.current = null;
                    setDrag(null);
                    const p = !target && canWrite && !noBoard ? toBoard(x, y) : null;
                    if (p && p.inside) {
                        bandRef.current = { x0: p.x, y0: p.y, add: false, base: [], moved: false, cx: x, cy: y };
                        menuTapRef.current = { x, y };
                        setBanding(true);
                        return;
                    }
                    openMenu(x, y, target || "board");
                }, LONG_PRESS_MS),
            };
        }
    };
    const boardWrapMove = (e: PointerEvent<HTMLDivElement>) => {
        const pr = pressRef.current;
        if (pr && Math.abs(e.clientX - pr.x) + Math.abs(e.clientY - pr.y) > 10) { window.clearTimeout(pr.timer); pressRef.current = null; }
    };
    const boardWrapEnd = () => {
        if (pressRef.current) { window.clearTimeout(pressRef.current.timer); pressRef.current = null; }
    };

    const dragPlayer = drag && drag.kind === "tray" ? players.get(drag.id) || null : null;
    const dragKey = drag && drag.moved && drag.handle !== "size" && drag.handle !== "rot" && drag.kind !== "tray" && drag.kind !== "palette" ? `${drag.kind}:${drag.id}` : "";
    const quick = (spec: InsertSpec, label: string, icon: ReactNode) => (
        <IconButton size="sm" icon={icon} tip={label} disabled={!canWrite} onClick={() => insert(spec, null)} />
    );

    return (
        <div className="rp-work" ref={workRef}>
            <div className={`rp-sticky${saveState && saveState !== "clean" ? ` is-${saveState}` : ""}`}>
                {notice}
                <div className="rp-toolbar2" role="toolbar" aria-label={t("raidBoard.tool.label")}>
                    <div className="rp-tool-group">
                        <IconButton size="sm" icon={<Undo2 size={17} />} tip={`${t("raidBoard.tool.undo")} (Ctrl+Z)`} disabled={!canWrite || !history.canUndo} onClick={history.undo} />
                        <IconButton size="sm" icon={<Redo2 size={17} />} tip={`${t("raidBoard.tool.redo")} (Ctrl+Y)`} disabled={!canWrite || !history.canRedo} onClick={history.redo} />
                    </div>
                    <span className="rp-tool-sep" aria-hidden="true" />
                    <div className="rp-tool-group">
                        {quick({ type: "line", kind: "arrow" }, t("raidBoard.line.arrow"), <MoveUpRight size={17} />)}
                        {quick({ type: "line", kind: "line" }, t("raidBoard.line.line"), <Minus size={17} />)}
                        {quick({ type: "text", text: t("raidBoard.text.default") }, t("raidBoard.tool.text"), <Type size={17} />)}
                        {quick({ type: "zone", zoneType: "neutral", shape: "rect" }, t("raidBoard.zone.rect"), <Square size={17} />)}
                        {quick({ type: "zone", zoneType: "neutral", shape: "ellipse" }, t("raidBoard.zone.ellipse"), <Circle size={17} />)}
                    </div>
                    <span className="rp-tool-sep" aria-hidden="true" />
                    <div className="rp-tool-group">
                        <IconButton size="sm" icon={<PanelLeft size={17} />} tip={t("raidBoard.tool.palette")} aria-pressed={showPalette} className={showPalette ? "is-on" : ""} onClick={() => setShowPalette((v) => !v)} />
                        {!noBoard && <IconButton size="sm" icon={<ListChecks size={17} />} tip={t("raidBoard.roster.title")} onClick={() => setRosterOpen(true)} />}
                        {!noBoard && <IconButton size="sm" icon={<CircleDashed size={17} />} tip={t("raidBoard.tool.rings")} aria-pressed={board.showRings !== false} className={board.showRings !== false ? "is-on" : ""} disabled={!canWrite} onClick={() => edit((b) => ({ ...b, showRings: b.showRings === false }))} />}
                        <IconButton size="sm" icon={<BoxSelect size={17} />} tip={t("raidBoard.tool.select")} aria-pressed={selectMode} className={selectMode ? "is-on" : ""} disabled={!canWrite} onClick={() => setSelectMode((v) => !v)} />
                        <IconButton size="sm" icon={<Users size={17} />} tip={t("raidBoard.tool.bes")} aria-pressed={showBes} className={showBes ? "is-on" : ""} onClick={() => setShowBes((v) => !v)} />
                        <IconButton size="sm" icon={<PanelRight size={17} />} tip={t("raidBoard.tool.panel")} aria-pressed={showPanel} className={showPanel ? "is-on" : ""} onClick={() => setShowPanel((v) => !v)} />
                    </div>
                    {!noBoard && <IconButton size="sm" icon={<Eye size={17} />} tip={t("raidBoard.tool.preview")} aria-pressed={preview} className={preview ? "is-on" : ""} onClick={() => setPreview((v) => !v)} />}
                    {!noBoard && <ZoomControls view={bv.view} zoomIn={bv.zoomIn} zoomOut={bv.zoomOut} fit={bv.fit} actual={bv.actual} hand={bv.hand} setHand={bv.setHand} canWrite={canWrite} hasSaved={!!board.view} onSaveView={() => edit((b) => ({ ...b, view: savedView(bv.view) }))} onClearView={() => { edit((b) => ({ ...b, view: null })); bv.fit(); }} />}
                    {!noBoard && <ViewOptions board={board} canWrite={canWrite} edit={edit} prefs={prefs} setPref={setPref} links={showLinks} onLinks={setShowLinks} />}
                    {!noBoard && (
                        <div className="rp-tool-group rp-mapsize" role="group" aria-label={t("raidBoard.split.size")}>
                            {["S", "M", "L"].map((k) => (
                                <button key={k} type="button" className={`rp-mapsize-btn${mapSize.step === k ? " is-on" : ""}`} aria-pressed={mapSize.step === k} data-tip={t(`raidBoard.split.step${k}`)} onClick={() => chooseMapSize({ step: k as "S" | "M" | "L", px: 0 })}>{k}</button>
                            ))}
                        </div>
                    )}
                    <div className="rp-tool-status">{status}</div>
                    <div className="rp-tool-group rp-tool-actions">{actions}</div>
                </div>
                {bossNav}
            </div>

            {(showPalette || showBes) && (
                <div className="rp-bands">
                    {showPalette && canWrite && !noBoard && (
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
                        multi={multi} multiBox={frame} band={band} onMultiScale={canWrite && !preview ? startScale : undefined} onMultiMove={canWrite && !preview ? startFrameDrag : undefined}
                        emptyText={canWrite ? `${t("raidBoard.board.noMapTitle")} · ${t("raidBoard.board.noMapText")}` : t("raidBoard.board.noMapTitle")}
                    />
                    {prefs.minimap && bv.view.z > 1 && <MiniMap mapUrl={boss.mapUrl} view={bv.view} onCenter={bv.centerAt} label={t("raidBoard.zoom.minimap")} />}
                </div>
                )}
                {!noBoard && (showPanel || (isEvent && roster.length >= 0)) && (
                    <div className="rp-side">
                {isEvent && !noBoard && (
                    <section className={`rp-tray${drag && drag.overTray ? " is-over" : ""}`} data-rp-tray aria-label={t("raidBoard.tray.title")}>
                        <span className="rp-kicker">{t("raidBoard.tray.title")} · {missing.length}</span>
                        {roster.length === 0 && <span className="rp-muted">{t("raidBoard.tray.none")}</span>}
                        {roster.length > 0 && missing.length === 0 && <span className="rp-muted">{t("raidBoard.tray.empty")}</span>}
                        <div className="rp-tray-list">
                            {missing.map((p) => (
                                <span
                                    key={p.userId}
                                    className={`rp-chip${canWrite ? " is-drag" : ""}`}
                                    data-tip={`${p.specLabel} ${p.className}`.trim()}
                                    onPointerDown={canWrite ? (e) => startDrag(e, "tray", p.userId) : undefined}
                                >
                                    <TokenIcon player={p} size="sm" />
                                    <PlayerName player={p} />
                                </span>
                            ))}
                        </div>
                    </section>
                )}
                    {showPanel && !noBoard && (
                        <aside className="rp-dock" ref={panelRef} aria-label={t("raidBoard.panel.props")}>
                            <div className="rp-dock-tabs" role="tablist">
                                <button type="button" role="tab" aria-selected={tab === "props"} className={tab === "props" ? "is-on" : ""} onClick={() => setTab("props")}>{t("raidBoard.panel.props")}</button>
                                <button type="button" role="tab" aria-selected={tab === "layers"} className={tab === "layers" ? "is-on" : ""} onClick={() => setTab("layers")}>{t("raidBoard.panel.layers")}</button>
                                <button type="button" role="tab" aria-selected={tab === "bg"} className={tab === "bg" ? "is-on" : ""} onClick={() => setTab("bg")}>{t("raidBoard.panel.background")}</button>
                            </div>
                            {tab === "props" && <Inspector board={board} selection={selected} multi={multi} boardPx={boardPx} players={players} roster={roster} isEvent={isEvent} canWrite={canWrite} edit={edit} editAll={editAll || edit} rows={filledRows} onSelect={setSelected} focusGroup={focusGroup} onFocusGroup={setFocusGroup} />}
                            {tab === "layers" && <LayerList board={board} players={players} selection={selected} multi={multi} canWrite={canWrite} edit={edit} onSelect={onLayerSelect} />}
                            {tab === "bg" && (
                                <div className="rp-bg">
                                    <MapOpacityField board={board} canWrite={canWrite} edit={edit} />
                                    <ObjectScaleField board={board} canWrite={canWrite} edit={edit} />
                                    <MapPanel csrfToken={csrfToken} rows={mapRows} canWrite={canWrite} onChanged={onMapsChanged} />
                                </div>
                            )}
                        </aside>
                    )}
                    </div>
                )}
            </div>
            {!noBoard && (
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
                    eventId={eventId} csrfToken={csrfToken} groupCount={groupCount} links={showLinks} onLinks={setShowLinks}
                    profileName={profileName} onPickProfile={onPickProfile} catalog={catalog} sectionMobs={mobs}
                    inherited={inherited} defaultRows={defaultRows} onCopyDefaults={onCopyDefaults}
                />
                {isEvent && !noBoard && <MyTasksPreview rows={filledRows} board={board} players={players} catalog={catalog} me={me || []} />}
                <StepsCard
                    board={board} edit={edit} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite} catalog={catalog} sectionMobs={mobs}
                    groupCount={groupCount} bossName={boss.name} onLibrary={onPickProfile} onSaveAs={onSaveTactic || onPickProfile}
                />
                <TargetsPanel board={board} canWrite={canWrite} maxNotes={limits.notes} onChange={(b) => edit(() => b)} />
            </div>
            {rosterOpen && <AssignRosterModal board={board} roster={roster} isEvent={isEvent} canWrite={canWrite} edit={edit} onClose={() => setRosterOpen(false)} />}
            {canWrite && !noBoard && <p className="rp-muted rp-hint">{t(isEvent ? "raidBoard.board.hint" : "raidBoard.board.hintTemplate")}</p>}

            {drag && drag.kind === "tray" && dragPlayer && (
                <div className="rp-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                    <TokenIcon player={dragPlayer} />
                </div>
            )}
            {drag && drag.kind === "palette" && drag.spec && drag.moved && (
                <div className="rp-ghost rp-ghost-pal" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                    {drag.spec.type === "mark" ? <MarkIcon mark={drag.spec.mark as never} size={34} /> : specLabel(drag.spec)}
                </div>
            )}
            {menu && (
                <ContextMenu
                    x={menu.x} y={menu.y}
                    title={menu.target === "board" || !menu.target ? t("raidBoard.ctx.board") : objectName(board, menu.target.kind, menu.target.id, players) || t(`raidBoard.obj.${menu.target.kind}`)}
                    items={menuItems()} labelFor={menuLabel} onPick={pickMenu} onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}
