# CLA reference data (extracted from the source Google Sheet)

Source spreadsheet (the "CLA / Role Performance Breakdown" by Lars Maag / "shariva"):
- Copy used: `1eDMGlfdnfyeHhYj02bY13DJnGU7LHMwSMKwkvcorwFs`
- Original/master (RPB): https://docs.google.com/spreadsheets/d/1EJ0g1i72rJjQkP1IN2Kz0vq31EphlrT0nCworP6ZXMc
- External master config (IMPORTRANGE source, e.g. `suboptimalEnchants`): `1pIbbPkn9i5jxyQ60Xt86fLthtbdCAmFriIpPSvmXiu0`
- Author: Lars Maag — Discord `shariva` / https://discord.gg/nGvt5zH — maag.lars+cla@gmail.com

## Important
The actual computation logic is **Google Apps Script** bound to the spreadsheet
(open the sheet copy → Extensions → Apps Script), **not** cell formulas. The cell
formulas are only `VLOOKUP(... trans ...)` translation lookups and
`__xludf.DUMMYFUNCTION` placeholders (cached Apps-Script results). CLA pulls its
raw data from the **Warcraft Logs API v1** (the "V1 Client Key" from the WCL profile).

These CSVs are therefore the **reference data tables** only. The algorithm has to be
ported from the Apps Script source.

## Files

| File | Type | Content |
|---|---|---|
| `gear_issues.csv` | **config** | Cheap/bad enchant blacklist (`id [slot]`, name) + excluded gear item IDs + settings. Right side is per-report output. |
| `sockets.csv` | **config** | `item id -> number of sockets` (used to detect empty/ungemmed sockets). ~1500 rows. |
| `shadow_resistance_config.csv` | **config** | `item id -> shadow resistance value`. ~1260 rows. |
| `master_buffConsumables.csv` | **config** | Spell GUIDs per consumable column (battle/guardian elixir, flask, food, scrolls, weapon enhancement, JC neck). |

All four are inputs of `scripts/build-cla-data.js`. The example outputs of one report
(`buff_consumables`, `drums`, `shadow_resi`, `gear_listing`) had no reader and were
removed in #418.

## Generator input: the Apps Script clone

`scripts/build-cla-data.js` also reads `appsscript/GearIssues.js` from this folder, the
Apps Script source of the sheet copy. It is **git-ignored** and has to be fetched first:
`clasp clone <scriptId>` into `scripts/data-sources/cla/appsscript/` (script id from the
copy's Extensions → Apps Script → Project settings). Without it the generator stops at
its first line of work.

The slot numbers in `gear_issues.csv` (`927 [8]`) are WCL/WoW equip slot indices,
e.g. 8 = Bracers, 9 = Gloves, 7 = Boots, 4 = Chest, 14 = Cloak, 16 = Shield.
