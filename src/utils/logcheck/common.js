const { logcheckRules } = require("./rules");

// The classes of TBC's rule set — the nine pre-Wrath classes every version so
// far shares. Kept for the callers outside the log check (character info, the
// WCL roster); the log check itself asks the report's rule set (selectPlayers).
const TBC_RULES = logcheckRules("tbc");
const VALID_CLASSES = TBC_RULES.classes;

/**
 * Player entries from a WCL table that are real raiders (a class of the rule
 * set, did something).
 * @param {object} table  a WCL table (`entries`)
 * @param {object} [rules]  the report's rule set (utils/logcheck/rules.js); TBC without one
 */
function selectPlayers(table, rules = TBC_RULES) {
    const classes = (rules && rules.classes) || VALID_CLASSES;
    return ((table && table.entries) || [])
        .filter((e) => classes.includes(e.type) && (e.total || 0) > 20)
        .sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
}

module.exports = { VALID_CLASSES, selectPlayers };
