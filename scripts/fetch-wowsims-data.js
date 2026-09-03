#!/usr/bin/env node
// Generates everything the loot council needs out of WoWSims-TBC (wowsims/tbc-new, MIT):
//
//   src/config/wowsims/items.json      — the raid-relevant slice of the item DB
//                                        (stats, slot, sockets, weapon), by item id
//   src/config/wowsims/bisSets.json    — the BiS gear sets per spec and phase
//   src/config/wowsims/apls/*.json     — the ground-truth rotations, verbatim
//
// Run it to refresh those files; do NOT hand-edit them (same rule as the
// RAID_LOOT block in config/tbcContent.js):
//
//   node scripts/fetch-wowsims-data.js
//
// ── Two pinned versions, on purpose ──────────────────────────────────────────
// SIM_VERSION is the release the *binary* and the *rotations* come from. The
// protojson schema, the APL fields and the embedded item DB all hang together
// at that version, so it moves as one — it is the same pin the sim engine uses
// (src/utils/wowsims/engine.js) and the fetch script for the binary.
//
// BIS_VERSION may run ahead of it, and here does: a gear set is nothing but a
// list of item/enchant/gem ids, which no proto change touches, and the newer
// release simply carries more of them (an Arcane-Mage T6 set, which v0.0.97
// does not have at all — and T6 is what the guild raids). Item and enchant ids
// are game data, so the newer sets are correct against the older binary.
const fs = require("fs");
const path = require("path");
const https = require("https");

const REPO = "wowsims/tbc-new";
const SIM_VERSION = "v0.0.97";
const BIS_VERSION = "v0.0.126";

// The tables land as JSON next to the module that reads them (index.js), not as
// generated JavaScript: 3000 items are ~650 KB, which as a JS literal would be
// one unreadable line for ESLint to walk and for every diff to re-print.
const OUT_DIR = path.join(__dirname, "..", "src", "config", "wowsims");
const APL_DIR = path.join(OUT_DIR, "apls");

// Which gear set files are the BiS list for a spec, newest phase last. WoWSims
// names them per class, not per scheme: the warlock files are named after the
// tier, the mage's after the phase plus the weapon choice. Only sets meant as
// "the best you can wear in that raid tier" are listed — a `simtest`, a
// `blank` or a per-boss resistance set is not a BiS list.
//
// `tier` is our own tier id (config/tbcContent.js's TIERS), so a set lines up
// with the content filter on the page: t4 = Kara/Gruul/Mag, t5 = SSC/TK/ZA,
// t6 = Hyjal/BT, t65 = Sunwell.
const BIS_FILES = {
    "Priest-Shadow": [
        { tier: "t4", file: "ui/priest/dps/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/priest/dps/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/priest/dps/gear_sets/p3.gear.json" },
    ],
    "Mage-Arcane": [
        { tier: "t4", file: "ui/mage/dps/gear_sets/p1Arcane.gear.json" },
        { tier: "t5", file: "ui/mage/dps/gear_sets/p2Arcane.gear.json" },
        { tier: "t6", file: "ui/mage/dps/gear_sets/p3ArcaneStaff.gear.json" },
    ],
    "Warlock-Destruction": [
        { tier: "t4", file: "ui/warlock/dps/gear_sets/t4.gear.json" },
        { tier: "t5", file: "ui/warlock/dps/gear_sets/t5.gear.json" },
        { tier: "t6", file: "ui/warlock/dps/gear_sets/t6.gear.json" },
        { tier: "t65", file: "ui/warlock/dps/gear_sets/swp.gear.json" },
    ],
    "Druid-Balance": [
        { tier: "t4", file: "ui/druid/balance/gear_sets/p1_a.gear.json" },
        { tier: "t5", file: "ui/druid/balance/gear_sets/p2_a.gear.json" },
        { tier: "t6", file: "ui/druid/balance/gear_sets/p3.gear.json" },
        // p5, nicht p4: p4 ist die ZA-Phase (medianes Itemlevel 141), Sunwell
        // steht in p5 (154). Stand vorher falsch hier.
        { tier: "t65", file: "ui/druid/balance/gear_sets/p5.gear.json" },
    ],
    "Shaman-Elemental": [
        { tier: "t4", file: "ui/shaman/elemental/gear_sets/p1_a.gear.json" },
        { tier: "t5", file: "ui/shaman/elemental/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/shaman/elemental/gear_sets/p3.gear.json" },
        // p5 aus demselben Grund wie beim Druiden oben.
        { tier: "t65", file: "ui/shaman/elemental/gear_sets/p5.gear.json" },
    ],
    // ⚠️ The healing specs are listed but yield nothing, and that is WoWSims'
    // state, not a bug here: ui/priest has no healing sim at all, and the resto
    // druid/shaman and holy paladin files exist but are empty placeholders
    // (`{"items": []}`) at both pinned versions — verified v0.0.97 and v0.0.126.
    // Empty sets are dropped below, so a healer simply has no BiS list and the
    // page says so, instead of being shown the DPS set of their class.
    // Keep them listed: the day WoWSims fills them in, a re-run picks them up.
    "Druid-Restoration": [
        { tier: "t4", file: "ui/druid/restoration/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/druid/restoration/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/druid/restoration/gear_sets/p3.gear.json" },
        { tier: "t65", file: "ui/druid/restoration/gear_sets/p4.gear.json" },
    ],
    "Shaman-Restoration": [
        { tier: "t4", file: "ui/shaman/restoration/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/shaman/restoration/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/shaman/restoration/gear_sets/p3.gear.json" },
        { tier: "t65", file: "ui/shaman/restoration/gear_sets/p4.gear.json" },
    ],
    "Paladin-Holy": [
        { tier: "t4", file: "ui/paladin/holy/gear_sets/p1.gear.json" },
    ],
};

