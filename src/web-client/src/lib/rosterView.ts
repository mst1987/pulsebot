// Plain helpers of the roster and the character page (design issue #218),
// kept apart from the components so fast refresh keeps working.
import type { GearIssue, GearItem, RosterAttendance, RosterRole } from "../api";
import { t } from "../i18n";
import { formatDayDate } from "./format";

/** The role badge's icon; its text is the role's name in the menu language (lib/wowNames roleLabel). */
export const ROLE_META: Record<Exclude<RosterRole, "">, { icon: string }> = {
    tank: { icon: "inv_shield_06" },
    healer: { icon: "spell_holy_flashheal" },
    dps: { icon: "ability_dualwield" },
};

/** The order a group lists its characters in: tanks, healers, damage, unknown. */
export const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2, "": 3 };

/** WoW class icon name for a class ("classicon_mage"). */
export function classIconName(className: string): string {
    return `classicon_${String(className || "").toLowerCase().replace(/\s+/g, "")}`;
}

/** "Do 21.08." — how a raid night is named in a tooltip or list. */
export function nightLabel(ms: number): string {
    const n = Number(ms);
    if (!n) return "";
    return formatDayDate(n);
}

/** ok ≥ 80 %, mid ≥ 60 %, bad below — the attendance bar's tone. */
export function attendanceTone(pct: number | null): "ok" | "mid" | "bad" | undefined {
    if (pct === null || pct === undefined) return undefined;
    if (pct >= 80) return "ok";
    if (pct >= 60) return "mid";
    return "bad";
}

/** Several categories folded into one figure (the character hero). */
export function combineAttendance(list: RosterAttendance[]): { attended: number; total: number; pct: number | null } {
    const attended = list.reduce((n, a) => n + (a.attended || 0), 0);
    const total = list.reduce((n, a) => n + (a.total || 0), 0);
    return { attended, total, pct: total ? Math.round((attended / total) * 100) : null };
}

/** Percent for a meter, clamped and safe for an empty roster. */
export function share(part: number, whole: number): number {
    if (!whole || whole <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

const SLOT_KEYS = [
    "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST", "HANDS", "WAIST", "LEGS", "FEET",
    "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED",
];

/**
 * Gear slot names ("HEAD" -> "Kopf" / "Head"). Each entry is a getter, so the
 * name is looked up in the menu language when it is read, never frozen at load.
 */
export const SLOT_LABELS: Record<string, string> = Object.defineProperties(
    {} as Record<string, string>,
    Object.fromEntries(SLOT_KEYS.map((slot) => [slot, { get: () => t(`roster.slot.${slot}`), enumerable: true }])),
);

/**
 * The findings that belong to one slot row: by item id first — WCL and
 * Battle.net do not always agree on which ring or trinket is "1" — then by slot
 * key for a finding without an item (an empty slot).
 */
export function findingsForSlot(issues: GearIssue[], slot: string, g?: GearItem): GearIssue[] {
    const itemId = g?.itemId ? String(g.itemId) : "";
    return issues.filter((i) => {
        if (itemId && i.itemId) return i.itemId === itemId;
        return !!i.slotKey && i.slotKey === slot;
    });
}

/** Short badge text of a finding, as it sits on the slot row ("Keine Verzauberung"). */
export function findingLabel(issue: GearIssue): string {
    const l = issue.label || "";
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : t("roster.finding");
}
