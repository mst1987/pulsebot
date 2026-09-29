// Which bosses of a raid plan are down, which one is being fought, which one comes next (#534).
//
// Read from a Warcraft Logs v1 fight list (report/fights, `translate: true`): a boss fight has `boss` > 0,
// `kill` true/false once it is over and `inProgress` true while the live log is still writing it. Trash
// (`boss` 0) never counts. A fight is matched to a section of the plan by its encounter name folded with
// tbcContent's encounterKey() (opera bosses, "Reliquary of Souls", "Daakara"), and by the name WCL gives the
// encounter id: the Anniversary realms log offset ids (50601 = Naj'entus), which config/bosses.js'
// bossName() folds back — so a log whose fight names were not translated still finds its boss.
//
// Pure: no request, no clock. services/raidplan/raidplanProgress.js does the fetching and the caching.

const { encounterKey } = require("../../config/tbcContent");
const { bossName } = require("../../config/bosses");

/** The encounter keys a fight can stand for: its own name and WCL's name for its encounter id. */
function fightKeys(fight) {
    const keys = [];
    if (fight && fight.name) keys.push(encounterKey(fight.name));
    const wcl = fight ? bossName(fight.boss) : "";
    if (wcl) keys.push(encounterKey(wcl));
    return keys.filter(Boolean);
}

/** The section (`{ key, name, instanceId }`) a boss fight belongs to, or null (trash, another raid). */
function sectionForFight(fight, sections) {
    if (!fight || !(Number(fight.boss) > 0)) return null;
    const keys = fightKeys(fight);
    if (!keys.length) return null;
    return sections.find((s) => keys.includes(encounterKey(s.name))) || null;
}

/** A boss fight the live log is still writing: flagged `inProgress`, or without an outcome yet. */
function isRunning(fight) {
    return fight.inProgress === true || typeof fight.kill !== "boolean";
}

/**
 * The progress of a plan's bosses in a fight list.
 *
 * - `killed`: the section keys with a kill (`kill: true`), in the plan's order. A wipe changes nothing.
 * - `current`: the boss of the log's LAST fight while that fight is still running (live log), else null.
 * - `next`: the first boss not killed, in the plan's order, starting in the instance of the most recent
 *   boss pull — a raid that does BT before Hyjal while the plan lists Hyjal first is still followed through
 *   BT — and over all sections once that instance is cleared (or when nothing was pulled yet). null when
 *   every boss is down.
 *
 * @param {object|null} fights   the report/fights answer (`fights`)
 * @param {{key:string,name:string,instanceId:string}[]} sections   the plan's bosses in order (no trash, no "Allgemein")
 * @returns {{ killed: string[], current: string|null, next: string|null }}
 */
function deriveProgress(fights, sections) {
    const list = Array.isArray(sections) ? sections.filter((s) => s && s.key && s.name) : [];
    const all = (fights && Array.isArray(fights.fights)) ? fights.fights.filter(Boolean) : [];
    const killedKeys = new Set();
    let lastPulled = null;
    for (const f of all) {
        const section = sectionForFight(f, list);
        if (!section) continue;
        lastPulled = section;
        if (f.kill === true) killedKeys.add(section.key);
    }
    const last = all.length ? all[all.length - 1] : null;
    const lastSection = last ? sectionForFight(last, list) : null;
    const current = lastSection && isRunning(last) ? lastSection.key : null;

    const open = list.filter((s) => !killedKeys.has(s.key));
    const inAnchor = lastPulled ? open.find((s) => s.instanceId === lastPulled.instanceId) : null;
    const next = (inAnchor || open[0] || null);
    return {
        killed: list.filter((s) => killedKeys.has(s.key)).map((s) => s.key),
        current,
        next: next ? next.key : null,
    };
}

module.exports = { deriveProgress, sectionForFight, fightKeys, isRunning };
