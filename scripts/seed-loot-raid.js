#!/usr/bin/env node
// Dev only: a raid group to try "Loot verteilen" in the setup editor (#1037, docs/setup.md):
// Karazhan 10 (TBC) with 50 signups over five parallel raids, a proposal, and a stored loot
// snapshot (setupLootStore) as "Loot-Daten laden" would have left it - so the editor shows
// "Loot: n Überschneidungen" and the item list without asking softres.it or the armory.
//
//   node scripts/seed-loot-raid.js                 # event "Kara Loot Test" (created, or rebuilt)
//   node scripts/seed-loot-raid.js --guild <id>    # Discord server id for a new event (default GUILD_ID / an existing event's)
//
// The wants come from the local game data only (no invented item ids): the Kara BiS items of each
// spec (WoWSims lists + the drop table, setupLoot.bisInInstances). The first 15 characters "reserved"
// two of them (source Softres), the next 25 wear their first BiS piece already (source BiS minus
// gear), the last 10 have no gear known (source Spec). Nothing goes to Discord or any API: only the
// local JSON stores under data/ are written. Refuses to run with NODE_ENV=production.
const fs = require("fs");
const TITLE = "Kara Loot Test";
const RAIDS = 5;
const FIRST_USER_ID = 301;
const SOFTRES = 15;
const BIS = 25;

// 10 tanks, 15 healers, 25 damage dealers: two tanks and three healers per raid
const SPECS = [
    ["Warrior-Protection", 4], ["Paladin-Protection", 3], ["Druid-Guardian", 3],
    ["Priest-Holy", 4], ["Paladin-Holy", 4], ["Shaman-Restoration", 4], ["Druid-Restoration", 3],
    ["Warrior-Fury", 3], ["Rogue-Combat", 3], ["Mage-Fire", 3], ["Warlock-Destruction", 3], ["Hunter-BeastMastery", 3],
    ["Priest-Shadow", 2], ["Shaman-Enhancement", 2], ["Druid-Balance", 2], ["Paladin-Retribution", 2], ["Mage-Arcane", 2],
];
const NAMES = ["Ash", "Bri", "Cor", "Dar", "Eld", "Fen", "Gal", "Hal", "Ivo", "Jor"];

/** The 50 characters: [name, spec], interleaved so each source holds every role. */
function roster() {
    const list = SPECS.flatMap(([spec, n]) => Array.from({ length: n }, () => spec));
    const order = [];
    for (let i = 0; i < 10; i++) for (let j = i; j < list.length; j += 10) order.push(list[j]);
    return order.map((spec, i) => [`${NAMES[i % 10]}${spec.split("-")[0].slice(0, 3).toLowerCase()}${Math.floor(i / 10) + 1}`, spec]);
}

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? String(process.argv[i + 1] || "") : "";
}

/** The snapshot "Loot-Daten laden" would store, from the local game data alone. */
function lootSnapshot(characters, userOf) {
    const { _internal: { bisInInstances, itemTable } } = require("../src/services/setup/setupLoot");
    const { lootWants } = require("../src/utils/setup/lootWants");
    const { characterKeyOf } = require("../src/utils/loot/lootImport");
    const wants = {};
    const counts = { signups: characters.length, gear: 0, softres: 0, bis: 0, spec: 0 };
    characters.forEach(([character, spec], i) => {
        const bis = bisInInstances(spec, "tbc", ["kara"]);
        const data = i < SOFTRES ? { reserves: bis.slice(0, 2) }
            : i < SOFTRES + BIS ? { bis, worn: bis.slice(0, 1) }
                : { spec };
        const entry = lootWants(userOf(i), character, { ...data, spec });
        if (!entry) return;
        (wants[userOf(i)] = wants[userOf(i)] || {})[characterKeyOf(character)] = entry;
        counts[entry.source]++;
        if (data.worn) counts.gear++;
    });
    return { versionId: "tbc", instanceIds: ["kara"], wants, items: itemTable(wants, "tbc"), counts };
}

function main() {
    if (process.env.NODE_ENV === "production") {
        console.error("seed-loot-raid: refused, NODE_ENV=production.");
        process.exit(1);
    }
    const path = require("path");
    const envFile = path.join(__dirname, "..", ".env.dev");
    if (fs.existsSync(envFile)) require("dotenv").config({ path: envFile, quiet: true });
    const { logcheckAdminIds } = require("../src/config/variables");
    const meId = arg("me") || logcheckAdminIds[0] || "dev";
    const eventStore = require("../src/stores/events/eventStore");
    const signupStore = require("../src/stores/events/signupStore");
    const raidGroup = require("../src/services/events/raidGroup");
    const editor = require("../src/services/setup/setupEditor");
    const { saveSetupLoot } = require("../src/stores/loot/setupLootStore");
    const { spec } = require("../src/config/gameVersions");

    // start clean: an old group of this title goes as a whole (the siblings first)
    const old = eventStore.listEvents("", { siblings: true }).filter((e) => e.title && e.title.startsWith(TITLE) && eventStore.isOwnEventId(e.id));
    const guildId = arg("guild") || process.env.GUILD_ID || (old[0] || {}).guildId || (eventStore.listEvents().find((e) => e.guildId) || {}).guildId || "";
    for (const e of old) { signupStore.deleteEventSignups(e.id); eventStore.deleteEvent(e.id); }

    const created = eventStore.createEvent({
        guildId, channelId: "1", title: TITLE, startTime: Math.floor(Date.now() / 1000) + 7 * 86400,
        versionId: "tbc", instanceIds: ["kara"], size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
    });
    if (created.error) { console.error(`seed-loot-raid: ${created.error}`); process.exit(1); }
    const id = created.event.id;

    const characters = roster();
    const userOf = (i) => (i === 0 ? meId : String(FIRST_USER_ID + i));
    characters.forEach(([character, specKey], i) => {
        if (!spec(specKey, "tbc")) throw new Error(`unknown spec ${specKey}`);
        const r = signupStore.saveSignup(id, userOf(i), { character, spec: specKey, status: "signed" }, { versionId: "tbc" });
        if (r.error) throw new Error(`${character}: ${r.error}`);
    });
    const added = raidGroup.addRaids(id, { count: RAIDS - 1 });
    if (added.error) { console.error(`seed-loot-raid: raids: ${added.error}`); process.exit(1); }

    const snapshot = saveSetupLoot(id, lootSnapshot(characters, userOf));
    const proposed = editor.proposeEventSetup(id, {}, { userId: "seed" });
    if (proposed.error) { console.error(`seed-loot-raid: proposal: ${proposed.error}`); process.exit(1); }
    const loot = (proposed.setup && proposed.setup.checks && proposed.setup.checks.loot) || {};
    const c = snapshot.counts;
    console.log(`seed-loot-raid: event ${id} "${TITLE}" - ${characters.length} signups over ${RAIDS} raids.`);
    console.log(`  loot snapshot: softres ${c.softres}, bis ${c.bis}, spec ${c.spec}, gear ${c.gear} of ${c.signups}; proposal: ${loot.conflicts || 0} overlaps`);
    console.log(`  open: /raids/detail?event=${id}&tab=setup`);
}

// only when started as a script: a `require` (a test, a syntax check) runs nothing and writes nothing
if (require.main === module) main();

module.exports = { main, roster, lootSnapshot, TITLE, RAIDS };