// ── Nahkampf und Tanks ───────────────────────────────────────────────────────
//
// ⚠️ WoWSims' Phasennummern sind nicht unsere Tiers. `p4` ist bei jeder Spec
// die Zul'Aman-Phase auf T6-Niveau, Sunwell steht in `p5` — und genau das war
// bei den Castern oben jahrelang falsch verbucht (p4 als t65, medianes
// Itemlevel 141 statt 154). Die Zuordnung hier ist an den Itemleveln der Sets
// geprüft, und das Skript druckt sie beim Erzeugen mit, damit eine verrutschte
// Phase auffällt statt still ein falsches Set als BiS zu führen.
//
// p4 fehlt deshalb überall: Zul'Aman ist in unserer Tier-Tabelle kein eigenes
// Tier, und das ZA-Set wäre ein zweites T6-Set. Gelistet ist je Phase nur, was
// als "das Beste daraus" gemeint ist — beim Jäger die Zweihand-Variante mit
// vollem Setbonus, beim Bären das ausgewogene statt der Widerstandssets.
const BIS_MELEE = {
    "Warrior-Arms": [
        { tier: "t4", file: "ui/warrior/dps/gear_sets/p1_arms.gear.json" },
        { tier: "t5", file: "ui/warrior/dps/gear_sets/p2_arms.gear.json" },
        { tier: "t6", file: "ui/warrior/dps/gear_sets/p3_arms.gear.json" },
        { tier: "t65", file: "ui/warrior/dps/gear_sets/p5_arms.gear.json" },
    ],
    "Warrior-Fury": [
        { tier: "t4", file: "ui/warrior/dps/gear_sets/p1_fury.gear.json" },
        { tier: "t5", file: "ui/warrior/dps/gear_sets/p2_fury.gear.json" },
        { tier: "t6", file: "ui/warrior/dps/gear_sets/p3_fury.gear.json" },
        { tier: "t65", file: "ui/warrior/dps/gear_sets/p5_fury.gear.json" },
    ],
    "Warrior-Protection": [
        { tier: "t4", file: "ui/warrior/protection/gear_sets/p1_bis.gear.json" },
        { tier: "t5", file: "ui/warrior/protection/gear_sets/p2_bis.gear.json" },
        { tier: "t6", file: "ui/warrior/protection/gear_sets/p3_bis.gear.json" },
        { tier: "t65", file: "ui/warrior/protection/gear_sets/p5_bis.gear.json" },
    ],
    "Rogue-Combat": [
        { tier: "t4", file: "ui/rogue/dps/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/rogue/dps/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/rogue/dps/gear_sets/p3.gear.json" },
    ],
    "Druid-Feral": [
        { tier: "t4", file: "ui/druid/feralcat/gear_sets/p1_bis_9p.gear.json" },
        { tier: "t5", file: "ui/druid/feralcat/gear_sets/p2_alt_9p.gear.json" },
        { tier: "t6", file: "ui/druid/feralcat/gear_sets/p3_9p.gear.json" },
        { tier: "t65", file: "ui/druid/feralcat/gear_sets/p5.gear.json" },
    ],
    "Druid-Guardian": [
        { tier: "t4", file: "ui/druid/feralbear/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/druid/feralbear/gear_sets/p2_balanced.gear.json" },
        { tier: "t6", file: "ui/druid/feralbear/gear_sets/p3.gear.json" },
        { tier: "t65", file: "ui/druid/feralbear/gear_sets/p5.gear.json" },
    ],
    "Shaman-Enhancement": [
        { tier: "t4", file: "ui/shaman/enhancement/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/shaman/enhancement/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/shaman/enhancement/gear_sets/p3.gear.json" },
        { tier: "t65", file: "ui/shaman/enhancement/gear_sets/p5.gear.json" },
    ],
    "Paladin-Retribution": [
        { tier: "t4", file: "ui/paladin/retribution/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/paladin/retribution/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/paladin/retribution/gear_sets/p3.gear.json" },
    ],
    "Paladin-Protection": [
        { tier: "t4", file: "ui/paladin/protection/gear_sets/p1.gear.json" },
        { tier: "t5", file: "ui/paladin/protection/gear_sets/p2.gear.json" },
        // p5 statt p3: mit ilvl 146 gegen 141 ist es das bessere T6-Set — und
        // eben kein Sunwell-Set, dafür liegt es 8 Itemlevel zu niedrig. Für den
        // Schutz-Paladin gibt es bei WoWSims schlicht keine Sunwell-Liste.
        { tier: "t6", file: "ui/paladin/protection/gear_sets/p5.gear.json" },
    ],
    // Der Jäger ordnet nach Phase *und* Spec; Beastmastery mit Zweihandwaffe und
    // vollem Setbonus ist die Liste, die als BiS gemeint ist.
    "Hunter-BeastMastery": [
        { tier: "t4", file: "ui/hunter/dps/gear_sets/phase_1/bm/2h_9p.gear.json" },
        { tier: "t5", file: "ui/hunter/dps/gear_sets/phase_2/bm/2h_9p.gear.json" },
        { tier: "t6", file: "ui/hunter/dps/gear_sets/phase_3/bm/2h_9p.gear.json" },
        // phase_4 liegt bei ilvl 141 und ist damit die ZA-Phase, kein Sunwell —
        // eine Sunwell-Liste führt WoWSims für Jäger nicht.
    ],
    "Hunter-Survival": [
        { tier: "t4", file: "ui/hunter/dps/gear_sets/phase_1/sv/2h_6p.gear.json" },
        { tier: "t5", file: "ui/hunter/dps/gear_sets/phase_2/sv/2h_6p.gear.json" },
        { tier: "t6", file: "ui/hunter/dps/gear_sets/phase_3/sv/2h_9p.gear.json" },
        // phase_4 wie beim Beastmastery-Jäger: ZA-Niveau, kein Sunwell.
    ],
};

