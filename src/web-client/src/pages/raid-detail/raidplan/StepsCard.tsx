import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BookOpen, Copy, GripVertical, ListOrdered, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { Catalog, RaidplanBoard, RaidplanMobRef, RaidplanPlayer, RaidplanStep } from "../../../api";
import { useConfirm } from "../../../components/ui";
import { ActionIcon } from "../../../components/raidplan/ActionIcon";
import type { AssignCtx } from "../../../lib/raidplan/assign";
import { appendSteps, blankStep, duplicateStep, moveStep, moveStepTo, putStep, removeStep, resolveParticipants, starterTactics, stepsOf, timingLabel } from "../../../lib/raidplan/steps";
import StepModal from "./StepModal";
import { StepPeople, StepSentence, TimingChip } from "./StepParts";
import { useT, type Params } from "../../../i18n";

/**
 * "Taktik": the ordered steps of a section (who does what, when and how) as a card under the assignment cards, in the same grid look as the
 * assignment rows: number with a grip | action icon | participants | sentence with its targets | timing | actions. The whole row opens the
 * step dialog; the grip drags a step to another place, Alt + arrow up / down moves it, duplicate and delete (Ctrl+Z brings it back). An
 * empty section explains itself and offers three starter tactics. The board's old note stays as a note under the steps.
 */
