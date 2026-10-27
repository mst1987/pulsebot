// The members of one server of the list (#895, System › Discord › Mitglieder,
// services/discord/serverMembers.js, docs/channels.md). Area `channels`, read only:
// nothing here changes a member or a role.
//
// GET /api/discord/members?guildId=<one of the servers>   (none: the first server)
//     → { data: { guildId, guildName, online, botRole, manageRoles, membersError: string|null,
//                 total, roles: [Role], members: [Member] } }
//       Role = { id, name, color: "#rrggbb"|"", position }   highest first, without @everyone
//       Member = { id, name, username, avatarUrl: string|null, bot, joinedAt: ms|null,
//                  roleIds: [id] (highest first), rosters: [Roster], characters: [Char],
//                  missingRosters: [{ id, name }] }
//       Roster = { id, name, categoryId, versionId, status }  the open rosters the member is in
//       Char = { name, className: ""|class id, versionId: ""|version id, rosterIds: [id] }
//              once per version and name; rosterIds = the open rosters it stands in
//       missingRosters: rosters whose member or trial role the member holds without being in it
//       members by name; membersError set (and members empty) when the list cannot be had in
//       time; offline: online false and empty lists
//
// GET /api/discord/members/detail?guildId=&userId=
//     → { data: { ...head as above, gone?: true, member: Member|null, roles: [Role],
//                 channels: [{ id, name, visible, total, channels: [{ id, name, kind: "text"|"voice"|"forum" }] }] } }
//       channels: grouped by category in Discord's order (id "" = without category), only those
//       the member can see (ViewChannel); total counts every text, voice and forum channel
//       gone: true (member null) when the server is online but has no such member (left, or an
//       old link) — an answer, not an error
//       400 missing_user: no userId; 400 unknown_guild: a guildId outside the server list
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const serverMembers = require("../../services/discord/serverMembers");
const { serverFromQuery } = require("../http/serverQuery");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** GET /api/discord/members */
const listMembers = withUser(async ({ user, req, query, res }) => {
    const guildId = serverFromQuery(query, res, { user, req });
    if (guildId === null) return undefined;
    ok(res, await serverMembers.listServerMembers(guildId));
    return undefined;
});

/** GET /api/discord/members/detail */
const memberDetail = withUser(async ({ user, req, query, res }) => {
    const userId = str(query.get("userId"));
    if (!userId) return apiError(res, 400, "missing_user", "Welches Mitglied? Die userId fehlt.");
    const guildId = serverFromQuery(query, res, { user, req });
    if (guildId === null) return undefined;
    ok(res, await serverMembers.serverMemberDetail(guildId, userId));
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/discord/members", handler: listMembers, area: "channels" },
    { method: "GET", path: "/api/discord/members/detail", handler: memberDetail, area: "channels" },
];

module.exports = { routes };
