// Which TBC raid a looted item came from.
//
// The loot exports are unequal: RCLootcouncil names the instance and the boss,
// Gargul carries nothing but the item id. So the item id has to be the primary
// key — the RAID_LOOT table maps every raid drop of the expansion to its
// content and its encounter. It is generated from AtlasLootClassic's TBC data
// by `node scripts/fetch-tbc-loot.js` into config/generated/tbcRaidLoot.json;
// regenerate it instead of hand-editing the JSON. This file is the hand-written
// part: content metadata and the lookups.
//
// Two boss values are not an NPC and mean what they say: "Trash" for the drops
// that come off trash rather than a kill, and "" for the handful of items no
// single encounter can be pinned on (Badge of Justice drops from every boss of
// its raid). Items that drop in *several* raids are left out of the table
// altogether, so they fall back to the instance string instead of being filed
// into whichever raid happened to come first.
//
// The export's own instance/boss strings are only the fallback for ids the
// table doesn't know (a world drop, a badge item, a future patch) — see
// contentForLoot().

// A raid tier groups the contents released together: the Tier-4/5/6 filter on
// the item list is exactly "everything from these raids". Zul'Aman shipped
// between T5 and T6 and drops no tier token of its own; it is filed under t5,
// where its item level and its raid week put it.
const TIERS = [
    { id: "t4", label: "Tier 4" },
    { id: "t5", label: "Tier 5" },
    { id: "t6", label: "Tier 6" },
    { id: "t65", label: "Sunwell" },
];

// `short` is what fits in a table badge, `label` what a filter dropdown shows.
// `zoneId` is the Wowhead zone the loot table was generated from.
const CONTENTS = [
    { id: "kara", label: "Karazhan", short: "Kara", tier: "t4", zoneId: 3457 },
    { id: "gruul", label: "Gruuls Unterschlupf", short: "Gruul", tier: "t4", zoneId: 3923 },
    { id: "mag", label: "Magtheridons Kammer", short: "Magtheridon", tier: "t4", zoneId: 3836 },
    { id: "ssc", label: "Höhle des Schlangenschreins", short: "SSC", tier: "t5", zoneId: 3607 },
    { id: "tk", label: "Festung der Stürme — Das Auge", short: "TK", tier: "t5", zoneId: 3845 },
    { id: "za", label: "Zul'Aman", short: "ZA", tier: "t5", zoneId: 3805 },
    { id: "hyjal", label: "Hyjalgipfel", short: "Hyjal", tier: "t6", zoneId: 3606 },
    { id: "bt", label: "Der Schwarze Tempel", short: "BT", tier: "t6", zoneId: 3959 },
    { id: "swp", label: "Sonnenbrunnenplateau", short: "SWP", tier: "t65", zoneId: 4075 },
];

