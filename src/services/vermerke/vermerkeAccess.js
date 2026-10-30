// Who may see the short form of the Vermerke (docs/vermerke.md, #981): the one rule for every answer that
// carries it - GET /api/vermerke/short, the setup editor, the raid detail, the roster and the Kaderplaner.
// An answer adds `vermerke` (or anything built from it, the setup's `shadowbanInPool`) only when this
// says yes; its own orga flag (`viewer.orga`, `isOrga`, a manager branch) or an area right (`kader`,
// `raids`) is never enough on its own - an Einzelkonto with `kader` read may stand in the pool itself.
//
// Yes for: the area "vermerke" (read), the global raid orga (orga rank with `raids` write, the rule of
// the setup editor) or a manager of a current roster on `guildId`. Never the person a note is about
// unless they are one of these (test/services/vermerke/vermerkeNeverToPerson.test.js), and never
// "Ansicht als Raider" (the user object then holds a raider's rights only).
const { userCan, userIsOrga } = require("../../config/permissions");
const categoryOrga = require("../roster/categoryOrga");

/**
 * Whether `user` may see the short form on `guildId`. `req` shares the Discord role lookup with the
 * gate of the same request (categoryOrga.requestCache); without it the lookup gets its own cache.
 * @returns {Promise<boolean>}
 */
async function maySeeShort(user, guildId, { req = null } = {}) {
    if (!user) return false;
    if (userCan(user, "vermerke", "read")) return true;
    if (userIsOrga(user) && userCan(user, "raids", "write")) return true;
    // a roster manager only on a named server: no server, no roster to manage
    if (!guildId) return false;
    return categoryOrga.isAnyCategoryManager(user, { cache: categoryOrga.requestCache(req), guildId: String(guildId) });
}

module.exports = { maySeeShort };
