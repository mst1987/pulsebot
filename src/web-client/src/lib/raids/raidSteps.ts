// Das Raid-Cockpit (#319): die Texte der Schritt-Leiste, rein und ohne React.
//
// Welche Schritte es gibt, wo der Raid steht und welche Tat ansteht, entscheidet
// der Server (src/web/raidDetailSteps.js' eventSteps) — hier steht nur, wie ein
// Zustand heißt und wie die Leiste auf dem Handy zu einer Zeile zusammenfällt.
// Strippable wie lib/raids/eventManage.ts (einzeilige Signaturen, keine Typen in den
// Rümpfen), damit src/web-client/src/lib/raids/__tests__/raidSteps.test.ts sie wirklich ausführt und
// gegen die Server-Regel hält.
import type { RaidEventStep, RaidEventStepState, RaidEventSteps, RaidStepDeed } from "../../api";
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
 * Eine Randnotiz (eines Schritts oder der ganzen Leiste) in der Menüsprache: über
 * ihre feste Id ("afterRaid"), sonst der Text des Servers — Notizen mit Zahl,
 * Name oder Datum schickt er ohne Id.
 */
export function noteText(item: { note: string; noteId?: string }): string {
    if (!item.noteId) return item.note || "";
    return tOr(`raidDetail.steps.note.${item.noteId}`, item.note);
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
    if (progress.cancelled) return noteText(progress) || t("raidDetail.steps.cancelled");
    const step = progress.steps.find((s) => s.id === progress.current);
    if (!step) return noteText(progress) || t("raidDetail.steps.nothingOpen");
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
 * Die zweite Zeile einer Zelle: der kurze Wert, sonst die Randnotiz des Servers
 * ("Raidplan leer", "nach dem Raid") — nie eine nackte Nummer, nie eine leere Zeile,
 * solange der Server etwas zu sagen hat.
 */
export function stepLine(step: RaidEventStep): string {
    return stepShort(step) || noteText(step);
}

/**
 * Der ruhige Streifen, wenn kein Schritt dran ist: der Satz des Servers ("Alles
 * erledigt, was vor dem Raid zu tun war.") und der nächste spätere Schritt — mit
 * seiner Tat, falls er eine hat (z. B. "Raidplan öffnen"), sonst nur mit dem Satz,
 * wann es weitergeht. Null, solange ein Schritt dran oder der Raid abgesagt ist.
 */
export function stepLater(progress: RaidEventSteps): { title: string; text: string; step: RaidEventStep | null } | null {
    if (progress.cancelled || progress.steps.some((s) => s.id === progress.current)) return null;
    const step = progress.steps.find((s) => s.state === "todo") || null;
    const title = noteText(progress) || t("raidDetail.steps.nothingOpen");
    if (!step) return { title, text: "", step: null };
    return { title, text: t("raidDetail.steps.later", { what: stepTitle(step), text: step.hint || noteText(step) }), step };
}

/**
 * Der Streifen unter der Leiste: "Jetzt dran: Einteilungen posten" und der eine
 * erklärende Satz dazu (sonst die Randnotiz). Ohne Tat (Leser) heißt er nach dem Schritt.
 */
export function stepFocus(step: RaidEventStep): { title: string; text: string } {
    const what = step.action ? deedLabel(step.action) : stepTitle(step);
    return { title: t("raidDetail.steps.focus", { what }), text: step.hint || noteText(step) };
}

/**
 * Die zweite Zeile des Tooltips: die Randnotiz (auf der schmalen Kachel oft
 * abgeschnitten), der erklärende Satz und — wo die Kachel selbst der Knopf ist —
 * was ein Klick tut.
 */
export function stepTipSub(step: RaidEventStep, withDeed: boolean): string {
    const parts = [noteText(step), step.hint];
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

/**
 * Ob eine Tat (oder der Hauptknopf) mit den Rechten außerhalb des Raids durchgeht (#729): „Log zuordnen“
 * und „auswerten“ sind `cla` write (`canLogs`), „Loot hinzufügen/importieren“ `history` write (`canLoot`);
 * alles andere hängt am Raid selbst.
 */
export function deedAllowed(deed: { modal?: string; evaluate?: unknown } | null | undefined, rights: { canLogs: boolean; canLoot: boolean }): boolean {
    if (!deed) return false;
    if (deed.modal === "log" || deed.evaluate) return rights.canLogs;
    if (deed.modal === "loot") return rights.canLoot;
    return true;
}

/** Die Leiste ohne die Taten, die diese Rechte nicht tragen — der Schritt bleibt als Anzeige stehen. */
export function withAllowedDeeds(progress: RaidEventSteps, rights: { canLogs: boolean; canLoot: boolean }): RaidEventSteps {
    const keep = (d: RaidStepDeed | null): RaidStepDeed | null => (d && deedAllowed(d, rights) ? d : null);
    return { ...progress, action: keep(progress.action), steps: progress.steps.map((s) => ({ ...s, action: keep(s.action) })) };
}
