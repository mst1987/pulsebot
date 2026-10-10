import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Clapperboard, Play, Plus, Square } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import PlanBoard, { type Handle } from "../PlanBoard";
import ScenePlayerBar, { SceneCaption } from "../ScenePlayerBar";
import { useBoardView } from "../../../hooks/useBoardView";
import { useScenePlayer } from "../../../hooks/useScenePlayer";
import { viewFromSaved } from "../../../lib/raidplan/boardView";
import { deriveAuto, type AutoPlan } from "../../../lib/raidplan/autoPlace";
import { autoAtOf, boardAfter, boardAt, clock, frameLength, loopHint, moveHints, positionOf } from "../../../lib/raidplan/scene";
import { addFrame, addScene, changeOf, frameSummary, insertIndex, insertPoint, loopInsertIndex, loopsOf, moveIn, movePoint, newScene, pathOf, removePoint, sceneRef, setPath, updateLoop, withScene, SCENE_LIMITS } from "../../../lib/raidplan/sceneEdit";
import type { ObjectKind } from "../../../lib/raidplan";
import { toBoardPoint } from "./workspace/types";
import AnimPanel from "./AnimPanel";
import { buttonClass } from "../../ui/Button";
import { useT } from "../../../i18n";

/** Which way is being drawn: the picked object's movement in this frame, or one of its loops. */
export type Draw = { kind: "move"; obj: string } | { kind: "loop"; id: string } | null;

/**
 * The editor's view "Animation" of a section (docs/raidplan/animation.md): the scenes of the board as chips, the board as it
 * stands after the chosen frame ("Takt"), the frame strip under it and the panel beside it (the scene, the frame, the object
 * picked on the map). Dragging an object on the map moves it IN THIS FRAME (one change, its timing in the panel); the dotted
 * way shows where it comes from. "Vorschau" plays the scene with the sheet's player. Everything goes through `edit`, so undo,
 * the unsaved strip and saving work as for the rest of the board.
 */
