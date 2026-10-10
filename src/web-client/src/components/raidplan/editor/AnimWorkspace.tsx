import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Clapperboard, Play, Plus, Square } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import PlanBoard, { type Handle } from "../PlanBoard";
import ScenePlayerBar, { SceneCaption } from "../ScenePlayerBar";
import { useBoardView } from "../../../hooks/useBoardView";
import { useScenePlayer } from "../../../hooks/useScenePlayer";
import { viewFromSaved } from "../../../lib/raidplan/boardView";
import { deriveAuto, type AutoPlan } from "../../../lib/raidplan/autoPlace";
import { autoAtOf, boardAfter, boardAt, clock, frameLength, moveHints, positionOf } from "../../../lib/raidplan/scene";
import { addFrame, addScene, frameSummary, moveIn, newScene, sceneRef, withScene, SCENE_LIMITS } from "../../../lib/raidplan/sceneEdit";
import type { ObjectKind } from "../../../lib/raidplan";
import { toBoardPoint } from "./workspace/types";
import AnimPanel from "./AnimPanel";
import { buttonClass } from "../../ui/Button";
import { useT } from "../../../i18n";

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
                    <div className="rp-board-wrap rp-anim-boardwrap">
                        <PlanBoard
                            boardRef={boardRef} frameRef={(el) => { frameEl.current = el; bv.frame(el); }} view={bv.view} maxHeight={mapPx}
                            bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} mapOpacity={board.mapOpacity}
                            tokens={drawn.tokens} slots={drawn.slots} marks={drawn.marks} icons={drawn.icons} objectScale={board.objectScale} zones={drawn.zones} lines={drawn.lines} texts={drawn.texts}
                            players={players} roster={roster} me={me} assignments={rows} auto={auto} showRings={board.showRings !== false}
                            showNames={board.showNames !== false} showBadges={board.showBadges !== false} showRoleRings={board.showRoleRings !== false}
                            groupColors={board.groupColors} groupMarks={board.groupMarks}
                            selected={preview ? null : selected} onObjectDown={preview ? undefined : startDrag}
                            fx={state ? state.fx : undefined} trails={[...(state ? state.trails : []), ...hints]}
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
                />
            </div>
            {canWrite && !preview && <p className="rp-muted rp-hint">{frame === 0 ? t("raidBoard.anim.hintStart") : t("raidBoard.anim.hint")}</p>}
        </div>
    );
}