// Womit man rechnen darf, wenn die Zuordnung stimmt: T4 liegt bei medianem
// Itemlevel 115-120, T5 bei 128-133, T6 bei 138-146, Sunwell bei 154-159. Das
// Skript druckt den Median je Set, damit eine verrutschte Phase auffällt statt
// still ein falsches Set als BiS zu führen — genau so war p4 jahrelang als
// Sunwell verbucht.
// T4 steht bewusst tief: WoWSims' Priester-P1-Set liegt bei 110 und ist damit
// echtes Kara-Einstiegsgear. Die Zahlen sollen einen um ein ganzes Tier
// verrutschten Satz fangen, nicht ein schwaches Set melden.
const TIER_ILVL_HINT = { t4: 108, t5: 126, t6: 136, t65: 152 };

/** Der Median der Itemlevel eines Sets — die Kontrollzahl beim Erzeugen. */
function medianIlvl(ilvls) {
    const sorted = ilvls.filter(Boolean).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// The rotations, copied verbatim (they are the ground truth we sim against).
const APL_FILES = {
    "Priest-Shadow": "ui/priest/dps/apls/default.apl.json",
    "Mage-Arcane": "ui/mage/dps/apls/arcane.apl.json",
    "Warlock-Destruction": "ui/warlock/dps/apls/destruction.apl.json",
    "Warlock-Affliction": "ui/warlock/dps/apls/affliction.apl.json",
    "Warlock-Demonology": "ui/warlock/dps/apls/demonology.apl.json",
    "Druid-Balance": "ui/druid/balance/apls/default.apl.json",
    "Shaman-Elemental": "ui/shaman/elemental/apls/default.apl.json",
};

// WoWSims HandType (proto/common.proto) — which hand a weapon occupies. The
// one that matters here is TwoHand: a two-handed staff takes *both* hands, so
// handing one out frees the main hand and the off hand at once, and a council
// deciding on it wants to see both pieces that would come off.
const HAND_TYPE = { 1: "main", 2: "one", 3: "off", 4: "two" };

// WoWSims ItemType (proto/common.proto) -> the WCL equip-slot indices it can go
// in. WCL numbers the slots the way the game does (see SLOT_NAMES in
// utils/logcheck/gearIssues.js); the doubled slots (rings, trinkets) list both,
// and a weapon lists main hand and off hand for the same reason.
const TYPE_TO_SLOTS = {
    1: [0],       // Head
    2: [1],       // Neck
    3: [2],       // Shoulder
    4: [14],      // Back
    5: [4],       // Chest
    6: [8],       // Wrist
    7: [9],       // Hands
    8: [5],       // Waist
    9: [6],       // Legs
    10: [7],      // Feet
    11: [10, 11], // Finger
    12: [12, 13], // Trinket
    13: [15, 16], // Weapon
    14: [17],     // Ranged (wand/idol/relic/totem)
};

// WoWSims stat index -> our stat key.
//
// Taken from WoWSims' own `enum Stat` (proto/common.proto), not inferred from
// example items: the caster half was originally read off a known item, and that
// works until it doesn't — one wrong index silently mis-scores every piece.
//
// Resistances and the composite health/mana entries are left out: no council
// question is decided by them, and an item's fire resistance would only add
// noise to a stat block the page prints.
const STAT_KEYS = {
    0: "strength",
    1: "agility",
    2: "stamina",
    3: "intellect",
    // Caster half.
    4: "healingPower",
    5: "spellPower",
    6: "arcanePower",
    7: "firePower",
    8: "frostPower",
    9: "holyPower",
    10: "naturePower",
    11: "shadowPower",
    12: "spellHit",
    13: "spellCrit",
    14: "spellHaste",
    15: "spellPen",
    16: "spirit",
    // Physical — what a melee, a hunter or a feral druid is judged by.
    17: "attackPower",
    18: "rangedAttackPower",
    19: "feralAttackPower",
    20: "meleeHit",
    21: "meleeCrit",
    22: "meleeHaste",
    23: "armorPen",
    24: "expertise",
    // Tank.
    25: "defense",
    26: "blockRating",
    27: "blockValue",
    28: "dodge",
    29: "parry",
    30: "resilience",
    31: "armor",
    32: "bonusArmor",
    35: "mp5",
};

function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "EventHelper-fetch-wowsims" } }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                res.resume();
                return resolve(get(res.headers.location));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject);
    });
}

