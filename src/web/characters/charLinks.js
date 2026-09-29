// Where to look a character up outside the bot: the armory and their Warcraft
// Logs page.
//
// Both are URL templates with a {char} placeholder, set per game version in
// Einstellungen → Spielversion (#542, services/events/versionSettings.js), so a
// TBC character links the TBC armory and a Forever one the Forever armory — or
// nothing while that version has no template. Three pages hand them out — the
// roster, the character history and the loot council — which is one more than
// a copied one-liner should live in.
//
// The armory link matters most where the bot shows gear it derived itself: it
// is *last seen in a log*, not live, and a council arguing over a drop wants to
// be able to check that in one click rather than trust it.

const { fillChar, versionLinks } = require("../../services/events/versionSettings");

/** Fill a {char} template for a character name. "" when no template is set (or the link would not work). */
function fillCharTemplate(tpl, character) {
    return fillChar(tpl, character);
}

/**
 * The armory page of a character, or "" when its version has no template.
 * @param {string} character
 * @param {string} [versionId] the character's version (#543); default the main version
 */
function armoryUrlFor(character, versionId) {
    return versionLinks(versionId).armory(character);
}

/** The Warcraft-Logs page of a character, or "" (version as in armoryUrlFor). */
function wclUrlFor(character, versionId) {
    return versionLinks(versionId).wcl(character);
}

module.exports = { fillCharTemplate, armoryUrlFor, wclUrlFor };
