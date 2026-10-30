// Whose Discord roles the raider's lists of raids ("Für dich", "Anmeldungen")
// are computed with.
//
//   * "Ansicht als Rolle" (viewAs.js): the roles being looked at — the preview
//     shows what a member holding exactly those roles sees, not what the
//     admin's own roles open (`viewAs: true`);
//   * else the member's own roles on the server (memberRoleMemory: read live,
//     a short memory over a Discord hiccup); `unknown: true` when they cannot
//     be read at all.
const { memberRolesRemembered } = require("../../services/discord/roles/memberRoleMemory");

/**
 * @param {string} guildId  the server the raids are on
 * @param {{ id: string, viewAs?: { roleIds: string[] } }} user  auth.getUser()'s user
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ roleIds: string[]|null, viewAs: boolean, unknown: boolean }>}
 */
async function viewerRoles(guildId, user, { now = Date.now() } = {}) {
    if (user && user.viewAs && Array.isArray(user.viewAs.roleIds)) {
        return { roleIds: user.viewAs.roleIds.map(String), viewAs: true, unknown: false };
    }
    const { roleIds } = await memberRolesRemembered(guildId, user && user.id, { now });
    return { roleIds, viewAs: false, unknown: roleIds === null };
}

module.exports = { viewerRoles };
