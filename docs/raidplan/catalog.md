# Raidplan: catalog, templates and tactic

Part of the raid plan docs, see [the entry page](../raidplan.md) for the other parts. Endnutzer-Sicht: siehe
[guide-web-admin.md#raidplan](../guide-web-admin.md#raidplan).

## Catalog: mobs and spells

Admin page **Raid-Events → Raidplan-Katalog** (`/raids/plan-catalog`, area `raids`; API
`/api/raidplan/catalog`, `/catalog/mobs`, `/catalog/spells`, `/catalog/reset`, store
`raidplanCatalogStore.js`). Two layers kept apart: the **defaults** in code (`raidplanCatalogDefaults.js`) and
the admin's changes in `data/settings/raidplan-catalog.json` (`mobs`, `spells`: an entry under a default's id
**overrides** it, a new one gets a `c:` id; `hiddenMobs` / `hiddenSpells`). Deleting a default hides it,
"reset" removes the override / the hiding — no migration is ever needed.

- **Mobs** `{ id, name, kind: boss | add | trash | other, instanceId, bossKey, icon, note }`; `icon` is a
  Wowhead icon name, `boss:<encounter id>` or empty (generic enemy icon). A mob with a `bossKey` is one of
  that boss's adds; a trash mob belongs to the instance.
- **Spells** `{ id, name, nameEn, icon, type (an assignment type), classes, note }`. The classes of a type's
  spells are what the suggestions and the pre-selection use (`classesFor`, `classesForType`); without spells
  of a type the built in list applies.
- **Defaults** (only what is certain; names from Wowhead TBC / warcraft.wiki.gg, see the header of the
  defaults file; the rest can be added by the admin): Black Temple — the four Illidari Council members
  (Gathios the Shatterer, High Nethermancer Zerevor, Lady Malande, Veras Darkshadow), Illidan's Flame of
  Azzinoth, Shadow Demon, Parasitic Shadowfiend and Maiev Shadowsong, the Ashtongue Channeler / Sorcerer /
  Defender / Elementalist / Rogue of Shade of Akama, the Essences of the Reliquary, Teron Gorefiend's Shadowy
  Construct and Vengeful Spirit, four Illidari trash mobs; Hyjal Summit — Towering Infernal (Anetheron),
  Lesser Doomguard (Azgalor), Doomfire Spirit (Archimonde), five wave mobs; a few adds of Karazhan,
  Serpentshrine Cavern, The Eye and the Sunwell. Spells: the six curses, Thunder Clap, Demoralizing Shout,
  Misdirection, Tricks of the Trade, Soulstone, Fear Ward, Kick / Pummel / Shield Bash / Earth Shock /
  Counterspell, Dispel Magic / Cleanse / Purge / Remove Curse / Cure Poison, Innervate, Bloodlust, Heroism,
  Power Infusion, Shackle Undead, Polymorph, Hibernate, Banish, Taunt, Growl. Not in there (add per admin if
  wanted): Supremus's volcanoes, Hyjal wave details beyond the five, most trash.
