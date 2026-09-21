// Das Raid-Cockpit (#319): die Schritt-Leiste im Kopf eines *eigenen* Events.
//
// Fünf Kacheln — Angelegt › Anmeldung › Setup › Freigabe › Nachbereitung —, je
// Kachel ein Zustand, eine große Zahl und höchstens eine Tat. Der offene Schritt
// ist markiert und trägt die Haupt-Tat als einzigen auffälligen Knopf; jede
// andere Kachel ist still und führt per Klick dorthin, wo sie hingehört. Der
// erklärende Satz steht im Tooltip, nicht auf der Fläche.
//
// Welche Zustände es gibt und welche Tat ansteht, entscheidet der Server
// (src/web/raidDetailSteps.js' eventSteps); die Texte drumherum stehen rein in
// lib/raidSteps.ts. Hier wird nur gezeichnet.
import type { RaidEventStep, RaidEventSteps, RaidStepDeed } from "../../api";
import { stepStateLabel, stepStateTone, stepSummary, stepTipSub } from "../../lib/raidSteps";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import { useT } from "../../i18n";

/** Der Ton der Kachel-Kachel: erledigt grün, offen im Akzent, übersprungen farblos. */
function tileTone(step: RaidEventStep) {
    if (step.state === "done") return "ok" as const;
    if (step.state === "current") return "raids" as const;
    if (step.state === "cancelled") return "bad" as const;
    return "none" as const;
}

function StepCell({ step, running, onDeed }: {
    step: RaidEventStep;
    running: boolean;
    onDeed: (deed: RaidStepDeed) => void;
}) {
    const t = useT();
    const tone = stepStateTone(step.state);
    const cell = (
        <>
            <span className="rd-ck-top">
                <IconTile icon={step.icon} tone={tileTone(step)} />
                <span className="kicker">{step.label}</span>
            </span>
            <span className="rd-ck-v">
                {step.value}
                {step.unit && <small>{step.unit}</small>}
            </span>
            {typeof step.fill === "number" && (
                <span className="rd-ck-bar"><i style={{ width: `${Math.round(step.fill * 100)}%` }} /></span>
            )}
            <span className="rd-ck-state">
                <Badge tone={tone}>{stepStateLabel(step.state)}</Badge>
                {step.note && <span className="rd-ck-note">{step.note}</span>}
            </span>
        </>
    );
    // Der offene Schritt: die Kachel ist kein Knopf mehr, damit der eine
    // auffällige Knopf darin nicht in einem Knopf steckt.
    if (step.state === "current") {
        return (
            <div className={`rd-ck current state-${step.state}`} data-step={step.id} data-tip={step.label} data-tip-sub={stepTipSub(step, false)}>
                {cell}
                {step.action && (
                    <Button size="sm" icon={step.action.icon} running={running} onClick={() => onDeed(step.action!)}>
                        {step.action.label}
                    </Button>
                )}
            </div>
        );
    }
    if (!step.action) {
        return (
            <div className={`rd-ck state-${step.state}`} data-step={step.id} data-tip={step.label} data-tip-sub={stepTipSub(step, false)}>
                {cell}
            </div>
        );
    }
    return (
        <button
            type="button" className={`rd-ck state-${step.state}`} data-step={step.id}
            data-tip={step.label} data-tip-sub={stepTipSub(step, true)}
            aria-label={t("raidDetail.stepBar.deedAria", { label: step.label, state: stepStateLabel(step.state), action: step.action.label })}
            onClick={() => onDeed(step.action!)}
        >
            {cell}
        </button>
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
                            {progress.action.label}
                        </Button>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="rd-cockpit">
            {/* Auf dem Handy fällt die Leiste auf diese Zeile plus die offene Kachel zusammen. */}
            <p className="rd-ck-sum">{stepSummary(progress)}</p>
            <ol className="rd-ck-steps">
                {progress.steps.map((s) => (
                    <li key={s.id} className={s.id === progress.current ? "is-current" : undefined}>
                        <StepCell step={s} running={running && s.id === progress.current} onDeed={onDeed} />
                    </li>
                ))}
            </ol>
        </div>
    );
}
