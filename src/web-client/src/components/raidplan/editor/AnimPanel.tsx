import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { RaidplanBoard, RaidplanLoop, RaidplanScene } from "../../../api";
import Switch from "../../ui/Switch";
import { buttonClass } from "../../ui/Button";
import { useConfirm } from "../../ui/Modal";
import { clock, frameLength } from "../../../lib/raidplan/scene";
import { addFrame, moveFrame, removeFrame, removeScene, setCaption, setFrameLength, withScene, SCENE_LIMITS } from "../../../lib/raidplan/sceneEdit";
import type { ActionPart, Actor } from "../../../lib/raidplan/sceneActions";
import { Row, Stepper } from "./AnimParts";
import ActionList from "./ActionList";
import ActionWizard from "./ActionWizard";
import type { Wizard } from "./wizardState";
import type { Draw } from "./AnimWorkspace";
import { useT } from "../../../i18n";

/**
 * The panel beside the animation's board (design B): the frame that is edited (number, start, caption, length, order), then
 * "Was passiert in diesem Takt" - every action as a sentence - with "+ Aktion", which opens the assistant Wer → Was → Wohin, and at
 * the bottom, folded, the animation's own settings (name, loop, its tactic step, delete).
 */
export default function AnimPanel({ board, scene, frame, canWrite, edit, onFrame, onSceneGone, parts, loops, index, sel, onPick, draw, onDraw, wiz, setWiz, onOpenWizard, who, names, canFade, canTurn, onAdd, onLoopDone }: {
    board: RaidplanBoard;
    scene: RaidplanScene;
    frame: number;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    onFrame: (k: number) => void;
    onSceneGone: () => void;
    /** what the frame does, part by part, and the loops that start in it */
    parts: ActionPart[];
    loops: RaidplanLoop[];
    index: Map<string, Actor>;
    sel: string[];
    onPick: (ref: string) => void;
    draw: Draw;
    onDraw: (d: Draw) => void;
    /** the action assistant (null = closed) and what it shows */
    wiz: Wizard | null;
    setWiz: (w: Wizard | null) => void;
    onOpenWizard: () => void;
    who: string;
    names: string[];
    canFade: boolean;
    canTurn: boolean;
    onAdd: () => void;
    onLoopDone: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const upd = (fn: (s: RaidplanScene) => RaidplanScene, coalesce = false) => edit((b) => withScene(b, scene.id, fn), coalesce);
    const f = scene.frames[frame];
    const n = scene.frames.length;
    const off = !canWrite;

    return (
        <aside className="rp-anim-panel" aria-label={t("raidBoard.anim.panel")}>
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
            </section>

            <section className="rp-anim-psec">
                <span className="rp-anim-kick">{t("raidBoard.anim.whatHappens")}</span>
                <ActionList scene={scene} frame={frame} parts={parts} loops={loops} index={index} canWrite={canWrite} upd={upd} draw={draw} onDraw={onDraw} sel={sel} onPick={onPick} />
                {canWrite && !wiz && (
                    <button type="button" className={buttonClass("primary", "md", true, "rp-anim-addact")} onClick={onOpenWizard}><Plus size={16} aria-hidden="true" />{t("raidBoard.anim.addAction")}</button>
                )}
            </section>

            {canWrite && wiz && (
                <ActionWizard wiz={wiz} set={setWiz} who={who} names={names} count={sel.length} canFade={canFade} canTurn={canTurn} onAdd={onAdd} onLoopDone={onLoopDone} onCancel={() => setWiz(null)} />
            )}

            <details className="rp-anim-psec rp-anim-settings">
                <summary>{t("raidBoard.anim.settings")}</summary>
                <label className="rp-anim-steppick">
                    <span className="rp-anim-plabel">{t("raidBoard.anim.title")}</span>
                    <input
                        className="inp-sm rp-anim-input rp-anim-title" value={scene.title} maxLength={SCENE_LIMITS.title} disabled={off}
                        onChange={(e) => upd((s) => ({ ...s, title: e.target.value }), true)}
                    />
                </label>
                <Switch checked={scene.loop} disabled={off} onChange={(v) => upd((s) => ({ ...s, loop: v }))} label={t("raidBoard.anim.loopScene")} tip={t("raidBoard.anim.loopSceneTip")} />
                <label className="rp-anim-steppick">
                    <span className="rp-anim-plabel" data-tip={t("raidBoard.anim.stepTip")}>{t("raidBoard.anim.step")}</span>
                    <select className="sel-sm rp-anim-input" value={scene.stepId} disabled={off} onChange={(e) => upd((s) => ({ ...s, stepId: e.target.value }))}>
                        <option value="">{t("raidBoard.anim.noStep")}</option>
                        {(board.steps || []).map((st, i) => <option key={st.id} value={st.id}>{`${i + 1}. ${st.sentence || t(`raidBoard.steps.actions.${st.action}`)}`.slice(0, 70)}</option>)}
                    </select>
                </label>
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
            </details>
        </aside>
    );
}
