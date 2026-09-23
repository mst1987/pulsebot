import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import PlanBoard, { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { Button } from "../../../components/ui";
import { useT } from "../../../i18n";
import {
    addMark, addSlot, addZone, assignSlot, moveObject, moveRect, nudgeObject, placeToken, removeObject, removeToken, resizeRect, rosterMap,
    slotTitle, unplaced, updateSlot, updateZone, type Corner, type ObjectKind, type Rect, type Selection,
} from "../../../lib/raidplan";
import TargetsPanel from "./TargetsPanel";
import { AddObjectModal, SlotModal, ZoneModal } from "./ObjectModals";

type Drag = {
    kind: ObjectKind | "tray";
    id: string;
    corner?: Corner;
    /** pointer, in client px (the ghost of a list chip follows it) */
    x: number;
    y: number;
    /** grip offset, px: the token does not jump under the pointer */
    ox: number;
    oy: number;
    /** where a zone and the pointer were when the drag began */
    rect0?: Rect;
    p0?: { x: number; y: number };
    overTray: boolean;
};

/**
 * The working area of one boss, shared by the event plan and the raid plan
 * template (one component, so both behave the same): a tool bar over the board, the
 * board at the full width of the column, and under it the players not placed yet
 * (an event plan) and the target rows, each in a fold-away section.
 *
 * Everything on the board is dragged with Pointer Events on window (no HTML5 drag
 * and drop, so a finger works like a mouse): a player from the list onto the
 * board or onto a slot, tokens / slots / marks / zones around the board, a zone's
 * corners to scale it, a token or a slot's player back onto the list to take it
 * off. A selected object moves with the arrow keys (Shift = bigger steps), Delete
 * removes it, Enter / a double click opens its details in a dialog.
 */
export default function BoardWorkspace({
    mode, boss, board, edit, roster, canWrite, limits, profileName, onPickProfile, toolbar,
}: {
    mode: "event" | "template";
    boss: RaidplanBoss;
    board: RaidplanBoard;
    /** Applies a change to this boss's board. */
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    /** The players of the setup (empty in a template). */
    roster: RaidplanPlayer[];
    canWrite: boolean;
    limits: { targetsPerBoss: number; title: number; notes: number };
    profileName: string;
    onPickProfile: () => void;
    /** More buttons for the tool bar (the map, …). */
    toolbar?: ReactNode;
}) {
    const t = useT();
    const [selected, setSelected] = useState<Selection>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [modal, setModal] = useState<"" | "add" | "slot" | "zone">("");
    const boardRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const players = useMemo(() => rosterMap(roster), [roster]);
    const missing = useMemo(() => unplaced(roster, board), [roster, board]);
    const isEvent = mode === "event";

    // Another boss: nothing is selected any more.
    useEffect(() => { setSelected(null); setModal(""); }, [boss.key]);

    const toBoard = (x: number, y: number) => {
        const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null;
        if (!rect || !rect.width || !rect.height) return null;
        return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, w: rect.width, h: rect.height, inside: x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom };
    };

    // ---- dragging (Pointer Events on window) ------------------------------------------
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const next = { ...d, x: e.clientX, y: e.clientY, overTray: !!(el && el.closest("[data-rp-tray]")) };
            dragRef.current = next;
            setDrag(next);
            if (d.kind === "tray") return;
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            if (d.kind === "zone" && d.rect0 && d.p0) {
                const dx = p.x - d.p0.x;
                const dy = p.y - d.p0.y;
                const r = d.corner ? resizeRect(d.rect0, d.corner, dx, dy) : moveRect(d.rect0, dx, dy);
                edit((b) => updateZone(b, d.id, r));
            } else {
                // the object follows the pointer live, keeping the grip it was taken with
                const bx = p.x + d.ox / p.w;
                const by = p.y + d.oy / p.h;
                edit((b) => moveObject(b, d.kind as ObjectKind, d.id, bx, by));
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
            if (d.kind === "tray") {
                if (slotId) edit((b) => (b.slots.some((s) => s.id === slotId && s.kind !== "group") ? assignSlot(b, slotId, d.id) : (p && p.inside ? placeToken(b, d.id, p.x, p.y) : b)));
                else if (p && p.inside) edit((b) => placeToken(b, d.id, p.x, p.y));
            } else if (d.kind === "token") {
                if (overTray) edit((b) => removeToken(b, d.id));
                else if (slotId) edit((b) => (b.slots.some((s) => s.id === slotId && s.kind !== "group") ? assignSlot(b, slotId, d.id) : b));
            } else if (d.kind === "slot" && overTray) {
                // a slot dragged onto the list gives up its player; the slot itself stays
                edit((b) => assignSlot(b, d.id, ""));
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

    const startDrag = (e: PointerEvent<HTMLElement>, kind: ObjectKind | "tray", id: string, corner?: Corner) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        // preventDefault keeps the browser from focusing the button: do it by hand, or Delete / arrows would go nowhere
        if (kind !== "tray") { setSelected({ kind, id }); (e.currentTarget as HTMLElement).focus(); }
        let ox = 0;
        let oy = 0;
        let rect0: Rect | undefined;
        let p0: { x: number; y: number } | undefined;
        const p = toBoard(e.clientX, e.clientY);
        if (kind === "zone") {
            const z = board.zones.find((k) => k.id === id);
            if (z) rect0 = { x: z.x, y: z.y, w: z.w, h: z.h };
            if (p) p0 = { x: p.x, y: p.y };
        } else if (kind !== "tray") {
            const r = e.currentTarget.getBoundingClientRect();
            ox = r.left + r.width / 2 - e.clientX;
            oy = r.top + r.height / 2 - e.clientY;
        }
        const d = { kind, id, corner, x: e.clientX, y: e.clientY, ox, oy, rect0, p0, overTray: false };
        dragRef.current = d;
        setDrag(d);
    };

    const openDetails = (kind: ObjectKind, id: string) => {
        if (kind === "slot") setModal("slot");
        else if (kind === "zone") setModal("zone");
        setSelected({ kind, id });
    };

    const onKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => {
        if (!canWrite) return;
        const step = e.shiftKey ? 0.05 : 0.01;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            edit((b) => nudgeObject(b, kind, id, moves[e.key][0], moves[e.key][1]));
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            edit((b) => removeObject(b, kind, id));
            setSelected(null);
        } else if (e.key === "Enter") {
            openDetails(kind, id);
        }
    };

    const remove = useCallback(() => {
        if (!selected) return;
        edit((b) => removeObject(b, selected.kind, selected.id));
        setSelected(null);
        setModal("");
    }, [selected, edit]);

    const selectedSlot = selected && selected.kind === "slot" ? board.slots.find((s) => s.id === selected.id) || null : null;
    const selectedZone = selected && selected.kind === "zone" ? board.zones.find((z) => z.id === selected.id) || null : null;
    const selectedName = !selected ? "" : selected.kind === "slot" ? (selectedSlot ? slotTitle(selectedSlot) : "")
        : selected.kind === "zone" ? (selectedZone ? selectedZone.label || t(`raidBoard.zone.${selectedZone.type}`) : "")
            : selected.kind === "mark" ? t(`raidBoard.mark.${(board.marks.find((m) => m.id === selected.id) || { mark: "star" }).mark}`)
                : (players.get(selected.id) || { character: "" }).character;
    const dragPlayer = drag && drag.kind === "tray" ? players.get(drag.id) || null : null;
    const dragKey = drag && drag.kind !== "tray" ? `${drag.kind}:${drag.id}` : "";

    return (
        <div className="rp-work">
            <div className="rp-toolbar">
                <h2 className="rp-title">{boss.name}</h2>
                <span className="rp-muted">{boss.instanceName}</span>
                <div className="rp-toolbar-act">
                    {canWrite && <Button variant="ghost" size="sm" onClick={() => setModal("add")}>{t("raidBoard.add.button")}</Button>}
                    {canWrite && selected && (
                        <span className="rp-selection">
                            <span className="rp-selection-name" data-tip={t("raidBoard.selection.hint")}>{selectedName}</span>
                            {(selected.kind === "slot" || selected.kind === "zone") && (
                                <Button variant="ghost" size="sm" onClick={() => setModal(selected.kind === "slot" ? "slot" : "zone")}>{t("raidBoard.selection.details")}</Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={remove}>{t("raidBoard.selection.delete")}</Button>
                        </span>
                    )}
                    {toolbar}
                </div>
            </div>

            <div
                className="rp-board-wrap"
                onPointerDown={(e) => { if (!(e.target as HTMLElement).closest(".rp-token, .rp-zone")) setSelected(null); }}
            >
                <PlanBoard
                    boardRef={boardRef}
                    bossName={boss.name}
                    bossIcon={boss.iconUrl}
                    mapUrl={boss.mapUrl}
                    tokens={board.tokens}
                    slots={board.slots}
                    marks={board.marks}
                    zones={board.zones}
                    players={players}
                    roster={roster}
                    selected={selected}
                    dragKey={dragKey}
                    onObjectDown={canWrite ? (e, kind, id, corner) => startDrag(e, kind, id, corner) : undefined}
                    onObjectKey={canWrite ? onKey : undefined}
                    onObjectOpen={canWrite ? openDetails : undefined}
                    emptyText={canWrite ? `${t("raidBoard.board.noMapTitle")} · ${t("raidBoard.board.noMapText")}` : t("raidBoard.board.noMapTitle")}
                />
            </div>
            {canWrite && <p className="rp-muted rp-hint">{t(isEvent ? "raidBoard.board.hint" : "raidBoard.board.hintTemplate")}</p>}

            <div className="rp-below">
                {isEvent && (
                    <details className="rp-fold rp-tray-fold" open>
                        <summary className="rp-kicker">{t("raidBoard.tray.title")} · {missing.length}</summary>
                        <section className={`rp-side-block rp-tray${drag && drag.overTray ? " is-over" : ""}`} data-rp-tray>
                            {roster.length === 0 && <p className="rp-muted">{t("raidBoard.tray.none")}</p>}
                            {roster.length > 0 && missing.length === 0 && <p className="rp-muted">{t("raidBoard.tray.empty")}</p>}
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
                    </details>
                )}
                <details className="rp-fold" open>
                    <summary className="rp-kicker">{t("raidBoard.targets.title")} · {board.targets.length}</summary>
                    <TargetsPanel
                        board={board}
                        roster={roster}
                        canWrite={canWrite}
                        assignable={isEvent}
                        maxRows={limits.targetsPerBoss}
                        maxTitle={limits.title}
                        maxNotes={limits.notes}
                        profileName={profileName}
                        onChange={(b) => edit(() => b)}
                        onPickProfile={onPickProfile}
                    />
                </details>
            </div>

            {drag && drag.kind === "tray" && dragPlayer && (
                <div className="rp-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                    <TokenIcon player={dragPlayer} />
                </div>
            )}

            <AddObjectModal
                open={modal === "add"} onClose={() => setModal("")}
                onSlot={(kind, label) => edit((b) => addSlot(b, kind, label))}
                onMark={(mark) => edit((b) => addMark(b, mark))}
                onZone={(type, shape) => edit((b) => addZone(b, type, shape))}
            />
            <SlotModal
                slot={modal === "slot" ? selectedSlot : null} roster={roster} showPlayers={isEvent}
                onChange={(patch) => selectedSlot && edit((b) => updateSlot(b, selectedSlot.id, patch))}
                onAssign={(userId) => selectedSlot && edit((b) => assignSlot(b, selectedSlot.id, userId))}
                onDelete={remove} onClose={() => setModal("")}
            />
            <ZoneModal
                zone={modal === "zone" ? selectedZone : null}
                onChange={(patch) => selectedZone && edit((b) => updateZone(b, selectedZone.id, patch))}
                onDelete={remove} onClose={() => setModal("")}
            />
        </div>
    );
}
