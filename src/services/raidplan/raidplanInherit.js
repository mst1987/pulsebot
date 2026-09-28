// The "Standard" of a raid plan template AND of an event plan (docs/raidplan.md, #524): the tank and healer basics entered ONCE (the
// board `defaults`) and inherited by every boss and trash section. A boss can deviate from a row (it gets its own copy, the default row
// is switched off for it: `board.inheritOff`) or switch a row off. Applying a template to an event writes the template's Standard into
// the event's Standard, where it stays inherited: a change there reaches every boss that did not deviate. An event plan from before
// #524 holds copies marked `origin: "default"` in each boss; raidplanDefaultsMigration.js turns them into the Standard once. "Allgemein"
// is something else: the raid-wide utility rows (curses ...), one board for the whole raid.
//
// "Boss" as a target of a default row is relative: `THIS_BOSS` ("b:this") means the boss of the section it lands in. A mob target
// that the section does not have falls back to none (the row stays, without that target), never an error.

const DEFAULTS_KEY = "defaults";
const GENERAL_KEY = "general";
const THIS_BOSS = "b:this";

const { str } = require("../../utils/text");

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

/** Whether a section inherits the Standard: every boss and trash section, not "Allgemein" (the raid-wide rows) and not the Standard itself. */
function inherits(key) {
    return key !== DEFAULTS_KEY && key !== GENERAL_KEY;
}

/**
 * The rows a section really has (#524): the Standard's rows in the Standard's order - resolved for the section, a row the section
 * deviated from replaced by its own copy at the same place, a row it switched off left out - then the section's other own rows in their
 * order. Inherited rows keep the Standard's id (`origin` = that id, so a moved tank keeps its place: raidplanBoard.rowKey). The client's
 * twin is `mergeInherited` in lib/raidplan/inherit.ts (the same cases run on both).
 */
function mergeRows(defaultRows, boardObj, section) {
    const own = (boardObj && boardObj.assignments) || [];
    const off = new Set((boardObj && boardObj.inheritOff) || []);
    const used = new Set();
    const out = [];
    for (const d of defaultRows || []) {
        if (!off.has(d.id)) { out.push({ ...resolveRow(d, section), suggested: false }); continue; }
        const dev = own.find((a) => a.origin === d.id && !used.has(a));
        if (dev) { used.add(dev); out.push(dev); }
    }
    for (const a of own) if (!used.has(a)) out.push(a);
    return out;
}

/**
 * The EFFECTIVE rows of one section of a plan or a template (`bosses` = its boards, `section` = sectionOf): own + inherited from the
 * Standard (`mergeRows`); "Allgemein" and the Standard have only their own. Everything that reads the rows of a section (the read view,
 * "Meine Aufgaben", the auto tokens and lines, the suggestions) goes through here or its client twin.
 */
function effectiveRows(bosses, key, section) {
    const all = bosses || {};
    const b = all[key] || {};
    if (!inherits(key)) return (b.assignments || []).slice();
    return mergeRows((all[DEFAULTS_KEY] || {}).assignments || [], b, section);
}

module.exports = { DEFAULTS_KEY, GENERAL_KEY, THIS_BOSS, bossIconKey, sectionOf, resolveRow, inheritedRows, inherits, mergeRows, effectiveRows };
