// Which raid is meant? — version-aware recognition of raid content (#749).
//
// tbcContent.js knows TBC best (loot table, German names, title abbreviations)
// but knows nothing of other versions, and its patterns would claim them:
// "Hyjal Summit (Forever)" and the boss Archimonde read as TBC's Hyjal. This
// module sits in front: every lookup takes `{ versionId }` and searches only
// the instances of that version. TBC goes to tbcContent, every other version to
// its rule set (config/gameVersions: `zoneNames`, `bosses`, `bossHints`).
//
// Without a `versionId` the version is TBC (what every stored record without
// one is), except that a free text naming "Forever" belongs to Forever.
// Instance ids are unique across versions, so the ids this returns need no
// version to be read back (`gameVersions.instanceById`).

const tbcContent = require("./tbcContent");
const gameVersions = require("./gameVersions");

const TBC = "tbc";

function versionFor(opts, text) {
    const id = opts && opts.versionId;
    if (id) return gameVersions.rulesFor(id) ? id : TBC;
    return /\bforever\b/i.test(String(text || "")) ? "forever" : TBC;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does a free text name this (non-TBC) instance: a zone name, its name without "(…)", or its short as a word. */
function textNames(inst, lower) {
    const names = [...(inst.zoneNames || []), String(inst.name || "").replace(/\s*\(.*?\)\s*/g, " ").trim()]
        .map((n) => n.toLowerCase())
        .filter(Boolean);
    if (names.some((n) => lower.includes(n))) return true;
    const short = String(inst.short || "").trim().toLowerCase();
    return !!short && new RegExp(`(^|[^a-z0-9])${escapeRe(short)}([^a-z0-9]|$)`).test(lower);
}

/**
 * Every content a free text names, in the version's release order; [] when
 * nothing is recognised.
 * @param {string} text
 * @param {{ versionId?: string }} [opts]
 * @returns {string[]} instance ids of that version
 */
function contentsForText(text, opts) {
    const s = String(text || "").trim();
    if (!s) return [];
    const versionId = versionFor(opts, s);
    if (versionId === TBC) return tbcContent.contentsForText(s);
    const rules = gameVersions.rulesFor(versionId);
    const lower = s.toLowerCase();
    return rules.instances.filter((i) => textNames(i, lower)).map((i) => i.id);
}

/** The content id an instance string (a zone, an addon's instance) names within the version, or "". */
function contentForInstance(instance, opts) {
    const s = String(instance || "").trim();
    if (!s) return "";
    const versionId = versionFor(opts, s);
    if (versionId === TBC) return tbcContent.contentForInstance(s);
    return gameVersions.instanceForZone(s, versionId);
}

/** The content id a boss name belongs to within the version, or "". */
function contentForBoss(bossName, opts) {
    const versionId = versionFor(opts, "");
    if (versionId === TBC) return tbcContent.contentForBoss(bossName);
    return gameVersions.instanceForBoss(bossName, versionId);
}

/**
 * Where a loot row came from. Only TBC has an item table; another version is
 * placed by the export's instance string alone.
 * @returns {{ contentId: string, boss: string }}
 */
function contentForLoot(item, opts) {
    const it = item || {};
    const versionId = versionFor(opts, it.instance);
    if (versionId === TBC) return tbcContent.contentForLoot(it);
    return { contentId: contentForInstance(it.instance, { versionId }), boss: String(it.boss || "").trim() };
}

/** The drop-table entry of an item ({ content, boss }); only TBC has a table, else null. */
function sourceForItem(itemId, opts) {
    return versionFor(opts, "") === TBC ? tbcContent.sourceForItem(itemId) : null;
}

/** { id, label, short } of a content of any version, or null. */
function content(contentId) {
    const tbc = tbcContent.content(contentId);
    if (tbc) return tbc;
    const inst = gameVersions.instanceById(contentId);
    return inst ? { id: inst.id, label: inst.name, short: inst.short } : null;
}

/** The boss icon of a content of any version (rule set), or "". */
function iconOf(contentId) {
    return gameVersions.iconOf(contentId);
}

/** The contents of a version in release order: [{ id, label, short }]. */
function contentsOf(versionId) {
    const rules = gameVersions.rulesFor(versionId || TBC);
    return rules ? rules.instances.map((i) => ({ id: i.id, label: i.name, short: i.short })) : [];
}

// Which versions a raid could be from: its own, plus every other version that
// knows a raid of the same name or one of the same bosses. TBC's SSC is TBC
// only; TBC's Hyjal is also Forever's, Forever's Onyxia also Classic's. Read
// once per id, the rule sets do not change at run time.
const VERSIONS_OF_CONTENT = new Map();

/**
 * Every version a raid could be from, its own first; [] for an unknown id. A
 * log of a raid only one version has belongs to that version (logVersion.js).
 * @param {string} contentId
 * @returns {string[]} version ids
 */
function versionsOfContent(contentId) {
    const id = String(contentId || "");
    if (VERSIONS_OF_CONTENT.has(id)) return VERSIONS_OF_CONTENT.get(id);
    const inst = gameVersions.instanceById(id);
    let versions = [];
    if (inst) {
        const bosses = [...(inst.bosses || []), ...(inst.finalBossNames || []), ...(inst.bossHints || [])];
        const zones = [String(inst.name || "").replace(/s*(.*?)s*/g, " ").trim(), ...(inst.zoneNames || [])].filter(Boolean);
        const others = gameVersions.VERSIONS.map((v) => v.id).filter((v) => v !== inst.versionId
            && (bosses.some((b) => contentForBoss(b, { versionId: v })) || zones.some((z) => contentForInstance(z, { versionId: v }))));
        versions = [inst.versionId, ...others];
    }
    VERSIONS_OF_CONTENT.set(id, versions);
    return versions;
}

module.exports = {
    contentsForText, contentForInstance, contentForBoss, contentForLoot, sourceForItem,
    content, iconOf, contentsOf, versionsOfContent,
};
