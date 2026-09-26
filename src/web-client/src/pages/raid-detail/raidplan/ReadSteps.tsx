import type { RaidplanStep } from "../../../api";
import { ActionIcon } from "../../../components/raidplan/ActionIcon";
import type { AssignCtx } from "../../../lib/raidplan/assign";
import { duForm, isMyStep } from "../../../lib/raidplan/steps";
import { StepPeople, StepSentence, TimingChip } from "./StepParts";
import { useLang, useT } from "../../../i18n";

/**
 * The tactic in the sheet (read only): "Was tue ich?" first — the viewer's own steps, the verb in the "du" form, his chip carries "DU"
 * (the one mark) — then "Alle Schritte" in their order (the viewer's own ones dimmed there, so the numbers do not jump). The steps come
 * from the server already resolved (class references of the approved setup; a missing class stays an open chip).
 */
export default function ReadSteps({ steps, ctx, me, onlyMine = false }: { steps: RaidplanStep[]; ctx: AssignCtx; me: string[]; onlyMine?: boolean }) {
    const t = useT();
    const lang = useLang();
    if (steps.length === 0) return null;
    const myGroups = me.map((id) => (ctx.players.get(id) || { group: -1 }).group);
    const mine = steps.map((s, i) => ({ s, i })).filter((x) => isMyStep(x.s.participants, me, myGroups));
    if (onlyMine && mine.length === 0) return null;
    const row = (s: RaidplanStep, i: number, own: boolean, dim: boolean) => (
        <li key={`${own ? "m" : "a"}${s.id}`} className={`rp-rs-row${own ? " is-me" : ""}${dim ? " is-faded" : ""}`}>
            <span className="rp-rs-nr">{i + 1}</span>
            <ActionIcon action={s.action} size={30} label={t(`raidBoard.steps.actions.${s.action}`)} />
            <span className="rp-st-line">
                <StepPeople step={s} filled={s.participants} ctx={ctx} me={own ? me : []} readOnly />
                <StepSentence step={s} ctx={ctx} text={own ? duForm(s.sentence, lang) : s.sentence} />
                <TimingChip timing={s.timing} />
            </span>
        </li>
    );
    return (
        <section className="rp-rs" aria-label={t("raidBoard.steps.title")}>
            <div className="rp-rs-head"><h3>{t("raidBoard.steps.title")}</h3><span className="rp-muted">{t("raidBoard.steps.nSteps", { n: steps.length })}</span></div>
            {mine.length > 0 && (
                <>
                    <span className="rp-kicker rp-rs-mine">{t("raidBoard.steps.read.mine")}</span>
                    <ol className="rp-rs-list">{mine.map((x) => row(x.s, x.i, true, false))}</ol>
                </>
            )}
            {!onlyMine && (
                <>
                    <span className="rp-kicker">{t("raidBoard.steps.read.all")}</span>
                    <ol className="rp-rs-list">{steps.map((s, i) => row(s, i, false, mine.some((x) => x.i === i)))}</ol>
                </>
            )}
        </section>
    );
}
