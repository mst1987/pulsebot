// The raid plan's board logic (docs/raidplan.md), pure: what a board looks like
// when nothing is stored, who is not placed yet, adding / moving / scaling /
// duplicating / ordering / locking / removing board objects (player tokens,
// slots, marks, zones, lines, texts), the right-click menu's items and what they
// do, undo/redo, applying a tactic profile, grouping profiles for the picker. The
// server checks and cleans every save again; these rules keep the page consistent
// while the orga works.
//
// One module to import ("lib/raidplan"), split by topic (#438):
//   model       constants, types, an empty board, the sections, undo/redo
//   players     who is placed where: tokens, groups, members, the roster
//   objects     adding, changing, looking, duplicating, ordering, removing objects
//   autoStyle   the look of what the tank rows put on the map, the facing wedge
//   geometry    moving, resizing and scaling objects and groups
//   labels      rings, labels and names on the board, the map's height, the layer list
//   facing      angles and compass, icon keys and portraits
//   menu        the right-click menu's items and what they do
//   besetzung   the role slots of a raid and their counts
//   profiles    tactic profiles, sheets, section labels
//   roleGroups  role group placeholders: their size, names and turning
// The other raid plan libs next to these (assign.ts, autoPlace.ts, steps.ts …)
// are imported by their own path.
export * from "./model";
export * from "./players";
export * from "./objects";
export * from "./autoStyle";
export * from "./geometry";
export * from "./labels";
export * from "./facing";
export * from "./menu";
export * from "./besetzung";
export * from "./profiles";
export * from "./roleGroups";