// Instance names as the loot addons write them, so RCLootcouncil rows for items
// outside the table (trash, badge gear) still land in the right content.
// English and German client strings both appear in the wild — the German
// clients are what most of the guild plays, RCLootcouncil forwards whatever the
// client reported. Matched case-insensitively against the raw instance string,
// which usually looks like "Serpentshrine Cavern-25 Player".
const INSTANCE_PATTERNS = [
    { content: "kara", re: /karazhan/i },
    { content: "gruul", re: /gruul/i },
    { content: "mag", re: /magtheridon/i },
    { content: "ssc", re: /serpentshrine|schlangenschrein/i },
    { content: "tk", re: /tempest keep|the eye|festung der stürme|das auge/i },
    { content: "za", re: /zul'?aman/i },
    { content: "hyjal", re: /hyjal/i },
    { content: "bt", re: /black temple|schwarze[rn]? tempel/i },
    { content: "swp", re: /sunwell|sonnenbrunnen/i },
];

// The boss a raid night is *over* with — what the logcheck guard looks for
// before it lets an evaluation run (see utils/logcheck/raidProgress.js).
// Matched against the encounter names Warcraft Logs reports, which arrive in
// English or German depending on the client the log came from, so both are
// listed.
//
// Karazhan is the one raid whose final boss is not its last encounter:
// Nightbane is optional and regularly skipped, so Prince Malchezaar is what
// ends the night. Where more than one name is listed, any one of them killed
// counts as done.
const FINAL_BOSSES = {
    kara: ["Prince Malchezaar", "Prinz Malchezaar"],
    gruul: ["Gruul the Dragonkiller", "Gruul der Drachentöter"],
    mag: ["Magtheridon"],
    ssc: ["Lady Vashj", "Fürstin Vashj"],
    tk: ["Kael'thas Sunstrider", "Kael'thas Sonnenwanderer"],
    za: ["Zul'jin"],
    hyjal: ["Archimonde"],
    bt: ["Illidan Stormrage", "Illidan Sturmgrimm"],
    swp: ["Kil'jaeden"],
};

// The order the encounters are actually met in, per raid. The pick list behind
// "Item nachtragen" is read top-down by someone who was just in there, and
// alphabetical order is no help to them: it puts Gurtogg Bloodboil in front of
// the Black Temple's first boss and Archimonde second in Hyjal.
//
// Hand-kept, unlike RAID_LOOT — the generator knows what drops where, not
// in which order the raid meets it. The names must match RAID_LOOT's English
// encounter keys exactly; test/config/tbcContent.test.js checks that they do and
// that no boss is missing here.
//
// Karazhan's three opera bosses follow their event (only one of them is up on a
// given night), its three rare trash spawns come after the last encounter.
const BOSS_ORDER = {
    kara: [
        "Attumen the Huntsman", "Moroes", "Maiden of Virtue",
        "Opera Event", "The Wizard of Oz", "The Big Bad Wolf", "Romulo and Julianne",
        "The Curator", "Terestian Illhoof", "Shade of Aran", "Netherspite", "Chess Event",
        "Prince Malchezaar", "Nightbane",
        "Hyakiss the Lurker", "Shadikith the Glider", "Rokad the Ravager",
    ],
    gruul: ["High King Maulgar", "Gruul the Dragonkiller"],
    mag: ["Magtheridon"],
    ssc: [
        "Hydross the Unstable", "The Lurker Below", "Leotheras the Blind",
        "Fathom-Lord Karathress", "Morogrim Tidewalker", "Lady Vashj",
    ],
    tk: ["Al'ar", "Void Reaver", "High Astromancer Solarian", "Kael'thas Sunstrider"],
    za: ["Nalorakk", "Akil'zon", "Jan'alai", "Halazzi", "Hex Lord Malacrass", "Zul'jin"],
    hyjal: ["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor", "Archimonde"],
    bt: [
        "High Warlord Naj'entus", "Supremus", "Shade of Akama", "Teron Gorefiend",
        "Gurtogg Bloodboil", "Reliquary of the Lost", "Mother Shahraz",
        "The Illidari Council", "Illidan Stormrage",
    ],
    swp: ["Kalecgos", "Brutallus", "Felmyst", "Eredar Twins", "M'uru", "Kil'jaeden"],
};

// Buckets in RAID_LOOT that are not an encounter: Zul'Aman's timed-run reward,
// trash drops, and the nameless one (an item no single kill can be pinned on).
// They sort after every boss, in this order.
const NON_BOSSES = ["Timed Chest", "Trash", ""];

// Room between a raid's last boss (< 100) and the non-encounter buckets, so a
// boss this table does not know yet — a freshly generated RAID_LOOT key — lands
// after the known ones but still ahead of the trash.
const UNKNOWN_BOSS_RANK = 100;
const NON_BOSS_RANK = 200;

/**
 * Where a boss stands in its raid: lower is earlier. Unknown encounters sort
 * after the known ones, trash and its like last of all.
 * @param {string} contentId
 * @param {string} boss
 * @returns {number}
 */
function bossOrder(contentId, boss) {
    const name = boss === null || boss === undefined ? "" : String(boss);
    const special = NON_BOSSES.indexOf(name);
    if (special !== -1) return NON_BOSS_RANK + special;
    const order = BOSS_ORDER[String(contentId || "")] || [];
    const at = order.indexOf(name);
    return at === -1 ? UNKNOWN_BOSS_RANK : at;
}

const RAID_LOOT = require("./generated/tbcRaidLoot.json");

// item id → { content, boss } and content id → meta, both built once at require
// time. RAID_LOOT is keyed the other way round because that is the shape the
// generator can write readably; every lookup wants the reverse.
const ITEM_SOURCE = new Map();
for (const [content, byBoss] of Object.entries(RAID_LOOT)) {
    for (const [boss, ids] of Object.entries(byBoss)) {
        for (const id of ids) ITEM_SOURCE.set(id, { content, boss });
    }
}
const CONTENT_BY_ID = new Map(CONTENTS.map((c) => [c.id, c]));
const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));

