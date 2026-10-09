// The roster's attendance tab (#677): members x the category's counted nights. Pure, so
// the page only draws it. Columns oldest first (the newest stands right, like the dots of
// "Meine Anwesenheit"); rows grouped by roster status (core, trial, bench, pause), then by
// name; each cell the member's verdict of that night, null where the night was not counted
// for them (no character to count with).
import type { RosterAttendance, RosterDetail, RosterMember, RosterNight } from "../../api";
import { STATUS_ORDER as ROSTER_STATUS_ORDER } from "./rosters";

export type GridNight = { eventId: string; title: string; startTime: number };
export type GridCell = (Omit<RosterNight, "attended" | "reason"> & { attended: boolean; reason?: string }) | null;
export type GridRow = { member: RosterMember; cells: GridCell[]; attendance: RosterAttendance | null };

/** Every night of a member's attendance by event id: the counted ones (`present`) and the missed ones. */
function nightsById(att: RosterAttendance | null): Map<string, NonNullable<GridCell>> {
    const out = new Map<string, NonNullable<GridCell>>();
    if (!att) return out;
    for (const n of att.present || []) out.set(n.eventId, { ...n, attended: true });
    for (const n of att.raids || []) if (!out.has(n.eventId)) out.set(n.eventId, n);
    for (const n of att.missed || []) out.set(n.eventId, { ...n, attended: false });
    return out;
}

/** The grid of a roster: columns oldest first, rows by status then name. */
export function attendanceGrid(data: Pick<RosterDetail, "members" | "nights">): { columns: GridNight[]; rows: GridRow[] } {
    const columns = [...(data.nights || [])].sort((a, b) => a.startTime - b.startTime);
    const rank = (m: RosterMember) => {
        const i = ROSTER_STATUS_ORDER.indexOf(m.status);
        return i < 0 ? ROSTER_STATUS_ORDER.length : i;
    };
    const members = [...data.members].sort((a, b) => (rank(a) - rank(b)) || a.displayName.localeCompare(b.displayName));
    const rows = members.map((member) => {
        const byId = nightsById(member.attendance);
        return { member, attendance: member.attendance, cells: columns.map((c) => byId.get(c.eventId) || null) };
    });
    return { columns, rows };
}
