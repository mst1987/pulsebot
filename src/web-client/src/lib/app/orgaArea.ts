// Is this an orga area — or does every raider see it? (design canvas Oct 2026, E + B)
//
// Which roles are orga is set in Einstellungen → Berechtigungen; every other role is a raider
// role. The server says per area who may open it (`user.audience`, src/web/http/areaAudience.js):
// an area the base access or a raider role opens is a raider area; any other belongs to the
// orga. A page counts as orga when none of its areas is a raider area (Abwesenheiten — `signup`
// or `roster` — is a raider's page too); its mark names the orga roles that open it.
import type { SessionUser } from "../../api";
import { t } from "../../i18n";

export type OrgaAudience = { roles: string[]; accounts: number };

/**
 * Who sees an orga area, or null when it is no orga area: one of `areas` is for everyone,
 * or the server sent no audience (an older one) — then nothing is marked rather than guessed.
 * `level` "write" names the roles that may change in it instead of those that may read it.
 */
export function orgaAudience(user: Pick<SessionUser, "audience">, areas: string[], level: "read" | "write" = "read"): OrgaAudience | null {
    const audience = user.audience;
    if (!audience || !areas.length) return null;
    const known = areas.map((a) => audience[a]).filter(Boolean);
    if (!known.length || known.some((a) => a.everyone)) return null;
    const roles = [...new Set(known.flatMap((a) => (level === "write" ? a.writers || [] : a.roles)))].sort((a, b) => a.localeCompare(b));
    return { roles, accounts: level === "write" ? 0 : Math.max(0, ...known.map((a) => a.accounts || 0)) };
}

/** Whether the account is orga: a full admin, or holding an orga role (the session's `isOrga`). */
export function isOrga(user: Pick<SessionUser, "isAdmin" | "isOrga">): boolean {
    return !!(user.isAdmin || user.isOrga);
}

/** Who the orga is, for a part only the orga sees: the admins and every orga role. */
export function orgaOnly(user: Pick<SessionUser, "orgaRoles">): OrgaAudience {
    return { roles: [...(user.orgaRoles || [])], accounts: 0 };
}

/** A menu page's audience: a page only full admins open (Systemstatus) is orga too, seen by the admins alone. */
export function pageAudience(user: Pick<SessionUser, "audience">, entry: { areas: string[]; adminOnly?: boolean }): OrgaAudience | null {
    return entry.adminOnly ? { roles: [], accounts: 0 } : orgaAudience(user, entry.areas);
}

/** "Admins · @Raidleitung · @Mo Raider · 2 einzelne Konten" — admins always see an orga area. */
export function audienceText(audience: OrgaAudience): string {
    return [
        t("shell.orga.admins"),
        ...audience.roles.map((r) => `@${r}`),
        ...(audience.accounts ? [t("shell.orga.accounts", { count: audience.accounts })] : []),
    ].join(" · ");
}
