import type { SessionUser } from "../api/session";

/** Whether the session user may read (or write) the given area. */
export function canAccess(user: SessionUser | null, area: string, level: "read" | "write" = "read"): boolean {
    if (!user) return false;
    if (user.isAdmin) return true;
    const entry = user.access && user.access[area];
    if (!entry) return false;
    return level === "write" ? !!entry.write : !!(entry.read || entry.write);
}

/**
 * Whether the user may read (or write) at least one of the given areas — the
 * client-side twin of userCanAny() in src/config/permissions.js, for a tab that
 * more than one area opens (Historie & Loot: "history" fully, "loot" partly).
 */
export function canAccessAny(user: SessionUser | null, areas: string[], level: "read" | "write" = "read"): boolean {
    return areas.some((area) => canAccess(user, area, level));
}
