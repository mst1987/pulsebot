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

const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../../config/variables");

/** Fill a {char} template for a character name. "" when no template is set. */
function fillCharTemplate(tpl, character) {
    const name = String(character || "").trim();
    if (!tpl || !name) return "";
    return String(tpl).replace("{char}", encodeURIComponent(name));
}

/**
 * The link templates of a game version (#543): where a character of that
 * version is looked up. The one place that asks per version — the settings per
 * version (#542) plug in here; until a version has its own, every version uses
 * the configured templates, as before.
 * @param {string} [_versionId]  the character's version ("" = TBC / the configured one)
 * @returns {{ armory: string, wcl: string }}
 */
function linkTemplatesFor(_versionId = "") {
    return { armory: applyArmoryUrlTemplate || "", wcl: applyWclUrlTemplate || "" };
}

/** The armory page of a character (of `versionId`), or "" when no template is configured. */
function armoryUrlFor(character, versionId = "") {
    return fillCharTemplate(linkTemplatesFor(versionId).armory, character);
}

/** The Warcraft-Logs page of a character (of `versionId`), or "". */
function wclUrlFor(character, versionId = "") {
    return fillCharTemplate(linkTemplatesFor(versionId).wcl, character);
}

module.exports = { fillCharTemplate, linkTemplatesFor, armoryUrlFor, wclUrlFor };
