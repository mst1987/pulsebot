import { get, send } from "./client";

// Rollen-Nachrichten (self-service roles): the contract is the header of
// src/web/apiRoutes/roleMessages.js, the overview docs/role-messages.md.

/** One role of a message: its button label and (optionally) its reaction emoji ("🛡️" or "<:name:id>"). */
export type RoleMessageRole = { roleId: string; emoji: string; label: string };

export type RoleMessage = {
    id: string;
    /** the server of the server list it stands on (#895; older entries are read by their side) */
    guildId: string;
    channelId: string;
    messageId: string;
    /** The Discord link of the posted message ("" while not posted). */
    url: string;
    title: string;
    body: string;
    imageUrl: string;
    /** 0..0xFFFFFF, or null for the bot's own accent. */
    color: number | null;
    roles: RoleMessageRole[];
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RoleMessageLimits = { roles: number; reactions: number; title: number; body: number; label: number };

export type RoleMessageRoleOption = {
    id: string;
    name: string;
    /** "#rrggbb", "" for an uncoloured role. */
    color: string;
    managed: boolean;
    /** "" = may be handed out, else why not (English, as the server logs it). */
    privileged: string;
    /** The bot sits above the role and it belongs to no integration. */
    editable: boolean;
};

export type RoleMessageChannelOption = { id: string; name: string; category: string; parentId: string; canReact: boolean | null };

export type RoleMessageEmojiOption = { id: string; name: string; animated: boolean; code: string; url: string };

export type RoleMessageOptions = {
    /** "" when no server is set. */
    guildId: string;
    online: boolean;
    manageRoles: boolean | null;
    roles: RoleMessageRoleOption[];
    channels: RoleMessageChannelOption[];
    emojis: RoleMessageEmojiOption[];
};

export type RoleMessageInput = {
    /** a server of the server list; "" = the first one */
    guildId: string;
    channelId: string;
    title: string;
    body: string;
    imageUrl: string;
    color: string | null;
    roles: RoleMessageRole[];
};

export type RoleMessageSaved = { entry: RoleMessage; url: string; warnings: string[]; reposted?: boolean };

export function getRoleMessages(): Promise<{ messages: RoleMessage[]; limits: RoleMessageLimits }> {
    return get("/api/role-messages");
}

export function getRoleMessageOptions(guildId: string): Promise<RoleMessageOptions> {
    return get(`/api/role-messages/options${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ""}`);
}

export function createRoleMessage(input: RoleMessageInput): Promise<RoleMessageSaved> {
    return send("POST", "/api/role-messages", input);
}

export function updateRoleMessage(id: string, input: RoleMessageInput): Promise<RoleMessageSaved> {
    return send("PUT", "/api/role-messages", { id, ...input });
}

export function deleteRoleMessage(id: string): Promise<{ id: string; messageDeleted: boolean }> {
    return send("DELETE", "/api/role-messages", { id });
}
