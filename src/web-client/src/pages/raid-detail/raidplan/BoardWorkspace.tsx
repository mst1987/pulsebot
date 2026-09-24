import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Circle, Minus, MoveUpRight, PanelLeft, PanelRight, Redo2, Square, Type, Undo2 } from "lucide-react";
import type { RaidplanBoard, RaidplanBoss, RaidplanPlayer, Besetzung as BesetzungData } from "../../../api";
import PlanBoard, { PlayerName, TokenIcon, type Handle } from "../../../components/raidplan/PlanBoard";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { IconButton } from "../../../components/ui";
import { useT } from "../../../i18n";
import {
    angleTo, applyMenuAction, assignSlot, placeSlot, canFace, compassName, snapAngle, turnIcon, updateIcon, contextMenuItems, insertObject, isLocked, lookOf, moveLineEnd, moveObject, moveRect, nudgeObject, objectName, scaleObject, setObjectSize, sizeOf,
    placeToken, removeObject, removeToken, resizeRect, rosterMap, unplaced, updateLine, updateZone, moveLine, type Corner, type InsertSpec, type MenuItem,
    type ObjectKind, type Rect, type Selection,
} from "../../../lib/raidplan";
import TargetsPanel from "./TargetsPanel";
import Palette from "./Palette";
import Inspector, { MapOpacityField, ObjectScaleField } from "./Inspector";
import LayerList from "./LayerList";
import MapPanel, { type MapRow } from "./MapPanel";
import ContextMenu from "./ContextMenu";
import AssignPanel from "./AssignPanel";
import Besetzung from "./Besetzung";
import { assignmentLinks, scopeOf } from "../../../lib/assign";

