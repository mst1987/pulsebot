// The raid plan's assignments ("Einteilungen", docs/raidplan.md), pure: what a reference
// means (a slot placeholder, a raider, a group, a raid mark, free text), how the rows are
// edited, which types a board offers, and where the thin connection lines on the map go.
// The server checks and cleans every save again and makes the suggestions
// (src/web/raidplanAssign.js); these rules keep the page consistent while the orga works.
//
// Written to be strippable (test/web-client/assign.test.js runs it, with `t` injected):
// imports, `export type`, tables and one-line signatures only, no typed locals or casts.
import type { Catalog, CatalogMob, CatalogSpell, RaidplanAssignment, RaidplanAssignTarget, RaidplanAssignType, RaidplanBoard, RaidplanMobRef, RaidplanPlayer, RaidplanSlot, RaidplanSpellRef } from "../api";
import { t } from "../i18n";

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

/** One thing somebody has to do: its icon and a short sentence ("Heilt Tank 1 + Gruppe 3"). */
export type Task = { id: string; type: string; icon: string; text: string };
/** What one assignee has to do in a section: the assignee (a player, or a placeholder slot) and their tasks. */
export type PlayerTasks = { key: string; who: Resolved; tasks: Task[] };

const SENTENCE_TYPES = ["heal", "md", "ss", "fearward", "tank"];

/** The sentence of a row for one of its assignees (`index` = the place in a rotation, 0 = first). */
export function taskText(a: RaidplanAssignment, index: number, ctx: AssignCtx): string {
    const targets = a.targets.map((tg) => resolveTarget(tg, ctx).label).join(" + ");
    if (!a.title && !a.spell && SENTENCE_TYPES.indexOf(a.type) >= 0 && targets) return t(`raidBoard.assign.sentence.${a.type}`, { targets });
    const head = a.title || (a.spell ? a.spell.name : t(`raidBoard.assign.type.${a.type}`));
    const rot = a.type === "kick" && a.assignees.length > 1 ? ` #${index + 1}` : "";
    return `${head}${rot}${targets ? ` \u2192 ${targets}` : ""}`;
}

/** The tasks of a section derived from its assignments, per assignee (a filled slot counts as its player), in the order they first appear. */
export function tasksByAssignee(assignments: RaidplanAssignment[], ctx: AssignCtx): PlayerTasks[] {
    const out = [];
    for (const a of assignments) {
        a.assignees.forEach((ref, i) => {
            const who = resolveAssignee(ref, ctx);
            const key = who.player ? `u:${who.player.userId}` : ref;
            let row = out.find((x) => x.key === key);
            if (!row) { row = { key, who, tasks: [] }; out.push(row); }
            row.tasks.push({ id: `${a.id}:${i}`, type: a.type, icon: iconForTask(a), text: taskText(a, i, ctx) });
        });
    }
    return out;
}

/** The tasks of the visitor's own players, in the order of the rows. */
export function myTasks(assignments: RaidplanAssignment[], ctx: AssignCtx, me: string[]): Task[] {
    return tasksByAssignee(assignments, ctx).filter((x) => isMe(x.who, me)).flatMap((x) => x.tasks);
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
export type AssignCtx = { slots: RaidplanSlot[]; players: Map<string, RaidplanPlayer>; catalog?: Catalog | null };
/** A reference resolved for display: its label, who it is now (null = open or not a person), and its kind. */
export type Resolved = { kind: string; ref: string; label: string; player: RaidplanPlayer | null; open: boolean; mark: string; group: number; role: string; icon: string };

const NONE = { kind: "", ref: "", label: "", player: null, open: false, mark: "", group: 0, role: "", icon: "" };

function slotLabel(kind: string, n: number): string {
    return t(`raidBoard.slot.${kind}`, { n });
}

function slotPlayer(ctx: AssignCtx, kind: string, n: number): RaidplanPlayer | null {
    const s = ctx.slots.find((x) => x.kind === kind && x.n === n && x.userId);
    return s ? ctx.players.get(s.userId) || null : null;
}

/** An assignee: `slot:<kind>:<n>` (the placeholder, or who stands in it) or `user:<userId>`. */
export function resolveAssignee(ref: string, ctx: AssignCtx): Resolved {
    const p = ref.split(":");
    if (p[0] === "slot") {
        const n = Number(p[2]);
        const player = slotPlayer(ctx, p[1], n);
        return { ...NONE, kind: "slot", ref, label: slotLabel(p[1], n), player, open: !player, role: p[1] };
    }
    if (p[0] === "user") {
        const player = ctx.players.get(p[1]) || null;
        return { ...NONE, kind: "user", ref, label: player ? player.character : "?", player, open: !player };
    }
    return { ...NONE, ref, label: ref };
}

/** A target: a slot, a group, a raider, a raid mark or free text. */
export function resolveTarget(target: RaidplanAssignTarget, ctx: AssignCtx): Resolved {
    if (target.kind === "slot") {
        const p = target.ref.split(":");
        const player = slotPlayer(ctx, p[0], Number(p[1]));
        return { ...NONE, kind: "slot", ref: target.ref, label: slotLabel(p[0], Number(p[1])), player, open: !player, role: p[0] };
    }
    if (target.kind === "group") return { ...NONE, kind: "group", ref: target.ref, label: t("raidBoard.slot.group", { n: Number(target.ref) }), group: Number(target.ref) };
    if (target.kind === "player") {
        const player = ctx.players.get(target.ref) || null;
        return { ...NONE, kind: "player", ref: target.ref, label: player ? player.character : "?", player, open: !player };
    }
    if (target.kind === "mob") {
        // the live catalog entry when there is one, else the snapshot the plan keeps
        const live = ctx.catalog ? ctx.catalog.mobs.find((m) => m.id === target.ref) : undefined;
        return { ...NONE, kind: "mob", ref: target.ref, label: live ? live.name : target.name || "?", icon: live ? live.icon : target.icon || "" };
    }
    if (target.kind === "mark") return { ...NONE, kind: "mark", ref: target.ref, label: t(`raidBoard.mark.${target.ref}`), mark: target.ref };
    return { ...NONE, kind: "text", ref: target.ref, label: target.ref };
}

/** Whether the viewer (`me`: their own players' userIds) is part of an assignment: as assignee, as a target, or in a targeted group. */
export function isMine(a: RaidplanAssignment, ctx: AssignCtx, me: string[]): boolean {
    if (me.length === 0) return false;
    if (a.assignees.some((r) => isMe(resolveAssignee(r, ctx), me))) return true;
    const groups = me.map((id) => (ctx.players.get(id) || { group: -1 }).group);
    return a.targets.some((tg) => { const r = resolveTarget(tg, ctx); return isMe(r, me) || (r.kind === "group" && groups.indexOf(r.group) >= 0); });
}

/** Whether a resolved reference is one of the visitor's own players. */
export function isMe(r: Resolved, me: string[]): boolean {
    return !!r.player && me.indexOf(r.player.userId) >= 0;
}

function sameTarget(x: RaidplanAssignTarget, y: RaidplanAssignTarget): boolean {
    return x.kind === y.kind && x.ref === y.ref;
}

// ---- editing --------------------------------------------------------------------------------

function newRowId(): string {
    return `a${Math.random().toString(36).slice(2, 9)}`;
}

export function addAssignment(board: RaidplanBoard, type: string): { board: RaidplanBoard; id: string } {
    const id = newRowId();
    const row = { id, type: type as RaidplanAssignType, title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, preferredClasses: [], allowOthers: false };
    return { board: { ...board, assignments: [...board.assignments, row] }, id };
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

export type AssignLink = { key: string; x1: number; y1: number; x2: number; y2: number; color: string };

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
        return tk ? { x: tk.x, y: tk.y } : null;
    }
    return null;
}

