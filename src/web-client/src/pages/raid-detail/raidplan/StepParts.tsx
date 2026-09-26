import type { RaidplanStep, RaidplanStepTarget, RaidplanTiming } from "../../../api";
import { classRefLabelFor, isMe, offRole, resolveAssignee, resolveTarget, type AssignCtx, type Resolved } from "../../../lib/raidplan/assign";
import { isMissing } from "../../../lib/raidplan/assignLine";
import { TASK_OF, sentenceParts, targetWord, timingLabel } from "../../../lib/raidplan/steps";
import { TimingIcon } from "../../../components/raidplan/ActionIcon";
import { LineChip } from "./AssignLine";

/** A participant of a step as a resolved chip: a group reference is "Gruppe n", a class nobody fills keeps its name ("Magier-Tank 1"). */
export function participantResolved(ref: string, filled: string, action: string, ctx: AssignCtx): Resolved {
    if (ref.indexOf("group:") === 0) return resolveTarget({ kind: "group", ref: ref.slice(6) }, ctx);
    if (ref.indexOf("role:") === 0) return resolveTarget({ kind: "role", ref: ref.slice(5) }, ctx);
    const r = resolveAssignee(filled || ref, ctx);
    return r.kind === "class" ? { ...r, label: classRefLabelFor(r.ref, TASK_OF[action] || "other") } : r;
}

/** A target of a step: a mob with its portrait, a raid mark, "Gruppe n", or a zone of the map by its name. */
export function StepTarget({ target, ctx }: { target: RaidplanStepTarget; ctx: AssignCtx }) {
    if (target.kind === "zone") return <span className="rp-lc is-zone"><svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" /></svg><span>{target.ref}</span></span>;
    const r = resolveTarget(target.kind === "mob" ? { kind: "mob", ref: target.ref, name: target.name || "", icon: target.icon || "" } : { kind: target.kind, ref: target.ref }, ctx);
    return <LineChip r={r} open={false} mine={false} order={0} ctx={ctx} />;
}

/** The timing as a small chip with its icon ("Pull", "bei 30 %", "alle 30 s"); nothing when there is none. */
export function TimingChip({ timing }: { timing: RaidplanTiming }) {
    const label = timingLabel(timing);
    if (!label) return null;
    return <span className="rp-tmchip"><TimingIcon kind={timing.kind} />{label}</span>;
}

/** The participants of a step as chips (resolved now; a missing class is the one yellow chip, the viewer's own carries "DU" in the sheet). */
export function StepPeople({ step, filled, ctx, me = [], readOnly, isEvent = true }: { step: RaidplanStep; filled: string[]; ctx: AssignCtx; me?: string[]; readOnly?: boolean; isEvent?: boolean }) {
    return (
        <>
            {step.participants.map((ref, i) => {
                const r = participantResolved(ref, filled[i], step.action, ctx);
                return <LineChip key={ref} r={r} open={isMissing(r, isEvent)} mine={isMe(r, me)} order={0} ctx={ctx} readOnly={readOnly} asTank={offRole(TASK_OF[step.action] || "other", r.player)} />;
            })}
        </>
    );
}

/** The sentence of a step with its targets as chips (a target is never repeated in words). */
export function StepSentence({ step, ctx, text }: { step: RaidplanStep; ctx: AssignCtx; text?: string }) {
    const words = text === undefined ? step.sentence : text;
    const { parts, rest } = sentenceParts(words, step.targets.map(targetWord));
    return (
        <>
            {parts.map((p, i) => (p.target >= 0 ? <StepTarget key={`p${i}`} target={step.targets[p.target]} ctx={ctx} /> : <span key={`p${i}`} className="rp-st-words">{p.text.trim()}</span>))}
            {rest.map((i) => <StepTarget key={`r${i}`} target={step.targets[i]} ctx={ctx} />)}
        </>
    );
}
