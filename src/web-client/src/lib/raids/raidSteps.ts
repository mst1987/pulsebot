// Das Raid-Cockpit (#319): die Texte der Schritt-Leiste, rein und ohne React.
//
// Welche Schritte es gibt, wo der Raid steht und welche Tat ansteht, entscheidet
// der Server (src/web/raidDetailSteps.js' eventSteps) — hier steht nur, wie ein
// Zustand heißt und wie die Leiste auf dem Handy zu einer Zeile zusammenfällt.
// Strippable wie lib/raids/eventManage.ts (einzeilige Signaturen, keine Typen in den
// Rümpfen), damit src/web-client/src/lib/raids/raidSteps.test.ts sie wirklich ausführt und
// gegen die Server-Regel hält.
import type { RaidEventStep, RaidEventStepState, RaidEventSteps, RaidStepDeed } from "../../api";
import type { Tone } from "../../components/ui/Badge";
import { t, tOr } from "../../i18n";

/**
 * Der Name eines Schritts in der Menüsprache: über seine feste Id, der Text des
 * Servers bleibt Rückfall für einen Schritt, den die Wörterbücher nicht kennen.
 */
export function stepTitle(step: RaidEventStep): string {
    return tOr(`raidDetail.steps.title.${step.id}`, step.label);
}

/**
 * Die Beschriftung einer Tat, ebenso über ihre Id. „CLA auswerten“ trägt den
 * Namen der Auswertung in sich und bleibt, wie der Server ihn schickt.
 */
export function deedLabel(deed: RaidStepDeed): string {
    if (deed.id === "evaluate") return deed.label;
    return tOr(`raidDetail.steps.deed.${deed.id}`, deed.label);
}

/**
 * Wie ein Zustand heißt. „Übersprungen“ ist bewusst kein Fehlerwort: ein Raid
 * ohne Setup ist ein gewöhnlicher Raid, kein kaputter.
 */
export function stepStateLabel(state: RaidEventStepState): string {
    if (state === "done") return t("raidDetail.steps.state.done");
    if (state === "current") return t("raidDetail.steps.state.current");
    if (state === "skipped") return t("raidDetail.steps.state.skipped");
    if (state === "cancelled") return t("raidDetail.steps.state.cancelled");
    return t("raidDetail.steps.state.later");
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
    return t("raidDetail.steps.position", { index: i + 1, total: steps.length });
}

/**
 * Die eine Zeile, zu der die Leiste auf dem Handy zusammenfällt:
 * "Schritt 3 von 5 · Setup" — oder, wenn nichts offen ist, warum.
 */
export function stepSummary(progress: RaidEventSteps): string {
    if (progress.cancelled) return progress.note || t("raidDetail.steps.cancelled");
    const step = progress.steps.find((s) => s.id === progress.current);
    if (!step) return progress.note || t("raidDetail.steps.nothingOpen");
    return `${stepPosition(progress.steps, step.id)} · ${stepTitle(step)}`;
}

/**
 * Der kurze Wert in der schmalen Leiste: "25 angemeldet", "25 von 25", "Stand 1".
 * Eine Zahl steht nie nackt gegen ihr Ziel ("25 / 25" wird "25 von 25"); ein
 * Wert, der nur den Namen wiederholt ("angelegt") oder leer ist ("—"), entfällt.
 */
export function stepShort(step: RaidEventStep): string {
    const value = step.value && step.value !== "—" ? step.value : "";
    if (!value || value.toLowerCase() === stepTitle(step).toLowerCase()) return "";
    const unit = (step.unit || "").startsWith("/ ") ? t("raidDetail.steps.of", { total: step.unit.slice(2) }) : step.unit;
    return [value, unit].filter(Boolean).join(" ");
}

/**
 * Der Streifen unter der Leiste: "Jetzt dran: Einteilungen posten" und der eine
 * erklärende Satz dazu (sonst die Randnotiz). Ohne Tat (Leser) heißt er nach dem Schritt.
 */
export function stepFocus(step: RaidEventStep): { title: string; text: string } {
    const what = step.action ? deedLabel(step.action) : stepTitle(step);
    return { title: t("raidDetail.steps.focus", { what }), text: step.hint || step.note || "" };
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
    if (withDeed && step.action) parts.push(t("raidDetail.steps.clickDeed", { action: deedLabel(step.action) }));
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
