import type { HistoryImportResult, RetirementChecklist, RetirementItem, RetirementStatus } from "../api";
import { t } from "../i18n";

// The rules behind the "Umstieg von Raid-Helper" card (#291): how a checklist
// item reads, when the switch may be pressed, and what the import dialog says.
// Kept free of React and strippable, so src/web-client/src/lib/raidhelperRetirement.test.ts
// runs it for real.

export type BadgeLook = { tone: "ok" | "mid" | "bad" | "accent" | ""; label: string };

/** The badge of one item's status. */
export function statusLook(status: RetirementStatus): BadgeLook {
    if (status === "ok") return { tone: "ok", label: t("settings.retirement.status.ok") };
    if (status === "bad") return { tone: "bad", label: t("settings.retirement.status.bad") };
    if (status === "mid") return { tone: "mid", label: t("settings.retirement.status.mid") };
    if (status === "unknown") return { tone: "", label: t("settings.retirement.status.unknown") };
    return { tone: "accent", label: t("settings.retirement.status.info") };
}

/** The tooltip under an item's label: why it matters, then what is open, then how to fix it. */
export function itemTip(item: RetirementItem): string {
    const parts = [item.why];
    if (item.detail.length) parts.push(item.detail.join("\n"));
    if (item.hint) parts.push(t("settings.retirement.command", { hint: item.hint }));
    parts.push(item.required ? t("settings.retirement.requiredTip") : t("settings.retirement.optionalTip"));
    return parts.join("\n\n");
}

/** The head badge: switched off, or how many checkable items are done. */
export function headLook(list: RetirementChecklist): BadgeLook {
    if (list.disabled) return { tone: "accent", label: t("settings.retirement.disabled") };
    return { tone: list.done === list.total ? "ok" : list.ready ? "mid" : "bad", label: t("settings.retirement.doneOf", { done: list.done, total: list.total }) };
}

export type SwitchState = { checked: boolean; enabled: boolean; reason: string };

/** Whether the switch can be pressed now, and the line that says why (not). */
export function switchState(list: RetirementChecklist): SwitchState {
    if (list.disabled) return { checked: true, enabled: true, reason: t("settings.retirement.switchDisabled") };
    if (!list.ready) {
        const open = list.items.filter((i) => list.blockers.includes(i.id)).map((i) => i.label);
        return { checked: false, enabled: false, reason: t("settings.retirement.switchBlocked", { items: open.join(", ") }) };
    }
    return { checked: false, enabled: true, reason: t("settings.retirement.switchReady") };
}

/** "vor 3 Tagen von Orga" for the disabled state, "" without a time. */
export function disabledSince(list: RetirementChecklist, now: number): string {
    if (!list.disabled || !list.disabledAt) return "";
    const days = Math.floor((now - list.disabledAt) / 86400000);
    const when = days <= 0 ? t("common.relDay.today") : days === 1 ? t("common.relDay.yesterday") : t("common.relDay.daysAgo", { count: days });
    return list.disabledBy ? t("settings.retirement.since", { when, name: list.disabledBy }) : when;
}

/** The import dialog's result line. */
export function importSummary(result: HistoryImportResult): string {
    const s = result.summary;
    if (result.stored) return t("settings.retirement.importStored", { events: result.stored.events, entries: result.stored.entries, users: result.stored.users });
    if (!s.events) return s.skippedEvents ? t("settings.retirement.importNothingNew", { count: s.skippedEvents }) : t("settings.retirement.importNone");
    return t("settings.retirement.importDry", { events: s.events, entries: s.entries, users: s.users });
}

export type SpecHistoryEntry = { spec: string; count: number; lastAt: number; character: string };
export type CharacterSuggestion = { className: string; specs: string[]; name: string };

/**
 * What "Von Hand" prefills from the specs imported from Raid-Helper: the class
 * of the most-played spec, every imported spec of that class (most played
 * first) and the name Raid-Helper had last for it. Null without a history.
 */
export function specSuggestion(history: SpecHistoryEntry[] | undefined): CharacterSuggestion | null {
    const list = (history || []).filter((h) => h && h.spec && h.spec.includes("-"));
    if (!list.length) return null;
    const top = list.slice().sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)[0];
    const className = top.spec.split("-")[0];
    const ofClass = list.filter((h) => h.spec.split("-")[0] === className);
    const specs = ofClass.slice().sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).map((h) => h.spec);
    const latest = ofClass.slice().sort((a, b) => b.lastAt - a.lastAt).find((h) => h.character);
    return { className, specs, name: latest ? latest.character : "" };
}

/** The spec names nothing could be mapped to, as one line ("" when none). */
export function unmappedText(result: HistoryImportResult): string {
    const entries = Object.entries(result.summary.unmapped || {});
    return entries.length
        ? t("settings.retirement.unmapped", { list: entries.map(([name, count]) => t("settings.retirement.unmappedItem", { name, count })).join(", ") })
        : "";
}
