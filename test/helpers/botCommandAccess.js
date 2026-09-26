// Drives the real access rules (services/discord/botAccess.js) for one command module, the
// way bot.js's guard resolves them: a plain member without roles, no stored
// setting unless one is passed.
const { resolveBotAccess } = require("../../src/services/discord/botAccess");

/** Whether a member without any role may run `command` (optionally with a stored config). */
function memberMayRun(command, config = {}, member = { id: "member-without-roles", roleIds: [] }) {
    return resolveBotAccess(command.name, member, { commands: [command], config }).allowed;
}

module.exports = { memberMayRun };
