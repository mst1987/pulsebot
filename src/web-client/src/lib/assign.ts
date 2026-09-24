// The raid plan's assignments ("Einteilungen", docs/raidplan.md), pure: what a reference
// means (a slot placeholder, a raider, a group, a raid mark, free text), how the rows are
// edited, which types a board offers, and where the thin connection lines on the map go.
// The server checks and cleans every save again and makes the suggestions
// (src/web/raidplanAssign.js); these rules keep the page consistent while the orga works.
//
// Written to be strippable (test/web-client/assign.test.js runs it, with `t` injected):
// imports, `export type`, tables and one-line signatures only, no typed locals or casts.
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanAssignType, RaidplanBoard, RaidplanPlayer, RaidplanSlot } from "../api";
import { t } from "../i18n";

/** Per type: its icon, where it is offered and which classes can do it (a filter for the picker, never a rule). */
export const ASSIGN_META = {
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
    boss: ["special", "heal", "kick", "md", "ss", "fearward", "dispel", "cc", "buff", "other"],
    trash: ["trashtank", "heal", "kick", "cc", "dispel", "other"],
    general: ["curse", "thunderclap", "demoshout", "buff", "other"],
} as Record<string, string[]>;
/** The role icons the raid detail already uses for its role groups. */
export const ROLE_ICON = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_dualwield",
    ranged: "inv_weapon_bow_07",
    dps: "inv_misc_questionmark",
} as Record<string, string>;
export const SLOT_ORDER = ["tank", "healer", "melee", "ranged", "dps"];
export const HEAL_COLOR = "#35d6c4";
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];

/** Which area a boss entry is: the whole raid, the trash of an instance or a boss. */
export function scopeOf(boss: { trash?: boolean; general?: boolean }): string {
    return boss.general ? "general" : boss.trash ? "trash" : "boss";
}

export function assignTypes(scope: string): string[] {
    return SCOPE_TYPES[scope] || SCOPE_TYPES.boss;
}

/** Whether a player's class is one the type suggests (no class list = everybody). */
export function fitsType(type: string, player: RaidplanPlayer): boolean {
    const classes = (ASSIGN_META[type] || ASSIGN_META.other).classes;
    return classes.length === 0 || classes.indexOf(player.classId) >= 0;
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
export type AssignCtx = { slots: RaidplanSlot[]; players: Map<string, RaidplanPlayer> };
/** A reference resolved for display: its label, who it is now (null = open or not a person), and its kind. */
export type Resolved = { kind: string; ref: string; label: string; player: RaidplanPlayer | null; open: boolean; mark: string; group: number };

const NONE = { kind: "", ref: "", label: "", player: null, open: false, mark: "", group: 0 };

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
        return { ...NONE, kind: "slot", ref, label: slotLabel(p[1], n), player, open: !player };
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
        return { ...NONE, kind: "slot", ref: target.ref, label: slotLabel(p[0], Number(p[1])), player, open: !player };
    }
    if (target.kind === "group") return { ...NONE, kind: "group", ref: target.ref, label: t("raidBoard.slot.group", { n: Number(target.ref) }), group: Number(target.ref) };
    if (target.kind === "player") {
        const player = ctx.players.get(target.ref) || null;
        return { ...NONE, kind: "player", ref: target.ref, label: player ? player.character : "?", player, open: !player };
    }
    if (target.kind === "mark") return { ...NONE, kind: "mark", ref: target.ref, label: t(`raidBoard.mark.${target.ref}`), mark: target.ref };
    return { ...NONE, kind: "text", ref: target.ref, label: target.ref };
}

/** Whether the viewer (`me`, a userId) is part of an assignment: as assignee, as a target, or in a targeted group. */
export function isMine(a: RaidplanAssignment, ctx: AssignCtx, me: string): boolean {
    if (!me) return false;
    if (a.assignees.some((r) => isMe(resolveAssignee(r, ctx), me))) return true;
    const meP = ctx.players.get(me);
    const mineGroup = meP ? meP.group : -1;
    return a.targets.some((tg) => { const r = resolveTarget(tg, ctx); return isMe(r, me) || (r.kind === "group" && r.group === mineGroup); });
}

function isMe(r: Resolved, me: string): boolean {
    return !!r.player && r.player.userId === me;
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
    const row = { id, type: type as RaidplanAssignType, title: "", assignees: [], targets: [], note: "", suggested: false };
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
        const s = board.slots.find((x) => x.kind === p[0] && x.n === Number(p[1]) && !x.hidden);
        return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === "group") {
        const s = board.slots.find((x) => x.kind === "group" && x.n === Number(ref) && !x.hidden);
        return s ? { x: s.x, y: s.y } : null;
    }
    if (kind === "mark") {
        const m = board.marks.find((x) => x.mark === ref && !x.hidden);
        return m ? { x: m.x, y: m.y } : null;
    }
    if (kind === "player" || kind === "user") {
        const s = board.slots.find((x) => x.userId === ref && !x.hidden);
        if (s) return { x: s.x, y: s.y };
        const tk = board.tokens.find((x) => x.userId === ref && !x.hidden);
        return tk ? { x: tk.x, y: tk.y } : null;
    }
    return null;
}

/** The thin lines of the heal assignments (healer to what it heals), for the ones whose two ends are on the board. */
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

/** How many assignments a board has (the boss chip's dot counts them too). */
export function assignmentCount(board: RaidplanBoard): number {
    return board.assignments.length;
}

export const ALL_MARKS = MARKS;
