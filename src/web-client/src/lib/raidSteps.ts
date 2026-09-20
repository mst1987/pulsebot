// Das Raid-Cockpit (#319): die Texte der Schritt-Leiste, rein und ohne React.
//
// Welche Schritte es gibt, wo der Raid steht und welche Tat ansteht, entscheidet
// der Server (src/web/raidDetailSteps.js' eventSteps) — hier steht nur, wie ein
// Zustand heißt und wie die Leiste auf dem Handy zu einer Zeile zusammenfällt.
// Strippable wie lib/eventManage.ts (einzeilige Signaturen, keine Typen in den
// Rümpfen), damit test/web-client/raidSteps.test.js sie wirklich ausführt und
// gegen die Server-Regel hält.
import type { RaidEventStep, RaidEventStepState, RaidEventSteps } from "../api";
import type { Tone } from "../components/ui/Badge";

/**
 * Wie ein Zustand heißt. „Übersprungen“ ist bewusst kein Fehlerwort: ein Raid
 * ohne Setup ist ein gewöhnlicher Raid, kein kaputter.
 */
export function stepStateLabel(state: RaidEventStepState): string {
    if (state === "done") return "erledigt";
    if (state === "current") return "jetzt dran";
    if (state === "skipped") return "übersprungen";
    if (state === "cancelled") return "abgesagt";
    return "später";
}

/** Der Ton eines Zustands — „übersprungen“ bleibt farblos, nie rot. */
export function stepStateTone(state: RaidEventStepState): Tone | undefined {
    if (state === "done") return "ok";
    if (state === "current") return "accent";
    if (state === "cancelled") return "bad";
    return undefined;
}

/** "Schritt 3 von 5" — die Kopfzeile der zusammengeklappten Leiste. */
export function stepPosition(steps: RaidEventStep[], id: string): string {
    const i = steps.findIndex((s) => s.id === id);
    if (i < 0) return "";
    return `Schritt ${i + 1} von ${steps.length}`;
}

/**
 * Die eine Zeile, zu der die Leiste auf dem Handy zusammenfällt:
 * "Schritt 3 von 5 · Setup" — oder, wenn nichts offen ist, warum.
 */
export function stepSummary(progress: RaidEventSteps): string {
    if (progress.cancelled) return progress.note || "Abgesagt";
    const step = progress.steps.find((s) => s.id === progress.current);
    if (!step) return progress.note || "Nichts offen";
    return `${stepPosition(progress.steps, step.id)} · ${step.label}`;
}

/** Die Zahl eines Schritts als ein Stück Text, für Vorlesehilfen und Tests. */
export function stepFigure(step: RaidEventStep): string {
    return [step.value, step.unit, step.note].filter(Boolean).join(" ");
}

/**
 * Die zweite Zeile des Tooltips: die Randnotiz (auf der schmalen Kachel oft
 * abgeschnitten), der erklärende Satz und — wo die Kachel selbst der Knopf ist —
 * was ein Klick tut.
 */
export function stepTipSub(step: RaidEventStep, withDeed: boolean): string {
    const parts = [step.note, step.hint];
    if (withDeed && step.action) parts.push(`Klick: ${step.action.label}`);
    return parts.filter(Boolean).join(" · ");
}

/**
 * Dieselbe Leiste ohne jede Tat — für Leser ohne Schreibrecht auf „Raids“.
 * Sie sollen sehen, wo der Raid steht; ändern dürfen sie nichts, und ein Knopf,
 * der am Server scheitert, ist schlechter als keiner.
 */
export function withoutDeeds(progress: RaidEventSteps): RaidEventSteps {
    return { ...progress, action: null, steps: progress.steps.map((s) => ({ ...s, action: null })) };
}