const raw = (version, file) => get(`https://raw.githubusercontent.com/${REPO}/${version}/${file}`);

/** The stats block of an item, in our keys. WoWSims keys them by stat index. */
function statsOf(item) {
    const scaling = item.scalingOptions && (item.scalingOptions["0"] || Object.values(item.scalingOptions)[0]);
    const raw = (scaling && scaling.stats) || {};
    const out = {};
    for (const [idx, key] of Object.entries(STAT_KEYS)) {
        const value = Number(raw[idx] || 0);
        if (value) out[key] = value;
    }
    return {
        stats: out,
        ilvl: Number((scaling && scaling.ilvl) || 0),
        // Waffenschaden steht im Skalierungsblock, die Geschwindigkeit dagegen
        // an der Wurzel des Items — für einen Caster war beides gleichgültig,
        // für jeden Nahkämpfer ist es die halbe Waffe.
        damage: {
            min: Number((scaling && scaling.weaponDamageMin) || 0),
            max: Number((scaling && scaling.weaponDamageMax) || 0),
        },
    };
}

// The stats that make a piece worth carrying, by the role that cares about it.
// Plain stamina or intellect is on every hybrid piece in the game and says
// nothing, so neither is a reason on its own.
const RELEVANT_STATS = {
    caster: ["spellPower", "healingPower", "arcanePower", "firePower", "frostPower",
        "holyPower", "naturePower", "shadowPower", "spellHit", "spellCrit", "spellHaste", "mp5"],
    physical: ["strength", "agility", "attackPower", "rangedAttackPower", "feralAttackPower",
        "meleeHit", "meleeCrit", "meleeHaste", "armorPen", "expertise"],
    tank: ["defense", "blockRating", "blockValue", "dodge", "parry", "bonusArmor"],
};

