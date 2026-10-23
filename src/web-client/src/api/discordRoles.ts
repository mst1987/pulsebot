import { get } from "./client";

// The roles of the event and the talk server (System › Discord › Rollen) and the
// counts of the Discord tabs: the contract is the header of
// src/web/apiRoutes/discordRoles.js, the overview docs/channels.md.

export type DiscordSide = "event" | "talk";

/** What the bot does with a role (services/discord/selfRole.js roleUses, plus role messages and addon updates). */
export type ServerRoleUse =
    | { code: "admin" | "orga" | "officer" | "addonUpdates" }
    | { code: "rolePermissions"; areas: string[] }
    | { code: "botCommand"; commands: string[] }
    | { code: "categoryRaider"; categoryIds: string[]; categories?: { id: string; name: string }[] }
    | { code: "roleSync"; sides: DiscordSide[] }
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
    side: DiscordSide;
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

export function getServerRoles(side: DiscordSide): Promise<ServerRoles> {
    return get(`/api/discord/roles?side=${side}`);
}

export function getServerRoleDetail(side: DiscordSide, roleId: string): Promise<ServerRoleDetail> {
    return get(`/api/discord/roles/detail?side=${side}&roleId=${encodeURIComponent(roleId)}`);
}

export function getDiscordTabCounts(side: DiscordSide = "event"): Promise<DiscordTabCounts> {
    return get(`/api/discord/tab-counts?side=${side}`);
}
