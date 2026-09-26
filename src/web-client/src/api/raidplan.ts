import { get, send, sendRaw } from "./client";

// ---- Raidplan (src/web/apiRoutes/raidplan.js, docs/raidplan.md) ----

/** What every board object shares: opacity 0.1..1 (zones start at 0.3), locked = cannot be moved, hidden = not drawn. */
/** What the orga changed about an object the tank rows put on the map (lib/raidplan/autoPlace.ts); missing = the default. */
export type RaidplanAutoStyle = { arrowScale?: number; arrowHidden?: boolean; arrowColor?: string; arrowOpacity?: number; size?: number; opacity?: number; ring?: boolean; showName?: boolean; label?: string; showLabel?: boolean; rotation?: number; autoFace?: boolean; hidden?: boolean; lock?: boolean; z?: number };
export type RaidplanLook = { opacity: number; lock: boolean; hidden: boolean; /** false = no ring / border round it (missing = shown) */ ring?: boolean; /** false = no name label at this object (missing = shown) */ showName?: boolean };
export type RaidplanToken = { userId: string; x: number; y: number; size: number } & RaidplanLook;
export type RaidplanTarget = { id: string; title: string; userIds: string[] };
export type RaidplanSlotKind = "tank" | "healer" | "melee" | "ranged" | "dps" | "group" | "label";
/** A placeholder place: tank 1..n, healer 1..n, dps, a group marker (n = the setup group) or a free label; `userId` "" = open. */
/** A raider of a split group who was moved or scaled on his own: relative to the group marker, in board fractions. */
export type RaidplanOffset = { dx: number; dy: number; size: number };
/** A group marker also has hideMembers (only its tag shows), split (its raiders stand around it) and per-raider offsets. */
export type RaidplanSlot = {
    /** a group: its scale as a whole, of its ring spacing and of its member tokens (0.25 .. 4, missing = 1) */
    groupScale?: number;
    ringSpread?: number;
    tokenScale?: number; /** a group: the width of its chip (reference px, 60 .. 400; 0 / missing = as wide as its longest name needs) */ chipWidth?: number; id: string; kind: RaidplanSlotKind; n: number; label: string; x: number; y: number; userId: string; size: number; hideMembers: boolean; split: boolean; offsets: Record<string, RaidplanOffset>; /** the ring round a split group (default shown), its colour ("" = accent) and opacity */ showRing?: boolean; ringColor?: string; ringOpacity?: number; /** a role slot asks for these classes (priority = order); a template fills it from the setup's players of them */ preferredClasses?: string[]; /** filled by class when the template was applied */ byClass?: boolean; /** false = a role slot of the Besetzung that is not on the map (missing = on the map) */ placed?: boolean } & RaidplanLook;
