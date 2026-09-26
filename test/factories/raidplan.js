// Fixture factories for the raid plan suites (#433): a raw board as the client
// sends it, an icon on the map, a roster person.
//
//   const { board, icon, person } = require("../factories/raidplan");
//   cleanBoard(board({ icons: [icon({ x: 0.2 })] }));

/** A raw, empty board: every list the editor sends, empty. */
function board(over = {}) {
    return {
        tokens: [],
        slots: [],
        marks: [],
        zones: [],
        targets: [],
        icons: [],
        notes: "",
        ...over,
    };
}

/** An icon on the map: the boss portrait in the middle. */
function icon(over = {}) {
    return { iconKey: "boss:609", x: 0.5, y: 0.5, ...over };
}

/** A roster person: who, as which class/role, in which group. `over` adds character/spec. */
function person(over = {}) {
    return { userId: "u1", classId: "warrior", role: "tank", group: 1, ...over };
}

module.exports = { board, icon, person };