export default function StepsCard({ board, edit, roster, players, isEvent, canWrite, catalog, sectionMobs, groupCount, bossName, onLibrary, onSaveAs }: {
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    roster: RaidplanPlayer[];
    players: Map<string, RaidplanPlayer>;
    isEvent: boolean;
    canWrite: boolean;
    catalog: Catalog | null;
    sectionMobs: RaidplanMobRef[];
    groupCount: number;
    bossName: string;
    /** "Aus Bibliothek wählen" */
    onLibrary: () => void;
    /** "Als Taktik speichern" (the steps of this section) */
    onSaveAs: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const steps = stepsOf(board);
    const [editing, setEditing] = useState<RaidplanStep | null>(null);
    const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
    const list = useRef<HTMLOListElement>(null);
    const ctx: AssignCtx = { slots: board.slots, players, catalog, groupColors: board.groupColors, groupMarks: board.groupMarks };
    const filled = useMemo(() => steps.map((s) => resolveParticipants(s, board.slots, roster, board.roles || {})), [steps, board.slots, board.roles, roster]);
    const index = editing ? steps.findIndex((s) => s.id === editing.id) + 1 : 0;

    const focusRow = (id: string) => requestAnimationFrame(() => { const el = document.querySelector<HTMLElement>(`[data-step="${id}"] .rp-st-open`); if (el) el.focus(); });
    const onRowKey = (e: KeyboardEvent<HTMLLIElement>, s: RaidplanStep) => {
        if (!canWrite || !(e.target as HTMLElement).classList.contains("rp-st-open")) return;
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); edit((b) => moveStep(b, s.id, e.key === "ArrowUp" ? -1 : 1)); focusRow(s.id); }
        else if (e.key === "Delete") { e.preventDefault(); remove(s, true); }
    };
    const remove = async (s: RaidplanStep, confirmFirst: boolean) => {
        if (confirmFirst && !(await ask({ title: t("raidBoard.steps.deleteTitle"), text: t("raidBoard.steps.deleteText"), action: t("raidBoard.assign.delete"), tone: "danger" }))) return;
        edit((b) => removeStep(b, s.id));
    };
    const clearAll = async () => {
        if (!(await ask({ title: t("raidBoard.steps.clearTitle"), text: t("raidBoard.steps.clearText", { n: steps.length }), action: t("raidBoard.steps.clearAll"), tone: "danger" }))) return;
        edit((b) => ({ ...b, steps: [] }));
    };

    // dragging by the grip (Pointer Events: works with a finger): the row goes where the pointer is between the other rows' middles
    const startDrag = (e: PointerEvent<HTMLButtonElement>, s: RaidplanStep) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const rows = () => Array.from(list.current ? list.current.querySelectorAll<HTMLElement>("[data-step]") : []);
        // the new place = how many of the OTHER rows have their middle above the pointer
        const at = (y: number) => rows().filter((el) => el.dataset.step !== s.id && y > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2).length;
        setDrag({ id: s.id, to: steps.indexOf(s) });
        const move = (ev: globalThis.PointerEvent) => setDrag({ id: s.id, to: at(ev.clientY) });
        const up = (ev: globalThis.PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setDrag(null);
            edit((b) => moveStepTo(b, s.id, at(ev.clientY)));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    return (
        <section className="rp-steps" aria-label={t("raidBoard.steps.title")}>
            <header className="rp-steps-head">
                <span className="rp-steps-ti" aria-hidden="true"><ListOrdered size={18} /></span>
                <div className="rp-steps-titles">
                    <h3 className="rp-steps-tn">{t("raidBoard.steps.title")}</h3>
                    <span className="rp-muted rp-steps-sub">{t("raidBoard.steps.sub")}</span>
                </div>
                {canWrite && (
                    <span className="rp-steps-tools">
                        <button type="button" className="rp-acard-add" onClick={onLibrary}><BookOpen size={14} aria-hidden="true" />{t("raidBoard.steps.fromLibrary")}</button>
                        <button type="button" className="rp-acard-add is-primary" onClick={() => setEditing(blankStep("tank"))} disabled={steps.length >= 30}><Plus size={14} aria-hidden="true" />{t("raidBoard.steps.addStep")}</button>
                        {steps.length > 0 && <button type="button" className="rp-line-btn is-tool" aria-label={t("raidBoard.steps.saveAs")} data-tip={t("raidBoard.steps.saveAs")} onClick={onSaveAs}><Save size={15} /></button>}
                        {steps.length > 0 && <button type="button" className="rp-line-btn is-tool is-danger" aria-label={t("raidBoard.steps.clearAll")} data-tip={t("raidBoard.steps.clearAll")} onClick={clearAll}><Trash2 size={15} /></button>}
                    </span>
                )}
            </header>
            {steps.length === 0 ? (
                <div className="rp-steps-empty">
                    <strong>{t("raidBoard.steps.emptyTitle", { boss: bossName })}</strong>
                    <p className="rp-muted">{t("raidBoard.steps.emptyText")}</p>
                    {canWrite && (
                        <div className="rp-steps-starters">
                            {starterTactics().map((st) => (
                                <div key={st.key} className="rp-steps-starter">
                                    <div className="rp-steps-starter-head"><ActionIcon action={st.action} size={26} /><b>{t(`raidBoard.steps.starterName.${st.key}`)}</b><span className="rp-muted">{t("raidBoard.steps.nSteps", { n: st.steps.length })}</span></div>
                                    <ul>{st.steps.map((x) => <li key={x.id}><ActionIcon action={x.action} size={18} /><span>{starterLine(x, t)}</span></li>)}</ul>
                                    <button type="button" className="rp-acard-add" onClick={() => edit((b) => appendSteps(b, st.steps))}>{t("raidBoard.steps.takeStarter")}</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="rp-st-cols" aria-hidden="true">
                        <span>{t("raidBoard.steps.cols.nr")}</span><span /><span>{t("raidBoard.steps.cols.who")}</span><span>{t("raidBoard.steps.cols.sentence")}</span><span>{t("raidBoard.steps.cols.timing")}</span><span className="is-end">{canWrite ? t("raidBoard.steps.cols.actions") : ""}</span>
                    </div>
                    <ol className="rp-st-list" ref={list}>
                        {steps.map((s, i) => (
                            <li key={s.id} data-step={s.id} className={`rp-st-row${drag && drag.id === s.id ? " is-dragging" : ""}${drag && drag.id !== s.id && drag.to === i ? " is-dropat" : ""}${canWrite ? "" : " is-ro"}`} onKeyDown={(e) => onRowKey(e, s)}>
                                <span className="rp-st-nr">
                                    {canWrite && <button type="button" className="rp-st-grip" aria-label={t("raidBoard.steps.drag")} data-tip={t("raidBoard.steps.dragTip")} onPointerDown={(e) => startDrag(e, s)}><GripVertical size={14} /></button>}
                                    <b>{i + 1}</b>
                                </span>
                                <ActionIcon action={s.action} size={30} label={t(`raidBoard.steps.actions.${s.action}`)} />
                                <span className="rp-st-who"><StepPeople step={s} filled={filled[i]} ctx={ctx} isEvent={isEvent} /></span>
                                <span className="rp-st-sent"><StepSentence step={s} ctx={ctx} /></span>
                                <span className="rp-st-tm"><TimingChip timing={s.timing} /></span>
                                <span className="rp-line-acts">
                                    {canWrite && <button type="button" className="rp-st-open rp-line-btn" aria-label={`${t("raidBoard.steps.edit")}: ${i + 1}. ${t(`raidBoard.steps.actions.${s.action}`)} ${s.sentence} ${timingLabel(s.timing)}`} data-tip={t("raidBoard.steps.editTip")} onClick={() => setEditing(s)}><Pencil size={14} /></button>}
                                    {canWrite && <button type="button" className="rp-line-btn" aria-label={t("raidBoard.steps.duplicate")} data-tip={t("raidBoard.steps.duplicate")} onClick={() => edit((b) => duplicateStep(b, s.id))}><Copy size={14} /></button>}
                                    {canWrite && <button type="button" className="rp-line-btn is-danger" aria-label={t("raidBoard.assign.delete")} data-tip={t("raidBoard.assign.delete")} onClick={() => remove(s, false)}><Trash2 size={14} /></button>}
                                </span>
                            </li>
                        ))}
                    </ol>
                </>
            )}
            {editing && (
                <StepModal
                    step={editing} index={index} bossName={bossName} board={board} roster={roster} players={players} isEvent={isEvent} catalog={catalog} sectionMobs={sectionMobs} groupCount={groupCount}
                    onClose={() => setEditing(null)}
                    onDone={(s) => { const id = s.id; edit((b) => putStep(b, s)); setEditing(null); focusRow(id); }}
                    onRemove={index > 0 ? () => { const s = editing; setEditing(null); edit((b) => removeStep(b, s.id)); } : undefined}
                />
            )}
        </section>
    );
}

/** A starter step as one short line ("Tank 2 · kitet den Boss um die Arena"). */
function starterLine(s: RaidplanStep, t: (k: string, v?: Params) => string): string {
    const who = s.participants.map((r) => { const p = r.split(":"); return p[0] === "slot" ? t(`raidBoard.slot.${p[1]}`, { n: Number(p[2]) }) : ""; }).filter(Boolean).join(", ");
    return who ? `${who} · ${s.sentence}` : s.sentence;
}
