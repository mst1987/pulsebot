import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, Route, Trash2 } from "lucide-react";
import type { RaidplanBoard, RaidplanChange, RaidplanEase, RaidplanLoop, RaidplanPlayer, RaidplanScene } from "../../../api";
import { NumberField } from "../NumberField";
import Switch from "../../ui/Switch";
import { buttonClass } from "../../ui/Button";
import { useConfirm } from "../../ui/Modal";
import { wowIconUrl } from "../../../lib/wow/wowIcon";
import { clock, frameLength, type SceneBoard } from "../../../lib/raidplan/scene";
import { BADGE_PRESETS, EASES, PATH_LIMITS, addLoop, loopsOf, newLoopId, pathOf, removeLoop, setPath, updateLoop, addFrame, changeOf, moveFrame, patchChange, removeChange, removeFrame, removeScene, setCaption, setFrameLength, valueAfter, withScene, SCENE_LIMITS } from "../../../lib/raidplan/sceneEdit";
import { objectName, type ObjectKind } from "../../../lib/raidplan";
import { useT } from "../../../i18n";
import type { Draw } from "./AnimWorkspace";

const ICON_NAME = /^[a-z0-9_'-]{2,64}$/;

/** A number with − / + beside it (the field in the middle takes typing and the arrow keys). */
function Stepper({ value, min, max, step, unit, decimals = 0, label, disabled, onChange }: {
    value: number; min: number; max: number; step: number; unit: string; decimals?: number; label: string; disabled?: boolean; onChange: (v: number) => void;
}) {
    const t = useT();
    const round = (v: number) => Math.round(Math.max(min, Math.min(max, v)) * 10 ** decimals) / 10 ** decimals;
    return (
        <span className="rp-anim-step" role="group" aria-label={label}>
            <button type="button" aria-label={t("raidBoard.anim.less", { what: label })} disabled={disabled || value <= min} onClick={() => onChange(round(value - step))}><Minus size={13} aria-hidden="true" /></button>
            <NumberField value={value} min={min} max={max} step={step} unit={unit} decimals={decimals} label={label} disabled={disabled} onChange={onChange} />
            <button type="button" aria-label={t("raidBoard.anim.more", { what: label })} disabled={disabled || value >= max} onClick={() => onChange(round(value + step))}><Plus size={13} aria-hidden="true" /></button>
        </span>
    );
}

/** One labelled line of the panel: the label at the left, the control at the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
    return <div className="rp-anim-prow"><span className="rp-anim-plabel">{label}</span><span className="rp-anim-pctl">{children}</span></div>;
}

/**
 * The panel beside the animation's board: the scene (name, loop, delete), the frame that is edited (caption, length, order,
 * the objects it changes) and the object picked on the map - what it does in this frame: when its change starts, how long it
 * takes and how it runs, its turn, opacity, size, whether it is shown, a debuff icon on it and a pulse. Every value shows the
 * state after this frame; changing it writes the object's change of this frame.
 */
export default function AnimPanel({ board, drawn, scene, frame, sel, canWrite, players, edit, onFrame, onSel, onSceneGone, draw, onDraw, startOf }: {
    board: RaidplanBoard;
    /** the board as it stands after this frame */
    drawn: SceneBoard;
    scene: RaidplanScene;
    frame: number;
    /** the picked object, "<kind>:<id>" ("" = none) */
    sel: string;
    canWrite: boolean;
    players: Map<string, RaidplanPlayer>;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    onFrame: (k: number) => void;
    onSel: (ref: string) => void;
    onSceneGone: () => void;
    /** the way being drawn (a click on the map adds a point) */
    draw: Draw;
    onDraw: (d: Draw) => void;
    /** where an object stands after this frame (a new loop starts there) */
    startOf: (ref: string) => { x: number; y: number } | null;
}) {
    const t = useT();
    const ask = useConfirm();
    const upd = (fn: (s: RaidplanScene) => RaidplanScene, coalesce = false) => edit((b) => withScene(b, scene.id, fn), coalesce);
    const f = scene.frames[frame];
    const n = scene.frames.length;
    const off = !canWrite;

    const nameOf = (ref: string) => {
        const i = ref.indexOf(":");
        const kind = ref.slice(0, i);
        const id = ref.slice(i + 1);
        if (kind === "auto") return id.startsWith("t:") ? t("raidBoard.anim.autoTank") : t("raidBoard.anim.autoMob");
        // an icon without a label that stands for a mob: the mob's name (from the section's mobs or a row that names it)
        const icon = kind === "icon" ? board.icons.find((x) => x.id === id) : undefined;
        if (icon && !icon.label && icon.mobId) {
            const mob = (board.mobs || []).find((m) => m.id === icon.mobId);
            const target = board.assignments.flatMap((r) => r.targets).find((tg) => tg.kind === "mob" && tg.ref === icon.mobId);
            const named = mob ? mob.name : target && "name" in target ? String(target.name || "") : "";
            if (named) return named;
        }
        return objectName(board, kind as ObjectKind, id, players) || t("raidBoard.anim.object");
    };

    return (
        <aside className="rp-anim-panel" aria-label={t("raidBoard.anim.panel")}>
            <section className="rp-anim-psec">
                <h3 className="rp-kicker">{t("raidBoard.anim.sceneHead")}</h3>
                <input
                    className="inp-sm rp-anim-input rp-anim-title" value={scene.title} maxLength={SCENE_LIMITS.title} disabled={off} aria-label={t("raidBoard.anim.title")}
                    onChange={(e) => upd((s) => ({ ...s, title: e.target.value }), true)}
                />
                <Switch checked={scene.loop} disabled={off} onChange={(v) => upd((s) => ({ ...s, loop: v }))} label={t("raidBoard.anim.loopScene")} tip={t("raidBoard.anim.loopSceneTip")} />
                {canWrite && (
                    <button
                        type="button" className={buttonClass("ghost", "sm", true, "rp-anim-del")}
                        onClick={async () => {
                            if (!(await ask({ title: t("raidBoard.anim.deleteSceneAsk"), text: scene.title, action: t("raidBoard.anim.yesDelete"), tone: "danger" }))) return;
                            edit((b) => removeScene(b, scene.id));
                            onSceneGone();
                        }}
                    ><Trash2 size={14} aria-hidden="true" />{t("raidBoard.anim.deleteScene")}</button>
                )}
            </section>

            <section className="rp-anim-psec">
                <h3 className="rp-anim-fhead"><span>{t("raidBoard.anim.frameOf", { n: frame + 1, of: n })}</span><span className="rp-muted">{t("raidBoard.anim.from", { at: clock(f.at) })}</span></h3>
                <input
                    className="inp-sm rp-anim-input" value={f.caption} maxLength={SCENE_LIMITS.caption} disabled={off} placeholder={t("raidBoard.anim.captionPh")} aria-label={t("raidBoard.anim.caption")}
                    onChange={(e) => upd((s) => setCaption(s, frame, e.target.value), true)}
                />
                <Row label={t("raidBoard.anim.length")}>
                    <Stepper value={frameLength(scene, frame)} min={0.1} max={60} step={0.5} unit="s" decimals={1} label={t("raidBoard.anim.length")} disabled={off} onChange={(v) => upd((s) => setFrameLength(s, frame, v))} />
                </Row>
                {canWrite && (
                    <div className="rp-anim-fbtns">
                        <button type="button" className={buttonClass("ghost", "sm", true)} disabled={frame === 0} onClick={() => { upd((s) => moveFrame(s, frame, -1)); onFrame(frame - 1); }} data-tip={t("raidBoard.anim.earlierTip")}><ChevronLeft size={14} aria-hidden="true" />{t("raidBoard.anim.earlier")}</button>
                        <button type="button" className={buttonClass("ghost", "sm", true)} disabled={frame >= n - 1} onClick={() => { upd((s) => moveFrame(s, frame, 1)); onFrame(frame + 1); }} data-tip={t("raidBoard.anim.laterTip")}>{t("raidBoard.anim.later")}<ChevronRight size={14} aria-hidden="true" /></button>
                        <button type="button" className={buttonClass("ghost", "sm", true)} disabled={n >= SCENE_LIMITS.frames} onClick={() => { upd((s) => addFrame(s, frame)); onFrame(frame + 1); }}><Plus size={14} aria-hidden="true" />{t("raidBoard.anim.addFrameAfter")}</button>
                        {n > 1 && (
                            <button
                                type="button" className={buttonClass("ghost", "sm", true)}
                                onClick={async () => {
                                    if (f.changes.length > 0 && !(await ask({ title: t("raidBoard.anim.deleteFrameAsk", { n: frame + 1 }), text: f.caption || undefined, action: t("raidBoard.anim.yesDelete"), tone: "danger" }))) return;
                                    upd((s) => removeFrame(s, frame));
                                    onFrame(Math.max(0, frame - 1));
                                }}
                            ><Trash2 size={14} aria-hidden="true" />{t("raidBoard.anim.deleteFrame")}</button>
                        )}
                    </div>
                )}
                {f.changes.length > 0 ? (
                    <div className="rp-anim-chips" aria-label={t("raidBoard.anim.changesHere")}>
                        {f.changes.map((c) => (
                            <button key={c.obj} type="button" className={`rp-anim-chip${c.obj === sel ? " is-on" : ""}`} onClick={() => onSel(c.obj)}>{nameOf(c.obj)}</button>
                        ))}
                    </div>
                ) : <p className="rp-muted rp-anim-note">{frame === 0 ? t("raidBoard.anim.startNote") : t("raidBoard.anim.emptyFrame")}</p>}
            </section>

            {sel && <ObjectSection key={sel} board={board} drawn={drawn} scene={scene} frame={frame} sel={sel} name={nameOf(sel)} canWrite={canWrite} upd={upd} draw={draw} onDraw={onDraw} startOf={startOf} />}
        </aside>
    );
}

/** What the picked object does in this frame. */
function ObjectSection({ board, drawn, scene, frame, sel, name, canWrite, upd, draw, onDraw, startOf }: {
    board: RaidplanBoard;
    drawn: SceneBoard;
    scene: RaidplanScene;
    frame: number;
    sel: string;
    name: string;
    canWrite: boolean;
    upd: (fn: (s: RaidplanScene) => RaidplanScene, coalesce?: boolean) => void;
    draw: Draw;
    onDraw: (d: Draw) => void;
    startOf: (ref: string) => { x: number; y: number } | null;
}) {
    const t = useT();
    const off = !canWrite;
    const c = changeOf(scene, frame, sel);
    const path = pathOf(scene, frame, sel);
    const drawingMove = !!draw && draw.kind === "move" && draw.obj === sel;
    const loops = loopsOf(scene, sel);
    const newLoop = () => {
        const at = startOf(sel);
        if (!at) return;
        const id = newLoopId();
        upd((s) => addLoop(s, sel, at, scene.frames[frame].at, id).scene);
        onDraw({ kind: "loop", id });
    };
    const kind = sel.slice(0, sel.indexOf(":"));
    const id = sel.slice(sel.indexOf(":") + 1);
    const patch = (p: Partial<Omit<RaidplanChange, "obj">>, coalesce = false) => upd((s) => patchChange(s, frame, sel, p), coalesce);
    const turnable = kind === "icon" || kind === "zone" || kind === "auto";
    const rotation = (() => {
        if (kind === "icon") { const o = drawn.icons.find((x) => x.id === id); return o ? o.rotation || 0 : 0; }
        if (kind === "zone") { const o = drawn.zones.find((x) => x.id === id); return o ? o.rotation || 0 : 0; }
        if (kind === "auto") { const st = (drawn.autoStyle || {})[id]; return st && st.rotation !== undefined ? st.rotation : 0; }
        return 0;
    })();
    const baseOpacity = (() => {
        const list = (kind === "auto" ? [] : (board[`${kind}s` as "tokens"] || [])) as { id?: string; userId?: string; opacity: number }[];
        const o = list.find((x) => (kind === "token" ? x.userId : x.id) === id);
        return o ? o.opacity : 1;
    })();
    const opacity = valueAfter(scene, frame, sel, "opacity") ?? baseOpacity;
    const scale = valueAfter(scene, frame, sel, "scale") ?? 1;
    const hidden = valueAfter(scene, frame, sel, "hidden") === true;
    const badge = valueAfter(scene, frame, sel, "badge") || "";
    const pulse = valueAfter(scene, frame, sel, "pulse") === true;
    const [icon, setIcon] = useState("");
    const typed = icon.trim().toLowerCase().replace(/\s+/g, "_");
    return (
        <section className="rp-anim-psec rp-anim-obj">
            <h3 className="rp-anim-ohead">{name}</h3>
            <p className={`rp-anim-state${c ? " is-on" : ""}`}>{c ? t("raidBoard.anim.changesInFrame") : t("raidBoard.anim.unchanged")}</p>
            {frame > 0 && (
                <>
                    <Row label={t("raidBoard.anim.delay")}>
                        <Stepper value={c ? c.delay : 0} min={0} max={60} step={0.1} unit="s" decimals={1} label={t("raidBoard.anim.delay")} disabled={off || !c} onChange={(v) => patch({ delay: v })} />
                    </Row>
                    <Row label={t("raidBoard.anim.duration")}>
                        <Stepper value={c ? c.dur : 1} min={0} max={60} step={0.1} unit="s" decimals={1} label={t("raidBoard.anim.duration")} disabled={off || !c} onChange={(v) => patch({ dur: v })} />
                    </Row>
                    <div className="rp-anim-eases" role="radiogroup" aria-label={t("raidBoard.anim.ease")}>
                        {EASES.map((e: RaidplanEase) => (
                            <button key={e} type="button" role="radio" aria-checked={(c ? c.ease : "inout") === e} disabled={off || !c} className={`rp-anim-chip${(c ? c.ease : "inout") === e ? " is-on" : ""}`} onClick={() => patch({ ease: e })} data-tip={t(`raidBoard.anim.easeTip.${e}`)}>{t(`raidBoard.anim.easeName.${e}`)}</button>
                        ))}
                    </div>
                </>
            )}
            {c && c.x !== undefined && (
                <Row label={t("raidBoard.anim.moves")}>
                    <button type="button" className={buttonClass("ghost", "sm", true)} disabled={off} onClick={() => patch({ x: undefined, y: undefined, path: undefined })}><RotateCcw size={13} aria-hidden="true" />{t("raidBoard.anim.noMove")}</button>
                </Row>
            )}
            {c && c.x !== undefined && frame > 0 && (
                <>
                    <Row label={path.length > 0 ? t("raidBoard.anim.wayN", { n: path.length }) : t("raidBoard.anim.way")}>
                        <span className="rp-anim-wayctl">
                            <button type="button" className={buttonClass(drawingMove ? "primary" : "ghost", "sm", true)} disabled={off || (!drawingMove && path.length >= PATH_LIMITS.path)} aria-pressed={drawingMove} onClick={() => onDraw(drawingMove ? null : { kind: "move", obj: sel })}>
                                <Route size={13} aria-hidden="true" />{drawingMove ? t("raidBoard.anim.drawDone") : t("raidBoard.anim.drawWay")}
                            </button>
                            {path.length > 0 && <button type="button" className={buttonClass("ghost", "sm")} disabled={off} onClick={() => upd((s) => setPath(s, frame, sel, []))}>{t("raidBoard.anim.straight")}</button>}
                        </span>
                    </Row>
                    {drawingMove && <p className="rp-anim-drawnote" role="status">{t("raidBoard.anim.drawNote")}</p>}
                </>
            )}
            {turnable && (
                <Row label={t("raidBoard.anim.rotation")}>
                    <Stepper value={rotation} min={0} max={359} step={15} unit="°" label={t("raidBoard.anim.rotation")} disabled={off} onChange={(v) => patch({ rotation: ((v % 360) + 360) % 360 })} />
                </Row>
            )}
            <Row label={t("raidBoard.anim.opacity")}>
                <Stepper value={Math.round(opacity * 100)} min={10} max={100} step={10} unit="%" label={t("raidBoard.anim.opacity")} disabled={off} onChange={(v) => patch({ opacity: v / 100 })} />
            </Row>
            <Row label={t("raidBoard.anim.size")}>
                <Stepper value={Math.round(scale * 100)} min={25} max={400} step={10} unit="%" label={t("raidBoard.anim.size")} disabled={off} onChange={(v) => patch({ scale: v / 100 })} />
            </Row>
            <Switch checked={!hidden} disabled={off} onChange={(v) => patch({ hidden: !v })} label={t("raidBoard.anim.visible")} tip={t("raidBoard.anim.visibleTip")} />
            <div className="rp-anim-badge">
                <span className="rp-anim-plabel">{t("raidBoard.anim.badge")}</span>
                <div className="rp-anim-presets">
                    {BADGE_PRESETS.map((p) => (
                        <button key={p} type="button" className={`rp-anim-preset${badge === p ? " is-on" : ""}`} disabled={off} aria-pressed={badge === p} aria-label={t(`raidBoard.anim.preset.${p}`)} data-tip={t(`raidBoard.anim.preset.${p}`)} onClick={() => patch({ badge: badge === p ? "" : p })}>
                            <img src={wowIconUrl(p, 36)} alt="" width={26} height={26} />
                        </button>
                    ))}
                </div>
                <div className="rp-anim-iconname">
                    <input className="inp-sm rp-anim-input" value={icon} placeholder="spell_fire_fireball" disabled={off} aria-label={t("raidBoard.anim.badgeName")} onChange={(e) => setIcon(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && ICON_NAME.test(typed)) { patch({ badge: typed }); setIcon(""); } }} />
                    <button type="button" className={buttonClass("ghost", "sm")} disabled={off || !ICON_NAME.test(typed)} onClick={() => { patch({ badge: typed }); setIcon(""); }}>{t("raidBoard.anim.badgeSet")}</button>
                </div>
                {badge && (
                    <div className="rp-anim-badgenow">
                        <img src={wowIconUrl(badge, 36)} alt="" width={22} height={22} /><code>{badge}</code>
                        <button type="button" className={buttonClass("ghost", "sm")} disabled={off} onClick={() => patch({ badge: "" })}>{t("raidBoard.anim.badgeOff")}</button>
                    </div>
                )}
            </div>
            <Switch checked={pulse} disabled={off} onChange={(v) => patch({ pulse: v })} label={t("raidBoard.anim.pulse")} tip={t("raidBoard.anim.pulseTip")} />
            {c && canWrite && (
                <button type="button" className={buttonClass("ghost", "sm", true, "rp-anim-reset")} onClick={() => upd((s) => removeChange(s, frame, sel))}><RotateCcw size={13} aria-hidden="true" />{t("raidBoard.anim.resetObject")}</button>
            )}
            <div className="rp-anim-loops">
                <span className="rp-anim-plabel" data-tip={t("raidBoard.anim.loopsTip")}>{t("raidBoard.anim.loops")}</span>
                {loops.map((l, i) => (
                    <LoopEditor key={l.id} n={i + 1} loop={l} length={scene.length} off={off} drawing={!!draw && draw.kind === "loop" && draw.id === l.id}
                        onDraw={(on) => onDraw(on ? { kind: "loop", id: l.id } : null)}
                        onChange={(p) => upd((s) => updateLoop(s, l.id, p))} onRemove={() => { upd((s) => removeLoop(s, l.id)); onDraw(null); }}
                    />
                ))}
                {canWrite && (scene.loops || []).length < PATH_LIMITS.loops && (
                    <button type="button" className={buttonClass("ghost", "sm", true)} onClick={newLoop}><Plus size={13} aria-hidden="true" />{t("raidBoard.anim.addLoop")}</button>
                )}
            </div>
        </section>
    );
}

