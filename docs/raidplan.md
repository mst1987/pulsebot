# Raidplan

Endnutzer-Sicht: siehe [guide-web-admin.md#raidplan](guide-web-admin.md#raidplan).

The raid plan of an event — an own one, or a Raid-Helper event whose plan the orga switched on (see
"Raid-Helper-Events"): **one plan per event, one board per boss** — the room map as the background, player
tokens placed freely on it, target rows with the players assigned to them, and a note. It sits next to the
Google raidsheet (`fillSetup`, `eventSheetStore`), which stays unchanged and independent. The design canvas it
follows is the "Raidplan" artifact (Boards, Editor, Sheet view).

The details are split by topic; code comments that cite `docs/raidplan.md, "<section>"` find the section in
the table below.

| File | What it covers | Sections |
|---|---|---|
| [raidplan/model.md](raidplan/model.md) | where the code lives, the stored plan, the Besetzung, the assignments, permissions, Raid-Helper events, the test raid and the tests | Where it lives; Data model; The Besetzung and the raid type; Assignments ("Einteilungen"); Permissions; Test raid (dev); Tests; Raid-Helper-Events (feature/raidplan-12) |
| [raidplan/catalog.md](raidplan/catalog.md) | the mob and spell catalog, raid plan templates, tactic profiles and the tactic steps of a section | Catalog: mobs and spells; Raid plan templates; Tactic profiles; Tactic ("Taktik", feature/raidplan-8) |
| [raidplan/editor.md](raidplan/editor.md) | the board editor: layout, pickers, rows and references, multi-selection and the rounds of editor work | Layout, flyout pickers, cards, chips (Sept 2026); Editor; Round 3 (Sept 2026): modal pickers, layout v2, multi-select, Standard, classes, roster dialog; Round 4 (Sept 2026): reference space, classes, groups, zoom, views; Count and round robin of class references (feature/raidplan-6b); Round 7 (feature/raidplan-7): the row dialog "Variante B" and the row container; Follow-up (feature/raidplan-2); Follow-up 4; Follow-up 5; Follow-up 6; Unsaved changes stand out (plan and template editor); Round 13 (feature/raidplan-13): one mob of several, the zoom as in the sheet, options of a multi-selection |
| [raidplan/board.md](raidplan/board.md) | room maps, map upload, auto placement, facing arrows, role groups, names on the map and the section bar | Room maps; Map upload size (proxy limit); Map on / off per section and "Allgemein" first; Auto placement from the tank rows (feature/raidplan-9); Facing arrow per icon and role group placeholders (feature/raidplan-10); Round 11 (feature/raidplan-11): width, role groups for "Meine Aufgaben", a turned role group; Names on the map (feature/raidplan-14); Role groups: turned, names inside, symbol size, label outside (feature/raidplan-16); Section bar and boss icons (feature/raidplan-16, part 3) |
| [raidplan/sharing.md](raidplan/sharing.md) | the read view of the assignments and the public read view `/p/<token>` | The read view of the assignments; Read view (`/p/<token>`); "All assignments" never cuts a name (feature/raidplan-16, part 2) |
