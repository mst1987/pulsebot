// The "Standard" of a raid plan template (docs/raidplan.md): the tank and healer basics entered ONCE (the board `defaults` of the
// template) and inherited by every boss and trash section. A boss can deviate from a row (it gets its own copy, the default row is
// switched off for it: `board.inheritOff`) or switch a row off; applying the template to an event writes the inherited rows into
// each boss board (a snapshot, marked `origin: "default"`, editable per boss there). "Allgemein" is something else: the raid-wide
// utility rows (curses ...), one board for the whole raid.
//
// "Boss" as a target of a default row is relative: `THIS_BOSS` ("b:this") means the boss of the section it lands in. A mob target
// that the section does not have falls back to none (the row stays, without that target), never an error.

const DEFAULTS_KEY = "defaults";
const THIS_BOSS = "b:this";

const { str } = require("../utils/text");
const { newId } = require("../utils/ids");

/** The icon key of a boss image url (/bosses/601.jpg -> boss:601, an icon CDN url -> its name), "" for none. */
function bossIconKey(url) {
    const boss = str(url).match(/\/bosses\/(\d+)\.jpg/);
    if (boss) return `boss:${boss[1]}`;
    const wow = str(url).match(/\/icons\/[a-z]+\/([a-z0-9_'-]+)\.jpg/);
    return wow ? wow[1] : "";
}

/**
 * What a section offers as mob targets: the boss itself (a boss section), the mobs of the catalog that belong to it and the
 * mobs added to its board. `boss` is the entry of the boss list ({ key, name, iconUrl, trash, general }), `catalogMobs` the
 * catalog's mobs, `boardMobs` the mobs of the board.
 */
function sectionOf(boss, catalogMobs, boardMobs) {
    const isBoss = !boss.trash && !boss.general;
    const mobs = new Map();
    if (isBoss) mobs.set(`b:${boss.key}`, { id: `b:${boss.key}`, name: boss.name, icon: bossIconKey(boss.iconUrl) });
    for (const m of catalogMobs || []) {
        if (isBoss ? m.bossKey === boss.key : boss.trash && m.kind === "trash" && m.instanceId === boss.instanceId && !m.bossKey) mobs.set(m.id, { id: m.id, name: m.name, icon: m.icon || "" });
    }
    for (const m of boardMobs || []) mobs.set(m.id, { id: m.id, name: m.name, icon: m.icon || "" });
    return { isBoss, bossMob: isBoss ? mobs.get(`b:${boss.key}`) : null, mobs };
}

/** A default row as it lands in a section: the relative boss target becomes the section's boss, mob targets the section lacks are dropped. */
function resolveRow(row, section) {
    const targets = [];
    for (const tg of row.targets || []) {
        if (tg.kind !== "mob") { targets.push({ ...tg }); continue; }
        if (tg.ref === THIS_BOSS) {
            if (section.bossMob) targets.push({ kind: "mob", ref: section.bossMob.id, name: section.bossMob.name, icon: section.bossMob.icon });
        } else if (section.mobs.has(tg.ref)) {
            const m = section.mobs.get(tg.ref);
            // the instance number ("Flame of Azzinoth 2") goes along
            targets.push({ kind: "mob", ref: m.id, name: m.name, icon: m.icon, ...(tg.n ? { n: tg.n } : {}) });
        }
    }
    return { ...row, targets, origin: row.id };
}

/** The rows a section inherits: every default row that is not switched off for it (`off`), resolved; ids stay the default's. */
function inheritedRows(defaultRows, off, section) {
    const skip = new Set(off || []);
    return (defaultRows || []).filter((r) => !skip.has(r.id)).map((r) => resolveRow(r, section));
}

/**
 * The rows of a section for an event plan: the inherited ones (fresh ids, `origin: "default"`, not a suggestion) first, then the
 * section's own rows. Used when a template is applied.
 */
function effectiveRows(defaultRows, boardObj, section) {
    // `_key`: the id the row had in the template, so the positions of what it puts on the map (autoPos) move to the new id (raidplanBoard.reidBoard)
    const inherited = inheritedRows(defaultRows, boardObj && boardObj.inheritOff, section).map((r) => ({ ...r, _key: r.id, id: newId(5), origin: "default", suggested: false }));
    return [...inherited, ...((boardObj && boardObj.assignments) || [])];
}

module.exports = { DEFAULTS_KEY, THIS_BOSS, bossIconKey, sectionOf, resolveRow, inheritedRows, effectiveRows };
