# RPB reference data (extracted from the source Google Sheet)

Source spreadsheet — the "Role Performance Breakdown" (RPB) by Lars Maag / "shariva",
the sister tool of the CLA (see `reference/cla/`):

- Template/master read here: `1vTE7E1EpWu_DjwoHcVcDrWBb_A3FLYKIUO2YWMOsXQ4` (version **1.6.0b**, 28.06.2026)
- Author: Lars Maag — Discord `Shariva#8127` / https://discord.gg/nGvt5zH — maag.lars+rpb@gmail.com
- Companion CLA sheet linked from the RPB instructions: `1TaL0zufIhSNhAVIfpsBXMT0JXL3ptpbA7vZnXCWOlBs`

## Important

Same situation as the CLA: the actual computation logic is **Google Apps Script** bound
to the spreadsheet (Extensions → Apps Script), **not** cell formulas. The master sheet is
read-only for everyone, so the script can only be obtained from a personal *copy* of the
sheet via `clasp clone <scriptId>`. Cloned sources go to `reference/rpb/appsscript/`,
which is git-ignored (same as the CLA one).

RPB pulls its raw data from the **Warcraft Logs API v1** (the "V1 Client Key" from the
WCL profile) — the same key we already use via `WARCRAFTLOGS_API_KEY`.

## Scope — how RPB differs from the CLA

The two tools deliberately do not overlap; the RPB instructions sheet points at the CLA
for gear/drums. RPB is the **performance** half:

| Group | Metrics (keys from `trans.csv`) |
|---|---|
| Avoidable damage | `avoidableDamageTaken`, `damageTakenByTrackedAbilities` (per ability, with WCL deep links) |
| Deaths | `totalDeaths`, `justOnTrash` |
| Self-inflicted | `damageReflected`, `damageHostile`, `friendlyFire` |
| Activity | `secondsActiveST`, `secondsActiveAoe`, `relativeActive*`, `WCLactive*`, `hitsPerAoeCast`, `minusSecondsSpellHaste` |
| Cooldowns | `usedOrGainedTrash`, `usedOrGainedBosses`, `gainedOn*`, `trinketsUsed`, `winterChill`, `shoutUptimeOnYou` |
| Interrupts | `interruptedSpells`, `namesAndSourcesInterruptedSpells` |
| Misc | `absorbedTot`, `damageDoneEngi`, `damageDoneImmolation`, `temporaryWeaponEnhancement` |
| Roles | `Caster` / `Healer` / `Physical` / `Tank` — auto-detected, manually correctable, saved per character; the whole breakdown is grouped by role |
| Validation | `isLogValid`, `minimumToKill`, `howManyKilled`, `containsStartPoint`, `totalNumberOfCharactersUsed` |
| Fight timing | `idle`, `totalIdleTime`, `timeDifference` (compares two logs' boss timings) |

## Files

| File | Type | Content |
|---|---|---|
| `spell_haste_config.csv` | **config** | `item id -> spell haste value` (143 rows). Used to subtract haste-inflated cast time when computing "seconds active" (`minusSecondsSpellHaste`). |
| `trans.csv` | **config** | Shared CLA+RPB translation table: `key -> English label` (column 9). The authoritative list of every metric the two tools produce. Other language columns are empty in the export. |
| `instructions.csv` | doc | The instructions tab, incl. the changelog and the documented limitations (activity numbers are inaccurate for melee; only in-combat actions are trackable; gear is only recorded at the start of boss fights). |

The `All`, `settings` tabs of the master are empty template scaffolding and are not
mirrored here.

## Re-fetching

The sheet is publicly readable, so the tabs can be re-exported without credentials:

```bash
curl -sL "https://docs.google.com/spreadsheets/d/1vTE7E1EpWu_DjwoHcVcDrWBb_A3FLYKIUO2YWMOsXQ4/gviz/tq?tqx=out:csv&sheet=trans"
curl -sL "https://docs.google.com/spreadsheets/d/1vTE7E1EpWu_DjwoHcVcDrWBb_A3FLYKIUO2YWMOsXQ4/export?format=xlsx"   # all tabs at once
```
