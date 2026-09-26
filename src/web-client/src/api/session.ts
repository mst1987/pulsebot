import { get, send } from "./client";
import { setCsrfToken } from "./csrf";
import type { DeployVersion } from "../lib/deployVersion";

// One admin-menu section a role can be given access to (src/config/permissions.js).
export type Area = { id: string; tab: string; label: string; description: string };
// What a user may do per area. Full admins hold every area at write level.
export type AreaAccess = { read: boolean; write: boolean };
export type Access = Record<string, AreaAccess | undefined>;
export type RolePermissions = Record<string, Record<string, AreaAccess>>;

/** `lang` = the menu language the account saved (POST /api/session/lang); absent until it chose one. */
/** "Ansicht als Rolle" (src/web/viewAs.js): the roles the menu is shown as right now. */
export type ViewAs = { roleIds: string[]; roleNames: string[]; at: number };
export type SessionUser = {
    id: string; name: string; isAdmin: boolean; access: Access; lang?: "de" | "en";
    /** A real full admin — may look at the menu as a role (also while doing so). */
    canViewAs?: boolean;
    /** Set while the menu shows the rights of these roles instead of the own ones. */
    viewAs?: ViewAs;
};
export type ViewAsRole = { id: string; name: string; color: string; admin: boolean; configured: boolean };
/** "event" | "talk" = the server's fixed role from Einstellungen → Discord-Server, "" = none. */
export type GuildRole = "event" | "talk" | "";
export type SessionGuild = { id: string; name: string; role?: GuildRole };
export type Session = {
    user: SessionUser | null;
    csrfToken: string | null;
    areas: Area[];
    guilds: SessionGuild[];
    activeGuildId: string;
};

/** The session — and, as a side effect, the CSRF token every send() from now on carries (csrf.ts). */
export async function getSession(): Promise<Session> {
    const session = await get<Session>("/api/session");
    setCsrfToken(session.csrfToken);
    return session;
}

export function switchGuild(guildId: string): Promise<{ activeGuildId: string }> {
    return send("POST", "/api/session/guild", { guildId });
}

/** The roles a full admin can look at the menu as. */
export function getViewAsRoles(): Promise<{ roles: ViewAsRole[]; maxRoles: number }> {
    return get<{ roles: ViewAsRole[]; maxRoles: number }>("/api/session/view-as");
}

/** Start the view as these roles ([] = only the base access), or stop it. */
export function setViewAs(input: { roleIds: string[] } | { stop: true }): Promise<{ viewAs: { roleIds: string[] } | null }> {
    return send("POST", "/api/session/view-as", input);
}

/** Saves the menu language for the own account, so it follows the user to other devices. */
export function saveLang(lang: "de" | "en"): Promise<{ lang: string }> {
    return send("POST", "/api/session/lang", { lang });
}

/** Which commit the server runs and how far behind main it is (#314) — settings readers only. */
export function getVersion(): Promise<DeployVersion> {
    return get<DeployVersion>("/api/version");
}
