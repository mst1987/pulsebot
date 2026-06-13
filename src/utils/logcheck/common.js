const VALID_CLASSES = ["Druid", "Hunter", "Mage", "Priest", "Paladin", "Rogue", "Shaman", "Warlock", "Warrior"];

/** Player entries from a WCL table that are real raiders (known class, did something). */
function selectPlayers(table) {
    return ((table && table.entries) || [])
        .filter((e) => VALID_CLASSES.includes(e.type) && (e.total || 0) > 20)
        .sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
}

module.exports = { VALID_CLASSES, selectPlayers };
