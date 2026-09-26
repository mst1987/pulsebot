// Plain helpers of the roster and the character page (design issue #218),
// kept apart from the components so fast refresh keeps working.
import type { GearIssue, GearItem, RosterAttendance, RosterRole } from "../api";
import { formatDayDate } from "./format";

export const ROLE_META: Record<Exclude<RosterRole, "">, { label: string; icon: string }> = {
    tank: { label: "Tank", icon: "inv_shield_06" },
    healer: { label: "Heiler", icon: "spell_holy_flashheal" },
    dps: { label: "DPS", icon: "ability_dualwield" },
};

/** The order a group lists its characters in: tanks, healers, damage, unknown. */
export const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2, "": 3 };

export const CLASS_LABELS: Record<string, string> = {
    Warrior: "Krieger", Paladin: "Paladin", Hunter: "Jäger", Rogue: "Schurke", Priest: "Priester",
    Shaman: "Schamane", Mage: "Magier", Warlock: "Hexenmeister", Druid: "Druide", DK: "Todesritter",
};

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

export const SLOT_LABELS: Record<string, string> = {
    HEAD: "Kopf", NECK: "Hals", SHOULDER: "Schulter", BACK: "Rücken", CHEST: "Brust", SHIRT: "Hemd", TABARD: "Wappenrock",
    WRIST: "Handgelenk", HANDS: "Hände", WAIST: "Taille", LEGS: "Beine", FEET: "Füße",
    FINGER_1: "Ring 1", FINGER_2: "Ring 2", TRINKET_1: "Schmuck 1", TRINKET_2: "Schmuck 2",
    MAIN_HAND: "Haupthand", OFF_HAND: "Nebenhand", RANGED: "Fernkampf",
};

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
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : "Befund";
}