/** The content meta for an id, or null. */
function content(contentId) {
    return CONTENT_BY_ID.get(String(contentId || "")) || null;
}

/** What the generated table knows about an item id: { content, boss } or null. */
function sourceForItem(itemId) {
    const id = Number(itemId) || 0;
    return id ? (ITEM_SOURCE.get(id) || null) : null;
}

/** The content id an instance string names, or "". */
function contentForInstance(instance) {
    const s = String(instance || "").trim();
    if (!s) return "";
    const hit = INSTANCE_PATTERNS.find((p) => p.re.test(s));
    return hit ? hit.content : "";
}

// What a raid night is called in a Raid-Helper title, which is not what an
// addon writes into an export: nobody names an event "Serpentshrine Cavern-25
// Player", they write "SSC/TK" or "Hyjal + BT". Kept apart from
// INSTANCE_PATTERNS on purpose — these abbreviations are short enough to hit
// inside an unrelated word ("BT" in "Debt", "ZA" in "Zangarmarschen"), so they
// only ever match on word boundaries.
const TITLE_PATTERNS = [
    { content: "kara", re: /\bkara\b|\bkz\b/i },
    { content: "gruul", re: /\bgruul\b|\bhdz\b/i },
    { content: "mag", re: /\bmag(theridon)?\b/i },
    { content: "ssc", re: /\bssc\b|\bhds\b/i },
    { content: "tk", re: /\btk\b|\bfds\b/i },
    { content: "za", re: /\bza\b/i },
    { content: "hyjal", re: /\bmh\b|\bhyjal\b/i },
    { content: "bt", re: /\bbt\b|\bswt\b/i },
    { content: "swp", re: /\bswp\b|\bsunwell\b|\bsonnenbrunnen\b/i },
];

/**
 * Every content a free text names, in CONTENTS order — "SSC + TK" is two raids,
 * and answering with one of them would be a wrong answer (TBC nights routinely
 * combine raids, the same reason lootSessionContent.js may name more than one).
 * Matches both the full instance names an export writes and the abbreviations
 * an event title uses. Returns [] when nothing is recognised, so a caller can
 * offer everything instead of a guess.
 * @param {string} text
 * @returns {string[]} content ids
 */
function contentsForText(text) {
    const s = String(text || "").trim();
    if (!s) return [];
    const hits = new Set();
    for (const p of [...INSTANCE_PATTERNS, ...TITLE_PATTERNS]) {
        if (p.re.test(s)) hits.add(p.content);
    }
    return CONTENTS.map((c) => c.id).filter((id) => hits.has(id));
}

/**
 * Where a loot row came from: the item table first (works for every source,
 * including Gargul's id-only rows), the export's instance string second.
 * Returns { contentId, boss } with "" for whatever could not be resolved —
 * unknown items are shown as such rather than guessed into a raid.
 *
 * The boss follows the same order, and deliberately so: RCLootcouncil's `boss`
 * is the encounter that was current when the item was *awarded*, not where it
 * dropped. Anything handed out later — from the bag, from the bank, a re-roll
 * after the next pull — carries the wrong boss, which is why a whole raid night
 * can end up filed under its last kill. The item id is unambiguous, so the
 * table wins, including when it says "Trash": a trash drop handed out during
 * the Vashj pull is a trash drop, not a Vashj drop. The export's string is only
 * the fallback for ids the table cannot place (badge gear, a BoE that drops in
 * several raids, a world drop, a future patch).
 */
