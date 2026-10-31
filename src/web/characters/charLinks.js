// Where to look a character up outside the bot: the armory and their Warcraft
// Logs page.
//
// Both are URL templates with a {char} placeholder, set per game version in
// Einstellungen → Spielversion (#542, services/versions/versionSettings.js), so a
// TBC character links the TBC armory and a Forever one the Forever armory — or
// nothing while that version has no template. Three pages hand them out — the
// roster, the character history and the loot council — which is one more than
// a copied one-liner should live in.
//
// The armory link matters most where the bot shows gear it derived itself: it
// is *last seen in a log*, not live, and a council arguing over a drop wants to
// be able to check that in one click rather than trust it.

const { versionLinks } = require("../../services/versions/versionSettings");

/**
 * The armory page of a character, or "" when its version has no template.
 * @param {string} character
 * @param {string} [versionId] the character's version (#543); default the main version
 * @param {string} [guildId] the server the page is shown for (#923): its own
 *   realm/templates win over the version's standard; "" = the standard only
 */
function armoryUrlFor(character, versionId, guildId) {
    return versionLinks(versionId, { guildId }).armory(character);
}

/** The Warcraft-Logs page of a character, or "" (version and server as in armoryUrlFor). */
function wclUrlFor(character, versionId, guildId) {
    return versionLinks(versionId, { guildId }).wcl(character);
}

module.exports = { armoryUrlFor, wclUrlFor };
