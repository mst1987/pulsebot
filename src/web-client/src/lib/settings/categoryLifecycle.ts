// Einstellungen → Kategorien over a category's life (#744): which categories a
// save deactivates, how a category's series is named in the dialogs, and which
// roles the raider-role picker offers. The server side is
// src/services/events/categoryLifecycle.js.
import type { CategorySeriesInfo, Role } from "../../api";
import { weekdayShort } from "../raids/eventSeries";
import { assignableRoles } from "./assignableRoles";

/** The categories active now (saved) that the draft no longer has — a save deactivates them. */
export function deactivatedIds(saved: string[] | undefined, draft: string[]): string[] {
    const next = new Set(draft);
    return (saved || []).filter((id) => !next.has(id));
}

/** "Mo + Do 19:30" — a series in one line; "" without one. */
export function seriesWhen(series: CategorySeriesInfo | null | undefined): string {
    if (!series) return "";
    const days = (series.weekdays || []).map(weekdayShort).filter(Boolean).join(" + ");
    return [days, series.time].filter(Boolean).join(" ");
}

/**
 * The roles the raider-role picker of a category offers: every role whose name
 * says "raid", plus every role a category already uses — matched by id, so a
 * raider role renamed in Discord (#744: "TBC Raider" → "Kern") stays offered and
 * stays picked. The roles in use come first; a bot's own role (@MEE6, #745) only
 * while a category still uses it.
 */
export function raiderRoleOptions(roles: Role[], categoryRoles: Record<string, string[]>): Role[] {
    const used = new Set(Object.values(categoryRoles || {}).flat());
    const offered = assignableRoles(roles, [...used]).filter((r) => used.has(r.id) || /raid/i.test(r.name || ""));
    return [...offered.filter((r) => used.has(r.id)), ...offered.filter((r) => !used.has(r.id))];
}
