// Das Raid-Cockpit (#319): die Schritt-Leiste im Kopf eines *eigenen* Events.
// Design-Pilot C (Okt 2026): eine ruhige Textleiste, je Schritt ein kleines WoW-Icon
// ohne Kachel und Kreis; nur der offene Schritt traegt die Akzentfarbe.
//
// Sechs Schritte — Angelegt › Anmeldung › Setup › Freigabe › Einteilungen ›
// Nachbereitung — als eine Reihe gleich breiter Zellen: je Schritt Icon, Name und
// darunter eine zweite Zeile, zweizeilig, damit beides nicht abgekürzt werden muss:
// der kurze Wert ("25 angemeldet", "Stand 1") oder, wo es keinen gibt, die Randnotiz
// ("Raidplan leer", "nach dem Raid"). Rechts steht nur bei erledigten Schritten ein
// Haken — keine nackte Nummer, die sich wie eine Anzahl liest.
//
// Darunter ein Streifen: ist ein Schritt dran, „Jetzt dran: <Tat>“ mit dem einen
// erklärenden Satz und dem einzigen auffälligen Knopf der Leiste. Ist nichts dran,
// ein ruhiger Streifen mit dem Satz des Servers („Alles erledigt, …“), was als
// Nächstes kommt und — hat dieser spätere Schritt eine Tat — ein stiller Knopf dafür.
// Jeder andere Schritt mit einer Tat ist ein stiller Knopf, der dorthin führt;
// Zustand und Randnotiz stehen im Tooltip.
//
// Welche Zustände es gibt und welche Tat ansteht, entscheidet der Server
// (src/web/raidDetailSteps.js' eventSteps); die Texte drumherum stehen rein in
// lib/raids/raidSteps.ts. Hier wird nur gezeichnet.
import type { RaidEventStep, RaidEventSteps, RaidStepDeed } from "../../api";
import { deedLabel, noteText, stepFocus, stepLater, stepLine, stepStateLabel, stepSummary, stepTipSub, stepTitle } from "../../lib/raids/raidSteps";
import { Button } from "../../components/ui/Button";
import WowIcon from "../../components/ui/WowIcon";
import { CheckIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";

function StepCell({ step, onDeed }: {
    step: RaidEventStep;
    onDeed: (deed: RaidStepDeed) => void;
}) {
    const t = useT();
    const title = stepTitle(step);
    const line = stepLine(step);
    // icon | name | tick on top, the second line below name and tick, so neither has to be cut short
    const cell = (
        <>
            <WowIcon name={step.icon} size={32} className="rd-ck-icon" />
            <span className="rd-ck-label">{title}</span>
            {line && <span className="rd-ck-val">{line}</span>}
            {/* der Zustand in Worten, für Vorlesehilfen — sichtbar sind Haken, Farbe und zweite Zeile */}
            <span className="rd-ck-sr">{stepStateLabel(step.state)}</span>
            {step.state === "done" && <span className="rd-ck-mark is-done" aria-hidden="true"><CheckIcon /></span>}
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

/** Nichts ist dran: der Satz des Servers, was als Nächstes kommt, und höchstens ein stiller Knopf. */
function LaterStrip({ progress, onDeed }: { progress: RaidEventSteps; onDeed: (deed: RaidStepDeed) => void }) {
    const later = stepLater(progress);
    if (!later) return null;
    const deed = later.step && later.step.action;
    return (
        <div className="rd-ck-focus rd-ck-calm" data-step={later.step ? later.step.id : undefined}>
            <div className="rd-ck-focus-text">
                <b className="rd-ck-focus-title">{later.title}</b>
                {later.text && <span className="rd-ck-focus-sub">{later.text}</span>}
            </div>
            {deed && (
                <Button variant="ghost" size="sm" icon={deed.icon} onClick={() => onDeed(deed)}>
                    {deedLabel(deed)}
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
                    <span className="rd-ck-off-text">
                        <span className="kicker">{t("raidDetail.stepBar.cancelled")}</span>
                        <span className="rd-ck-off-why">{noteText(progress)}</span>
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
            {/* Auf dem Handy fällt die Leiste auf diese Zeile plus den Streifen zusammen; ohne offenen Schritt sagt es der ruhige Streifen. */}
            {current && <p className="rd-ck-sum">{stepSummary(progress)}</p>}
            <ol className="rd-ck-steps">
                {progress.steps.map((s) => (
                    <li key={s.id} className={s.id === progress.current ? "is-current" : undefined}>
                        <StepCell step={s} onDeed={onDeed} />
                    </li>
                ))}
            </ol>
            {current ? <FocusStrip step={current} running={running} onDeed={onDeed} /> : <LaterStrip progress={progress} onDeed={onDeed} />}
        </div>
    );
}
