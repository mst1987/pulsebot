import type { SetupActivity, SetupAttendance, SetupPerson, SetupRaidIdTaken } from "../../../api";
import { specLabel } from "../../../lib/wow/wowNames";
import { t } from "../../../i18n";
import { formatDayDate, formatWith } from "../../../lib/format";
import { SIGNUP_STATUS } from "../../../lib/signups/status";

/**
 * The word of a marked signup state (late, tentative, bench) — the app's one
 * vocabulary (lib/signups/status.ts, the signup page and Discord): "Spät",
 * "Vielleicht", "Bank" / "Late", "Tentative", "Bench"; "" for a plain signup.
 */
export function statusLabel(status: string | undefined): string {
    const marked = markedStatus(status);
    return marked ? SIGNUP_STATUS[marked].label : "";
}

/** The word of any signup state, a plain one included ("Angemeldet" / "Signed up"). */
export function statusWord(status: string | undefined): string {
    return SIGNUP_STATUS[markedStatus(status) || "signed"].label;
}

/** The signup states that are not a plain "dabei" — they get a labelled badge on the line. */
export const MARKED_STATUSES = ["late", "tentative", "bench"] as const;
export type MarkedStatus = typeof MARKED_STATUSES[number];

/** The state a line is marked with: late, tentative or bench — "" for a plain signup. */
export function markedStatus(status: string | undefined): MarkedStatus | "" {
    return (MARKED_STATUSES as readonly string[]).includes(status || "") ? status as MarkedStatus : "";
}

/** The order inside a role block of "Angemeldet": signed first, then late, tentative, bench. */
export function statusRank(status: string | undefined): number {
    const marked = markedStatus(status);
    return marked ? MARKED_STATUSES.indexOf(marked) + 1 : 0;
}

/** A raider's spec in the active language — the server's label as fallback. */
export const specText = (p: SetupPerson) => specLabel(p.spec, p.specLabel || p.spec);

/** The weight sliders of the proposal, labels in the active language. */
export function weightLabels(): { key: string; label: string; tip: string }[] {
    return [
        { key: "requiredBuffs", label: t("setup.weights.requiredBuffs.label"), tip: t("setup.weights.requiredBuffs.tip") },
        { key: "roster", label: t("setup.weights.roster.label"), tip: t("setup.weights.roster.tip") },
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
        { key: "loot", label: t("setup.weights.loot.label"), tip: t("setup.weights.loot.tip") },
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

// The bench as a sixth column beside the groups ("Ansicht › Bank als Spalte") instead
// of a row under them — like the compact view a per-viewer choice, off by default.
const BENCH_COLUMN_KEY = "eh-setup-bench-column";

export function readBenchColumn(): boolean {
    try {
        return localStorage.getItem(BENCH_COLUMN_KEY) === "1";
    } catch {
        return false;
    }
}

export function storeBenchColumn(on: boolean) {
    try {
        localStorage.setItem(BENCH_COLUMN_KEY, on ? "1" : "0");
    } catch {
        // private window or blocked storage — the choice just is not remembered
    }
}

// "Angemeldet" as a 300px sidebar left of the groups (B, "Ansicht › Angemeldet als
// Seitenleiste") instead of role columns under them (A) — per viewer, off by default.
const POOL_SIDEBAR_KEY = "eh-setup-pool-sidebar";

export function readPoolSidebar(): boolean {
    try {
        return localStorage.getItem(POOL_SIDEBAR_KEY) === "1";
    } catch {
        return false;
    }
}

export function storePoolSidebar(on: boolean) {
    try {
        localStorage.setItem(POOL_SIDEBAR_KEY, on ? "1" : "0");
    } catch {
        // private window or blocked storage — the choice just is not remembered
    }
}

/** One line of "Gerade eben" in words: "Taccop hat Cherrylol in Gruppe 2 gesetzt". */
export function activityText(e: SetupActivity): string {
    const who = e.byName || "?";
    switch (e.kind) {
        case "move": {
            const character = e.character || "?";
            if (e.to?.bench) return t("setup.live.toBench", { who, character });
            if (e.to?.pool) return t("setup.live.toPool", { who, character });
            return t("setup.live.toGroup", { who, character, group: e.to?.group || "?" });
        }
        case "many": return t("setup.live.movedMany", { who, count: e.count || 0 });
        case "fill": return t("setup.live.filled", { who, count: e.count || 0 });
        case "propose": return t("setup.live.proposed", { who });
        case "post": return t("setup.live.posted", { who });
        default: return who;
    }
}

/** "jetzt", "vor 20 s", "vor 3 min" */
export function agoText(at: number, now: number): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 10) return t("setup.live.now");
    if (s < 60) return t("setup.live.secondsAgo", { count: s });
    return t("setup.live.minutesAgo", { count: Math.round(s / 60) });
}

/** Who the search finds: the character, the Discord name, the spec — and every other character they signed up with (#293) and its spec. */
export function matchesQuery(p: SetupPerson, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const others = (p.characters || []).flatMap((c) => [c.character, specLabel(c.spec, c.specLabel || c.spec)]);
    return [p.character, p.name, specText(p), ...others].some((x) => String(x || "").toLowerCase().includes(q));
}

/**
 * One instance per raid ID: the line naming where the character already stands —
 * "ID: schon in Hyjal F · Raid 1 (Mi 09.12.)" for a raid of this server, only
 * "Schon in einem anderen Raid dieser ID" for one of another server (the server
 * sends nothing more about it). Empty without a hint.
 */
export function raidIdText(taken: SetupRaidIdTaken | undefined): string {
    if (!taken) return "";
    if (!taken.local) return t("setup.raidId.other");
    const title = taken.title || "?";
    const base = taken.raidNo ? t("setup.raidId.localRaid", { title, n: taken.raidNo }) : t("setup.raidId.local", { title });
    // Server time zone (DISPLAY_TZ), like the raid ID itself: a raid at 00:30 shows its server day.
    const day = taken.startTime ? formatDayDate(taken.startTime * 1000) : "";
    return day ? `${base} (${day})` : base;
}
