// The raid plan's assignments ("Einteilungen", docs/raidplan.md), pure: what a reference
// means (a slot placeholder, a raider, a group, a raid mark, free text), how the rows are
// edited, which types a board offers, and where the thin connection lines on the map go.
// The server checks and cleans every save again and makes the suggestions
// (src/web/raidplanAssign.js); these rules keep the page consistent while the orga works.
//
// Written to be strippable (src/web-client/src/lib/assign.test.ts runs it, with `t` injected):
// imports, `export type`, tables and one-line signatures only, no typed locals or casts.
import { mentionsInRow } from "./mention";
import { ANY, parseClassRef } from "./classRefs";
import type { Catalog, CatalogMob, CatalogSpell, RaidplanAssignment, RaidplanAssignTarget, RaidplanAssignType, RaidplanBoard, RaidplanMobRef, RaidplanPlayer, RaidplanSlot, RaidplanSpellRef } from "../../api";
import { t } from "../../i18n";

/** Per type: its icon, where it is offered and which classes can do it (a filter for the picker, never a rule). */
export const ASSIGN_META = {
    tank: { icon: "ability_warrior_defensivestance", classes: [] },
    heal: { icon: "spell_holy_flashheal", classes: [] },
    kick: { icon: "ability_kick", classes: ["Rogue", "Shaman", "Warrior", "Mage"] },
    md: { icon: "ability_hunter_misdirection", classes: ["Hunter", "Rogue"] },
    ss: { icon: "spell_shadow_soulgem", classes: ["Warlock"] },
    fearward: { icon: "spell_holy_excorcism", classes: ["Priest"] },
    special: { icon: "inv_shield_06", classes: [] },
    dispel: { icon: "spell_holy_dispelmagic", classes: ["Priest", "Paladin", "Shaman", "Druid"] },
    cc: { icon: "spell_nature_polymorph", classes: ["Mage", "Hunter", "Rogue", "Druid", "Warlock", "Priest"] },
    buff: { icon: "spell_holy_prayeroffortitude", classes: [] },
    curse: { icon: "spell_shadow_chilltouch", classes: ["Warlock"] },
    thunderclap: { icon: "spell_nature_thunderclap", classes: ["Warrior"] },
    demoshout: { icon: "ability_warrior_warcry", classes: ["Warrior"] },
    trashtank: { icon: "ability_defend", classes: [] },
    other: { icon: "inv_misc_note_01", classes: [] },
} as Record<string, { icon: string; classes: string[] }>;
export const SUGGESTABLE = ["heal", "kick", "md", "ss", "fearward", "curse", "thunderclap", "demoshout", "trashtank"];
export const SCOPE_TYPES = {
    boss: ["tank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "other"],
    trash: ["trashtank", "tank", "heal", "kick", "cc", "dispel", "other"],
    general: ["curse", "thunderclap", "demoshout", "buff", "other"],
    defaults: ["tank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "other"],
} as Record<string, string[]>;
/** The role icons the raid detail already uses for its role groups. */
export const ROLE_ICON = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_dualwield",
    ranged: "inv_weapon_bow_07",
    dps: "inv_misc_questionmark",
} as Record<string, string>;
/** The fixed order of the cards: tanking, healing, interrupts ... (the same in the editor, the template and the read view). */
export const CARD_ORDER = ["tank", "trashtank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "curse", "thunderclap", "demoshout", "other"];
/** The cards an area always has in the editor, even empty. */
export const DEFAULT_CARDS = {
    boss: ["tank", "heal"],
    trash: ["trashtank", "heal"],
    general: ["curse", "thunderclap", "demoshout"],
    defaults: ["tank", "heal"],
} as Record<string, string[]>;

/**
 * Which cards to show, in the fixed order: the area's default cards (editor only), every type that
 * has a row, and the cards added by hand (`extra`, editor only). The read view (`readOnly`) shows only
 * cards with content.
 */
export function cardTypes(scope: string, assignments: RaidplanAssignment[], extra: string[], readOnly: boolean, hidden: string[]): string[] {
    const want = new Set(assignments.map((a) => a.type as string));
    if (!readOnly) {
        for (const x of DEFAULT_CARDS[scope] || DEFAULT_CARDS.boss) if ((hidden || []).indexOf(x) < 0) want.add(x);
        for (const x of extra) want.add(x);
    }
    return CARD_ORDER.filter((x) => want.has(x));
}

/** The types a card can still be added for (the area's types that are not shown yet). */
export function addableCards(scope: string, shown: string[]): string[] {
    const types = SCOPE_TYPES[scope] || SCOPE_TYPES.boss;
    return CARD_ORDER.filter((x) => types.indexOf(x) >= 0 && shown.indexOf(x) < 0);
}

/** Whether a card is one of the area's default cards (those are hidden, the others removed). */
export function isDefaultCard(scope: string, type: string): boolean {
    return (DEFAULT_CARDS[scope] || DEFAULT_CARDS.boss).indexOf(type) >= 0;
}

/** Hides a default card on this board (kept in the plan, so the template, the event and everybody sees the same); its rows, if any, go with it. */
export function hideCard(board: RaidplanBoard, type: string): RaidplanBoard {
    const hidden = (board.hiddenCards || []).indexOf(type) >= 0 ? board.hiddenCards : [...(board.hiddenCards || []), type];
    return { ...board, hiddenCards: hidden, assignments: board.assignments.filter((a) => a.type !== type) };
}

/** Brings a hidden default card back. */
export function showCard(board: RaidplanBoard, type: string): RaidplanBoard {
    return { ...board, hiddenCards: (board.hiddenCards || []).filter((x) => x !== type) };
}

/** Removes a card: the rows of its type are deleted (one Undo brings them back). */
export function removeCard(board: RaidplanBoard, type: string): RaidplanBoard {
    return { ...board, assignments: board.assignments.filter((a) => a.type !== type) };
}

/** The rows of one card, in their stored order. */
export function rowsOfType(assignments: RaidplanAssignment[], type: string): RaidplanAssignment[] {
    return assignments.filter((a) => a.type === type);
}

/** A new empty row of a card's type. */
export function addRowOfType(board: RaidplanBoard, type: string): { board: RaidplanBoard; id: string } {
    return addAssignment(board, type);
}

// The spell / ability icon of a task, found by a word in its text (a curse, an interrupt, Thunder Clap ...).
export const TEXT_ICONS = [
    ["curse of the elements", "spell_shadow_chilltouch"], ["fluch der elemente", "spell_shadow_chilltouch"], ["elements", "spell_shadow_chilltouch"],
    ["recklessness", "spell_shadow_unholystrength"], ["tollkühn", "spell_shadow_unholystrength"],
    ["doom", "spell_shadow_auraofdarkness"], ["verdammnis", "spell_shadow_auraofdarkness"],
    ["agony", "spell_shadow_curseofsargeras"], ["qual", "spell_shadow_curseofsargeras"],
    ["tongues", "spell_shadow_curseoftounges"], ["sprachen", "spell_shadow_curseoftounges"],
    ["weakness", "spell_shadow_curseofmannoroth"], ["schwäche", "spell_shadow_curseofmannoroth"],
    ["thunder clap", "spell_nature_thunderclap"], ["donnerknall", "spell_nature_thunderclap"],
    ["demoralizing", "ability_warrior_warcry"], ["demoralisierend", "ability_warrior_warcry"],
    ["counterspell", "spell_frost_iceshock"], ["gegenzauber", "spell_frost_iceshock"],
    ["earth shock", "spell_nature_earthshock"], ["erdschock", "spell_nature_earthshock"],
    ["pummel", "inv_gauntlets_04"], ["shield bash", "ability_warrior_shieldbash"], ["schildschlag", "ability_warrior_shieldbash"],
    ["kick", "ability_kick"], ["tritt", "ability_kick"],
    ["misdirect", "ability_hunter_misdirection"], ["irreführ", "ability_hunter_misdirection"],
    ["soulstone", "spell_shadow_soulgem"], ["seelenstein", "spell_shadow_soulgem"],
    ["fear ward", "spell_holy_excorcism"], ["furchtschutz", "spell_holy_excorcism"],
    ["dispel", "spell_holy_dispelmagic"], ["polymorph", "spell_nature_polymorph"], ["verwandlung", "spell_nature_polymorph"],
];

/** The icon a text names (a curse, an interrupt ...), or "" when it names none. */
export function iconForText(text: string): string {
    const low = text.toLowerCase();
    const hit = TEXT_ICONS.find((x) => low.indexOf(x[0]) >= 0);
    return hit ? hit[1] : "";
}

/** The icon of a row: what its task text or a text target names, else the icon of its type. */
export function iconForTask(a: RaidplanAssignment): string {
    if (a.spell && a.spell.icon) return a.spell.icon;
    const fromTitle = iconForText(a.title || "");
    if (fromTitle) return fromTitle;
    for (const tg of a.targets) {
        const hit = tg.kind === "text" ? iconForText(tg.ref) : "";
        if (hit) return hit;
    }
    return (ASSIGN_META[a.type] || ASSIGN_META.other).icon;
}

/** Ready-made texts for a type's target picker (the curses, the interrupts). */
export function quickTexts(type: string): string[] {
    if (type === "curse") return ["Curse of the Elements", "Curse of Recklessness", "Curse of Doom", "Curse of Agony", "Curse of Tongues", "Curse of Weakness"];
    if (type === "kick") return ["Kick", "Pummel", "Shield Bash", "Counterspell", "Earth Shock"];
    return [];
}

export const SLOT_ORDER = ["tank", "healer", "melee", "ranged", "dps"];
export const HEAL_COLOR = "#35d6c4";
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];

/** Which area a boss entry is: the whole raid, the trash of an instance or a boss. */
export function scopeOf(boss: { trash?: boolean; general?: boolean; defaults?: boolean }): string {
    return boss.defaults ? "defaults" : boss.general ? "general" : boss.trash ? "trash" : "boss";
}

export function assignTypes(scope: string): string[] {
    return SCOPE_TYPES[scope] || SCOPE_TYPES.boss;
}

/** The classes a row is meant for: its own preferred classes, else the ones that can do its type (none = everybody). */
export function rowClasses(row: { type: string; preferredClasses?: string[] }, catalog?: Catalog | null): string[] {
    return row.preferredClasses && row.preferredClasses.length > 0 ? row.preferredClasses : classesForType(row.type, catalog);
}

/** The WoW classes a row can prefer, and a class's icon name. */
export const CLASS_IDS = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
export function classIconOf(classId: string): string {
    return `classicon_${String(classId || "").toLowerCase()}`;
}

/** A player whose class is not among the row's preferred ones (the row names none: nobody is out of place). */
export function outOfClass(row: { preferredClasses?: string[] }, player: { classId: string } | null): boolean {
    return !!player && !!row.preferredClasses && row.preferredClasses.length > 0 && row.preferredClasses.indexOf(player.classId) < 0;
}

/** Players of a roster in the order a picker shows them: the preferred classes first (in the order they were chosen), then the rest. */
export function playersByClass<T extends { classId: string }>(list: T[], preferred: string[]): T[] {
    if (!preferred || preferred.length === 0) return list;
    function rank(p) {
        const i = preferred.indexOf(p.classId);
        return i < 0 ? preferred.length : i;
    }
    return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Whether a player's class is one the type suggests (no class list = everybody). */
export function fitsType(type: string, player: RaidplanPlayer, catalog?: Catalog | null): boolean {
    const classes = classesForType(type, catalog);
    return classes.length === 0 || classes.indexOf(player.classId) >= 0;
}

/** The classes that can do a type: the catalog's spells of that type say it, else the built in list (none = everybody). */
export function classesForType(type: string, catalog?: Catalog | null): string[] {
    const own = [];
    if (catalog) for (const s of catalog.spells) if (s.type === type) for (const c of s.classes) if (own.indexOf(c) < 0) own.push(c);
    return own.length > 0 ? own : (ASSIGN_META[type] || ASSIGN_META.other).classes;
}

/** The spells a row of a type can pick: the catalog's of that type; `classIds` (the assignees' classes) put the fitting ones first. */
export function spellsFor(type: string, catalog: Catalog | null | undefined, classIds: string[]): CatalogSpell[] {
    const list = catalog ? catalog.spells.filter((s) => s.type === type) : [];
    return [...list.filter((s) => spellFits(s, classIds)), ...list.filter((s) => !spellFits(s, classIds))];
}

function spellFits(s: CatalogSpell, classIds: string[]): boolean {
    return classIds.length === 0 || s.classes.length === 0 || s.classes.some((c) => classIds.indexOf(c) >= 0);
}

/** The reference a row keeps for a catalog spell: id and a snapshot of name and icon. */
export function spellRef(spell: CatalogSpell): RaidplanSpellRef {
    return { id: spell.id, name: spell.name, icon: spell.icon };
}

/** The reference a section keeps for a mob: id and a snapshot of name and icon. */
export function mobRef(mob: CatalogMob): RaidplanMobRef {
    return { id: mob.id, name: mob.name, icon: mob.icon };
}

/** The icon key of a boss image url (/bosses/601.jpg -> boss:601, an icon CDN url -> its name), "" for none. */
export function bossIconOf(url: string): string {
    const boss = url.match(/\/bosses\/(\d+)\.jpg/);
    if (boss) return `boss:${boss[1]}`;
    const wow = url.match(/\/icons\/[a-z]+\/([a-z0-9_'-]+)\.jpg/);
    return wow ? wow[1] : "";
}

/** The icon object a mob makes on the map: the boss image (boss:N) or portrait (mob:N), a spell icon (wow:name) or the built in enemy symbol. */
export function mobIconKey(icon: string): string {
    return icon.indexOf("boss:") === 0 || icon.indexOf("mob:") === 0 ? icon : icon ? `wow:${icon}` : "enemy";
}

/** Adds mobs to the section (each once) and takes one away again. */
export function addMobs(board: RaidplanBoard, mobs: RaidplanMobRef[]): RaidplanBoard {
    return { ...board, mobs: [...board.mobs, ...mobs.filter((m) => board.mobs.every((x) => x.id !== m.id))] };
}

export function removeMob(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, mobs: board.mobs.filter((m) => m.id !== id) };
}

function pushUnique(out: RaidplanMobRef[], m: RaidplanMobRef): void {
    if (out.every((x) => x.id !== m.id)) out.push(m);
}

/** The target a mob makes (the id with a snapshot). */
export function mobTarget(m: RaidplanMobRef): RaidplanAssignTarget {
    return { kind: "mob", ref: m.id, name: m.name, icon: m.icon };
}

/**
 * Everything that can be tanked or marked in a section, as tank targets: the boss (a boss section always has
 * it; `bossIcon` is its icon key), the catalog's mobs that belong to the boss (a trash section: the trash mobs of
 * the instance) and the mobs added to the board — each once, in that order.
 */
export function sectionMobs(scope: string, bossKey: string, bossName: string, bossIcon: string, instanceId: string, board: RaidplanBoard, catalog: Catalog | null | undefined): RaidplanMobRef[] {
    const out = [];
    if (scope === "boss") pushUnique(out, { id: `b:${bossKey}`, name: bossName, icon: bossIcon });
    // the Standard has no boss of its own: "the boss of the section this row lands in"
    if (scope === "defaults") pushUnique(out, { id: "b:this", name: t("raidBoard.defaults.thisBoss"), icon: "" });
    if (catalog && scope !== "general" && scope !== "defaults") {
        for (const m of catalog.mobs) {
            if (scope === "boss" ? m.bossKey === bossKey : m.kind === "trash" && m.instanceId === instanceId && m.bossKey === "") pushUnique(out, mobRef(m));
        }
    }
    for (const m of board.mobs) pushUnique(out, m);
    return out;
}

/** The slot placeholders a board can be referred by, in role order: `{ ref: "healer:2", kind, n }`. */
export function slotChoices(slots: RaidplanSlot[]): { ref: string; kind: string; n: number }[] {
    const seen = new Set();
    const out = [];
    for (const s of slots) {
        const key = `${s.kind}:${s.n}`;
        if (SLOT_ORDER.indexOf(s.kind) < 0 || seen.has(key)) continue;
        seen.add(key);
        out.push({ ref: key, kind: s.kind, n: s.n });
    }
    return out.sort((a, b) => SLOT_ORDER.indexOf(a.kind) - SLOT_ORDER.indexOf(b.kind) || a.n - b.n);
}

/** What a reference is looked up in: the board's slots and the setup's players by userId. */
export type AssignCtx = { slots: RaidplanSlot[]; players: Map<string, RaidplanPlayer>; catalog?: Catalog | null; /** the colour / raid mark of the groups (lib/groupStyle.ts) */ groupColors?: Record<string, string>; groupMarks?: Record<string, string>; /** the rows with their class references resolved (lib/classRefs.ts), same order: what the chips show */ filled?: RaidplanAssignment[]; /** who plays another role on this boss (flex): the role groups follow it */ roles?: Record<string, string>; /** the section's placed icons: a target of one of several mob icons is called by its number on the map ("Flame 2") */ icons?: { id: string; mobId?: string; hidden?: boolean }[] };
/** A reference resolved for display: its label, who it is now (null = open or not a person), and its kind. */
export type Resolved = { kind: string; ref: string; label: string; player: RaidplanPlayer | null; open: boolean; mark: string; group: number; role: string; icon: string; /** a class reference: the class */ classId?: string };

const NONE = { kind: "", ref: "", label: "", player: null, open: false, mark: "", group: 0, role: "", icon: "" };

function slotLabel(kind: string, n: number): string {
    return t(`raidBoard.slot.${kind}`, { n });
}

function slotPlayer(ctx: AssignCtx, kind: string, n: number): RaidplanPlayer | null {
    const s = ctx.slots.find((x) => x.kind === kind && x.n === n && x.userId);
    return s ? ctx.players.get(s.userId) || null : null;
}

/** What a class (or general role) place is called, without its number: "Jäger", "Tank (Krieger)", "Tank" (any tank), "Priester (Heiler)". */
export function classPlaceName(classId: string, role: string): string {
    if (classId === ANY) return t(`raidBoard.class.roles.${role || "dps"}`);
    if (role === "tank") return t("raidBoard.class.tankOf", { cls: t(`wow.class.${classId}`) });
    if (role === "any") return t(`wow.class.${classId}`);
    return t(`wow.class.${classId}`) + (role ? ` (${t(`raidBoard.class.roles.${role}`)})` : "");
}

/** The kinds of task that are tanking: a class of any spec on them reads as a class tank ("Magier-Tank"). */
const TANKING = ["tank", "trashtank", "special"];

/** A class place as a row of this kind of task names it: on a tanking row a class of any spec is "Magier-Tank"; else as classPlaceName. */
export function classPlaceNameFor(classId: string, role: string, type: string): string {
    if (TANKING.indexOf(type) >= 0 && classId !== ANY && (role === "any" || (role === "" && type === "special"))) return t("raidBoard.class.classTank", { cls: t(`wow.class.${classId}`) });
    if (role === "any") return t("raidBoard.class.anySpecOf", { cls: t(`wow.class.${classId}`) });
    return classPlaceName(classId, role);
}

/** The label of a class reference with its running number: "Jäger 1", "Jäger 2", "Tank (Krieger) 1", "Tank 2". */
export function classRefLabel(ref: string): string {
    const q = parseClassRef(ref);
    return q ? `${classPlaceName(q.classId, q.role)} ${q.n}` : ref;
}

/** The label of a class reference on a row of this kind of task: "Magier-Tank 1" on a tanking row, else as classRefLabel. */
export function classRefLabelFor(ref: string, type: string): string {
    const q = parseClassRef(ref);
    return q ? `${classPlaceNameFor(q.classId, q.role, type)} ${q.n}` : ref;
}

/** Whether a player stands in a row outside his spec role: a mage on a tanking row ("als Tank"); only tanking rows say so. */
export function offRole(type: string, player: RaidplanPlayer | null): boolean {
    return !!player && TANKING.indexOf(type) >= 0 && player.role !== "tank";
}

/** The icon of a class reference: the class icon, for "any <role>" the role's icon. */
export function classRefIcon(classId: string, role: string): string {
    return classId === ANY ? ROLE_ICON[role] || ROLE_ICON.dps : classIconOf(classId);
}

/** A class reference nobody fills (yet): an open place with the class icon and its name with the running number; `role` is its role filter. */
function classResolved(ref: string): Resolved {
    const q = parseClassRef(ref);
    if (!q) return { ...NONE, ref, label: ref };
    return { ...NONE, kind: "class", ref, label: classRefLabel(ref), open: true, role: q.role, icon: classRefIcon(q.classId, q.role), classId: q.classId };
}

/** A role group ("Melees", "Ranged" ...): the role's icon and the group's name; it names nobody (the sheet works without the setup). */
function roleResolved(role: string): Resolved {
    return { ...NONE, kind: "role", ref: role, label: t(`raidBoard.roleGroup.${role}`), role, icon: ROLE_ICON[role] || ROLE_ICON.dps };
}

/** The role groups the dialog offers, as assignee references and as targets. */
export const ROLE_REFS = ["melee", "ranged", "healer", "tank", "dps"];
/** The colour of a role group chip (the board's role colours). */
export const ROLE_TONE = { melee: "#f97316", ranged: "#a78bfa", healer: "#35d6c4", tank: "#60a5fa", dps: "#f5c542" };

/** An assignee: `slot:<kind>:<n>` (the placeholder, or who stands in it) or `user:<userId>`. */
export function resolveAssignee(ref: string, ctx: AssignCtx): Resolved {
    const p = ref.split(":");
    if (p[0] === "slot") {
        const n = Number(p[2]);
        const player = slotPlayer(ctx, p[1], n);
        return { ...NONE, kind: "slot", ref, label: slotLabel(p[1], n), player, open: !player, role: p[1] };
    }
    if (p[0] === "class") return classResolved(ref);
    // a whole role group ("Melees"): its role icon and name, never players, never open
    if (p[0] === "role") return roleResolved(p[1]);
    if (p[0] === "user") {
        const player = ctx.players.get(p[1]) || null;
        return { ...NONE, kind: "user", ref, label: player ? player.character : "?", player, open: !player };
    }
    return { ...NONE, ref, label: ref };
}

/** The number of a placed icon among the visible icons of its mob (1, 2 ...), 0 = the only one; -1 = it is not on the map (any more). */
export function iconNumber(icons: { id: string; mobId?: string; hidden?: boolean }[], ref: string, id: string): number {
    const list = icons.filter((ic) => !ic.hidden && ic.mobId === ref);
    const at = list.findIndex((ic) => ic.id === id);
    if (at < 0) return -1;
    return list.length > 1 ? at + 1 : 0;
}

/** A target: a slot, a group, a raider, a raid mark or free text. */
export function resolveTarget(target: RaidplanAssignTarget, ctx: AssignCtx): Resolved {
    if (target.kind === "slot") {
        const p = target.ref.split(":");
        const player = slotPlayer(ctx, p[0], Number(p[1]));
        return { ...NONE, kind: "slot", ref: target.ref, label: slotLabel(p[0], Number(p[1])), player, open: !player, role: p[0] };
    }
    if (target.kind === "class") return { ...classResolved(target.ref), ref: target.ref };
    if (target.kind === "role") return { ...roleResolved(target.ref), ref: target.ref };
    if (target.kind === "group") return { ...NONE, kind: "group", ref: target.ref, label: t("raidBoard.slot.group", { n: Number(target.ref) }), group: Number(target.ref) };
    if (target.kind === "player") {
        const player = ctx.players.get(target.ref) || null;
        return { ...NONE, kind: "player", ref: target.ref, label: player ? player.character : "?", player, open: !player };
    }
    if (target.kind === "mob") {
        // the live catalog entry when there is one, else the snapshot the plan keeps
        const live = ctx.catalog ? ctx.catalog.mobs.find((m) => m.id === target.ref) : undefined;
        // one of several of its kind: "Flame of Azzinoth 2" - a target of one placed icon by that icon's number on the map (when the map is at hand)
        const base = live ? live.name : target.name || "?";
        const no = target.oid && ctx.icons ? iconNumber(ctx.icons, target.ref, target.oid) : -1;
        const n = no >= 0 ? no : target.n || 0;
        return { ...NONE, kind: "mob", ref: target.ref, label: n ? `${base} ${n}` : base, icon: live ? live.icon : target.icon || "" };
    }
    if (target.kind === "mark") return { ...NONE, kind: "mark", ref: target.ref, label: t(`raidBoard.mark.${target.ref}`), mark: target.ref };
    return { ...NONE, kind: "text", ref: target.ref, label: target.ref };
}

/**
 * Whether a raider belongs to a role group ("Melees" ...): his spec role from the setup, a flex role on this boss wins; "dps" = everybody
 * who is neither tank nor healer. The server twin is src/web/raidplanAssign.js inRoleGroup (kept in step by the tests).
 */
export function inRoleGroup(role: string, playerRole: string): boolean {
    if (!role || !playerRole) return false;
    return role === "dps" ? playerRole !== "tank" && playerRole !== "healer" : playerRole === role;
}

/** Whether one of the viewer's own players is in a role group (his role on this boss). */
export function meInRole(role: string, ctx: AssignCtx, me: string[]): boolean {
    return me.some((id) => { const p = ctx.players.get(id); return !!p && inRoleGroup(role, (ctx.roles || {})[id] || p.role); });
}

/** Whether the viewer (`me`: their own players' userIds) is part of an assignment: as assignee, as a target, in a targeted group or role group. */
export function isMine(a: RaidplanAssignment, ctx: AssignCtx, me: string[], names: string[] = []): boolean {
    if (me.length === 0) return false;
    if (a.assignees.some((r) => isMe(resolveAssignee(r, ctx), me) || (r.indexOf("role:") === 0 && meInRole(r.slice(5), ctx, me)))) return true;
    // named in words: the title, the note or a free-text target
    if (names.length > 0 && mentionsInRow(a, names)) return true;
    const groups = me.map((id) => (ctx.players.get(id) || { group: -1 }).group);
    return a.targets.some((tg) => { const r = resolveTarget(tg, ctx); return isMe(r, me) || (r.kind === "group" && groups.indexOf(r.group) >= 0) || (r.kind === "role" && meInRole(r.role, ctx, me)); });
}

/** Whether a resolved reference is one of the visitor's own players. */
export function isMe(r: Resolved, me: string[]): boolean {
    return !!r.player && me.indexOf(r.player.userId) >= 0;
}

/** Two targets are the same one: a mob target of one placed icon (`oid`) is only that icon, never the kind (lib/autoPlace.ts sameTargetAs). */
function sameTarget(x: RaidplanAssignTarget, y: RaidplanAssignTarget): boolean {
    return x.kind === y.kind && x.ref === y.ref && (x.kind !== "mob" || (x.oid || "") === (y.oid || ""));
}

// ---- editing --------------------------------------------------------------------------------

function newRowId(): string {
    return `a${Math.random().toString(36).slice(2, 9)}`;
}

export function addAssignment(board: RaidplanBoard, type: string): { board: RaidplanBoard; id: string } {
    const id = newRowId();
    const row = { id, type: type as RaidplanAssignType, title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, preferredClasses: [], allowOthers: false };
    return { board: { ...board, assignments: [...(board.assignments || []), row] }, id };
}

/** Changes one row; touching it is an edit by hand, so it is no longer "Vorschlag". */
export function patchAssignment(board: RaidplanBoard, id: string, patch: Partial<RaidplanAssignment>): RaidplanBoard {
    return { ...board, assignments: board.assignments.map((a) => (a.id === id ? { ...a, suggested: false, ...patch } : a)) };
}

export function removeAssignment(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, assignments: board.assignments.filter((a) => a.id !== id) };
}

/** Adds the assignee, or takes it away when it is already there (a multi-select). */
export function toggleAssignee(board: RaidplanBoard, id: string, ref: string): RaidplanBoard {
    const a = board.assignments.find((x) => x.id === id);
    if (!a) return board;
    const has = a.assignees.indexOf(ref) >= 0;
    return patchAssignment(board, id, { assignees: has ? a.assignees.filter((r) => r !== ref) : [...a.assignees, ref] });
}

export function toggleTarget(board: RaidplanBoard, id: string, target: RaidplanAssignTarget): RaidplanBoard {
    const a = board.assignments.find((x) => x.id === id);
    if (!a) return board;
    return patchAssignment(board, id, { targets: a.targets.some((x) => sameTarget(x, target)) ? a.targets.filter((x) => !sameTarget(x, target)) : [...a.targets, target] });
}

/** Moves an assignee one place in the rotation (1, 2, 3 ...). */
export function moveAssignee(board: RaidplanBoard, id: string, ref: string, dir: number): RaidplanBoard {
    const a = board.assignments.find((x) => x.id === id);
    if (!a) return board;
    const i = a.assignees.indexOf(ref);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= a.assignees.length) return board;
    const next = [...a.assignees];
    next[i] = next[j];
    next[j] = ref;
    return patchAssignment(board, id, { assignees: next });
}

/** Puts suggestions in: the earlier suggestions of that type (still unedited) are replaced, rows made by hand stay. */
export function applySuggestions(board: RaidplanBoard, type: string, list: RaidplanAssignment[]): RaidplanBoard {
    const kept = board.assignments.filter((a) => !(a.type === type && a.suggested));
    return { ...board, assignments: [...kept, ...list.map((a) => ({ ...a, suggested: true }))] };
}

// ---- lines on the map -----------------------------------------------------------------------

export type AssignLink = { key: string; x1: number; y1: number; x2: number; y2: number; color: string; /** the line concerns one of the visitor's own characters */ mine?: boolean };

/** Where a reference stands on the board (a slot, the slot or token a raider is in, a mark), or null. */
function position(board: RaidplanBoard, kind: string, ref: string) {
    if (kind === "slot") {
        const p = ref.split(":");
        const s = board.slots.find((x) => x.kind === p[0] && x.n === Number(p[1]) && !x.hidden && x.placed !== false);
        return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === "group") {
        const s = board.slots.find((x) => x.kind === "group" && x.n === Number(ref) && !x.hidden && x.placed !== false);
        return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === "mark") {
        const m = board.marks.find((x) => x.mark === ref && !x.hidden);
        return m ? { x: m.x, y: m.y } : null;
    }
    if (kind === "player" || kind === "user") {
        const s = board.slots.find((x) => x.userId === ref && !x.hidden && x.placed !== false);
        if (s) return { x: s.x, y: s.y };
        const tk = board.tokens.find((x) => x.userId === ref && !x.hidden);
        if (tk) return { x: tk.x, y: tk.y };
        // a raider who stands in the ring of a split group marker: the place the board drew him at (handed over by the board as `places`)
        return board.places && board.places[ref] ? board.places[ref] : null;
    }
    return null;
}

/** The player behind a reference of a line: a raider, or whoever stands in a slot ("" for anything else). */
function linkPlayer(board: RaidplanBoard, kind: string, ref: string): string {
    if (kind === "player" || kind === "user") return ref;
    if (kind !== "slot") return "";
    const q = ref.split(":");
    const s = board.slots.find((x) => x.kind === q[0] && x.n === Number(q[1]));
    return s ? s.userId : "";
}

/** The thin lines of the heal assignments (healer to what it heals), for the ones whose two ends are ON THE MAP: a slot or group that only stands in the Besetzung (placed: false) has no place, so no line is drawn to or from it. */
export function assignmentLinks(board: RaidplanBoard, me: string[] = []): AssignLink[] {
    const out = [];
    for (const a of board.assignments || []) {
        if (a.type !== "heal") continue;
        for (const r of a.assignees) {
            const p = r.split(":");
            const from = p[0] === "slot" ? position(board, "slot", `${p[1]}:${p[2]}`) : position(board, "user", p[1]);
            if (!from) continue;
            for (const tg of a.targets) {
                const to = position(board, tg.kind, tg.ref);
                const mine = me.length > 0 && (me.indexOf(linkPlayer(board, p[0] === "slot" ? "slot" : "user", p[0] === "slot" ? `${p[1]}:${p[2]}` : p[1])) >= 0 || me.indexOf(linkPlayer(board, tg.kind, tg.ref)) >= 0);
                if (to) out.push({ key: `${a.id}:${r}:${tg.kind}:${tg.ref}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: HEAL_COLOR, mine });
            }
        }
    }
    return out;
}

/**
 * The tanks of a mob, in the order of the rows: for every tank row that targets the mob, its first assignee whose place is on the map (a placed slot, or a
 * free token; an assignee that is not placed is skipped, the next one of the row counts), each place once. `board.assignments` must be the EFFECTIVE rows of the
 * section (its own rows and the ones it inherits from the Standard, class references resolved) - that is what the callers hand over.
 */
export function tanksOfMob(board: RaidplanBoard, mobId: string, iconId = ""): { x: number; y: number }[] {
    const out = [];
    if (!mobId) return out;
    for (const a of board.assignments || []) {
        const type = a.type as string;
        if (type !== "tank" && type !== "trashtank") continue;
        // `iconId` "": the rows that mean the mob as such; an icon's id: the rows that mean exactly that placed icon
        if (!(a.targets || []).some((tg) => tg.kind === "mob" && tg.ref === mobId && (iconId ? tg.oid === iconId : !tg.oid || !placedIcon(board, tg)))) continue;
        for (const r of a.assignees || []) {
            const p = r.split(":");
            const at = p[0] === "slot" ? position(board, "slot", `${p[1]}:${p[2]}`) : position(board, "user", p[1]);
            if (at) { if (!out.some((x) => x.x === at.x && x.y === at.y)) out.push(at); break; }
        }
    }
    return out;
}

/** The first tank of a mob that stands on the map, or null (then nothing turns by itself). */
export function tankOfMob(board: RaidplanBoard, mobId: string): { x: number; y: number } | null {
    const all = tanksOfMob(board, mobId);
    return all.length > 0 ? all[0] : null;
}

type FacingIcon = { id?: string; x: number; y: number; rotation: number; mobId?: string; iconKey?: string; autoFace?: boolean };

/** Whether a mob target's placed icon (`oid`) stands on the board for that mob (else the target means the kind again). */
function placedIcon(board: RaidplanBoard, tg: RaidplanAssignTarget): boolean {
    return !!tg.oid && (board.icons || []).some((ic) => ic.id === tg.oid && ic.mobId === tg.ref && !ic.hidden);
}

/** The icons of a mob some row means one by one (a target with their `oid`): the kind's rows leave them alone. */
function namedIcons(board: RaidplanBoard, mobId: string): string[] {
    const out = [];
    for (const a of board.assignments || []) for (const tg of a.targets || []) if (tg.kind === "mob" && tg.ref === mobId && tg.oid && placedIcon(board, tg) && out.indexOf(tg.oid) < 0) out.push(tg.oid);
    return out;
}

/** The mobs a tank row of the section targets that an icon stands for: its own mob; a boss icon without a mob is the section's boss ("b:...", also a Standard row's resolved "boss of this section"). */
function mobRefsOfIcon(board: RaidplanBoard, icon: FacingIcon): string[] {
    if (icon.mobId) return [icon.mobId];
    if (String(icon.iconKey || "").indexOf("boss:") !== 0) return [];
    const out = [];
    for (const a of board.assignments || []) {
        if ((a.type as string) !== "tank" && (a.type as string) !== "trashtank") continue;
        for (const tg of a.targets || []) if (tg.kind === "mob" && tg.ref.indexOf("b:") === 0 && out.indexOf(tg.ref) < 0) out.push(tg.ref);
    }
    return out;
}

/** The angle (0 = straight up, clockwise, degrees) from a point to another, on a board that is `ar` times as wide as high. */
export function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }, ar: number): number {
    const dx = (to.x - from.x) * ar;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return 0;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
}

/**
 * The facing an icon is drawn with: towards the tank of the mob it stands for when it follows the tank (the default) and one stands on the map, else its own
 * rotation - never a jump to a default when the tank is not placed. Several icons of one mob (two Flames of Azzinoth) take the tanks of that mob in the
 * order of the icons; with fewer tanks than icons the extra ones follow the first. Pure: the effective rows and the board's places in, an angle out, so
 * the editor, the template editor and the read view show the same (there is no cache to go stale).
 */
export function facingOf(board: RaidplanBoard, icon: FacingIcon, ar: number): number {
    if (icon.autoFace === false) return icon.rotation || 0;
    const refs = mobRefsOfIcon(board, icon);
    if (refs.length === 0) return icon.rotation || 0;
    // an icon a row means by itself ("Tank 2 -> Flame 2") turns to that row's tank, and only that one
    if (icon.id && icon.mobId && namedIcons(board, icon.mobId).indexOf(icon.id) >= 0) {
        const own = tanksOfMob(board, icon.mobId, icon.id);
        return own.length > 0 ? angleBetween(icon, own[0], ar) : icon.rotation || 0;
    }
    const all = [];
    for (const r of refs) for (const t of tanksOfMob(board, r)) if (!all.some((x) => x.x === t.x && x.y === t.y)) all.push(t);
    if (all.length === 0) return icon.rotation || 0;
    // the icons that stand for the same mob, in the board's order: the n-th takes the n-th tank (the ones a row means by themselves are not counted)
    const named = icon.mobId ? namedIcons(board, icon.mobId) : [];
    const peers = (board.icons || []).filter((x) => !x.hidden && named.indexOf(x.id) < 0 && (icon.mobId ? x.mobId === icon.mobId : !x.mobId && String(x.iconKey || "").indexOf("boss:") === 0));
    const at = icon.id ? peers.findIndex((x) => x.id === icon.id) : 0;
    const tank = all[at >= 0 && at < all.length ? at : 0];
    return angleBetween(icon, tank, ar);
}

/** Whether an icon is turned by its tank right now (for the inspector's hint). */
export function followsTank(board: RaidplanBoard, icon: FacingIcon): boolean {
    if (icon.autoFace === false) return false;
    if (icon.id && icon.mobId && namedIcons(board, icon.mobId).indexOf(icon.id) >= 0) return tanksOfMob(board, icon.mobId, icon.id).length > 0;
    return mobRefsOfIcon(board, icon).some((r) => tanksOfMob(board, r).length > 0);
}

/** How many assignments a board has (the boss chip's dot counts them too). */
export function assignmentCount(board: RaidplanBoard): number {
    return (board.assignments || []).length;
}

export const ALL_MARKS = MARKS;