type Drag = {
    kind: ObjectKind | "tray" | "palette";
    id: string;
    spec?: InsertSpec;
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
    mode, eventId, besetzung, boss, allBosses, board, edit, roster, canWrite, limits, profileName, onPickProfile, history, status, actions, bossNav, csrfToken, mapRows, onMapsChanged,
}: {
    mode: "event" | "template";
    /** the event whose plan this is ("" in a template): suggestions read its lineup */
    eventId: string;
    /** the role slots of this raid (Tank 1..n ...): shown as the Besetzung, assignable without being on the map */
    besetzung: BesetzungData;
    boss: RaidplanBoss;
    /** every boss of the plan: the palette offers their icons */
    allBosses: RaidplanBoss[];
    board: RaidplanBoard;
    /** Applies a change to this boss's board; `coalesce` = one step of undo with the change right before (a drag, a slider). */
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    /** The players of the setup (empty in a template). */
    roster: RaidplanPlayer[];
    canWrite: boolean;
    limits: { targetsPerBoss: number; title: number; notes: number };
    profileName: string;
    onPickProfile: () => void;
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
}) {
    const t = useT();
    const [selected, setSelected] = useState<Selection>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [menu, setMenu] = useState<Menu | null>(null);
    const [tab, setTab] = useState<"props" | "bg">("props");
    const [showPalette, setShowPalette] = useState(true);
    const [showPanel, setShowPanel] = useState(true);
    const [showLinks, setShowLinks] = useState(true);
    const boardRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
    const players = useMemo(() => rosterMap(roster), [roster]);
    const missing = useMemo(() => unplaced(roster, board), [roster, board]);
    const isEvent = mode === "event";
    const scope = scopeOf(boss);
    const links = useMemo(() => (showLinks ? assignmentLinks(board) : []), [showLinks, board]);
    const groupCount = Math.max(besetzung.groups, ...roster.map((p) => p.group));
    const boardNow = useRef(board);
    boardNow.current = board;

    // Another boss: nothing is selected any more.
    useEffect(() => { setSelected(null); setMenu(null); }, [boss.key]);

    const toBoard = (x: number, y: number) => {
        const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
        if (!rect || !rect.width || !rect.height) return null;
        return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, w: rect.width, h: rect.height, inside: x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom };
    };

    const specLabel = (spec: InsertSpec): string => {
        if (spec.type === "mark") return t(`raidBoard.mark.${spec.mark}`);
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
            if (d.handle === "rot" && d.center) {
                const a = angleTo(d.center.x, d.center.y, e.clientX, e.clientY);
                edit((b) => updateIcon(b, d.id, { rotation: e.shiftKey ? snapAngle(a, 15) : a }), true);
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
            if (d.kind === "palette" && d.spec) {
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
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
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
        // preventDefault keeps the browser from focusing the button: do it by hand, or Delete / arrows would go nowhere
        if (kind !== "tray") { setSelected({ kind, id }); if (target.focus) target.focus(); }
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
        const d: Drag = { kind, id, handle, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox, oy, rect0, line0, p0, origin, size0, center, d0, keepRatio: e.shiftKey, overTray: false };
        dragRef.current = d;
        setDrag(d);
    };

    const startPalette = (e: PointerEvent<HTMLElement>, spec: InsertSpec) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const d: Drag = { kind: "palette", id: "", spec, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox: 0, oy: 0, overTray: false };
        dragRef.current = d;
        setDrag(d);
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

    const onKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => {
        if (!canWrite) return;
        const step = e.shiftKey ? 0.05 : 0.01;
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
            if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
            else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); history.redo(); }
        };
        window.addEventListener("keydown", onWindowKey);
        return () => window.removeEventListener("keydown", onWindowKey);
    }, [history]);

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
        if (target !== "board" && target) setSelected(target);
        else setSelected(null);
        setMenu({ x, y, target, at: p ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) } : null });
    };
    const onContext = (e: MouseEvent<HTMLElement>, target: Selection) => openMenu(e.clientX, e.clientY, target || "board");

    const menuItems = (): MenuItem[] => {
        if (!menu) return [];
        if (menu.target === "board") return contextMenuItems("board", { locked: false, hasPlayer: false, isEvent, kind: "" });
        const sel = menu.target;
        if (!sel) return [];
        const look = lookOf(board, sel.kind, sel.id);
        const slot = sel.kind === "slot" ? board.slots.find((s) => s.id === sel.id) : undefined;
        const ic = sel.kind === "icon" ? board.icons.find((s) => s.id === sel.id) : undefined;
        return contextMenuItems(sel.kind, { locked: !!look && look.lock, hasPlayer: !!slot && !!slot.userId, isEvent, kind: slot ? slot.kind : "", hideMembers: !!slot && slot.hideMembers, split: !!slot && slot.split, faces: !!ic && canFace(ic.iconKey) });
    };
    const menuLabel = (item: MenuItem): string => {
        const parts = item.id.split(":");
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
        if (id === "deselect") { setSelected(null); return; }
        const sel = target === "board" ? null : target;
        const r = applyMenuAction(board, id, sel ? sel.kind : "", sel ? sel.id : "", menu.at);
        edit(() => r.board);
        setSelected(r.sel);
        if (id.startsWith("insert:") || id === "duplicate") setTab("props");
    };

    const boardWrapDown = (e: PointerEvent<HTMLDivElement>) => {
        const el = e.target as HTMLElement;
        if (!el.closest(".rp-token, .rp-zone, .rp-text, .rp-line-hit")) setSelected(null);
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
        <div className="rp-work">
            <div className="rp-sticky">
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
                        <IconButton size="sm" icon={<PanelRight size={17} />} tip={t("raidBoard.tool.panel")} aria-pressed={showPanel} className={showPanel ? "is-on" : ""} onClick={() => setShowPanel((v) => !v)} />
                    </div>
                    <div className="rp-tool-status">{status}</div>
                    <div className="rp-tool-group rp-tool-actions">{actions}</div>
                </div>
                {bossNav}
            </div>

            {isEvent && scope !== "general" && (
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

            {scope !== "general" && (
            <div className={`rp-stage${showPalette ? "" : " no-palette"}${showPanel ? "" : " no-panel"}`}>
                {showPalette && (canWrite ? <Palette onStart={startPalette} onInsert={(spec) => insert(spec, null)} bosses={allBosses} currentBoss={boss.key} /> : <div />)}
                <div
                    className="rp-board-wrap"
                    onPointerDown={boardWrapDown} onPointerMove={boardWrapMove} onPointerUp={boardWrapEnd} onPointerCancel={boardWrapEnd}
                >
                    <PlanBoard
                        boardRef={boardRef}
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
                        texts={board.texts}
                        players={players}
                        roster={roster}
                        selected={selected}
                        dragKey={dragKey}
                        onObjectDown={canWrite ? (e, kind, id, handle) => startDrag(e, kind, id, handle) : undefined}
                        onObjectKey={canWrite ? onKey : undefined}
                        onObjectOpen={canWrite ? (kind, id) => { setSelected({ kind, id }); focusProperties(); } : undefined}
                        onContext={canWrite ? onContext : undefined}
                        links={links}
                        emptyText={canWrite ? `${t("raidBoard.board.noMapTitle")} · ${t("raidBoard.board.noMapText")}` : t("raidBoard.board.noMapTitle")}
                    />
                </div>
                {showPanel && (
                    <aside className="rp-panel" ref={panelRef} aria-label={t("raidBoard.panel.props")}>
                        <div className="rp-tabs2" role="tablist">
                            <button type="button" role="tab" aria-selected={tab === "props"} className={tab === "props" ? "is-on" : ""} onClick={() => setTab("props")}>{t("raidBoard.panel.props")}</button>
                            <button type="button" role="tab" aria-selected={tab === "bg"} className={tab === "bg" ? "is-on" : ""} onClick={() => setTab("bg")}>{t("raidBoard.panel.background")}</button>
                        </div>
                        {tab === "props" ? (
                            <Inspector board={board} selection={selected} players={players} roster={roster} isEvent={isEvent} canWrite={canWrite} edit={edit} onSelect={setSelected} />
                        ) : (
                            <div className="rp-bg">
                                <MapOpacityField board={board} canWrite={canWrite} edit={edit} />
                                <ObjectScaleField board={board} canWrite={canWrite} edit={edit} />
                                <MapPanel csrfToken={csrfToken} rows={mapRows} canWrite={canWrite} onChanged={onMapsChanged} />
                            </div>
                        )}
                        <h3 className="rp-kicker rp-layers-head">{t("raidBoard.panel.layers")}</h3>
                        <LayerList board={board} players={players} selection={selected} canWrite={canWrite} edit={edit} onSelect={setSelected} />
                    </aside>
                )}
            </div>
            )}
            {canWrite && scope !== "general" && <p className="rp-muted rp-hint">{t(isEvent ? "raidBoard.board.hint" : "raidBoard.board.hintTemplate")}</p>}

            <div className="rp-below">
                <Besetzung
                    board={board} besetzung={besetzung} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite} edit={edit}
                    onPlaceDown={(e, slotId) => startPalette(e, { type: "place", slotId })}
                />
                <div className="rp-below-grid">
                    <AssignPanel
                        scope={scope} board={board} edit={edit} roster={roster} players={players} isEvent={isEvent} canWrite={canWrite}
                        eventId={eventId} csrfToken={csrfToken} groupCount={groupCount} links={showLinks} onLinks={setShowLinks}
                        profileName={profileName} onPickProfile={onPickProfile}
                    />
                    <aside className="rp-below-side">
                        <TargetsPanel board={board} canWrite={canWrite} maxNotes={limits.notes} onChange={(b) => edit(() => b)} />
                    </aside>
                </div>
            </div>

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
