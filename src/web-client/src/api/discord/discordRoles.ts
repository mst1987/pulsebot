import { get } from "../client";
import { guildQuery } from "./discordOverview";

// The roles of one server of the server list (System › Discord › Rollen) and the
// counts of the Discord tabs: the contract is the header of
// src/web/apiRoutes/discord/discordRoles.js, the overview docs/channels.md.

/** What the bot does with a role (services/discord/selfRole.js roleUses, plus role messages and addon updates). */
export type ServerRoleUse =
    | { code: "admin" | "orga" | "officer" | "addonUpdates" }
    | { code: "rolePermissions"; areas: string[] }
    | { code: "botCommand"; commands: string[] }
    | { code: "categoryRaider"; categoryIds: string[]; categories?: { id: string; name: string }[] }
    | { code: "roleSync"; guildIds: string[]; servers?: { guildId: string; name: string }[] }
    | { code: "pugVersion"; versionIds: string[] }
    | { code: "roster"; rosterId: string; name: string; kinds: ("member" | "trial" | "manager")[] }
    | { code: "roleMessage"; messageId: string; title: string };

/** Why the bot cannot hand a role out ("" = it can). */
export type AssignReason = "" | "everyone" | "managed" | "botRole" | "noManageRoles" | "above";

export type ServerRoleHint = "empty" | "sensitive" | "aboveBot";

export type ServerRole = {
    id: string;
    name: string;
    /** "#rrggbb", "" for an uncoloured role. */
    color: string;
    position: number;
    managed: boolean;
    everyone: boolean;
    isBotRole: boolean;
    /** null when the member list could not be had in time. */
    memberCount: number | null;
    /** discord.js permission flag names ("ManageRoles"); the labels are in lib/discord/permissions.ts. */
    permissions: string[];
    sensitive: string[];
    /** the sensitive permissions most roles of the server do not have (empty for @everyone) */
    unusual: string[];
    uses: ServerRoleUse[];
    assign: { ok: boolean; reason: AssignReason };
    hints: ServerRoleHint[];
};

export type ServerRolesHead = {
    guildId: string;
    guildName: string;
    online: boolean;
    botRole: { id: string; name: string; position: number } | null;
    manageRoles: boolean | null;
    membersError: string | null;
};

/** A sensitive permission that is common on the server: @everyone has it, or most roles do. */
export type CommonSensitive = { key: string; roles: number; everyone: boolean };

export type ServerRoles = ServerRolesHead & { total: number; roles: ServerRole[]; commonSensitive: CommonSensitive[] };

export type ServerRoleChannel = {
    id: string;
    name: string;
    kind: "category" | "text" | "voice";
    parentName: string;
    allow: string[];
    deny: string[];
};

export type ServerRoleMember = { id: string; name: string; avatarUrl: string | null; bot: boolean };

export type ServerRoleDetail = ServerRolesHead & {
    role: ServerRole | null;
    channels: ServerRoleChannel[];
    /** at most EVERYONE_MEMBERS_MAX for @everyone; membersTotal counts them all */
    members: ServerRoleMember[];
    membersTotal: number;
};

/** Keyed by the menu ids of the Discord tabs (config/menu.json); null = unknown (bot offline). */
export type DiscordTabCounts = Partial<Record<string, number | null>>;

const withQuery = (path: string, ...parts: string[]) => {
    const q = parts.filter(Boolean).join("&");
    return q ? `${path}?${q}` : path;
};

export function getServerRoles(guildId: string): Promise<ServerRoles> {
    return get(withQuery("/api/discord/roles", guildQuery(guildId)));
}

export function getServerRoleDetail(guildId: string, roleId: string): Promise<ServerRoleDetail> {
    return get(withQuery("/api/discord/roles/detail", guildQuery(guildId), `roleId=${encodeURIComponent(roleId)}`));
}

export function getDiscordTabCounts(guildId = ""): Promise<DiscordTabCounts> {
    return get(withQuery("/api/discord/tab-counts", guildQuery(guildId)));
}