- **Real portraits (43 of the 46 default mobs, Sept 2026):** `scripts/data/raidplanMobNpcs.js` names the Wowhead
  NPC of each default mob (TBC Classic database, e.g. Gathios 22949). `scripts/fetch-mob-icons.js` fetches the
  NPC page (its title has to name the mob, else the mob is skipped and reported), reads the display id and
  downloads the **model render** of that display,
  `https://wow.zamimg.com/modelviewer/tbc/webthumbs/npc/<displayId % 256>/<displayId>.png` (300 px,
  transparent, the renders Wowhead's model viewer shows; Blizzard artwork, the same class of origin as the
  boss icons and raid marks). A small own PNG codec (`scripts/lib/png.js`, only node's zlib, no dependency)
  finds the figure's box and crops a square: **head and shoulders** for an upright figure, the **whole
  creature** for a compact one (infernal, elemental, fiend); it is scaled to 64 px and stored as
  `src/web-client/public/mobs/<npcId>.png` (about 8 KB each, 350 KB in all). The icon key is `mob:<npcId>`
  (validated everywhere `boss:<id>` is: catalog, assignment snapshots, board icons and mobs; client
  `portraitUrl` in `lib/raidplan/facing.ts`). The JSON records per portrait the NPC id, the page's name, the display
  id, the crop and the request check (200, image/png). Only the mobs without a portrait stay
  "Platzhalter-Icon": **Doomfire Spirit, Towering Infernal, Giant Infernal** (their Wowhead pages name no
  display, so there is no render). Not used: the Encounter Journal images
  (`wow.zamimg.com/images/wow/journal/ui-ej-boss-*.png` exist for whole encounters, e.g. `illidari-council`,
  not for single adds), the WCL asset CDN has no NPC images (`img/warcraft/npcs/...` answers 403), and guide
  screenshots of other sites are not scraped. `--force` fetches the renders again, `--offline` only re-derives
  the mapping. `test/services/raidplan/raidplanMobPortraits.test.js` fails when an NPC of the table has no verified
  portrait, no stored file or a wrong size; `test/scripts/png.test.js` covers the codec and the crop.
- **Placeholder mob icons** (`scripts/fetch-mob-icons.js` -> generated `src/config/generated/mobIcons.json`, the table
  to edit is `scripts/data/raidplanMobIconRules.js`; never edit the JSON). **Source check:** the boss icons come
  from Warcraft Logs (`scripts/fetch-boss-icons.js`, `public/bosses/<encounter id>.jpg`, artwork of the game
  as WCL shows it); WCL lists encounters only, it has no icon for a boss's adds or for trash, so no real NPC
  pictures are available from that source. Every default mob therefore gets a **similar WoW icon** from the
  Wowhead icon CDN (the one the menu already uses for spells; game artwork, hotlinked like the spell icons, no
  files in the repo), picked by the kind of creature; the catalog marks them "Platzhalter-Icon" and an admin
  can override any of them (an override is not marked). The script requests every candidate (HTTP 200 and an
  image), takes the first that exists and writes the check of each icon into the JSON — nothing is entered
  blind; `test/stores/raidplanCatalogStore.test.js` fails when a default mob has no icon or an icon that was not
  checked. Mapping kind -> icon: infernal spell_shadow_summoninfernal; doomguard spell_shadow_summonfelguard;
  demon spell_shadow_summonvoidwalker; fel spell_fire_felflamestrike; undead spell_shadow_animatedead;
  necromancer spell_shadow_deathcoil; caster spell_frost_frostbolt02; priest spell_holy_holybolt; rogue
  ability_stealth; guard ability_warrior_defensivestance; warrior ability_warrior_charge; paladin
  spell_holy_sealofmight; ranged ability_marksmanship; beast ability_hunter_beasttaming; shaman
  spell_nature_lightning; fire spell_fire_incinerate; water spell_frost_summonwaterelemental_2; tainted
  spell_nature_acid_01; arcane spell_arcane_arcane01; shadow spell_shadow_shadowfury; drain
  spell_shadow_lifedrain02; fiend spell_shadow_shadowfiend; horse ability_mount_ridinghorse; engineer
  inv_misc_gear_01 (the second candidates in the table are the fallbacks). The admin's mob form has an icon
  picker (categories Demon, Undead, Elemental, Guard, Caster, Rogue, Beast, Ranged, Other, with a search)
  besides the free icon name. Mobs show as round icons in the tank-target picker, the "Mobs" bar, the icon
  objects on the map and the catalog list.
- **References in a plan are ids with a snapshot.** A row has `spell: { id, name, icon }`, a target `{ kind:
  "mob", ref, name, icon }`, a section `mobs: [{ id, name, icon }]`. The editor and the read view show the
  live catalog entry when it still exists, else the snapshot — a deleted entry never leaves a broken display.
  Editor, template and read view get the catalog with their payload (`catalog`).
- **Tank targets:** every boss section has the boss as a target (`b:<boss key>`), plus the catalog's adds of
  that boss (trash: the trash mobs of the instance) and the mobs added by hand ("Mobs" bar: "+" picks from the
  whole catalog, grouped "Zu diesem Boss / Diese Instanz / Alle Mobs"; the crosshair puts a mob on the map as
  a round icon with a facing wedge). The target picker of tanking, trash tank, special tank, CC, kick and
  dispel rows lists them first (`sectionMobs`); a new tanking row of a boss starts with the boss as its
  target.
- **Spell picker:** rows of a type that has spells pick one (fitting classes of the assignees first); its icon
  and name show in the row, the card and the read view. The suggestions fill the spell (curses: one per
  warlock in the catalog's order, thunder clap / demoralizing shout, misdirect, soulstone, fear ward).

## Raid plan templates

Admin page **Raid-Events → Raidplan-Vorlagen** (`/raids/plan-templates`, area `raids`; list first,
`?edit=<id>` is the editor, `?edit=new` the create dialog). A template is a named layout — "Montags-Raid" —
that lays out the coarse plan **without players**: per boss placeholder slots, raid marks, zones, target rows
and a note. `data/settings/raidplan-templates.json`: `{ id, name, category, description, guildId, instanceIds,
bosses, version, updatedAt }`.

- `guildId` is optional (the Discord event server it is for; "" = every server). A template made for another
  server is not offered for an event on this one and cannot be applied to it. `instanceIds` (at least one)
  decide which bosses can have a board; changing them drops the boards of bosses no longer covered.
- **No players in a template:** `cleanBoard` runs with an empty set of allowed players and no free tokens, so
  a slot's `userId`, tokens and row assignments are always emptied. Its own room map per boss is uploaded in
  the editor (`t/<id>/<boss>`).
- Saving the boards needs the `version` that was read (409 `conflict` otherwise); renaming and the other
  fields do not.
- **Applying** (`POST /api/raidplan/apply { event, templateId, version }`, or "Vorlage wählen" in the event's
  Raidplan tab; the default is "Leer" = no template): `raidplanStore.applyTemplate` copies the template into
  the plan **as a snapshot** — every boss the template and the event both have gets the template's board (new
  ids, no tokens), other bosses are left alone, `templateId` is remembered for the display, the plan's version
  bumps. **There is no live link:** changing or deleting the template afterwards never reaches a plan that
  already exists (only the template's map is looked up live). The editor asks first when the plan already
  holds something or has unsaved edits.
- **Slots are filled from the setup** (`raidplanBoard.fillSlots`, from the editor's roster in setup order):
  `tank n` gets the tanks in order, `healer n` the healers, `melee` and `ranged` the damage dealers of that
  role, `dps` the remaining ones; a slot nobody fits stays **open** and is marked on the board (dashed role
  icon, "N Slots offen" in the tool bar). A `group n` marker needs no filling: it names the players of setup
  group `n`. A label slot is filled by hand.
- **The overview** (`TemplateList` in `RaidplanTemplatesPage.tsx`) shows one card per template, newest change
  first: a thumbnail (the first filled boss, drawn by the board itself, read-only), name, chips (category,
  server, instances), a segment per boss (filled or not), "N Bosse befüllt" (real de/en plurals) and the date
  of the last change. The whole card opens the editor. Icon actions: properties (name, category, server,
  instances), duplicate, delete (a confirmation names what is lost). Search over name, category and
  description, filters by instance and category, an empty state with a call to action. Duplicate = `POST
  /api/raidplan/templates/duplicate { id }` (copy "<name> (Kopie)", new ids, the template's maps are copied);
  delete = `DELETE /api/raidplan/templates { id }` (its maps go with it, applied plans keep their copy).
- After applying, everything is adjusted one by one in the event plan: reassign a slot (dialog, or drop a
  player from the list onto it), move or delete slots, marks and zones, add new ones, edit the rows.

**Templates and tactic profiles complement each other, and are kept simple:** a template is the *layout of the
board* (where things stand), a tactic profile is a *snippet of target rows* (titles + note, by category) that
can be picked on any board — in a template as well as in an event plan. Applying a template copies its rows
(and its `profileId`); picking a profile afterwards replaces the rows as before.

## Tactic profiles

> Since feature/raidplan-8 a profile holds **steps** and applying one ADDS them (see "Tactic" at the end);
> what follows describes the older row-title profiles, which are read as note steps.

A named, categorised set of target rows the orga picks for a boss instead of typing the rows again.
`data/settings/raidplan-profiles.json`: `{ id, name, category, bossKey, targets: [{ title }], notes, updatedAt
}`.

- `category` is free text (the editor offers the ones in use and lets a new one be typed); `bossKey` is `""`
  (every boss), an instance id, or one boss.
- **Nothing is shipped** and no boss mechanics are invented; a profile holds only what the orga wrote. Titles
  only: **who stands on a row is decided per plan**. A token layout is not part of a profile (follow-up).
- API (area `raids`, GET reads, the rest writes, CSRF): `GET/POST/PATCH/DELETE /api/raidplan/profiles`. The
  editor payload carries the list too.
- In the board: "Taktik wählen" opens the picker (the profiles that fit the boss, grouped by category, with a
  search). Picking one **replaces the rows and the note** (asked first when the board already holds something;
  players stay on rows whose title stays) and remembers the `profileId` in the plan. "Als Taktik speichern"
  (from the rows on the board) and "Taktiken verwalten" sit in the picker's foot. Managing follows the
  collection pattern of docs/web-admin.md: **list first, one editor at a time**; a profile's rows are edited
  as one title per line. Renaming or changing a profile does not touch rows that were applied earlier — the
  plan stores copies plus the profile id; the read view shows the profile's current name.

## Tactic ("Taktik", feature/raidplan-8)

Design: the Raidplan canvas, boards `Taktiken` and `Taktiken-Details`. **Einteilung** = who is responsible for
what for the whole fight (cards per type, no order); **Taktik** = the sequence: who does what, when and how,
as numbered steps with a sentence ("Magier-Tank tankt Zerevor · Pull"). Rule of thumb: a line with a moment or
a verb is a step.

- **Data** (`src/services/raidplan/raidplanSteps.js`, client `lib/raidplan/steps.ts`): every section board (boss, trash, Allgemein;
  also in templates) has `steps: [{ id, action, participants, sentence, targets, timing }]`, at most 30.
  `action` is one of 13 fixed actions (tank, swap, kite, adds, interrupt, dispel, cc, soak, focus, buff, heal,
  wait, note; each with an inline line icon, the colour = its group: tanks blue, control violet, position
  amber, support cyan, flow grey — `components/raidplan/ActionIcon.tsx`). `participants` are the references of
  the assignments (`slot:`, `user:` in event plans only, `class:<Class>:<n>[:<role>|:any]`,
  `class:Any:<n>:<role>`) plus `group:<n>`; `sentence` free text (160 characters); `targets` a mob (id +
  snapshot of name / icon), a zone of the map by name (`{ kind: "zone", ref: "Arena" }`), a raid mark or a
  group; `timing` `{ kind: "" | pull | phase | hp | interval | now | text, from, to, text }` (phase 1-9,
  health 1-100 with an optional lower end, interval 1-600 s, a free word; `lib/raidplan/steps.timingLabel`: "Pull",
  "Phase 2", "bei 30 %", "50 → 30 %", "Pull → 30 %", "alle 30 s", "sofort"). `cleanSteps` (part of
  `cleanBoard`, every save) turns an unknown action into "note", drops unknown references (a player outside
  the lineup, any player in a template or a library tactic), cuts texts, clamps numbers and drops a step
  without sentence, participants and targets.
- **Resolution**: each step ON ITS OWN through the central `expandClassRefs` (the same "Magier 1" in two steps
  is the same raider; a tactic is a sequence, not a round robin); the action implies the role like the
  assignments (tank / swap / adds -> tank specs, heal -> healers, kite -> none: `TASK_OF`). A class nobody
  fills stays its reference: the yellow dashed chip "Magier-Tank 1 fehlt", never another class. The editor
  resolves live (`resolveParticipants`), the sheet gets the steps resolved by the server (`resolveSteps` in
  `publicView`, sections left out of the sheet are not sent). A player outside his spec role on a tanking step
  carries "als Tank".
- **Editor** (`StepsCard.tsx`, under the assignment cards of every section, also in the template editor): head
  with the explanation, "Aus Bibliothek wählen", "+ Schritt", "Als Taktik speichern" and "Alle Schritte
  entfernen" (asks). One container per step in the grid `Nr | action | who | sentence · target | when |
  actions`; the targets stand as chips where the sentence names them (`sentenceParts`). The whole row opens
  the step dialog (stretched button), the grip drags it to another place (Pointer Events), Alt + ↑/↓ moves it,
  Entf deletes after asking, duplicate and delete in the row (Ctrl+Z brings everything back). Empty: an
  explanation and three starter tactics (Kiten, Tanktausch, Adds; slots only, texts of the current language,
  `starterTactics`) with "Vorlage übernehmen".
- **Step dialog** (`StepModal.tsx`, one page, no scrolling, the building blocks of the assignment dialog): 1
  action (icon grid), 2 who (chosen chips; tabs Spieler (event plans) / Rollen-Slots / Klassen / Gruppen with
  a search; a class tile adds the class with the task's role — on a tanking step a non-tank class of any spec
  —, its card has the count and the role chips incl. "Alle Specs"), 3 sentence (the action's suggestions as
  chips, "…" is filled with the first mob target or the boss; "@" offers raiders and mobs as chips under the
  field, ↑/↓ and Enter pick: a raider joins the participants, a mob the targets), 4 when and target (chips for
  the timing kinds with their numbers, targets: the section's mobs with portraits, "Arena" and the map's named
  zones, marks, groups, a free area name), the preview "So steht es im Plan", foot "Schritt entfernen /
  Abbrechen / Fertig" (Ctrl+Enter, Esc; the native dialog traps the focus). Phone (< 900 px): full screen, the
  four parts are tabs. Measured without scroll bar at 1440x900, 1920x1080 and 390x844 with 25 raiders.
- **Library** (the tactic profiles, `raidplanProfileStore`): a profile is now `{ name, category, bossKey,
  steps, notes }`; the offered categories are Kiten, Tanktausch, Adds, Dispel, Phase 2 (free text stays
  possible). `LibraryModal`: category tabs, search, six tiles; "Auf diesen Boss anwenden" **adds** the steps
  under the section's (nothing is replaced, so nothing is asked; `applyTactic` also remembers the profile and
  takes its note when the board has none). "Schritte dieses Abschnitts als Taktik speichern" keeps slots and
  classes and leaves players out; "Taktiken verwalten" renames, files under a category, sets where it applies,
  deletes (the steps are edited on a board).
- **Migration, nothing lost**: an old profile (row titles + note) is read with each title as a "note" step
  without participants (stable ids `t1`, `t2` …) and keeps its note; the board's old note field stays as the
  note under the steps ("Notiz"); rows an old profile once wrote into the assignments ("Sonstiges") stay
  assignments. Boards without `steps` read as none.
- **Sheet** (`ReadSteps.tsx`): the tactic after the assignments; "Was tue ich?" first (the viewer's own steps
  — his player or his group —, the verb in the du form `duForm`: "tankt" -> "tankst", "hält" -> "hältst",
  English "tanks" -> "tank"; his chip carries "DU", the one mark), then "Alle Schritte" in their order (his
  own dimmed there so the numbers do not jump); on a phone the rows wrap.
- Tests: `test/services/raidplan/raidplanSteps.test.js` (validation, template without players, clamping, board, resolution
  incl. mage tank / missing class, migration of profiles), `src/web-client/src/lib/raidplan/steps.test.ts` (editing and
  sorting, timing words, sentence parts, du form, @ mentions, resolution, library, starters, structure,
  texts).
