import { get, send } from "./client";
import { setCsrfToken } from "./csrf";
import type { DeployVersion } from "../lib/app/deployVersion";

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
    /** The Discord picture for the user circle; missing when there is none (the circle shows the initial). */
    avatarUrl?: string;
    /** A real full admin — may look at the menu as a role (also while doing so). */
    canViewAs?: boolean;
    /** Set while the menu shows the rights of these roles instead of the own ones. */
    viewAs?: ViewAs;
    /** Who sees each area this account may open (src/web/http/areaAudience.js) — the "Orga-Bereich" marks read it. */
    audience?: Record<string, AreaAudience>;
    /** Orga: a full admin, or holding an orga role (Einstellungen → Berechtigungen) — sees the orga's parts of the pages. */
    isOrga?: boolean;
    /**
     * The categories whose current roster this account manages (#729): it is the orga of those categories'
     * raids - the pages show it their orga parts there (each raid's buttons still follow the server's answer).
     */
    orgaCategories?: string[];
    /** The names of the orga roles (admin roles left out) — the orga zones name them. */
    orgaRoles?: string[];
};
/** A raider area (the base access or a raider role opens it), else the orga roles that may read / change in it and how many single accounts may read it. */
export type AreaAudience = { everyone: boolean; roles: string[]; writers: string[]; raiders?: string[]; accounts: number };
export type ViewAsRole = { id: string; name: string; color: string; admin: boolean; configured: boolean };
/** "event" = a configured server from Einstellungen → Discord-Server, "" = none (#897). */
export type GuildRole = "event" | "";
/**
 * A server of the server list; `label` is the orga's own short name ("" = none, missing from an older server),
 * `iconUrl` the server's Discord icon ("" = it has none).
 */
export type SessionGuild = { id: string; name: string; role?: GuildRole; label?: string; iconUrl?: string };
/** A game version the content switch offers (#563). */
export type ContentVersionRef = {
    id: string; label: string; short: string;
    /** The version's colour (#742): the setting's, else the rule set's. Missing = the stylesheet's default. */
    color?: string;
    /** The colour differs from the rule set's — only then the client writes its own values (lib/app/versionColor.ts). */
    custom?: boolean;
};
/** The content switch of the menu (#563): main version, whether the others are hidden, the versions offered (main first). */
export type ContentInfo = { mainVersion: string; hideOtherVersions: boolean; versions: ContentVersionRef[] };
export type Session = {
    user: SessionUser | null;
    csrfToken: string | null;
    areas: Area[];
    guilds: SessionGuild[];
    activeGuildId: string;
    /** null for a caller without menu access; missing from an older server. */
    content?: ContentInfo | null;
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
