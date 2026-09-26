#!/usr/bin/env node
// Regenerates src/config/generated/tbcLootNames.json — the name, icon and quality of every
// item id in tbcContent.js's RAID_LOOT table.
//
// RAID_LOOT answers "which raid does item 30095 drop in", which is all a loot
// import needs: the export already carries the name, or enrichItemNames() looks
// the one id up that it is missing. The manual "Item nachtragen" picker asks the
// question the other way round — "which items can drop here" — and that needs
// every id of a raid named at once. Looking up 800 ids through Wowhead on each
// pick would be both slow and rude, so the names are resolved once, here, and
// shipped as a table.
//
// Names are the English ones, deliberately: that is what both loot addons write
// into their exports and therefore what the loot tables already show, and a
// picker offering "Handschuhe des vergessenen Eroberers" for a row that reads
// "Gloves of the Forgotten Conqueror" would be its own bug.
//
// Run it after regenerating RAID_LOOT (new raid, AtlasLoot correction):
//   node scripts/fetch-tbc-loot.js && node scripts/fetch-tbc-loot-names.js
// It rewrites src/config/generated/tbcLootNames.json (read by
// src/config/tbcLootNames.js); ids it cannot resolve keep whatever name the
// file already had, so a Wowhead hiccup never empties the table.

const fs = require("fs");
const path = require("path");
const { RAID_LOOT } = require("../src/config/tbcContent");
const { lookupItem } = require("../src/utils/loot/wowhead");
const { GENERATED_DIR, writeGeneratedJson } = require("./lib/generatedJson");

const TARGET = path.join(GENERATED_DIR, "tbcLootNames.json");

// Wowhead answers a single tooltip request in ~300ms; eight at a time keeps the
// whole table under a minute without hammering them.
const CONCURRENCY = 8;

/** Every item id RAID_LOOT knows, ascending. */
function allItemIds() {
    const ids = new Set();
    for (const byBoss of Object.values(RAID_LOOT)) {
        for (const list of Object.values(byBoss)) for (const id of list) ids.add(Number(id));
    }
    return [...ids].sort((a, b) => a - b);
}

/** The ids the file already resolved, so a failed lookup keeps its old entry. */
function existingNames() {
    try {
        return JSON.parse(fs.readFileSync(TARGET, "utf8"));
    } catch {
        return {};
    }
}

/** Runs `worker` over `items`, `limit` at a time. */
async function pooled(items, limit, worker) {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) await worker(queue.shift());
    });
    await Promise.all(runners);
}

(async () => {
    const ids = allItemIds();
    const known = existingNames();
    const resolved = new Map();
    let failed = 0;
    let done = 0;

    await pooled(ids, CONCURRENCY, async (id) => {
        const item = await lookupItem(id);
        done += 1;
        if (done % 100 === 0) console.log(`  ${done}/${ids.length} …`);
        if (item && item.name) {
            resolved.set(id, [item.name, item.icon || "", item.quality === null ? 0 : item.quality]);
            return;
        }
        failed += 1;
        if (known[id]) resolved.set(id, known[id]);
    });

    if (resolved.size < ids.length / 2) {
        throw new Error(`only ${resolved.size} of ${ids.length} items resolved — Wowhead unreachable?`);
    }

    // id → [name, icon, quality], ascending by id.
    const items = Object.fromEntries([...resolved.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, [name, icon, quality]]) => [String(id), [name, icon, quality]]));
    console.log(`${resolved.size} item(s) named, ${failed} lookup(s) failed`);

    console.log(`wrote ${writeGeneratedJson("tbcLootNames.json", items)}`);
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
