// Fixture factories for the Warcraft Logs side of the logcheck suites (#433).
//
//   const { makeWcl, fight, GRUUL, fights } = require("../../factories/wcl");
//   const wcl = makeWcl({ getCasts: jest.fn(async () => table) });
//
// makeWcl() answers every table of src/classes/warcraftlogs.js with
// empty-but-valid data, so an analyzer touching a table the test does not care
// about still runs; a test replaces the ones it steers.

/** A WCL client double: every method a jest.fn with an empty answer, `over` replaces. */
function makeWcl(over = {}) {
    const table = () => jest.fn(async () => ({ entries: [] }));
    return {
        getFights: jest.fn(async () => ({ end: 0, fights: [], friendlies: [], enemies: [] })),
        getSummary: jest.fn(async () => ({ composition: [], playerDetails: { dps: [], healers: [], tanks: [] } })),
        getCasts: table(),
        getBuffs: jest.fn(async () => ({ auras: [] })),
        getDebuffs: jest.fn(async () => ({ auras: [] })),
        getDamageTaken: table(),
        getDamageDone: table(),
        getHealing: table(),
        getDeaths: table(),
        getInterrupts: table(),
        getEvents: jest.fn(async () => ({ events: [] })),
        getAllEvents: jest.fn(async () => []),
        getParses: jest.fn(async () => []),
        ...over,
    };
}

/** A boss fight: Gruul, killed, two minutes from 300000 on (report-relative ms). */
function fight(over = {}) {
    return {
        id: 3,
        boss: 650,
        name: "Gruul the Dragonkiller",
        kill: true,
        start_time: 300000,
        end_time: 420000,
        ...over,
    };
}

/** The Gruul kill most analyzer suites share. */
const GRUUL = Object.freeze(fight());

/**
 * A report's fight list `{ end, fights }`: `n` boss pulls of 900 ms each, 100
 * ms apart, ids 1..n, bosses 600, 601, ... . With `wipes`, the first `wipes`
 * pulls are wipes (kill false) on one boss and the next pull kills it; every
 * pull then carries `kill`.
 */
function fights(n, { wipes, length = 900, gap = 100 } = {}) {
    const list = Array.from({ length: n }, (_, i) => {
        const f = { id: i + 1, boss: 600 + i, name: `Boss ${i + 1}`, start_time: i * (length + gap), end_time: i * (length + gap) + length };
        if (wipes !== undefined) {
            f.kill = i >= wipes;
            if (i <= wipes) Object.assign(f, { boss: 600, name: "Boss 1" });
        }
        return f;
    });
    return { end: list.length ? list[list.length - 1].end_time : 0, fights: list };
}

module.exports = { makeWcl, fight, GRUUL, fights };
