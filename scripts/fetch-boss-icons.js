#!/usr/bin/env node
// Downloads the boss icons Warcraft Logs shows for every TBC encounter, so the
// report page can label its boss tabs with them without hotlinking.
//
//   node scripts/fetch-boss-icons.js [--force]
//
// Needs WARCRAFTLOGS_API_KEY (from .env.dev or .env) to list the zones; the
// icons themselves are public. Writes:
//   src/web-client/public/bosses/<encounterId>.jpg   (served at /bosses/<id>.jpg)
//   src/config/generated/bossIcons.json                       (zone → encounters, id → name)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_DEV = path.join(ROOT, ".env.dev");
require("dotenv").config({ path: fs.existsSync(ENV_DEV) ? ENV_DEV : path.join(ROOT, ".env") });

const ICON_DIR = path.join(ROOT, "src", "web-client", "public", "bosses");
const OUT_JSON = path.join(ROOT, "src", "config", "generated", "bossIcons.json");
const ZONES_URL = "https://classic.warcraftlogs.com/v1/zones";
const ICON_URL = (id) => `https://assets.rpglogs.com/img/warcraft/bosses/${id}-icon.jpg`;

// The TBC raid zones as WCL Classic numbers them.
const TBC_ZONES = [1007, 1008, 1010, 1011, 1012, 1013];

async function main() {
    const force = process.argv.includes("--force");
    const key = process.env.WARCRAFTLOGS_API_KEY;
    if (!key) throw new Error("WARCRAFTLOGS_API_KEY fehlt (.env.dev / .env)");

    const res = await fetch(`${ZONES_URL}?api_key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`zones: HTTP ${res.status}`);
    const zones = (await res.json())
        .filter((z) => TBC_ZONES.includes(z.id))
        .map((z) => ({ id: z.id, name: z.name, encounters: (z.encounters || []).map((e) => ({ id: e.id, name: e.name })) }));

    fs.mkdirSync(ICON_DIR, { recursive: true });
    let fetched = 0;
    let skipped = 0;
    for (const zone of zones) {
        for (const enc of zone.encounters) {
            const file = path.join(ICON_DIR, `${enc.id}.jpg`);
            if (!force && fs.existsSync(file)) { skipped++; continue; }
            const icon = await fetch(ICON_URL(enc.id));
            if (!icon.ok) {
                console.warn(`kein Icon für ${enc.id} ${enc.name} (HTTP ${icon.status})`);
                continue;
            }
            fs.writeFileSync(file, Buffer.from(await icon.arrayBuffer()));
            fetched++;
        }
    }
    fs.writeFileSync(OUT_JSON, `${JSON.stringify({ generatedAt: new Date().toISOString(), zones }, null, 2)}\n`);
    console.log(`${zones.length} Zonen, ${zones.reduce((n, z) => n + z.encounters.length, 0)} Encounter; ${fetched} Icons geladen, ${skipped} vorhanden → ${path.relative(ROOT, ICON_DIR)}`);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
