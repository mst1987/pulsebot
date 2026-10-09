// The pure rules of the roster pages (#654): which members a filter keeps, how
// the table groups and sorts them, the stored view read back safely. Names,
// characters, roles and attendance come from the server (api/roster.ts).
import type { RosterMember, RosterRole, RosterStatus } from "../../api";
import { sortRows, type Dir } from "../ui/tableSort";
import { ROLE_ORDER } from "./rosterView";

/** The statuses in the order the table groups them. */
export const STATUS_ORDER: RosterStatus[] = ["core", "trial", "bench", "pause"];

/** Role icons as the role segment and the role column show them. */
export const ROLE_ICONS: Record<Exclude<RosterRole, "">, string> = {
    tank: "inv_shield_06",
    healer: "spell_holy_flashheal",
    dps: "ability_dualwield",
};

export type MemberRoleFilter = "all" | Exclude<RosterRole, "">;
export type MemberSortKey = "name" | "chars" | "role" | "discord" | "attendance" | "since";

/** Which way a column sorts on its first click: names up, attendance and dates down. */
export const MEMBER_SORT_DEFAULTS: Record<MemberSortKey, Dir> = {
    name: "asc", chars: "asc", role: "asc", discord: "asc", attendance: "desc", since: "desc",
};

/** The remembered filter of the members tab; pause is off at first (who pauses does not raid). */
export type MemberView = { statuses: RosterStatus[]; role: MemberRoleFilter; search: string };
export const MEMBER_VIEW_DEFAULT: MemberView = { statuses: ["core", "trial", "bench"], role: "all", search: "" };

const ROLE_FILTERS: MemberRoleFilter[] = ["all", "tank", "healer", "dps"];

/** A stored view from another build, read field by field; unknown values fall back. */
export function readMemberView(stored: Partial<MemberView> | null | undefined): MemberView {
    const s = stored || {};
    const statuses = Array.isArray(s.statuses) ? STATUS_ORDER.filter((st) => s.statuses?.includes(st)) : MEMBER_VIEW_DEFAULT.statuses;
    return {
        statuses,
        role: ROLE_FILTERS.includes(s.role as MemberRoleFilter) ? (s.role as MemberRoleFilter) : "all",
        search: typeof s.search === "string" ? s.search : "",
    };
}

/** Members per status, for the status fields. */
export function statusCounts(members: RosterMember[]): Record<RosterStatus, number> {
    const out: Record<RosterStatus, number> = { core: 0, trial: 0, bench: 0, pause: 0 };
    for (const m of members) out[m.status] = (out[m.status] || 0) + 1;
    return out;
}

/** The members the filter keeps: picked statuses, the role, and a search in the name and every character. */
export function filterMembers(members: RosterMember[], view: MemberView): RosterMember[] {
    const q = view.search.trim().toLowerCase();
    return members.filter((m) => {
        if (!view.statuses.includes(m.status)) return false;
        if (view.role !== "all" && m.role !== view.role) return false;
        if (q && !m.displayName.toLowerCase().includes(q) && !m.chars.some((c) => c.name.toLowerCase().includes(q))) return false;
        return true;
    });
}

/** What a column sorts by. Unknown values sort last in ascending order. */
function sortValue(m: RosterMember, key: MemberSortKey): string | number {
    switch (key) {
        case "chars": return (m.chars[0]?.name || "￿").toLowerCase();
        case "role": return ROLE_ORDER[m.role] ?? 3;
        // missing role first: that is the row somebody has to act on
        case "discord": return m.hasRole === false ? 0 : m.hasRole === true ? 1 : 2;
        case "attendance": return m.attendance && m.attendance.pct !== null ? m.attendance.pct : -1;
        case "since": return m.since || "";
        default: return m.displayName.toLowerCase();
    }
}

/** The rows in the order of a column; equal rows keep their name order. */
export function sortMembers(members: RosterMember[], key: MemberSortKey, dir: Dir): RosterMember[] {
    const byName = sortRows(members, (m) => m.displayName.toLowerCase(), "asc");
    return sortRows(byName, (m) => sortValue(m, key), dir);
}

/** The table's groups: one per status (in STATUS_ORDER) that has rows. */
export function groupByStatus(members: RosterMember[]): { status: RosterStatus; rows: RosterMember[] }[] {
    return STATUS_ORDER
        .map((status) => ({ status, rows: members.filter((m) => m.status === status) }))
        .filter((g) => g.rows.length);
}

/** The letter of a person's avatar when Discord has no picture. */
export function initialOf(name: string): string {
    return (Array.from(String(name || "").trim())[0] || "?").toUpperCase();
}

/** The damage target of a roster: the places left after tanks and healers, 0 when nothing is planned. */
export function dpsTarget(slots: { total: number; tank: number; healer: number }): number {
    return slots.total > 0 ? Math.max(0, slots.total - slots.tank - slots.healer) : 0;
}
