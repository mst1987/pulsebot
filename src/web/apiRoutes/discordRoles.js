// The roles of the event and the talk server (System › Discord › Rollen,
// services/discord/serverRoles.js, docs/channels.md) and the counts of the Discord tabs.
// Area `channels`, read only: nothing here changes a role.
//
// GET /api/discord/roles?side=event|talk
//     → { data: { side, guildId, guildName, online, botRole: { id, name, position }|null,
//                 manageRoles: boolean|null, membersError: string|null, total, roles: [Role] } }
//       Role = { id, name, color: "#rrggbb"|"", position, managed, everyone, isBotRole,
//                memberCount: number|null, permissions: [key], sensitive: [key],
//                uses: [Use], assign: { ok, reason }, hints: [Hint] }
//       key: a discord.js permission flag name ("ManageRoles"); the page has the labels
//       Use: { code: "admin"|"orga"|"officer" } | { code: "rolePermissions", areas }
//            | { code: "botCommand", commands } | { code: "categoryRaider", categoryIds, categories: [{ id, name }] }
//            | { code: "roleSync", sides } | { code: "roster", rosterId, name, kinds }
//            | { code: "roleMessage", messageId, title } | { code: "addonUpdates" }
//       assign.reason: "" | "everyone" | "managed" | "botRole" | "noManageRoles" | "above"
//       Hint: "empty" (no members) | "sensitive" (sensitive permissions) | "aboveBot" (the bot
//             hands it out but sits below it)
//       highest first, @everyone last; memberCount null (and membersError set) when the member
//       list cannot be had in time; offline: online false and no roles
//
// GET /api/discord/roles/detail?side=event|talk&roleId=
//     → { data: { ...as above without roles, role: Role|null,
//                 channels: [{ id, name, kind: "category"|"text"|"voice", parentName, allow: [key], deny: [key] }],
//                 members: [{ id, name, avatarUrl: string|null, bot }] } }
//       channels: those with an overwrite for the role, in Discord's order; members by name
//       404 not_found: the server is online but has no such role
//
// GET /api/discord/tab-counts?side=event|talk
//     → { data: { channels: number|null, serverRoles: number|null, members: number|null, roleMessages: number } }
//       keyed by the menu ids of the tabs (config/menu.json); channels: the active server's
//       channels without categories and threads; serverRoles: the side's roles without
//       @everyone; members: the side's people (bots left out, as on the list);
//       null = unknown (bot offline)
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const discord = require("../../services/discord/discord");
const serverRoles = require("../../services/discord/serverRoles");
const serverMembers = require("../../services/discord/serverMembers");
const roleMessageStore = require("../../stores/roleMessageStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const sideOf = (query) => (str(query.get("side")) === "talk" ? "talk" : "event");

/** GET /api/discord/roles */
const listRoles = withUser(async ({ query, res }) => {
    ok(res, await serverRoles.listServerRoles(sideOf(query)));
});

/** GET /api/discord/roles/detail */
const roleDetail = withUser(async ({ query, res }) => {
    const roleId = str(query.get("roleId"));
    if (!roleId) return apiError(res, 400, "missing_role", "Welche Rolle? Die roleId fehlt.");
    const detail = await serverRoles.serverRoleDetail(sideOf(query), roleId);
    if (!detail) return apiError(res, 404, "not_found", "Diese Rolle gibt es auf dem Server nicht (mehr).");
    ok(res, detail);
    return undefined;
});

/** GET /api/discord/tab-counts */
const tabCounts = withUser(async ({ query, req, res }) => {
    const guildId = activeGuildFor(req);
    const online = !!guildId && !!discord.getGuild(guildId);
    const channels = online ? discord.listAllChannels(guildId).filter((c) => !c.isThread).length : null;
    let roleMessages;
    try {
        roleMessages = roleMessageStore.listMessages().length;
    } catch {
        roleMessages = 0;
    }
    const side = sideOf(query);
    ok(res, { channels, serverRoles: serverRoles.roleCount(side), members: serverMembers.memberCount(side), roleMessages });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/discord/roles", handler: listRoles, area: "channels" },
    { method: "GET", path: "/api/discord/roles/detail", handler: roleDetail, area: "channels" },
    { method: "GET", path: "/api/discord/tab-counts", handler: tabCounts, area: "channels" },
];

module.exports = { routes };