export type RaidplanMarkName = "skull" | "cross" | "square" | "moon" | "triangle" | "diamond" | "circle" | "star";
export type RaidplanMark = { id: string; mark: RaidplanMarkName; x: number; y: number; size: number } & RaidplanLook;
/** An icon on the board: `iconKey` is boss:<encounter id>, wow:<icon name> or enemy / bosspos; size in px, rotation = the way it faces in degrees 0..359 (0 = up, clockwise; boss / enemy / position icons only). */
export type RaidplanIcon = { id: string; iconKey: string; label: string; showLabel: boolean; x: number; y: number; size: number; rotation: number; /** the mob it stands for ("" = none) */ mobId: string; /** turns to the tank of that mob by itself (default on) */ autoFace: boolean; /** the facing wedge: its size (0.25..3, missing = 1), hidden, colour, opacity */ arrowScale?: number; arrowHidden?: boolean; arrowColor?: string; arrowOpacity?: number } & RaidplanLook;
export type RaidplanZoneType = "danger" | "healthy" | "neutral" | "custom" | "role";
/** The role of a role group placeholder ("Melees", "Ranged" ...). */
export type RaidplanRoleGroup = "melee" | "ranged" | "healer" | "tank" | "dps";
/** A rectangle or ellipse area; x/y is its top-left corner, all relative to the board (0..1). */
export type RaidplanZone = { id: string; shape: "rect" | "ellipse" | "cluster"; type: RaidplanZoneType; label: string; color: string; x: number; y: number; w: number; h: number; /** a role group (type "role"): its role, a count badge (0 = none), the setup's players of that role shown in the event */ role?: RaidplanRoleGroup; count?: number; showNames?: boolean; /** a role group turned (degrees, 0 = as drawn) */ rotation?: number; /** a role group: its symbol's scale on top of the automatic size (0.25 .. 3, 1 = automatic) */ iconScale?: number; /** a role group: where its label stands (inside, or outside on one side) */ labelPos?: "in" | "top" | "bottom" | "left" | "right" } & RaidplanLook;
/** An arrow or a plain line from (x1, y1) to (x2, y2), relative to the board; `width` in px. */
export type RaidplanLine = { id: string; kind: "arrow" | "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number } & RaidplanLook;
/** Free text on the board; `size` is the font size in px. */
export type RaidplanText = { id: string; text: string; x: number; y: number; color: string; size: number } & RaidplanLook;
/** One boss's board: free player tokens, slots, marks, zones, target rows, a note, the profile the rows came from. */
export type RaidplanBoard = {
    tokens: RaidplanToken[]; slots: RaidplanSlot[]; marks: RaidplanMark[]; icons: RaidplanIcon[]; zones: RaidplanZone[]; lines: RaidplanLine[]; texts: RaidplanText[];
    targets: RaidplanTarget[]; notes: string; profileId: string;
    /** who heals whom, kicks, curses ... (references only, names come from the setup) */
    assignments: RaidplanAssignment[];
    /** the tactic: ordered steps, who does what, when and how (references only) */
    steps?: RaidplanStep[];
    /** false = this boss / trash section is shown without its map (the objects stay stored) */
    showMap?: boolean;
    /** the tank rows put their mobs and tanks on the map by themselves (default on; lib/raidplan/autoPlace.ts) */
    autoPlace?: boolean;
    /** where an auto-placed object was moved to by hand, by its key ("t:<row>:<n>" / "m:<mob>#<n>") */
    autoPos?: Record<string, { x: number; y: number }>;
    /** not stored: the raiders the tank rows put on the map (they are placed, their group ring closes up) */
    autoUsers?: string[];
    /** how an auto-placed object looks where it was changed, by its key (size, opacity, ring, name, label, facing, hidden, lock, order) */
    autoStyle?: Record<string, RaidplanAutoStyle>;
    /** all auto-placed objects of the section together, 0.4..2 (on top of objectScale) */
    autoScale?: number;
    /** not stored: where the auto-placed objects stand right now (the editor hands it to the selection code) */
    autoAt?: Record<string, { x: number; y: number }>;
    /** how many role slots the Besetzung has on this board (null = the raid type's) */
    counts: BesetzungCounts | null;
    /** mobs added to this section: always tank targets */
    mobs: RaidplanMobRef[];
    /** default assignment cards hidden on this board */
    hiddenCards: string[];
    /** the rows of the template's Standard this boss does not inherit (deviated from / switched off) */
    inheritOff: string[];
    /** the rings round split groups, all at once (default shown) */
    showRings?: boolean;
    /** client only, never saved: where the raiders of split group markers are drawn (so an icon can face a tank who stands in a ring) */
    places?: Record<string, { x: number; y: number }>;
    /** false = this section is left out of the shared sheet (default in) */
    inSheet?: boolean;
    /** the colour ("#rrggbb") and the raid mark of the groups, by group number; missing = the default colour / no mark */
    groupColors?: Record<string, string>;
    groupMarks?: Record<string, string>;
    /** what the board shows besides the icons (all default on): the names, the group number badges, the role rings */
    showNames?: boolean;
    showBadges?: boolean;
    showRoleRings?: boolean;
    /** the saved default view (zoom above 100 % and the centre), null = the whole picture */
    view?: { zoom: number; cx: number; cy: number } | null;
    /** who plays another role on this boss than in the setup: { userId: role } */
    roles: Record<string, string>;
    /** the default size of tokens, slots, marks and icons, 0.5..2 */
    objectScale: number;
    /** how strongly the map shows, 0.1..1 (dim it so the objects stand out) */
    mapOpacity: number;
};
/** A player as the setup names them — never stored in the plan, only referenced by userId. */
export type RaidplanPlayer = {
    userId: string;
    character: string;
    classId: string;
    className: string;
    classColor: string;
    spec: string;
    specLabel: string;
    role: string;
    iconUrl: string;
    group: number;
    /** a Raid-Helper event: the name Raid-Helper shows (a nickname, maybe) - `character` is the profile's character when one was found */
    rhName?: string;
    /** a Raid-Helper event: no profile character was found, `character` is Raid-Helper's name */
    nameFromRh?: boolean;
    /** a Raid-Helper event: Raid-Helper no longer lists him; he keeps his places until the next save with a loaded line-up */
    gone?: boolean;
};
/** Where a Raid-Helper event's players come from right now (raidplanRosterSource.js); null for an own event. */
export type RaidplanRosterSource = {
    kind: "raidhelper";
    /** live / cache = Raid-Helper just answered; last = its last answer; snapshot = a past raid's snapshot; saved = the line-up the plan remembered; none */
    origin: "live" | "cache" | "last" | "snapshot" | "saved" | "none";
    fetchedAt: number;
    available: boolean;
    authoritative: boolean;
    stale: boolean;
    lineupSource: "raidplan" | "signups" | "saved" | "none";
    hasGroups: boolean;
    unknown: string[];
    unmatchedNames: number;
    goneCount: number;
    disabled: boolean;
    error: string;
};
/** A Raid-Helper event's raid plan switch and what its title suggests (GET/POST /api/raidplan/link). */
export type RaidplanLinkInstance = { id: string; name: string; short: string; sizes: number[]; defaultSize: number };
export type RaidplanLinkView = {
    eventId: string;
    title: string;
    enabled: boolean;
    link: { enabled: boolean; instanceIds: string[]; versionId: string; size: number; title: string } | null;
    suggestion: { instanceIds: string[]; size: number; versionId: string };
    instances: RaidplanLinkInstance[];
    hasPlan: boolean;
    published: boolean;
    raidhelperDisabled: boolean;
    /** only on GET: what Raid-Helper lists right now (players, whether it names the groups) */
    lineup?: { count: number; available: boolean; hasGroups: boolean; origin: string; unmatchedNames: number; unknown: string[] };
};
/** What an assignment names: a slot (`tank:1`), a group number, a raider, a raid mark or free text. */
export type RaidplanAssignTarget = { kind: "slot" | "group" | "player" | "mark" | "text" | "mob" | "class" | "role"; ref: string; /** a mob: the snapshot of its name and icon (shown when the catalog entry is gone) */ name?: string; icon?: string; /** a mob: which of several of its kind (1..20; none = the row's own) */ n?: number; /** a mob: the one icon placed on the map it means (the icon's id; its `n` is the icon's number then) - not the kind */ oid?: string };
/** The catalog spell a row is about, with a snapshot of its name and icon. */
export type RaidplanSpellRef = { id: string; name: string; icon: string };
/** A mob added to a section (a tank target; also an icon on the map): the catalog id with a snapshot. */
export type RaidplanMobRef = { id: string; name: string; icon: string };
export type RaidplanAssignType = "tank" | "heal" | "kick" | "md" | "ss" | "fearward" | "special" | "dispel" | "cc" | "buff" | "curse" | "thunderclap" | "demoshout" | "trashtank" | "other";
/** An assignment (spell: the catalog spell it is about): assignees are `slot:<kind>:<n>` or `user:<userId>` (the order is a rotation); `suggested` = made by "Vorschlag", not edited yet. */
export type RaidplanAssignment = { id: string; type: RaidplanAssignType; /** the free text of the task */ title: string; spell: RaidplanSpellRef | null; assignees: string[]; targets: RaidplanAssignTarget[]; note: string; suggested: boolean; /** the class(es) that should do it (class ids; empty = any that fits the type) */ preferredClasses?: string[]; /** a suggestion may take other classes when none of them fits */ allowOthers?: boolean; /** where the row comes from: "default" (the template's Standard) or the id of the default row it deviates from */ origin?: string; /** a raider chosen by hand for a class reference of the row (key: the assignee ref, or "t:" + the target ref) */ picks?: Record<string, string>; /** the same raider may take the task more than once when the class is short */ allowMulti?: boolean };
/** The role slots of a raid: tanks, healers, melee and ranged (the groups follow from the size). */
export type BesetzungCounts = { tank: number; healer: number; dps: number; melee: number; ranged: number };
export type Besetzung = { size: number; counts: BesetzungCounts; groups: number; /** melee / ranged were split by hand */ split: boolean };
export type CatalogSource = "default" | "override" | "custom" | "hidden";
export type CatalogMob = { id: string; name: string; kind: "boss" | "add" | "trash" | "other"; instanceId: string; bossKey: string; icon: string; /** the icon is a similar one, a placeholder */ similar?: boolean; note: string; /** the game versions that have it (missing = all) */ versions?: string[]; source: CatalogSource };
export type CatalogSpell = { id: string; name: string; nameEn: string; icon: string; type: RaidplanAssignType; classes: string[]; note: string; versions?: string[]; source: CatalogSource };
export type Catalog = { mobs: CatalogMob[]; spells: CatalogSpell[] };
export type CatalogAdmin = Catalog & {
    hidden: Catalog; iconChoices: Record<string, string[]>; kinds: string[]; classes: string[]; types: string[];
    instances: { id: string; name: string; short: string; bosses: { key: string; name: string }[] }[];
    limits: { mobs: number; spells: number; name: number; note: number };
    entry?: CatalogMob | CatalogSpell | null;
};
export type RaidplanBoss = {
    /** the template's Standard (the tank / healer basics of every boss), not a boss */
    defaults?: boolean;
    /** "Trash" of an instance / "Allgemein" for the whole raid: no boss, but a board (trash) or only assignments (general) */
    trash?: boolean;
    general?: boolean;
    key: string;
    instanceId: string;
    instanceName: string;
    name: string;
    iconUrl: string;
    mapUrl: string;
    /** which map the board shows: "event" plan's own, "template", "boss" default, "instance" default, "" = grid */
    mapSource: "event" | "template" | "boss" | "instance" | "";
    /** which of the maps exist (the map dialog offers each) */
    eventMap?: boolean;
    templateMap?: boolean;
    ownMap: boolean;
    instanceMap: boolean;
};
export type RaidplanTemplateSummary = { id: string; name: string; category: string; description: string; guildId: string; instanceIds: string[]; bossCount: number };
/** A raid plan template with its boards and the bosses of its instances. */
export type RaidplanTemplate = {
    id: string; name: string; category: string; description: string; guildId: string; instanceIds: string[];
    bosses: Record<string, Partial<RaidplanBoard>>; version: number; updatedAt: number; bossList: RaidplanBoss[];
    catalog: Catalog;
    /** the raid type: its size (0 = the instances' default) and the role counts (null = derived) */
    size: number; counts: BesetzungCounts | null;
    /** what the type comes to: size, counts and number of groups */
    besetzung: Besetzung;
};
/** A named, categorised set of target rows (bossKey: "" = every boss, an instance id, or one boss). */
/** One step of a tactic (docs/raidplan.md, "Taktik"). */
export type RaidplanStepTarget = { kind: "mob" | "zone" | "mark" | "group" | "role"; ref: string; name?: string; icon?: string };
export type RaidplanTiming = { kind: "" | "pull" | "phase" | "hp" | "interval" | "now" | "text"; from: number | null; to: number | null; text: string };
export type RaidplanStep = { id: string; action: string; participants: string[]; sentence: string; targets: RaidplanStepTarget[]; timing: RaidplanTiming };
export type RaidplanProfile = { id: string; name: string; category: string; bossKey: string; steps: RaidplanStep[]; targets: { title: string }[]; notes: string; updatedAt: number };
export type RaidplanProfileInput = { name?: string; category?: string; bossKey?: string; steps?: RaidplanStep[]; targets?: { title: string }[]; notes?: string };
export type RaidplanProfiles = { profiles: RaidplanProfile[]; categories: string[]; profile?: RaidplanProfile };
export type RaidplanView = {
    /** the players of the lineup the logged-in user is (own account + raider profile characters) */
    meIds?: string[];
    eventId: string;
    event: { id: string; title: string; startTime: number };
    canWrite: boolean;
    plan: { version: number; status: "draft" | "published"; publicPath: string; templateId: string; templateName: string; bosses: Record<string, Partial<RaidplanBoard>>; updatedAt: number };
    bosses: RaidplanBoss[];
    besetzung: Besetzung;
    catalog: Catalog;
    roster: RaidplanPlayer[];
    hasApprovedSetup: boolean;
    /** a Raid-Helper event: where its players come from (header note, reload, stale); null for an own event */
    rosterSource?: RaidplanRosterSource | null;
    profiles: RaidplanProfile[];
    templates: RaidplanTemplateSummary[];
    limits: { tokensPerBoss: number; targetsPerBoss: number; usersPerTarget: number; title: number; notes: number; mapBytes: number; profileName: number; profileCategory: number };
    /** Only on a save's answer: tokens or assignments the server left out (a player who is no longer in the setup). */
    dropped?: number;
};
export type RaidplanPublicBoss = {
    key: string; name: string; instanceName: string; iconUrl: string; mapUrl: string; trash: boolean; general: boolean;
    tokens: RaidplanToken[]; slots: RaidplanSlot[]; marks: RaidplanMark[]; icons: RaidplanIcon[]; zones: RaidplanZone[]; lines: RaidplanLine[]; texts: RaidplanText[];
    targets: RaidplanTarget[]; assignments: RaidplanAssignment[]; steps?: RaidplanStep[]; showMap?: boolean; autoPlace?: boolean; autoPos?: Record<string, { x: number; y: number }>; autoStyle?: Record<string, RaidplanAutoStyle>; autoScale?: number; /** who plays another role on this boss (flex): role groups follow it */ roles?: Record<string, string>; notes: string; profileName: string; mapOpacity: number; objectScale: number; showRings?: boolean; inSheet?: boolean; groupColors?: Record<string, string>; groupMarks?: Record<string, string>; showNames?: boolean; showBadges?: boolean; showRoleRings?: boolean; view?: { zoom: number; cx: number; cy: number } | null;
};
export type RaidplanPublic = {
    event: { title: string; startTime: number };
    bosses: RaidplanPublicBoss[];
    hiddenCount?: number;
    roster: RaidplanPlayer[];
    me: string;
    /** every player of the approved setup that is the visitor's: their own account and the characters of their raider profile */
    meIds: string[];
    catalog: Catalog;
    loggedIn: boolean;
};

/** `fresh`: a Raid-Helper event asks Raid-Helper again now instead of the minute's cache ("Neu laden"). */
export function getRaidplan(eventId: string, fresh = false): Promise<RaidplanView> {
    return get<RaidplanView>(`/api/raidplan?event=${encodeURIComponent(eventId)}${fresh ? "&fresh=1" : ""}`);
}

export function getRaidplanLink(eventId: string): Promise<RaidplanLinkView> {
    return get<RaidplanLinkView>(`/api/raidplan/link?event=${encodeURIComponent(eventId)}`);
}

/** Switches a Raid-Helper event's raid plan on (with instances / size / version) or off (the plan stays, its public link goes). */
export function setRaidplanLink(input: { event: string; enabled: boolean; instanceIds?: string[]; size?: number; versionId?: string }): Promise<RaidplanLinkView> {
    return send("POST", "/api/raidplan/link", input);
}

export function saveRaidplan(input: { event: string; version: number; bosses: Record<string, RaidplanBoard> }): Promise<RaidplanView> {
    return send("PUT", "/api/raidplan", input);
}

/** Suggested assignments of one type (nothing is saved); "slots" are the board's placeholder slots as the editor holds them. */
export function suggestRaidplan(input: { event?: string; type: string; preferredClasses?: string[]; allowOthers?: boolean; slots: { kind: string; n: number; userId: string }[]; roles?: Record<string, string>; /** the rows of this type made by hand: the suggestion goes round them */ keep?: RaidplanAssignment[] }): Promise<{ assignments: RaidplanAssignment[] }> {
    return send("POST", "/api/raidplan/suggest", input);
}

export function getRaidplanCatalog(): Promise<CatalogAdmin> {
    return get<CatalogAdmin>("/api/raidplan/catalog");
}

/** Creates (no id) or changes (id; a default's id makes an override) a mob or a spell; answers the whole catalog. */
export function saveCatalogEntry(kind: "mobs" | "spells", input: Partial<CatalogMob & CatalogSpell>): Promise<CatalogAdmin> {
    return send(input.id ? "PATCH" : "POST", `/api/raidplan/catalog/${kind}`, input);
}

/** Deletes an own entry; a default is hidden instead. */
export function deleteCatalogEntry(kind: "mobs" | "spells", id: string): Promise<CatalogAdmin> {
    return send("DELETE", `/api/raidplan/catalog/${kind}`, { id });
}

/** A default entry back to what the code says (its override goes, a hidden one is shown again). */
export function resetCatalogEntry(kind: "mobs" | "spells", id: string): Promise<CatalogAdmin> {
    return send("POST", "/api/raidplan/catalog/reset", { kind, id });
}

export function publishRaidplan(input: { event: string; published: boolean; rotate?: boolean }): Promise<RaidplanView> {
    return send("POST", "/api/raidplan/publish", input);
}

/** Uploads a room map: the file itself is the request body (PNG/JPG/WebP, up to 3 MB). */
export function uploadRaidplanMap(key: string, file: File): Promise<{ key: string }> {
    return sendRaw("POST", `/api/raidplan/map?key=${encodeURIComponent(key)}`, file, file.type || "application/octet-stream");
}

export function deleteRaidplanMap(key: string): Promise<{ key: string; removed: boolean }> {
    return send("POST", "/api/raidplan/map/delete", { key });
}

export function createRaidplanProfile(input: RaidplanProfileInput): Promise<RaidplanProfiles> {
    return send("POST", "/api/raidplan/profiles", input);
}

export function updateRaidplanProfile(id: string, input: RaidplanProfileInput): Promise<RaidplanProfiles> {
    return send("PATCH", "/api/raidplan/profiles", { id, ...input });
}

export function deleteRaidplanProfile(id: string): Promise<RaidplanProfiles> {
    return send("DELETE", "/api/raidplan/profiles", { id });
}

/** The read view behind /p/<token> — no login, the token is the authentication. */
export function getRaidplanPublic(token: string): Promise<RaidplanPublic> {
    return get<RaidplanPublic>(`/api/raidplan/public?token=${encodeURIComponent(token)}`);
}

export function applyRaidplanTemplate(input: { event: string; templateId: string; version: number }): Promise<RaidplanView> {
    return send("POST", "/api/raidplan/apply", input);
}

export type RaidplanTemplates = { templates: RaidplanTemplate[]; template?: RaidplanTemplate; dropped?: number };
export type RaidplanTemplateInput = { name?: string; category?: string; description?: string; guildId?: string; instanceIds?: string[]; size?: number; counts?: BesetzungCounts | null };

export function getRaidplanTemplates(): Promise<RaidplanTemplates> {
    return get<RaidplanTemplates>("/api/raidplan/templates");
}

export function createRaidplanTemplate(input: RaidplanTemplateInput): Promise<RaidplanTemplates> {
    return send("POST", "/api/raidplan/templates", input);
}

/** Changes fields and/or, with `bosses` + the `version` that was read, the boards. */
export function updateRaidplanTemplate(id: string, input: RaidplanTemplateInput & { bosses?: Record<string, RaidplanBoard>; version?: number }): Promise<RaidplanTemplates> {
    return send("PATCH", "/api/raidplan/templates", { id, ...input });
}

export function duplicateRaidplanTemplate(id: string): Promise<RaidplanTemplates> {
    return send("POST", "/api/raidplan/templates/duplicate", { id });
}

export function deleteRaidplanTemplate(id: string): Promise<RaidplanTemplates> {
    return send("DELETE", "/api/raidplan/templates", { id });
}

export function getRaidplanProfiles(): Promise<RaidplanProfiles> {
    return get<RaidplanProfiles>("/api/raidplan/profiles");
}