export default function AnimWorkspace({ boss, board, edit, players, roster, rows, isEvent, canWrite, me, mapPx, baseAuto }: {
    boss: RaidplanBoss;
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    players: Map<string, RaidplanPlayer>;
    roster: RaidplanPlayer[];
    /** the section's effective rows (class references resolved): the tank rows put their objects on the map */
    rows: RaidplanAssignment[];
    isEvent: boolean;
    canWrite: boolean;
    me?: string[];
    mapPx: number;
    /** what the tank rows put on the map without the animation */
    baseAuto: AutoPlan;
}) {
    const t = useT();
    const scenes = useMemo(() => board.scenes || [], [board.scenes]);
    const [sceneId, setSceneId] = useState(scenes.length ? scenes[0].id : "");
    const scene = scenes.find((s) => s.id === sceneId) || scenes[0] || null;
    const [k, setK] = useState(0);
    const frame = scene ? Math.min(k, scene.frames.length - 1) : 0;
    const [sel, setSel] = useState("");
    /** drawing a way (#712): the movement of the picked object in this frame, or one of its loops - a click on the map adds a point */
    const [draw, setDraw] = useState<Draw>(null);
    useEffect(() => { setDraw(null); }, [sel, frame, sceneId]);
    useEffect(() => {
        if (!draw) return undefined;
        const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") setDraw(null); };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [draw]);
    const [preview, setPreview] = useState(false);
    const player = useScenePlayer(preview ? scene : null, { autoplay: true });
    const boardRef = useRef<HTMLDivElement>(null);
    const frameEl = useRef<HTMLDivElement | null>(null);
    const bv = useBoardView({ touchPan: false });
    const savedKey = board.view ? `${board.view.zoom}:${board.view.cx}:${board.view.cy}` : "";
    useEffect(() => { bv.set(viewFromSaved(board.view)); }, [boss.key, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // a new section starts at its first scene and frame, nothing picked
    useEffect(() => { setSceneId(""); setK(0); setSel(""); setPreview(false); }, [boss.key]);

    const autoAt = autoAtOf(baseAuto);
    const state = !scene ? null : preview ? boardAt(board, scene, player.t, autoAt) : boardAfter(board, scene, frame, autoAt);
    const drawn = state ? state.board : board;
    const auto = state ? deriveAuto(rows, drawn, { template: !isEvent, roster }) : baseAuto;
    const hints = scene && !preview ? moveHints(board, scene, frame, autoAt) : [];
    // the ways of the picked object: its movement in this frame (from where it stood to where it goes) and its loops
    const before = scene && frame > 0 && sel ? boardAfter(board, scene, frame - 1, autoAt).board : null;
    const moveOfSel = scene && sel ? changeOf(scene, frame, sel) : undefined;
    const moveWay = moveOfSel && moveOfSel.x !== undefined && moveOfSel.y !== undefined && before ? { from: positionOf(before, sel, autoAt), to: { x: moveOfSel.x, y: moveOfSel.y }, path: pathOf(scene!, frame, sel) } : null;
    const selLoops = scene && sel && !preview ? loopsOf(scene, sel) : [];
    const loopHints = selLoops.map(loopHint);
    const selected = sel ? { kind: sel.slice(0, sel.indexOf(":")) as ObjectKind, id: sel.slice(sel.indexOf(":") + 1) } : null;

    const create = () => {
        const s = newScene(t("raidBoard.anim.newTitle", { n: scenes.length + 1 }));
        edit((b) => addScene(b, s));
        setSceneId(s.id);
        setK(0);
        setSel("");
    };
    const pickScene = (id: string) => { setSceneId(id); setK(0); setSel(""); setPreview(false); };
    const addAfter = () => {
        if (!scene) return;
        edit((b) => withScene(b, scene.id, (s) => addFrame(s, frame)));
        setK(frame + 1);
    };

    /** An object picked on the map: selected, and - with a pointer drag - moved in this frame (live, one step of undo). */
    const startDrag = (e: ReactPointerEvent<HTMLElement | SVGElement>, kind: ObjectKind, id: string, handle?: Handle) => {
        const ref = sceneRef(kind, id);
        setSel(ref);
        // a grip (size, turn, a corner) only picks the object here: the animation moves, the map view scales
        if (!scene || !canWrite || preview || handle) return;
        const start = toBoardPoint(boardRef.current, frameEl.current, e.clientX, e.clientY);
        const pos0 = positionOf(drawn, ref, autoAtOf(auto));
        if (!start || !pos0) return;
        e.preventDefault();
        e.stopPropagation();
        let moved = false;
        const move = (ev: PointerEvent) => {
            const p = toBoardPoint(boardRef.current, frameEl.current, ev.clientX, ev.clientY);
            if (!p) return;
            const dx = p.x - start.x;
            const dy = p.y - start.y;
            if (!moved && Math.hypot(dx * p.w, dy * p.h) < 3) return;
            edit((b) => withScene(b, scene.id, (s) => moveIn(s, frame, ref, pos0.x + dx, pos0.y + dy)), moved);
            moved = true;
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    };

    /** A click on the map while a way is drawn: a new point where it fits best (nothing else is picked or moved meanwhile). */
    const drawDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!draw || !scene || !canWrite) return;
        if ((e.target as HTMLElement).closest(".rp-path-pt")) return;
        const p = toBoardPoint(boardRef.current, frameEl.current, e.clientX, e.clientY);
        if (!p || !p.inside) return;
        e.preventDefault();
        e.stopPropagation();
        if (draw.kind === "move" && moveWay && moveWay.from) {
            const at = insertIndex(moveWay.path, p.x, p.y, moveWay.from, moveWay.to);
            edit((b) => withScene(b, scene.id, (s) => setPath(s, frame, draw.obj, insertPoint(pathOf(s, frame, draw.obj), at, p.x, p.y))));
        } else if (draw.kind === "loop") {
            edit((b) => withScene(b, scene.id, (s) => {
                const l = (s.loops || []).find((x) => x.id === draw.id);
                return l ? updateLoop(s, l.id, { path: insertPoint(l.path, loopInsertIndex(l.path, p.x, p.y, l.closed), p.x, p.y) }) : s;
            }));
        }
    };
    /** A point of a way dragged (live, one undo step) or removed with a double click. */
    const pointDown = (e: ReactPointerEvent<HTMLElement>, way: { kind: "move"; obj: string } | { kind: "loop"; id: string }, i: number) => {
        if (!scene || !canWrite) return;
        e.preventDefault();
        e.stopPropagation();
        let moved = false;
        const write = (x: number, y: number) => edit((b) => withScene(b, scene.id, (s) => {
            if (way.kind === "move") return setPath(s, frame, way.obj, movePoint(pathOf(s, frame, way.obj), i, x, y));
            const l = (s.loops || []).find((q) => q.id === way.id);
            return l ? updateLoop(s, l.id, { path: movePoint(l.path, i, x, y) }) : s;
        }), moved);
        const move = (ev: PointerEvent) => {
            const p = toBoardPoint(boardRef.current, frameEl.current, ev.clientX, ev.clientY);
            if (!p) return;
            write(p.x, p.y);
            moved = true;
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    };
    const dropPoint = (way: { kind: "move"; obj: string } | { kind: "loop"; id: string }, i: number) => {
        if (!scene || !canWrite) return;
        edit((b) => withScene(b, scene.id, (s) => {
            if (way.kind === "move") return setPath(s, frame, way.obj, removePoint(pathOf(s, frame, way.obj), i));
            const l = (s.loops || []).find((q) => q.id === way.id);
            return l ? updateLoop(s, l.id, { path: removePoint(l.path, i) }) : s;
        }));
    };
    const grip = (key: string, x: number, y: number, way: { kind: "move"; obj: string } | { kind: "loop"; id: string }, i: number, first = false) => (
        <span
            key={key} className={`rp-path-pt${first ? " is-loopstart" : ""}`} role="button" tabIndex={-1} aria-label={t("raidBoard.anim.wayPoint", { n: i + 1 })} data-tip={t("raidBoard.anim.wayPointTip")}
            style={{ "--rp-x": `${x * 100}%`, "--rp-y": `${y * 100}%` } as CSSProperties}
            onPointerDown={(e) => pointDown(e, way, i)} onDoubleClick={() => dropPoint(way, i)}
        />
    );
    const overlay = preview || !canWrite ? null : (
        <>
            {moveWay && moveWay.path.map(([x, y], i) => grip(`m${i}`, x, y, { kind: "move", obj: sel }, i))}
            {selLoops.map((l) => l.path.map(([x, y], i) => grip(`l${l.id}${i}`, x, y, { kind: "loop", id: l.id }, i, i === 0)))}
        </>
    );

    if (!scene) {
        return (
            <div className="rp-anim-empty">
                <Clapperboard size={32} aria-hidden="true" />
                <h3>{t("raidBoard.anim.emptyTitle")}</h3>
                <p className="rp-muted">{t("raidBoard.anim.emptyText")}</p>
                <ol className="rp-anim-howto">
                    <li>{t("raidBoard.anim.how1")}</li>
                    <li>{t("raidBoard.anim.how2")}</li>
                    <li>{t("raidBoard.anim.how3")}</li>
                </ol>
                {canWrite && <button type="button" className={buttonClass("primary", "md", true)} onClick={create}><Plus size={16} aria-hidden="true" />{t("raidBoard.anim.create")}</button>}
            </div>
        );
    }

    return (
        <div className="rp-anim-work">
            <div className="rp-anim-head">
                <div className="rp-anim-scenes" role="tablist" aria-label={t("raidBoard.anim.scenes")}>
                    {scenes.map((s) => (
                        <button key={s.id} type="button" role="tab" aria-selected={s.id === scene.id} className={`rp-anim-scene${s.id === scene.id ? " is-on" : ""}`} onClick={() => pickScene(s.id)}>
                            {s.title}<span className="rp-anim-scene-n">{clock(s.length)}</span>
                        </button>
                    ))}
                    {canWrite && scenes.length < SCENE_LIMITS.scenes && (
                        <button type="button" className="rp-anim-scene rp-anim-add" onClick={create}><Plus size={14} aria-hidden="true" />{t("raidBoard.anim.create")}</button>
                    )}
                </div>
                <button type="button" className={buttonClass(preview ? "ghost" : "primary", "md", true, "rp-anim-preview")} aria-pressed={preview} onClick={() => setPreview((v) => !v)} disabled={scene.frames.length < 2 && scene.loops.length === 0}>
                    {preview ? <Square size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                    {preview ? t("raidBoard.anim.stopPreview") : t("raidBoard.anim.preview")}
                </button>
            </div>

            <div className="rp-anim-stagegrid">
                <div className="rp-anim-boardcol">
                    <div className={`rp-board-wrap rp-anim-boardwrap${draw ? " is-drawing" : ""}`} onPointerDownCapture={drawDown}>
                        <PlanBoard
                            boardRef={boardRef} frameRef={(el) => { frameEl.current = el; bv.frame(el); }} view={bv.view} maxHeight={mapPx}
                            bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} mapOpacity={board.mapOpacity}
                            tokens={drawn.tokens} slots={drawn.slots} marks={drawn.marks} icons={drawn.icons} objectScale={board.objectScale} zones={drawn.zones} lines={drawn.lines} texts={drawn.texts}
                            players={players} roster={roster} me={me} assignments={rows} auto={auto} showRings={board.showRings !== false}
                            showNames={board.showNames !== false} showBadges={board.showBadges !== false} showRoleRings={board.showRoleRings !== false}
                            groupColors={board.groupColors} groupMarks={board.groupMarks}
                            selected={preview ? null : selected} onObjectDown={preview ? undefined : startDrag}
                            fx={state ? state.fx : undefined} trails={[...(state ? state.trails : []), ...hints, ...loopHints]} overlay={overlay}
                        />
                        {/* the caption over the map only while it plays: in the editor it would cover the objects (the strip and the panel show it) */}
                        {preview && <SceneCaption scene={scene} t={player.t} />}
                    </div>
                    {preview ? (
                        <ScenePlayerBar scenes={[scene]} scene={scene} player={player} onPick={() => undefined} onClose={() => setPreview(false)} />
                    ) : (
                        <div className="rp-anim-strip" role="listbox" aria-label={t("raidBoard.anim.frames")}>
                            {scene.frames.map((f, i) => {
                                const sum = frameSummary(f);
                                return (
                                    <button key={f.id} type="button" role="option" aria-selected={i === frame} className={`rp-anim-frame${i === frame ? " is-on" : ""}`} onClick={() => { setK(i); }}>
                                        <span className="rp-anim-frame-top"><b>{i + 1}</b><span>{clock(f.at)}</span><span className="rp-anim-frame-len">{t("raidBoard.anim.seconds", { v: String(frameLength(scene, i)).replace(".", ",") })}</span></span>
                                        <span className="rp-anim-frame-cap">{f.caption || (i === 0 ? t("raidBoard.anim.startFrame") : t("raidBoard.anim.noCaption"))}</span>
                                        <span className="rp-anim-frame-sum">{sum.total === 0 ? t("raidBoard.anim.noChanges") : t("raidBoard.anim.changes", { n: sum.total })}</span>
                                    </button>
                                );
                            })}
                            {canWrite && scene.frames.length < SCENE_LIMITS.frames && (
                                <button type="button" className="rp-anim-frame rp-anim-frame-add" onClick={addAfter} data-tip={t("raidBoard.anim.addFrameTip")}>
                                    <Plus size={18} aria-hidden="true" /><span>{t("raidBoard.anim.addFrame")}</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <AnimPanel
                    board={board} drawn={drawn} scene={scene} frame={frame} sel={preview ? "" : sel} canWrite={canWrite && !preview} players={players} edit={edit}
                    onFrame={setK} onSel={setSel} onSceneGone={() => { setSceneId(""); setK(0); setSel(""); }}
                    draw={draw} onDraw={setDraw} startOf={(ref) => positionOf(drawn, ref, autoAtOf(auto))}
                />
            </div>
            {canWrite && !preview && <p className="rp-muted rp-hint">{frame === 0 ? t("raidBoard.anim.hintStart") : t("raidBoard.anim.hint")}</p>}
        </div>
    );
}
