# Generated data — do not edit by hand

Everything in this directory is written by a script. A hand edit is lost the next
time the script runs, so change the script (or the source it reads) instead and
regenerate. Only JSON lives here; the modules that use the data load it:

| Script | File | Source | Command | Read by |
|---|---|---|---|---|
| `scripts/fetch-tbc-loot.js` | `tbcRaidLoot.json` | AtlasLootClassic `data-tbc.lua` (raid drops per boss) | `node scripts/fetch-tbc-loot.js` | `config/tbcContent.js` (`RAID_LOOT`) |
| `scripts/fetch-tbc-loot-names.js` | `tbcLootNames.json` | Wowhead tooltips of every `RAID_LOOT` id | `node scripts/fetch-tbc-loot-names.js` (after the one above) | `config/tbcLootNames.js` (`RAID_ITEMS`) |
| `scripts/build-cla-data.js` | `claData.json` | CLA Apps Script source + `scripts/data-sources/cla/*.csv` | `node scripts/build-cla-data.js` | `config/claData.js` |
| `scripts/build-rpb-data.js` | `rpbData.json` | `scripts/data-sources/rpb/*.csv` (+ cached spell icons) | `node scripts/build-rpb-data.js` | `config/rpbData.js` |
| `scripts/fetch-boss-icons.js` | `bossIcons.json` | Warcraft Logs zones/encounters (icons go to `src/web-client/public/bosses/`) | `node scripts/fetch-boss-icons.js` | `config/bosses.js` |
| `scripts/fetch-mob-icons.js` | `mobIcons.json` | Wowhead icon CDN + NPC model renders (portraits go to `src/web-client/public/mobs/`) | `node scripts/fetch-mob-icons.js` | `services/raidplan/raidplanCatalogDefaults.js`, `web/apiRoutes/raidplan.js` |
| `scripts/fetch-wowhead-bis.js` | `wowhead/bisSets.json` | Wowhead's written BiS guides (the five healing specs) | `npm run bis:refresh` | `config/bisSets.js` |
| `scripts/fetch-wowsims-data.js` | `wowsims/items.json`, `wowsims/bisSets.json`, `wowsims/apls/*.apl.json` | wowsims/tbc-new (MIT) | `npm run bis:refresh` | `config/wowsims/index.js` |

The four files that used to be JavaScript (`tbcRaidLoot`, `tbcLootNames`,
`claData`, `rpbData`) are written through `scripts/lib/generatedJson.js`, which
keeps short rows on one line so a regeneration gives a readable diff.

`test/config/generated.test.js` checks that every file here parses and that the
modules above still answer what they answered before the data moved here.