/** One loop of the picked object: its way (drawn on the map), round or there and back, how long a round takes, when it runs, a trail. */
function LoopEditor({ n, loop, length, off, drawing, onDraw, onChange, onRemove }: {
    n: number;
    loop: RaidplanLoop;
    /** the scene's length (the latest a loop can start) */
    length: number;
    off: boolean;
    drawing: boolean;
    onDraw: (on: boolean) => void;
    onChange: (patch: Partial<RaidplanLoop>) => void;
    onRemove: () => void;
}) {
    const t = useT();
    return (
        <div className={`rp-anim-loop${drawing ? " is-drawing" : ""}`}>
            <div className="rp-anim-loophead">
                <b>{t("raidBoard.anim.loopN", { n })}</b>
                <span className="rp-muted">{t("raidBoard.anim.wayN", { n: loop.path.length })}</span>
                <button type="button" className={buttonClass(drawing ? "primary" : "ghost", "sm", true)} disabled={off} aria-pressed={drawing} onClick={() => onDraw(!drawing)}>
                    <Route size={13} aria-hidden="true" />{drawing ? t("raidBoard.anim.drawDone") : t("raidBoard.anim.drawWay")}
                </button>
                <button type="button" className="rp-anim-iconbtn" disabled={off} aria-label={t("raidBoard.anim.removeLoop", { n })} data-tip={t("raidBoard.anim.removeLoop", { n })} onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
            {drawing && <p className="rp-anim-drawnote" role="status">{loop.path.length < 2 ? t("raidBoard.anim.loopFirst") : t("raidBoard.anim.drawNote")}</p>}
            <Switch checked={loop.closed} disabled={off} onChange={(v) => onChange({ closed: v })} label={t("raidBoard.anim.closed")} tip={t("raidBoard.anim.closedTip")} />
            <Row label={t("raidBoard.anim.period")}>
                <Stepper value={loop.period} min={1} max={600} step={1} unit="s" decimals={1} label={t("raidBoard.anim.period")} disabled={off} onChange={(v) => onChange({ period: v })} />
            </Row>
            <Row label={t("raidBoard.anim.loopFrom")}>
                <Stepper value={loop.from} min={0} max={Math.max(0, length)} step={0.5} unit="s" decimals={1} label={t("raidBoard.anim.loopFrom")} disabled={off} onChange={(v) => onChange({ from: v })} />
            </Row>
            <Row label={loop.to > 0 ? t("raidBoard.anim.loopTo") : t("raidBoard.anim.loopToEnd")}>
                <Stepper value={loop.to} min={0} max={600} step={0.5} unit="s" decimals={1} label={t("raidBoard.anim.loopTo")} disabled={off} onChange={(v) => onChange({ to: v })} />
            </Row>
            <Switch checked={loop.trail} disabled={off} onChange={(v) => onChange({ trail: v })} label={t("raidBoard.anim.trail")} tip={t("raidBoard.anim.trailTip")} />
        </div>
    );
}
