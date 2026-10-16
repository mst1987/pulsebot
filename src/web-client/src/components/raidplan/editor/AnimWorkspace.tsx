import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Clapperboard, Play, Plus, Square } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import PlanBoard, { type Handle } from "../PlanBoard";
import ScenePlayerBar, { SceneCaption } from "../ScenePlayerBar";
import { useBoardView } from "../../../hooks/useBoardView";
import { useScenePlayer } from "../../../hooks/useScenePlayer";
import { viewFromSaved } from "../../../lib/raidplan/boardView";
import { deriveAuto, type AutoPlan } from "../../../lib/raidplan/autoPlace";
import { autoAtOf, boardAfter, boardAt, clock, frameLength, loopHint, moveHints, positionOf } from "../../../lib/raidplan/scene";
import { addFrame, addScene, changeOf, insertIndex, insertPoint, loopInsertIndex, loopsOf, moveIn, movePoint, newScene, pathOf, removePoint, sceneRef, setPath, updateLoop, withScene, SCENE_LIMITS } from "../../../lib/raidplan/sceneEdit";
import { actorIndex, actsIn, centroid, frameParts, loopAll, loopsInFrame, moveAllTo, patchAll, sceneActors, selectionSummary } from "../../../lib/raidplan/sceneActions";
import { memberOffsets } from "../../../lib/raidplan/members";
import type { ObjectKind } from "../../../lib/raidplan";
import { toBoardPoint } from "./workspace/types";
import AnimPanel from "./AnimPanel";
import ActorPicker from "./ActorPicker";
import { newWizard, type Wizard } from "./wizardState";
import { buttonClass } from "../../ui/Button";
import { useT } from "../../../i18n";

/** Which way is being drawn: the picked object's movement in this frame, or one of its loops. */
export type Draw = { kind: "move"; obj: string } | { kind: "loop"; id: string } | null;
type Pt = { x: number; y: number };
const toggle = (list: string[], ref: string) => (list.includes(ref) ? list.filter((r) => r !== ref) : [...list, ref]);

