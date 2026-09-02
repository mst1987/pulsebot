#!/usr/bin/env node
// Generates everything the loot council needs out of WoWSims-TBC (wowsims/tbc-new, MIT):
//
//   src/config/wowsims/casterItems.js  — the caster-relevant slice of the item DB
//                                        (stats, slot, sockets), keyed by item id
//   src/config/wowsims/bisSets.js      — the BiS gear sets per caster spec and phase
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
        { tier: "t65", file: "ui/druid/balance/gear_sets/p4.gear.json" },
    ],
    "Shaman-Elemental": [
        { tier: "t4", file: "ui/shaman/elemental/gear_sets/p1_a.gear.json" },
        { tier: "t5", file: "ui/shaman/elemental/gear_sets/p2.gear.json" },
        { tier: "t6", file: "ui/shaman/elemental/gear_sets/p3.gear.json" },
        { tier: "t65", file: "ui/shaman/elemental/gear_sets/p4.gear.json" },
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

// WoWSims stat index -> our stat key. Only the stats a caster is judged on are
// carried over; the melee half of the vector would just be noise here.
// Verified against the item DB (e.g. Hood of Absolution 31064: 3=int, 5=spell
// power, 13=spell crit, 16=spirit, 35=mp5).
const STAT_KEYS = {
    2: "stamina",
    3: "intellect",
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
    return { stats: out, ilvl: Number((scaling && scaling.ilvl) || 0) };
}

/**
 * Is this item worth carrying into the caster item table? Caster gear is what
 * has spell power, healing power or a school-specific damage bonus on it; plain
 * intellect alone is not enough (every mail/plate hybrid piece has some).
 *
 * Kept deliberately wide — an item that is *offered* to a caster has to be
 * lookup-able even when it is a poor pick, or the page would silently drop the
 * very row a council is arguing about.
 */
function isCasterItem(item, stats) {
    if (item.quality < 3) return false; // green and worse never reaches a council
    return !!(stats.spellPower || stats.healingPower || stats.arcanePower || stats.firePower
        || stats.frostPower || stats.holyPower || stats.naturePower || stats.shadowPower
        || stats.spellHit || stats.spellCrit || stats.spellHaste || stats.mp5);
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
    for (const [specKey, sets] of Object.entries(BIS_FILES)) {
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
            console.log(`  ${specKey} ${tier}: ${items.filter(Boolean).length} Items`);
        }
        if (Object.keys(bySets).length) bis[specKey] = bySets;
    }

    // Now the item table: everything a caster could be handed, plus every id a
    // BiS set names.
    const items = {};
    const icons = new Map((db.itemIcons || []).map((i) => [Number(i.id), String(i.icon || "")]));
    for (const item of db.items || []) {
        const { stats, ilvl } = statsOf(item);
        if (!isCasterItem(item, stats) && !bisItemIds.has(Number(item.id))) continue;
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
        };
    }
    console.log(`Caster-Items: ${Object.keys(items).length}`);

    // Shape per id: { name, icon, slots: [wcl equip slot], ilvl, quality, phase,
    // stats: { spellPower, spellHit, … }, setName?, sockets?, classes? }.
    writeJson("casterItems.json", { version: SIM_VERSION, items });
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
