// Where to look a character up outside the bot: the armory and their Warcraft
// Logs page.
//
// Both are URL templates with a {char} placeholder (config/variables.js), so a
// guild on another realm sets them once in the environment instead of the links
// being wrong everywhere. Three pages hand them out — the roster, the character
// history and the loot council — which is one more than a copied one-liner
// should live in.
//
// The armory link matters most where the bot shows gear it derived itself: it
// is *last seen in a log*, not live, and a council arguing over a drop wants to
// be able to check that in one click rather than trust it.

const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../config/variables");

/** Fill a {char} template for a character name. "" when no template is set. */
function fillCharTemplate(tpl, character) {
    const name = String(character || "").trim();
    if (!tpl || !name) return "";
    return String(tpl).replace("{char}", encodeURIComponent(name));
}

/** The armory page of a character, or "" when no template is configured. */
function armoryUrlFor(character) {
    return fillCharTemplate(applyArmoryUrlTemplate, character);
}

/** The Warcraft-Logs page of a character, or "". */
function wclUrlFor(character) {
    return fillCharTemplate(applyWclUrlTemplate, character);
}

module.exports = { fillCharTemplate, armoryUrlFor, wclUrlFor };