/**
 * Is this item worth carrying into the table at all?
 *
 * Kept deliberately wide — an item that is *offered* to somebody has to be
 * lookup-able even when it is a poor pick, or the page would silently drop the
 * very row a council is arguing about. Green and worse never reaches a council,
 * and that is the only hard cut.
 */
function isRaidItem(item, stats) {
    if (item.quality < 3) return false;
    return Object.values(RELEVANT_STATS).some((keys) => keys.some((key) => stats[key]));
}

async function main() {
    fs.mkdirSync(APL_DIR, { recursive: true });

    process.stdout.write(`Item-DB laden (${REPO} ${SIM_VERSION}) … `);
    const db = JSON.parse(await raw(SIM_VERSION, "assets/database/db.json"));
    process.stdout.write(`${(db.items || []).length} Items\n`);

    // The BiS sets first: every id they name has to survive the item filter,
    // whatever its stats say — a set that references an item the table doesn't
    // carry would show up as a hole in the BiS list.
    const bis = {};
    const bisItemIds = new Set();
    // Itemlevel je Item — die Kontrollzahl, mit der unten jedes Set gedruckt
    // wird (siehe TIER_ILVL_HINT).
    const ilvlById = new Map();
    for (const item of db.items || []) ilvlById.set(Number(item.id), statsOf(item).ilvl);

    for (const [specKey, sets] of Object.entries({ ...BIS_FILES, ...BIS_MELEE })) {
        const bySets = {};
        for (const { tier, file } of sets) {
            let parsed;
            try {
                parsed = JSON.parse(await raw(BIS_VERSION, file));
            } catch (e) {
                // A set WoWSims does not (yet) ship for that spec/phase. Skipping
                // it leaves a gap the page reports honestly, which beats pinning
                // a wrong set onto the tier.
                console.warn(`  ! ${specKey} ${tier}: ${file} nicht verfügbar (${e.message})`);
                continue;
            }
            const items = (parsed.items || []).map((it) => (it && it.id ? {
                id: Number(it.id),
                enchant: Number(it.enchant || 0) || undefined,
                gems: Array.isArray(it.gems) ? it.gems.map(Number) : undefined,
            } : null));
            // An empty set is a WoWSims placeholder, not a BiS list (see the
            // healer note on BIS_FILES) — storing it would make the page claim
            // "BiS: 0 of 0 items" instead of "no list for this spec".
            if (!items.some(Boolean)) {
                console.warn(`  ! ${specKey} ${tier}: ${file} ist leer (WoWSims-Platzhalter) — übersprungen`);
                continue;
            }
            for (const it of items) if (it) bisItemIds.add(it.id);
            bySets[tier] = items;
            const median = medianIlvl(items.filter(Boolean).map((it) => ilvlById.get(it.id) || 0));
            const expected = TIER_ILVL_HINT[tier] || 0;
            const off = expected && median < expected ? "  ← unter dem erwarteten Itemlevel dieses Tiers!" : "";
            console.log(`  ${specKey} ${tier}: ${items.filter(Boolean).length} Items, ilvl ${median}${off}`);
        }
        if (Object.keys(bySets).length) bis[specKey] = bySets;
    }

    // The healer lists come from Wowhead, not from here (scripts/fetch-wowhead-bis.js),
    // but their items have to sit in the same table — and a healing relic
    // carries no stats at all, its whole value being an effect, so the filter
    // below would drop every idol, totem and libram. Their ids are taken along
    // the way a WoWSims set's are, except for the quality cut: a written guide
    // may name an item this table filters for want of stats, never a green.
    const wowheadIds = new Set();
    try {
        const wowhead = require(path.join(OUT_DIR, "..", "wowhead", "bisSets.json"));
        for (const tiers of Object.values(wowhead.sets || {})) {
            for (const set of Object.values(tiers)) {
                for (const entry of set) if (entry) wowheadIds.add(Number(entry.id));
            }
        }
        for (const id of wowhead.pending || []) wowheadIds.add(Number(id));
        console.log(`Wowhead-Heilerlisten: ${wowheadIds.size} Items mitgenommen`);
    } catch {
        console.warn("  ! keine Wowhead-Heilerlisten gefunden — `node scripts/fetch-wowhead-bis.js` erzeugt sie");
    }

    // Now the item table: everything anybody on the council could be handed,
    // plus every id a BiS set names.
    const items = {};
    const icons = new Map((db.itemIcons || []).map((i) => [Number(i.id), String(i.icon || "")]));
    for (const item of db.items || []) {
        const { stats, ilvl, damage } = statsOf(item);
        const id = Number(item.id);
        const wanted = bisItemIds.has(id) || (wowheadIds.has(id) && Number(item.quality || 0) >= 3);
        if (!isRaidItem(item, stats) && !wanted) continue;
        const slots = TYPE_TO_SLOTS[item.type];
        if (!slots) continue; // a type we have no equip slot for (shirt, tabard)
        items[item.id] = {
            name: String(item.name || ""),
            icon: String(item.icon || icons.get(Number(item.id)) || ""),
            slots,
            ilvl,
            quality: Number(item.quality || 0),
            phase: Number(item.phase || 0),
            stats,
            ...(item.setName ? { setName: String(item.setName) } : {}),
            // Only weapons have one, and only "two" changes anything downstream.
            ...(HAND_TYPE[item.handType] ? { hand: HAND_TYPE[item.handType] } : {}),
            ...(Array.isArray(item.gemSockets) && item.gemSockets.length ? { sockets: item.gemSockets.map(Number) } : {}),
            // Which classes may wear it at all (WoWSims class enum). Kept so the
            // page never offers a Mage a Shaman's mail chest.
            ...(Array.isArray(item.classAllowlist) && item.classAllowlist.length
                ? { classes: item.classAllowlist.map(Number) } : {}),
            // Waffen: Schaden und Geschwindigkeit. Für einen Caster war das
            // gleichgültig — die Zauberwerte stehen im Statblock —, für jeden
            // Nahkämpfer ist es die halbe Waffe.
            ...(damage.min || damage.max || item.weaponSpeed ? {
                weapon: {
                    min: damage.min,
                    max: damage.max,
                    speed: Number(item.weaponSpeed || 0),
                    type: Number(item.weaponType || 0),
                },
            } : {}),
        };
    }
    const withPhysical = Object.values(items)
        .filter((it) => RELEVANT_STATS.physical.some((key) => it.stats[key])).length;
    console.log(`Items: ${Object.keys(items).length} (davon ${withPhysical} mit Nahkampf-/Distanzwerten)`);

    // Shape per id: { name, icon, slots: [wcl equip slot], ilvl, quality, phase,
    // stats: { spellPower, spellHit, … }, setName?, sockets?, classes? }.
    writeJson("items.json", { version: SIM_VERSION, items });
    // Shape: { "<Class>-<Spec>": { t4: [{ id, enchant?, gems? } | null, …], … } }.
    writeJson("bisSets.json", { version: BIS_VERSION, sets: bis });

    for (const [specKey, file] of Object.entries(APL_FILES)) {
        try {
            const apl = await raw(SIM_VERSION, file);
            fs.writeFileSync(path.join(APL_DIR, `${specKey}.apl.json`), apl);
            console.log(`APL ${specKey} ok`);
        } catch (e) {
            console.warn(`  ! APL ${specKey}: ${e.message}`);
        }
    }

    console.log(`\nFertig. Geschrieben nach ${OUT_DIR}`);
}

/** Write one generated table. `_generated` marks it in the file itself. */
function writeJson(fileName, payload) {
    const data = {
        _generated: `scripts/fetch-wowsims-data.js from ${REPO} (MIT) — do not hand-edit, re-run the script`,
        ...payload,
    };
    fs.writeFileSync(path.join(OUT_DIR, fileName), `${JSON.stringify(data)}\n`);
    console.log(`-> src/config/wowsims/${fileName}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