function contentForLoot(item) {
    const it = item || {};
    const known = sourceForItem(it.itemId);
    const contentId = known ? known.content : contentForInstance(it.instance);
    return { contentId, boss: (known && known.boss) || String(it.boss || "").trim() };
}

// The tier tokens ("Chestguard of the Fallen Champion", "Helm der siegreichen
// …") are what actually drops — the set piece itself is traded from a vendor
// and never shows up in a loot export. Matching the token lets the item list
// answer "who got tier?" without a second table. The three token adjectives are
// one per tier: Fallen = T4, Vanquished = T5, Forgotten = T6 (Sunwell's
// Sunmote-upgraded pieces reuse the T6 tokens).
const TOKEN_TIERS = [
    { tier: "t4", re: /\bfallen\b|\bgefallen/i },
    { tier: "t5", re: /\bvanquished\b|besiegt/i },
    { tier: "t6", re: /\bforgotten\b|vergessen/i },
];
const TOKEN_CLASSES = /champion|defender|hero|conqueror|protector|vanquisher|verteidiger|held|eroberer|beschützer|bezwinger/i;

/**
 * The tier a set token belongs to ("t4"/"t5"/"t6"), or "" for anything that is
 * not a token. Name-based, because that is all a loot row carries; both the
 * English and the German item names are matched.
 */
function tokenTier(itemName) {
    const name = String(itemName || "");
    if (!name || !TOKEN_CLASSES.test(name)) return "";
    const hit = TOKEN_TIERS.find((t) => t.re.test(name));
    return hit ? hit.tier : "";
}

/** The accepted final-boss names of a raid, or [] when the raid has none listed. */
function finalBossesFor(contentId) {
    return FINAL_BOSSES[String(contentId || "")] || [];
}

/**
 * The content id a boss name belongs to, or "". Uses the generated loot table,
 * whose keys are the English encounter names, plus the final-boss list, which
 * also carries the German ones.
 */
function contentForBoss(bossName) {
    const name = normalizeBoss(bossName);
    if (!name) return "";
    return BOSS_CONTENT.get(name) || "";
}

/** Encounter names differ in case, punctuation and stray whitespace between clients. */
function normalizeBoss(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");
}

// Encounters that are not a boss of their own on the count a raid lead keeps
// ("Kara 11/11"): Karazhan's opera bosses are one encounter — only one of them
// is up on a night — and its three rare trash spawns are no encounter at all.
// Lives here rather than in utils/logcheck/raidProgress.js because the game
// version rule set (config/gameVersions/tbc.js) lists the same encounters.
const OPERA = ["The Wizard of Oz", "The Big Bad Wolf", "Romulo and Julianne", "Opera Hall"];
const NOT_COUNTED = new Set(["Hyakiss the Lurker", "Shadikith the Glider", "Rokad the Ravager", ...OPERA].map(normalizeBoss));

/** The encounters a raid is counted by, in the order they are met. */
function encountersFor(contentId) {
    return (BOSS_ORDER[contentId] || []).filter((name) => !NOT_COUNTED.has(normalizeBoss(name)));
}

/** A boss name folded onto the encounter it counts as (an opera boss → "Opera Event"). */
function encounterKey(name) {
    const key = normalizeBoss(name);
    return OPERA.map(normalizeBoss).includes(key) ? normalizeBoss("Opera Event") : key;
}

const BOSS_CONTENT = new Map();
for (const [contentId, byBoss] of Object.entries(RAID_LOOT)) {
    for (const boss of Object.keys(byBoss)) BOSS_CONTENT.set(normalizeBoss(boss), contentId);
}
for (const [contentId, names] of Object.entries(FINAL_BOSSES)) {
    for (const name of names) BOSS_CONTENT.set(normalizeBoss(name), contentId);
}

module.exports = {
    TIERS, CONTENTS, RAID_LOOT, FINAL_BOSSES, BOSS_ORDER, NON_BOSSES,
    content, sourceForItem, contentForInstance, contentsForText, contentForLoot, tokenTier,
    finalBossesFor, contentForBoss, normalizeBoss, bossOrder, encountersFor, encounterKey,
    tier: (id) => TIER_BY_ID.get(String(id || "")) || null,
};
