import type { SetupActivity, SetupAttendance, SetupBalanceCheck, SetupPerson } from "../../../api";
import { specLabel } from "../../../lib/wow/wowNames";
import { t } from "../../../i18n";
import { formatWith } from "../../../lib/format";
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
        { key: "balance", label: t("setup.weights.balance.label"), tip: t("setup.weights.balance.tip") },
    ];
}

/** A raid counts as clearly weaker this many points (0-100) below the mean of the other raids (#1038). */
export const WEAKER_BY = 10;

/**
 * The raid strengths of a group (#1038) for the tabs: the value per raid id and the clearly
 * weaker raid, if any (the weakest one only). Nothing without strength data (`known` 0).
 */
export function raidBalance(balance: SetupBalanceCheck | undefined): { byId: Record<string, number>; weakId: string | null } | null {
    if (!balance || !balance.known || balance.raids.length < 2) return null;
    const byId: Record<string, number> = {};
    for (const r of balance.raids) if (typeof r.strength === "number") byId[r.eventId] = r.strength;
    const ids = Object.keys(byId);
    if (ids.length < 2) return null;
    let weakId: string | null = null;
    let gap = 0;
    for (const id of ids) {
        const others = ids.filter((o) => o !== id);
        const mean = others.reduce((sum, o) => sum + byId[o], 0) / others.length;
        const below = mean - byId[id];
        if (below >= WEAKER_BY && below > gap) { gap = below; weakId = id; }
    }
    return { byId, weakId };
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
