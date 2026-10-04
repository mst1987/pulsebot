// Das Raid-Cockpit (#319): die Schritt-Leiste im Kopf eines *eigenen* Events.
//
// Sechs Schritte — Angelegt › Anmeldung › Setup › Freigabe › Einteilungen ›
// Nachbereitung — als EINE schmale Zeile: je Schritt Icon, Name, ein kurzer
// Wert ("25 angemeldet", "Stand 1") und rechts ein Haken (erledigt) bzw. seine
// Nummer (der offene Schritt hervorgehoben). Darunter ein Streifen „Jetzt dran:
// <Tat>“ mit dem einen erklärenden Satz und dem einzigen auffälligen Knopf der
// Leiste — voll sichtbar, nie abgeschnitten. Jeder andere Schritt mit einer Tat
// ist ein stiller Knopf, der dorthin führt; Zustand und Randnotiz stehen im Tooltip.
//
// Welche Zustände es gibt und welche Tat ansteht, entscheidet der Server
// (src/web/raidDetailSteps.js' eventSteps); die Texte drumherum stehen rein in
// lib/raidSteps.ts. Hier wird nur gezeichnet.
import type { RaidEventStep, RaidEventSteps, RaidStepDeed } from "../../api";
import { deedLabel, stepFocus, stepShort, stepStateLabel, stepSummary, stepTipSub, stepTitle } from "../../lib/raidSteps";
import { Button } from "../../components/ui/Button";
import IconTile from "../../components/ui/IconTile";
import WowIcon from "../../components/ui/WowIcon";
import { CheckIcon } from "../../components/icons";
import { useT } from "../../i18n";

/** Rechts in der Zeile: der Haken eines erledigten Schritts, sonst seine Nummer. */
function StepMark({ step, index }: { step: RaidEventStep; index: number }) {
    if (step.state === "done") return <span className="rd-ck-mark is-done" aria-hidden="true"><CheckIcon /></span>;
    return <span className={`rd-ck-mark${step.state === "current" ? " is-current" : ""}`} aria-hidden="true">{index}</span>;
}

function StepCell({ step, index, onDeed }: {
    step: RaidEventStep;
    index: number;
    onDeed: (deed: RaidStepDeed) => void;
}) {
    const t = useT();
    const title = stepTitle(step);
    const short = step.state === "current" ? "" : stepShort(step);
    const cell = (
        <>
            <WowIcon name={step.icon} size={18} />
            <span className="rd-ck-label">{title}</span>
            {short && <span className="rd-ck-val">{short}</span>}
            {/* der Zustand in Worten, für Vorlesehilfen — sichtbar sind Haken und Nummer */}
            <span className="rd-ck-sr">{stepStateLabel(step.state)}</span>
            <StepMark step={step} index={index} />
        </>
    );
    // Der offene Schritt: kein Knopf — seine Tat ist der Knopf im Streifen darunter.
    if (step.state === "current" || !step.action) {
        return (
            <div className={`rd-ck${step.state === "current" ? " current" : ""} state-${step.state}`} data-step={step.id} data-tip={title} data-tip-sub={stepTipSub(step, false) || undefined}>
                {cell}
            </div>
        );
    }
    return (
        <button
            type="button" className={`rd-ck state-${step.state}`} data-step={step.id}
            data-tip={title} data-tip-sub={stepTipSub(step, true)}
            aria-label={t("raidDetail.stepBar.deedAria", { label: title, state: stepStateLabel(step.state), action: deedLabel(step.action) })}
            onClick={() => onDeed(step.action!)}
        >
            {cell}
        </button>
    );
}

/** „Jetzt dran: …“ — der Satz und die eine Haupt-Tat des offenen Schritts. */
function FocusStrip({ step, running, onDeed }: { step: RaidEventStep; running: boolean; onDeed: (deed: RaidStepDeed) => void }) {
    const focus = stepFocus(step);
    return (
        <div className="rd-ck-focus" data-step={step.id}>
            <IconTile icon={step.icon} tone="raids" />
            <div className="rd-ck-focus-text">
                <b className="rd-ck-focus-title">{focus.title}</b>
                {focus.text && <span className="rd-ck-focus-sub">{focus.text}</span>}
            </div>
            {step.action && (
                <Button icon={step.action.icon} running={running} onClick={() => onDeed(step.action!)}>
                    {deedLabel(step.action)}
                </Button>
            )}
        </div>
    );
}

export default function StepBar({ progress, running, onDeed }: {
    progress: RaidEventSteps;
    /** Die Haupt-Tat läuft gerade (eine Log-Auswertung). */
    running: boolean;
    onDeed: (deed: RaidStepDeed) => void;
}) {
    const t = useT();
    // Abgesagt: nur „abgesagt“ und der Weg zurück, keine Strecke.
    if (progress.cancelled) {
        return (
            <div className="rd-cockpit cancelled">
                <div className="rd-ck-off">
                    <IconTile icon="ability_creature_cursed_02" tone="bad" />
                    <span className="rd-ck-off-text">
                        <span className="kicker">{t("raidDetail.stepBar.cancelled")}</span>
                        <span className="rd-ck-off-why">{progress.note}</span>
                    </span>
                    {progress.action && (
                        <Button variant="ghost" size="sm" icon={progress.action.icon} onClick={() => onDeed(progress.action!)}>
                            {deedLabel(progress.action)}
                        </Button>
                    )}
                </div>
            </div>
        );
    }
    const current = progress.steps.find((s) => s.id === progress.current);
    return (
        <div className={`rd-cockpit${current ? " has-focus" : ""}`}>
            {/* Auf dem Handy fällt die Leiste auf diese Zeile plus den Streifen zusammen. */}
            <p className="rd-ck-sum">{stepSummary(progress)}</p>
            <ol className="rd-ck-steps">
                {progress.steps.map((s, i) => (
                    <li key={s.id} className={s.id === progress.current ? "is-current" : undefined}>
                        <StepCell step={s} index={i + 1} onDeed={onDeed} />
                    </li>
                ))}
            </ol>
            {current && <FocusStrip step={current} running={running} onDeed={onDeed} />}
        </div>
    );
}
