#!/usr/bin/env node
// Downloads the spec icons (the same wow.zamimg.com icons the spec emojis are
// made of) so the pictures the bot draws - the setup graphic - can embed them
// without fetching anything while they render.
//
//   node scripts/fetch-spec-icons.js [--force]
//
// Writes assets/specs/<icon>.jpg for every spec and class of
// src/config/gameVersions/classes.js (the class icon stands in for a raider
// without a spec); an icon already there is kept unless --force.
const fs = require("fs");
const path = require("path");
const { buildClasses } = require("../src/config/gameVersions/classes");

const ROOT = path.join(__dirname, "..");
const ICON_DIR = path.join(ROOT, "assets", "specs");
const ICON_URL = (icon) => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;

async function main() {
    const force = process.argv.includes("--force");
    const icons = [...new Set(buildClasses().flatMap((c) => [c.icon, ...c.specs.map((s) => s.icon)]).filter(Boolean))];
    fs.mkdirSync(ICON_DIR, { recursive: true });
    let fetched = 0;
    let skipped = 0;
    for (const icon of icons) {
        const file = path.join(ICON_DIR, `${icon}.jpg`);
        if (!force && fs.existsSync(file)) { skipped++; continue; }
        const res = await fetch(ICON_URL(icon));
        if (!res.ok) {
            console.warn(`kein Icon für ${icon} (HTTP ${res.status})`);
            continue;
        }
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        fetched++;
    }
    console.log(`${icons.length} Spec-Icons; ${fetched} geladen, ${skipped} vorhanden → ${path.relative(ROOT, ICON_DIR)}`);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