/**
 * The editor's view "Animation" of a section (docs/raidplan/animation.md, design B "Aktionen als Sätze"): the scenes as chips, the
 * board as it stands after the chosen frame ("Takt"), under it "Wer?" (everyone who can act) and the frame strip, beside it the
 * frame's actions as sentences with the assistant Wer → Was → Wohin. Who is picked is always visible: the map lights them up (a
 * picked group with all its raiders), a label names them, the picker marks them. A click on a raider picks his group, Alt + click
 * only him, Shift + click adds; dragging moves everyone picked in this frame. Everything goes through `edit`, so undo, the unsaved
 * strip and saving work as for the rest of the board.
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
    const [sel, setSel] = useState<string[]>([]);
    const [wiz, setWiz] = useState<Wizard | null>(null);
    /** drawing a way (#712): the movement of the picked object in this frame, or one of its loops - a click on the map adds a point */
    const [draw, setDraw] = useState<Draw>(null);
    const selKey = sel.join("|");
    useEffect(() => { setDraw(null); }, [selKey, frame, sceneId]);
    useEffect(() => { setWiz(null); }, [frame, sceneId]);
    useEffect(() => {
        if (!draw && !wiz) return undefined;
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") { setDraw(null); setWiz(null); }
            if (e.key === "Enter" && draw) setDraw(null);
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [draw, wiz]);
    const [preview, setPreview] = useState(false);
    const player = useScenePlayer(preview ? scene : null, { autoplay: true });
    const [aspect, setAspect] = useState(16 / 10);
    const onAspect = useCallback((a: number) => setAspect(a), []);
    const boardRef = useRef<HTMLDivElement>(null);
    const frameEl = useRef<HTMLDivElement | null>(null);
    const bv = useBoardView({ touchPan: false });
    const savedKey = board.view ? `${board.view.zoom}:${board.view.cx}:${board.view.cy}` : "";
    useEffect(() => { bv.set(viewFromSaved(board.view)); }, [boss.key, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // a new section starts at its first scene and frame, nothing picked
    useEffect(() => { setSceneId(""); setK(0); setSel([]); setPreview(false); setWiz(null); }, [boss.key]);

    const autoAt = autoAtOf(baseAuto);
    // where the ring puts each raider of a split group (a single raider is moved from there)
    const memberAt = useMemo(() => memberOffsets({ ...board, autoUsers: baseAuto.users }, roster, aspect), [board, baseAuto, roster, aspect]);
    const state = !scene ? null : preview ? boardAt(board, scene, player.t, autoAt, memberAt) : boardAfter(board, scene, frame, autoAt, memberAt);
    const drawn = state ? state.board : board;
    const auto = state ? deriveAuto(rows, drawn, { template: !isEvent, roster }) : baseAuto;
    const posOf = (ref: string) => positionOf(drawn, ref, autoAtOf(auto), memberAt);
    const before = scene && frame > 0 ? boardAfter(board, scene, frame - 1, autoAt, memberAt).board : board;
    const fromOf = (ref: string) => positionOf(before, ref, autoAt, memberAt);
    const actors = useMemo(() => sceneActors({ ...board, autoUsers: baseAuto.users }, roster, players, baseAuto), [board, roster, players, baseAuto]);
    const index = useMemo(() => actorIndex(actors), [actors]);
    const live = sel.filter((r) => index.has(r));
    const summary = selectionSummary(live, index);
    const parts = scene ? frameParts(scene, frame, fromOf) : [];
    const frameLoops = scene ? loopsInFrame(scene, frame) : [];
    const hints = scene && !preview ? moveHints(board, scene, frame, autoAt, memberAt) : [];
    // the ways of a single picked actor: his movement in this frame (from where he stood to where he goes) and his loops
    const single = live.length === 1 ? live[0] : "";
    const moveOfSel = scene && single ? changeOf(scene, frame, single) : undefined;
    const moveWay = moveOfSel && moveOfSel.x !== undefined && moveOfSel.y !== undefined && frame > 0 ? { from: fromOf(single), to: { x: moveOfSel.x, y: moveOfSel.y }, path: pathOf(scene!, frame, single) } : null;
    const selLoops = scene && single && !preview ? loopsOf(scene, single) : [];
    const picking = !!wiz && wiz.step === "where";
    // the assistant's loop as it is clicked: from the middle of the picked through the points
    const selMid = centroid(live.map(posOf).filter((p): p is Pt => !!p));
    const wizWay = picking && wiz!.what === "loop" && wiz!.points.length > 0
        ? [loopHint({ id: "wiz", obj: "wiz", path: [[selMid.x, selMid.y], ...wiz!.points.map((p) => [p.x, p.y] as [number, number])], closed: wiz!.closed, period: 10, from: 0, to: 0, trail: false })] : [];

    const create = () => {
        const s = newScene(t("raidBoard.anim.newTitle", { n: scenes.length + 1 }));
        edit((b) => addScene(b, s));
        setSceneId(s.id);
        setK(0);
        setSel([]);
    };
    const pickScene = (id: string) => { setSceneId(id); setK(0); setSel([]); setPreview(false); };
    const addAfter = () => {
        if (!scene) return;
        edit((b) => withScene(b, scene.id, (s) => addFrame(s, frame)));
        setK(frame + 1);
    };
    const pick = (ref: string, add = false) => setSel((cur) => (add ? toggle(cur, ref) : [ref]));
    const upd = (fn: Parameters<typeof withScene>[2], coalesce = false) => { if (scene) edit((b) => withScene(b, scene.id, fn), coalesce); };

    /** An object on the map: picked (a raider = his group, Alt = only him, Shift = add), and - with a drag - everyone picked moves in this frame. */
    const startDrag = (e: ReactPointerEvent<HTMLElement | SVGElement>, kind: ObjectKind, id: string, handle?: Handle) => {
        const ref = kind === "member" && !e.altKey ? sceneRef("member", id) : `${kind}:${id}`;
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        const next = add ? toggle(live, ref) : live.includes(ref) ? live : [ref];
        setSel(next);
        // a grip (size, turn, a corner) only picks the object here: the animation moves, the map view scales
        if (!scene || !canWrite || preview || handle || add || picking) return;
        const start = toBoardPoint(boardRef.current, frameEl.current, e.clientX, e.clientY);
        const from = next.map((r) => ({ r, p: posOf(r) })).filter((x): x is { r: string; p: Pt } => !!x.p);
        if (!start || from.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        let moved = false;
        const move = (ev: PointerEvent) => {
            const p = toBoardPoint(boardRef.current, frameEl.current, ev.clientX, ev.clientY);
            if (!p) return;
            const dx = p.x - start.x;
            const dy = p.y - start.y;
            if (!moved && Math.hypot(dx * p.w, dy * p.h) < 3) return;
            edit((b) => withScene(b, scene.id, (s) => from.reduce((acc, x) => moveIn(acc, frame, x.r, x.p.x + dx, x.p.y + dy), s)), moved);
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

    /** A click on the map while the assistant asks "Wohin?" or a way is drawn: the target / a new point (nothing else is picked meanwhile). */
    const drawDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!scene || !canWrite || (!draw && !picking)) return;
        if ((e.target as HTMLElement).closest(".rp-path-pt")) return;
        const p = toBoardPoint(boardRef.current, frameEl.current, e.clientX, e.clientY);
        if (!p || !p.inside) return;
        e.preventDefault();
        e.stopPropagation();
        if (picking && wiz) {
            if (wiz.what === "move") {
                upd((s) => moveAllTo(s, frame, live, posOf, { x: p.x, y: p.y }));
                setWiz(null);
            } else setWiz({ ...wiz, points: [...wiz.points, { x: p.x, y: p.y }] });
            return;
        }
        if (draw && draw.kind === "move" && moveWay && moveWay.from) {
            const at = insertIndex(moveWay.path, p.x, p.y, moveWay.from, moveWay.to);
            upd((s) => setPath(s, frame, draw.obj, insertPoint(pathOf(s, frame, draw.obj), at, p.x, p.y)));
        } else if (draw && draw.kind === "loop") {
            upd((s) => {
                const l = (s.loops || []).find((x) => x.id === draw.id);
                return l ? updateLoop(s, l.id, { path: insertPoint(l.path, loopInsertIndex(l.path, p.x, p.y, l.closed), p.x, p.y) }) : s;
            });
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
        upd((s) => {
            if (way.kind === "move") return setPath(s, frame, way.obj, removePoint(pathOf(s, frame, way.obj), i));
            const l = (s.loops || []).find((q) => q.id === way.id);
            return l ? updateLoop(s, l.id, { path: removePoint(l.path, i) }) : s;
        });
    };

    /** The assistant adds an action that needs no place, for everyone picked. */
    const addAction = () => {
        if (!wiz) return;
        // a debuff is given (with a pulse) or taken off from this frame on (the pulse ends with it)
        const patch = wiz.what === "badge" ? (wiz.badgeOff ? { badge: "", ...(wiz.pulseToo ? { pulse: false } : {}) } : { badge: wiz.badge, ...(wiz.pulseToo ? { pulse: true } : {}) })
            : wiz.what === "fade" ? (wiz.fade === "half" ? { opacity: 0.5 } : { hidden: wiz.fade === "hide" })
                : wiz.what === "turn" ? { rotation: wiz.deg }
                    : { pulse: wiz.pulseOn };
        upd((s) => patchAll(s, frame, live, patch));
        setWiz(null);
    };
    /** The assistant's loop: one for everyone picked, along the clicked way, from this frame's start. */
    const loopDone = () => {
        if (!wiz || !scene) return;
        upd((s) => {
            const r = loopAll(s, live, posOf, wiz.points, scene.frames[frame].at);
            return { ...r.scene, loops: r.scene.loops.map((l) => (r.ids.includes(l.id) ? { ...l, closed: wiz.closed } : l)) };
        });
        setWiz(null);
    };

    const grip = (key: string, x: number, y: number, way: { kind: "move"; obj: string } | { kind: "loop"; id: string }, i: number, first = false) => (
        <span
            key={key} className={`rp-path-pt${first ? " is-loopstart" : ""}`} role="button" tabIndex={-1} aria-label={t("raidBoard.anim.wayPoint", { n: i + 1 })} data-tip={t("raidBoard.anim.wayPointTip")}
            style={{ "--rp-x": `${x * 100}%`, "--rp-y": `${y * 100}%` } as CSSProperties}
            onPointerDown={(e) => pointDown(e, way, i)} onDoubleClick={() => dropPoint(way, i)}
        />
    );
    const names = summary.names.length > 6 ? `${summary.names.slice(0, 6).join(", ")} +${summary.names.length - 6}` : summary.names.join(", ");
    const overlay = preview ? null : (
        <>
            {canWrite && moveWay && moveWay.path.map(([x, y], i) => grip(`m${i}`, x, y, { kind: "move", obj: single }, i))}
            {canWrite && selLoops.map((l) => l.path.map(([x, y], i) => grip(`l${l.id}${i}`, x, y, { kind: "loop", id: l.id }, i, i === 0)))}
            {live.length > 0 && (
                <div className={`rp-anim-sellabel${selMid.x < 0.25 ? " is-leanstart" : selMid.x > 0.75 ? " is-leanend" : ""}`} role="status" style={{ "--rp-x": `${selMid.x * 100}%`, "--rp-y": `${selMid.y * 100}%` } as CSSProperties}>
                    <strong>{summary.title}</strong>
                    {names && <span>{names}</span>}
                </div>
            )}
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

    /** who does something in a frame, for its card in the strip */
    const whoIn = (i: number) => {
        const refs = [...new Set([...scene.frames[i].changes.map((c) => c.obj), ...loopsInFrame(scene, i).map((l) => l.obj)])];
        return refs.map((r) => index.get(r)).filter((a): a is NonNullable<typeof a> => !!a);
    };

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
                    <div className={`rp-board-wrap rp-anim-boardwrap${draw || picking ? " is-drawing" : ""}`} onPointerDownCapture={drawDown}>
                        <PlanBoard
                            boardRef={boardRef} frameRef={(el) => { frameEl.current = el; bv.frame(el); }} view={bv.view} maxHeight={mapPx} onAspect={onAspect}
                            bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} mapOpacity={board.mapOpacity}
                            tokens={drawn.tokens} slots={drawn.slots} marks={drawn.marks} icons={drawn.icons} objectScale={board.objectScale} zones={drawn.zones} lines={drawn.lines} texts={drawn.texts}
                            players={players} roster={roster} me={me} assignments={rows} auto={auto} showRings={board.showRings !== false}
                            showNames={board.showNames !== false} showBadges={board.showBadges !== false} showRoleRings={board.showRoleRings !== false}
                            groupColors={board.groupColors} groupMarks={board.groupMarks} showSelection={false}
                            lit={preview ? [] : live} onObjectDown={preview ? undefined : startDrag}
                            fx={state ? state.fx : undefined} trails={[...(state ? state.trails : []), ...hints, ...selLoops.map(loopHint), ...wizWay]} overlay={overlay}
                        />
                        {preview && <SceneCaption scene={scene} t={player.t} />}
                        {picking && (
                            <div className="rp-anim-picking" role="status">{wiz!.what === "loop" ? t("raidBoard.anim.wiz.whereLoop", { n: wiz!.points.length }) : t("raidBoard.anim.wiz.whereMove", { who: summary.title })}</div>
                        )}
                    </div>
                    {preview ? (
                        <ScenePlayerBar scenes={[scene]} scene={scene} player={player} onPick={() => undefined} onClose={() => setPreview(false)} />
                    ) : (
                        <>
                            <p className="rp-anim-pickhint">{t("raidBoard.anim.pickHint")}</p>
                            <ActorPicker actors={actors} sel={live} active={!!wiz && wiz.step === "who"} actsIn={(ref) => actsIn(scene, frame, ref)} onPick={pick} onClear={() => setSel([])} />
                            <div className="rp-anim-strip" role="listbox" aria-label={t("raidBoard.anim.frames")}>
                                {scene.frames.map((f, i) => {
                                    const who = whoIn(i);
                                    return (
                                        <button key={f.id} type="button" role="option" aria-selected={i === frame} className={`rp-anim-frame${i === frame ? " is-on" : ""}`} onClick={() => { setK(i); }}>
                                            <span className="rp-anim-frame-top"><b>{i + 1}</b><span>{clock(f.at)}</span><span className="rp-anim-frame-len">{t("raidBoard.anim.seconds", { v: String(frameLength(scene, i)).replace(".", ",") })}</span></span>
                                            <span className="rp-anim-frame-cap">{f.caption || (i === 0 ? t("raidBoard.anim.startFrame") : t("raidBoard.anim.noCaption"))}</span>
                                            <span className="rp-anim-frame-who">
                                                {who.length === 0 ? <span className="rp-anim-frame-sum">{t("raidBoard.anim.noChanges")}</span> : who.slice(0, 3).map((a) => (
                                                    <span key={a.ref} className="rp-anim-frame-chip" style={{ "--rp-ac": a.color } as CSSProperties}>{a.label}</span>
                                                ))}
                                                {who.length > 3 && <span className="rp-anim-frame-sum">+{who.length - 3}</span>}
                                            </span>
                                        </button>
                                    );
                                })}
                                {canWrite && scene.frames.length < SCENE_LIMITS.frames && (
                                    <button type="button" className="rp-anim-frame rp-anim-frame-add" onClick={addAfter} data-tip={t("raidBoard.anim.addFrameTip")}>
                                        <Plus size={18} aria-hidden="true" /><span>{t("raidBoard.anim.addFrame")}</span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
                <AnimPanel
                    board={board} scene={scene} frame={frame} canWrite={canWrite && !preview} edit={edit}
                    onFrame={setK} onSceneGone={() => { setSceneId(""); setK(0); setSel([]); }}
                    parts={parts} loops={frameLoops} index={index} sel={live} onPick={(ref) => pick(ref)} draw={draw} onDraw={setDraw}
                    wiz={wiz} setWiz={setWiz} onOpenWizard={() => setWiz(newWizard(live.length > 0))}
                    who={summary.title} names={summary.names}
                    canFade={live.every((r) => index.get(r)!.canFade)} canTurn={live.length > 0 && live.every((r) => index.get(r)!.canTurn)}
                    onAdd={addAction} onLoopDone={loopDone}
                />
            </div>
        </div>
    );
}
