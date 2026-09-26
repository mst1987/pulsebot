import type { ReactNode } from "react";
import { stepLabel } from "../../lib/eventPlan";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import RaidIcon from "../RaidIcon";
import RaidLoader from "../ui/RaidLoader";
import { ChevronRightIcon } from "../icons";
import { useT } from "../../i18n";
import { IconStack, Stepper } from "./CreateParts";
import { useRaidCreateForm } from "./useRaidCreateForm";
import { StartStep } from "./StartStep";
import { TerminStep } from "./TerminStep";
import { RaidStep } from "./RaidStep";
import { KanalStep } from "./KanalStep";
import { CheckStep } from "./CheckStep";

// "Neues Event" as a guided dialog, one step at a time instead of a long page:
//   Vorlage            — repeat the latest event of a category, start from a raid
//                        template (#266), or start empty,
//   Termin             — title, date, time and the category; leader and
//                        description folded away under "Weitere Angaben",
//   Raid               — only for an EventHelper event (#261): version,
//                        instances, size, tanks/healers large; ranges, required
//                        buffs and the switches behind "Mehr",
//   Kanal & Anmeldung  — where it is posted (new by the category's schema, a
//                        clone, or an existing channel), how people sign up
//                        (preset from the category) and the deadline,
//   Prüfen             — the event as the list will show it.
// ?source=<id> (the list's "Wiederholen") opens it straight at "Termin".
// With `editEventId` the same dialog edits an own event (PATCH /api/raids):
// no start step, and the channel stays.
//
// The state and both writes live in useRaidCreateForm.ts, each step in a file
// of its own (StartStep.tsx ... CheckStep.tsx).

export default function RaidCreateDialog({ open, sourceId, editEventId = "", userId, onClose, onCreated }: {
    open: boolean;
    sourceId: string;
    /** an own event's id: the dialog edits it instead of creating one */
    editEventId?: string;
    userId: string;
    onClose: () => void;
    onCreated: () => void;
}) {
    const t = useT();
    const f = useRaidCreateForm({ open, sourceId, editEventId, onCreated });
    const { editing, ctx, loadError, step, setStep, choice, sourceEvent, chosenInstances, steps, stepAt, problem, saving, readyAt, submit } = f;

    const summaryIcon = choice?.kind === "event" && sourceEvent
        ? <RaidIcon contentIds={sourceEvent.contentIds} sources={["title"]} />
        : <IconStack icons={chosenInstances.map((i) => i.icon)} />;

    let body: ReactNode;
    if (loadError) body = <div className="re-empty">{t("raidCreate.load.failed", { error: loadError })}</div>;
    else if (!ctx) body = <RaidLoader compact text={editing ? t("raidCreate.load.event") : t("raidCreate.load.templates")} />;
    else if (step === "start") body = <StartStep f={f} ctx={ctx} />;
    else if (step === "termin") body = <TerminStep f={f} ctx={ctx} userId={userId} summaryIcon={summaryIcon} />;
    else if (step === "raid") body = <RaidStep f={f} />;
    else if (step === "kanal") body = <KanalStep f={f} ctx={ctx} />;
    else body = <CheckStep f={f} ctx={ctx} userId={userId} summaryIcon={summaryIcon} />;

    const cancel = <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>;
    const back = stepAt > 0 ? <Button variant="ghost" onClick={() => setStep(steps[stepAt - 1])}>{t("raidCreate.footer.back")}</Button> : undefined;
    const next = steps[stepAt + 1];
    const footer = step === "check" || !next
        ? <>{cancel}<Button icon="inv_misc_note_05" running={saving} disabled={!ctx || !!problem} onClick={submit}>{editing ? t("common.save") : t("raidCreate.footer.create")}</Button></>
        : <>{cancel}<Button disabled={!ctx || !readyAt(step)} onClick={() => setStep(next)}>{t("raidCreate.footer.next", { step: stepLabel(next) })} <ChevronRightIcon /></Button></>;

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_note_05"
            kicker={t("raidCreate.footer.stepOf", { n: stepAt + 1, total: steps.length })}
            title={editing ? t("raidCreate.footer.titleEdit") : t("raidCreate.footer.titleNew")}
            width={680}
            hint={back}
            footer={footer}
        >
            <Stepper steps={steps} current={step} />
            <div className="re-dlg-body">{body}</div>
        </Modal>
    );
}