/** The thin lines of the heal assignments (healer to what it heals), for the ones whose two ends are ON THE MAP: a slot or group that only stands in the Besetzung (placed: false) has no place, so no line is drawn to or from it. */
export function assignmentLinks(board: RaidplanBoard): AssignLink[] {
    const out = [];
    for (const a of board.assignments) {
        if (a.type !== "heal") continue;
        for (const r of a.assignees) {
            const p = r.split(":");
            const from = p[0] === "slot" ? position(board, "slot", `${p[1]}:${p[2]}`) : position(board, "user", p[1]);
            if (!from) continue;
            for (const tg of a.targets) {
                const to = position(board, tg.kind, tg.ref);
                if (to) out.push({ key: `${a.id}:${r}:${tg.kind}:${tg.ref}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: HEAL_COLOR });
            }
        }
    }
    return out;
}

/**
 * The tank a mob has: the first assignee (in the order they were picked) of a tank row that targets the mob and whose
 * place is on the map (a slot that is placed, or a free token). Null when there is none — then nothing turns by itself.
 */
export function tankOfMob(board: RaidplanBoard, mobId: string): { x: number; y: number } | null {
    if (!mobId) return null;
    for (const a of board.assignments) {
        const type = a.type as string;
        if (type !== "tank" && type !== "trashtank") continue;
        if (!a.targets.some((tg) => tg.kind === "mob" && tg.ref === mobId)) continue;
        for (const r of a.assignees) {
            const p = r.split(":");
            const at = p[0] === "slot" ? position(board, "slot", `${p[1]}:${p[2]}`) : position(board, "user", p[1]);
            if (at) return at;
        }
    }
    return null;
}

/** The angle (0 = straight up, clockwise, degrees) from a point to another, on a board that is `ar` times as wide as high. */
export function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }, ar: number): number {
    const dx = (to.x - from.x) * ar;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return 0;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
}

/** The facing an icon is drawn with: towards its mob's tank when it follows the tank and one is on the map, else its own rotation. */
export function facingOf(board: RaidplanBoard, icon: { x: number; y: number; rotation: number; mobId?: string; autoFace?: boolean }, ar: number): number {
    if (icon.autoFace === false || !icon.mobId) return icon.rotation || 0;
    const tank = tankOfMob(board, icon.mobId);
    return tank ? angleBetween(icon, tank, ar) : icon.rotation || 0;
}

/** Whether an icon is turned by its tank right now (for the inspector's hint). */
export function followsTank(board: RaidplanBoard, icon: { mobId?: string; autoFace?: boolean }): boolean {
    return icon.autoFace !== false && !!icon.mobId && tankOfMob(board, icon.mobId) !== null;
}

/** How many assignments a board has (the boss chip's dot counts them too). */
export function assignmentCount(board: RaidplanBoard): number {
    return board.assignments.length;
}

export const ALL_MARKS = MARKS;
