import type { SetupAttendance, SetupPerson } from "../../../api";
import { specLabel } from "../../../lib/wowNames";
import { t } from "../../../i18n";
import { formatWith } from "../../../lib/format";

/** The signup states a slot shows a marker for, in the active language. */
export function statusLabel(status: string | undefined): string {
    if (status === "late") return t("setup.person.status.late");
    if (status === "tentative") return t("setup.person.status.tentative");
    if (status === "bench") return t("setup.person.status.bench");
    return "";
}

/** A raider's spec in the active language — the server's label as fallback. */
export const specText = (p: SetupPerson) => specLabel(p.spec, p.specLabel || p.spec);

/** The weight sliders of the proposal, labels in the active language. */
export function weightLabels(): { key: string; label: string; tip: string }[] {
    return [
        { key: "requiredBuffs", label: t("setup.weights.requiredBuffs.label"), tip: t("setup.weights.requiredBuffs.tip") },
        { key: "mainSpec", label: t("setup.weights.mainSpec.label"), tip: t("setup.weights.mainSpec.tip") },
        { key: "preferredCharacter", label: t("setup.weights.preferredCharacter.label"), tip: t("setup.weights.preferredCharacter.tip") },
        { key: "fairness", label: t("setup.weights.fairness.label"), tip: t("setup.weights.fairness.tip") },
        { key: "status", label: t("setup.weights.status.label"), tip: t("setup.weights.status.tip") },
        { key: "partyBuffs", label: t("setup.weights.partyBuffs.label"), tip: t("setup.weights.partyBuffs.tip") },
        { key: "wishes", label: t("setup.weights.wishes.label"), tip: t("setup.weights.wishes.tip") },
        { key: "avoid", label: t("setup.weights.avoid.label"), tip: t("setup.weights.avoid.tip") },
        { key: "raidBuffs", label: t("setup.weights.raidBuffs.label"), tip: t("setup.weights.raidBuffs.tip") },
        { key: "attendance", label: t("setup.weights.attendance.label"), tip: t("setup.weights.attendance.tip") },
        { key: "gear", label: t("setup.weights.gear.label"), tip: t("setup.weights.gear.tip") },
    ];
}

// the raid size an own event allows (eventStore.js's MAX_SIZE) — the server checks it again
export const MAX_RAID_SIZE = 40;

export const dateTime = (ms: number) => (ms
    ? formatWith(ms, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "");


/** The date of the last night on the bench ("12.09.2026"), "–" when they were not on it in the nights looked at; "" without any earlier night. */
export function benchText(a: SetupAttendance | undefined): string {
    if (!a || !a.benchNights) return "";
    if (!a.lastBench) return "–";
    return formatWith(a.lastBench * 1000, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Attendance bar tone: healthy from 80 %, worrying below 50 %. */
export const attendanceTone = (pct: number) => (pct >= 80 ? "ok" : pct >= 50 ? "mid" : "bad");

export const clock = (ms: number) => {
    if (!ms) return "";
    const sameDay = new Date(ms).toDateString() === new Date().toDateString();
    return formatWith(ms, sameDay
        ? { hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

// The compact view (one-line raiders, narrower cards) is an option, off by default;
// the choice is a per-viewer convenience, so it lives in the browser only.
const COMPACT_KEY = "eh-setup-compact";

export function readCompact(): boolean {
    try {
        return localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
        return false;
    }
}

export function storeCompact(on: boolean) {
    try {
        localStorage.setItem(COMPACT_KEY, on ? "1" : "0");
    } catch {
        // private window or blocked storage — the choice just is not remembered
    }
}
