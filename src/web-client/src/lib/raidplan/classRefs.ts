// A class as who does a task or at whom: "class:Hunter:1" = the first free Hunter of the raid, "class:Priest:1:healer" limits it to a role,
// "class:Any:1:tank" = any raider whose SPEC role is tank ("Beliebiger Tank"; "Any" always names a role, the class alone would be a guess).
// The reference is only stored in the row; who it means is worked out from the setup each time (expandClassRefs), so a template needs no
// slot to be pre-chosen ("misdirect = Hunter") and an event fills it from the players it really has. A class nobody plays stays an
// open reference ("Hunter missing"), never a stranger. A choice made by hand (`picks`) wins and stays.
//
// The COUNT of a class in a row ("Hunter x 2") is the number of its references in the row (Hunter 1, Hunter 2), so every reference stays one
// place with its own number, its own hand-made pick and its own chip; the running number counts on over all rows of the same kind of task
// (a second misdirect row gets "Hunter 2", a third "Hunter 3"). Pure and tested (src/web-client/src/lib/classRefs.test.ts), the server twin is
// src/web/raidplanAssign.js (expandClassRefs, renumberClassRefs); written with function declarations and one-line signatures only.
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanPlayer } from "../../api";

/** The role filters of a class reference (empty = any spec). "dps" = melee or ranged. */
export const CLASS_ROLES = ["tank", "healer", "dps", "melee", "ranged"];
/** The "class" of a reference that means any raider of its role. */
export const ANY = "Any";
/** The role filter "every spec of the class" (a mage who tanks, a warlock tank): chosen on purpose, the task's own role is not applied. */
export const ANY_SPEC = "any";
/** The classes that can tank by their spec; any other class on a tanking row is a class tank on purpose ("Magier-Tank"). */
export const TANK_SPEC_CLASSES = ["Warrior", "Paladin", "Druid"];
/**
 * The role a class gets when it is added to a row by its tile: healing -> its healers, a tanking row -> its tanks for the three tanking
 * classes and ANY spec for every other class (the orga chose a mage to tank on purpose), everything else -> no filter.
 */
export function defaultClassRole(classId: string, type: string): string {
    const implied = impliedRole(type);
    if (implied === "tank" && TANK_SPEC_CLASSES.indexOf(classId) < 0) return ANY_SPEC;
    return "";
}
/** The role a reference really filters by on a row: its own, else the one the task implies, else any spec. */
export function effectiveRole(role: string, type: string): string {
    return role || impliedRole(type) || ANY_SPEC;
}
/** The role to store when the user picks a filter chip: "any" on a task that implies no role is stored as none (it is the same). */
export function storedRole(picked: string, type: string): string {
    if (picked === ANY_SPEC && !impliedRole(type)) return "";
    return picked;
}
/** The highest running number a reference can have. */
export const MAX_CLASS_N = 99;
/** The general tanks a tanking row offers: any tank, or a tank of one of the three tanking classes (by the spec role, never the class alone). */
export const TANK_CLASSES = ["Any", "Warrior", "Paladin", "Druid"];
/** The kinds of task that are tanking (they offer the general tanks). */
export const TANK_TYPES = ["tank", "trashtank", "special"];

// ---- count and class priority of a row (#525) --------------------------------------------------------
// "1 x Paladin > Shaman": the row wants `count` raiders (its fixed assignees count), taken class by class in the order of `classPriority`;
// only stored with a class list, so a row without one resolves exactly as before. Twin of raidplanAssign.js rowCount / classPriorityOf.

/** The nine classes a priority can name (the order of the dialog's tiles). */
export const PRIORITY_CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
/** The most raiders a row with a class priority asks for. */
export const MAX_COUNT = 40;

/** The places a row with a class priority asks for: a whole number 1..40, anything else = 1. */
export function rowCount(v: unknown): number {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : 1;
}

/** The class priority of a row as it is resolved: known classes, each once, in the order given. */
export function classPriorityOf(a: { classPriority?: string[] } | null | undefined): string[] {
    const out: string[] = [];
    for (const c of (a && Array.isArray(a.classPriority) ? a.classPriority : [])) if (PRIORITY_CLASSES.indexOf(c) >= 0 && out.indexOf(c) < 0) out.push(c);
    return out;
}

/** Whether a row resolves by its class priority ("1 x Paladin > Shaman"). */
export function hasPriority(a: { classPriority?: string[] } | null | undefined): boolean {
    return classPriorityOf(a).length > 0;
}

/**
 * Turns the row's class references into a priority ("in Priorität umwandeln"): `class:Paladin:1`, `class:Shaman:1` -> 1 x Paladin > Shaman.
 * Only when it is simple: every class reference names a class (no "Any") with no role of its own or the task's; the count is the most
 * references one class had (Priest 1, Priest 2, Druid 1 -> 2 x Priest > Druid) plus the fixed assignees; hand picks of those references
 * go. null = not simple.
 */
export function toPriority(row: RaidplanAssignment): RaidplanAssignment | null {
    const refs = row.assignees.filter((r) => isClassRef(r));
    if (refs.length === 0) return null;
    const implied = impliedRole(row.type);
    const per: Record<string, number> = {};
    const order: string[] = [];
    for (const r of refs) {
        const q = parseClassRef(r);
        if (!q || PRIORITY_CLASSES.indexOf(q.classId) < 0 || (q.role && q.role !== implied)) return null;
        if (!per[q.classId]) order.push(q.classId);
        per[q.classId] = (per[q.classId] || 0) + 1;
    }
    const most = Math.max(...order.map((c) => per[c]));
    const picks: Record<string, string> = {};
    const own = row.picks || {};
    for (const key of Object.keys(own)) if (refs.indexOf(key) < 0) picks[key] = own[key];
    const fixed = row.assignees.filter((r) => !isClassRef(r));
    return { ...row, assignees: fixed, picks, classPriority: order, count: rowCount(fixed.length + most), suggested: false };
}

/** Sets the class priority of a row (the list in its order; empty = none, the count goes with it); a new list starts at 1 raider. */
export function setPriority(row: RaidplanAssignment, list: string[]): RaidplanAssignment {
    const prio = classPriorityOf({ classPriority: list });
    const next: RaidplanAssignment = { ...row, suggested: false };
    delete next.classPriority;
    delete next.count;
    if (prio.length === 0) return next;
    return { ...next, classPriority: prio, count: hasPriority(row) ? rowCount(row.count) : 1 };
}

/** Adds a class at the end of the priority, or takes it out when it is in it. */
export function togglePriorityClass(row: RaidplanAssignment, classId: string): RaidplanAssignment {
    const cur = classPriorityOf(row);
    return setPriority(row, cur.indexOf(classId) >= 0 ? cur.filter((c) => c !== classId) : [...cur, classId]);
}

/** Moves a class of the priority one place earlier (dir -1) or later (+1). */
export function movePriorityClass(row: RaidplanAssignment, classId: string, dir: number): RaidplanAssignment {
    const cur = classPriorityOf(row);
    const i = cur.indexOf(classId);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= cur.length) return row;
    const next = cur.slice();
    next[i] = cur[j];
    next[j] = classId;
    return setPriority(row, next);
}

/** Sets how many raiders a row with a priority wants (1..40; a row without a priority stays as it is). */
export function setRowCount(row: RaidplanAssignment, count: number): RaidplanAssignment {
    if (!hasPriority(row)) return row;
    return { ...row, count: Math.max(1, Math.min(MAX_COUNT, Math.round(Number(count) || 1))), suggested: false };
}

export function isClassRef(ref: string): boolean {
    return ref.indexOf("class:") === 0;
}

/** The reference of a class as an assignee ("class:Hunter:1[:role]"); as a target the same without the prefix. */
export function classRef(classId: string, n: number, role: string): string {
    return `class:${classId}:${n}${role ? `:${role}` : ""}`;
}

export function classTargetRef(classId: string, n: number, role: string): string {
    return `${classId}:${n}${role ? `:${role}` : ""}`;
}

/** Splits "class:Hunter:1:tank" (or the target form "Hunter:1:tank") into its parts; null when it is none. */
export function parseClassRef(ref: string): { classId: string; n: number; role: string } | null {
    const p = ref.split(":");
    if (p[0] === "class") p.shift();
    const n = Number(p[1]);
    if (p.length < 2 || !p[0] || !(n >= 1)) return null;
    return { classId: p[0], n, role: p[2] || "" };
}

/** The next free number for a class among references already chosen (Hunter 1 taken -> 2); `role` limits it to references of that role when given. */
export function nextClassN(refs: string[], classId: string, role?: string): number {
    const taken: Record<number, boolean> = {};
    for (const r of refs) {
        const q = parseClassRef(r);
        if (q && q.classId === classId && (role === undefined || q.role === role)) taken[q.n] = true;
    }
    let n = 1;
    while (taken[n]) n += 1;
    return Math.min(MAX_CLASS_N, n);
}

/** The class references (assignee form) of every row of one kind of task: what the running number counts over. `target` = the target references instead. */
export function classRefsOfType(assignments: RaidplanAssignment[], type: string, target: boolean): string[] {
    const out: string[] = [];
    for (const a of assignments) {
        if (a.type !== type) continue;
        if (target) { for (const tg of a.targets) if (tg.kind === "class") out.push(tg.ref); } else for (const r of a.assignees) if (isClassRef(r)) out.push(r);
    }
    return out;
}

/** The references of one class (and role) in a row, in the row's order: what its "x n" counts. */
export function refsOfClass(refs: string[], classId: string, role: string): string[] {
    return refs.filter((r) => { const q = parseClassRef(r); return !!q && q.classId === classId && q.role === role; });
}

/** The class references of a row grouped per class and role, in the order they first appear: one chip "Hunter x 2" each. */
export function classGroups(refs: string[]): { classId: string; role: string; refs: string[]; ns: number[] }[] {
    const out: { classId: string; role: string; refs: string[]; ns: number[] }[] = [];
    for (const r of refs) {
        const q = parseClassRef(r);
        if (!q) continue;
        let g = out.find((x) => x.classId === q.classId && x.role === q.role);
        if (!g) { g = { classId: q.classId, role: q.role, refs: [], ns: [] }; out.push(g); }
        g.refs.push(r);
        g.ns.push(q.n);
    }
    return out;
}

/** "1", "1-2", "1, 3": the running numbers of a class group as they read on its chip. */
export function numbersLabel(ns: number[]): string {
    const s = [...ns].sort((a, b) => a - b);
    if (s.length === 0) return "";
    const run = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
    return run && s.length > 1 ? `${s[0]}-${s[s.length - 1]}` : s.join(", ");
}

/**
 * Sets how many raiders of a class (and role) a row asks for ("x n", the stepper): more adds references with the next free running
 * numbers of that kind of task (over ALL its rows, so the new place is the next raider of the class), fewer takes the highest numbers of
 * THIS row away (and their hand-made picks). `target` works on the row's class targets instead. At least 0, never more than MAX_CLASS_N.
 */
export function setClassCount(assignments: RaidplanAssignment[], rowId: string, classId: string, role: string, count: number, target: boolean): RaidplanAssignment[] {
    const row = assignments.find((a) => a.id === rowId);
    if (!row) return assignments;
    const own = target ? row.targets.filter((tg) => tg.kind === "class").map((tg) => tg.ref) : row.assignees.filter((r) => isClassRef(r));
    const mine = refsOfClass(own, classId, role);
    const want = Math.max(0, Math.min(MAX_CLASS_N, Math.floor(count)));
    if (want === mine.length) return assignments;
    const all = classRefsOfType(assignments, row.type, target);
    const add: string[] = [];
    const drop: Record<string, boolean> = {};
    if (want > mine.length) {
        const known = [...all];
        for (let i = mine.length; i < want; i += 1) {
            const n = nextClassN(known, classId, role);
            const ref = target ? classTargetRef(classId, n, role) : classRef(classId, n, role);
            if (known.indexOf(ref) >= 0) break;
            known.push(ref);
            add.push(ref);
        }
    } else {
        const byN = [...mine].sort((a, b) => (parseClassRef(b) || { n: 0 }).n - (parseClassRef(a) || { n: 0 }).n);
        for (const r of byN.slice(0, mine.length - want)) drop[r] = true;
    }
    const picks = { ...(row.picks || {}) };
    for (const r of Object.keys(drop)) delete picks[target ? `t:${r}` : r];
    const next = target
        ? { ...row, targets: [...row.targets.filter((tg) => !(tg.kind === "class" && drop[tg.ref])), ...add.map((r) => classTarget(r))] }
        : { ...row, assignees: [...row.assignees.filter((r) => !drop[r]), ...add] };
    return assignments.map((a) => (a.id === rowId ? { ...next, picks, suggested: false } : a));
}

/**
 * A new row of a task takes over the classes of the row before it with the NEXT running numbers: the first misdirect row asks for
 * "Jäger 1", a second one added after it for "Jäger 2" (the next free hunter), a third for "Jäger 3" - and a "Tank (Krieger)" row is
 * followed by the next warrior tank. Only the assignees' class references are carried (the counts stay), nothing else; the last
 * earlier row of the same type with class references is the model. No such row: the list comes back unchanged.
 */
export function carryClasses(assignments: RaidplanAssignment[], rowId: string): RaidplanAssignment[] {
    const row = assignments.find((a) => a.id === rowId);
    if (!row) return assignments;
    const before = assignments.slice(0, assignments.indexOf(row)).filter((a) => a.type === row.type && (a.assignees.some((r) => isClassRef(r)) || hasPriority(a)));
    if (before.length === 0) return assignments;
    const model = before[before.length - 1];
    // a priority row ("1 x Paladin > Shaman") is followed by the same priority: the resolution gives the next row the next free raider (#525)
    if (hasPriority(model)) return assignments.map((a) => (a.id === rowId ? { ...a, classPriority: classPriorityOf(model), count: rowCount(model.count) } : a));
    let out = assignments;
    for (const g of classGroups(before[before.length - 1].assignees.filter((r) => isClassRef(r)))) out = setClassCount(out, rowId, g.classId, g.role, g.refs.length, false);
    return out;
}

/**
 * Changes the role filter of a class in a row ("Priester" -> "Priester (Heiler)"): the references of the class with the old role go, as
 * many with the new role come (next free running numbers of that role); hand-made picks of the old ones are dropped. Same role: unchanged.
 */
export function setClassRole(assignments: RaidplanAssignment[], rowId: string, classId: string, fromRole: string, toRole: string, target: boolean): RaidplanAssignment[] {
    if (fromRole === toRole) return assignments;
    const row = assignments.find((a) => a.id === rowId);
    if (!row) return assignments;
    const own = target ? row.targets.filter((tg) => tg.kind === "class").map((tg) => tg.ref) : row.assignees.filter((r) => isClassRef(r));
    const count = refsOfClass(own, classId, fromRole).length;
    const have = refsOfClass(own, classId, toRole).length;
    const cleared = setClassCount(assignments, rowId, classId, fromRole, 0, target);
    return setClassCount(cleared, rowId, classId, toRole, have + count, target);
}

function classTarget(ref: string): RaidplanAssignTarget {
    return { kind: "class", ref };
}

/** The role a kind of task needs by itself (from the SPEC's role in the setup, never from the class): healing -> healer, tanking -> tank, else none. */
export function impliedRole(type: string): string {
    return type === "heal" ? "healer" : type === "tank" || type === "trashtank" ? "tank" : "";
}

/** Whether a player of this role (on this boss) passes the role filter of a class reference. */
export function roleFits(filter: string, role: string): boolean {
    if (!filter) return true;
    if (filter === "dps") return role !== "tank" && role !== "healer";
    return role === filter;
}

/**
 * The raiders a class reference can mean, in setup order: the players of the class whose spec role (a flex role on this boss wins)
 * passes the role filter — the reference's own role, else the one the task implies. "Any" = every raider of that role; "Any" without a
 * role means nobody.
 */
export function poolOf(q: { classId: string; role: string }, type: string, roster: RaidplanPlayer[], roles: Record<string, string>): RaidplanPlayer[] {
    // "any" = every spec of the class, chosen on purpose (a mage tanks); no role = the one the task implies
    const want = q.role === ANY_SPEC ? "" : q.role || impliedRole(type);
    if (q.classId === ANY && !want) return [];
    return roster.filter((p) => (q.classId === ANY || p.classId === q.classId) && roleFits(want, (roles || {})[p.userId] || p.role));
}

// ---- ranking of candidates (#501) ----------------------------------------------------------------
// Who of several raiders who COULD do a task should do it. The server twin is raidplanAssign.js (rankCandidates ...); the same cases run
// on both (rank.test.ts here, test/services/raidplan/raidplanRank.test.js there).

/** The roles a row can prefer (the row dialog's "Rolle"); none = any. */
export const PREFERRED_ROLES = ["melee", "ranged", "healer", "tank"];
/** The points of the ranking: the row's role wins over a spell of the catalog, that over the tank and healer penalties, those over the load. */
export const RANK_POINTS = { role: 100, spell: 50, tank: -40, healer: -20, load: -3, loadCap: 6 };
/** Kinds of task a tank does himself: no tank penalty (thunder clap and demoralizing shout are a warrior tank's; a protection paladin blesses and has an aura). */
const TANK_OK_TYPES = [...TANK_TYPES, "heal", "thunderclap", "demoshout", "blessing", "aura"];
/** Spells a tank keeps up himself (#536): no tank penalty on a debuff row with one of them (Sunder Armor, the Faerie Fire of a bear). */
const TANK_OK_SPELLS = ["d:sunder-armor", "d:faerie-fire"];
/** Damage dealers' utility: a healer is only suggested for it when no damage dealer can. */
const DPS_UTILITY_TYPES = ["kick", "cc", "curse", "md", "debuff"];

/** What the ranking knows of a board: flex roles, who stands in a tanking row, in how many rows each raider stands, the classes with a spell. */
export type RankCtx = { roles?: Record<string, string>; tanks?: Record<string, boolean>; load?: Record<string, number>; spellClasses?: string[] };
type RankPlayer = { userId: string; classId: string; role: string; specRole?: string };
type RankRow = { type: string; preferredRole?: string; spell?: { id: string } | null };

/** Whether a tank may do this row without a penalty: a kind of task of his, or a spell he keeps up anyway (server twin: tankOk). */
function tankOk(row: RankRow): boolean {
    return TANK_OK_TYPES.indexOf(row.type) >= 0 || (!!row.spell && TANK_OK_SPELLS.indexOf(row.spell.id) >= 0);
}

function isDamage(r: string): boolean {
    return r === "melee" || r === "ranged";
}

/** The role a raider plays on this boss for the ranking: a flex role wins ("dps" takes melee / ranged from the spec), a tank / healer placed as such stays one, else the SPEC's role. */
export function playerRole(p: RankPlayer, roles?: Record<string, string>): string {
    const flex = (roles || {})[p.userId] || "";
    const spec = p.specRole || "";
    if (flex === "tank" || flex === "healer" || isDamage(flex)) return flex;
    if (flex === "dps") return isDamage(spec) ? spec : isDamage(p.role) ? p.role : "dps";
    if (p.role === "tank" || p.role === "healer") return p.role;
    return spec || p.role || "";
}

function isTankOf(p: RankPlayer, ctx: RankCtx): boolean {
    return !!(ctx.tanks || {})[p.userId] || playerRole(p, ctx.roles) === "tank";
}

/** The points of one raider for a row with their parts: role +100, a spell of the catalog +50, a tank on a task not his -40, a healer on DPS utility -20, -3 per row (at most 6). */
export function scoreCandidate(row: RankRow, p: RankPlayer, ctx: RankCtx = {}): { score: number; parts: { role: number; spell: number; tank: number; healer: number; load: number } } {
    const parts = { role: 0, spell: 0, tank: 0, healer: 0, load: 0 };
    const role = playerRole(p, ctx.roles);
    if (row.preferredRole && PREFERRED_ROLES.indexOf(row.preferredRole) >= 0 && role === row.preferredRole) parts.role = RANK_POINTS.role;
    if (TANK_TYPES.indexOf(row.type) < 0) {
        if ((ctx.spellClasses || []).indexOf(p.classId) >= 0) parts.spell = RANK_POINTS.spell;
        if (!tankOk(row) && isTankOf(p, ctx)) parts.tank = RANK_POINTS.tank;
        if (DPS_UTILITY_TYPES.indexOf(row.type) >= 0 && role === "healer") parts.healer = RANK_POINTS.healer;
        const n = Math.min(RANK_POINTS.loadCap, Number((ctx.load || {})[p.userId]) || 0);
        if (n > 0) parts.load = n * RANK_POINTS.load;
    }
    return { score: parts.role + parts.spell + parts.tank + parts.healer + parts.load, parts };
}

/** The raiders in the order a row wants them: the highest points first; a tie keeps the order given (the setup's). */
export function rankCandidates<T extends RankPlayer>(row: RankRow, list: T[], ctx: RankCtx = {}): T[] {
    return list.map((p, i) => ({ p, i, s: scoreCandidate(row, p, ctx).score })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

/** The hard rules of a suggestion, only while somebody is left: no tank on a task not his, no healer on damage dealers' utility. */
export function withoutMisfits<T extends RankPlayer>(row: RankRow, list: T[], ctx: RankCtx = {}): T[] {
    let out = list;
    if (!tankOk(row)) {
        const rest = out.filter((p) => !isTankOf(p, ctx));
        if (rest.length > 0) out = rest;
    }
    if (DPS_UTILITY_TYPES.indexOf(row.type) >= 0) {
        const rest = out.filter((p) => playerRole(p, ctx.roles) !== "healer");
        if (rest.length > 0) out = rest;
    }
    return out;
}

/** What the ranking knows of a board from the raiders its rows NAME (user refs, filled slots, hand picks): tanks, load, and per row who is in it. */
export function boardContext(list: RaidplanAssignment[], slots: { kind: string; n: number; userId: string }[], roles?: Record<string, string>): { roles: Record<string, string>; tanks: Record<string, boolean>; load: Record<string, number>; rowIds: Record<string, boolean>[] } {
    const tanks: Record<string, boolean> = {};
    const load: Record<string, number> = {};
    const rowIds: Record<string, boolean>[] = [];
    for (const a of list) {
        const ids: Record<string, boolean> = {};
        rowIds.push(ids);
        for (const r of a.assignees || []) {
            const q = r.split(":");
            if (q[0] === "user" && q[1]) ids[q[1]] = true;
            else if (q[0] === "slot") {
                const s = (slots || []).find((x) => x.kind === q[1] && x.n === Number(q[2]) && x.userId);
                if (s) ids[s.userId] = true;
            }
        }
        const picks = a.picks || {};
        for (const key of Object.keys(picks)) if (key.indexOf("t:") !== 0 && picks[key]) ids[picks[key]] = true;
        for (const id of Object.keys(ids)) {
            load[id] = (load[id] || 0) + 1;
            if (TANK_TYPES.indexOf(a.type) >= 0) tanks[id] = true;
        }
    }
    return { roles: roles || {}, tanks, load, rowIds };
}

/**
 * THE resolution of class references (the server twin is raidplanAssign.expandClassRefs): every class reference replaced by the raider it
 * means, round robin per kind of task. Taken first: raiders named by hand (user refs, slots, `picks`); then the references of a named
 * class ("Hunter", "Tank (Warrior)") in row order, then the "Any" ones ("any tank"), so an "any tank" never takes the one warrior tank a
 * "Tank (Warrior)" row needs. A reference starts at its own number and takes the first raider of its pool nobody of that kind of task
 * has yet; nobody free = it stays as it is (an open place with the class icon), never a player of another class or role; `allowMulti`
 * on the row lets it repeat a raider instead. Targets ("Soulstone at a Priest") are resolved the same way among themselves. Same length
 * and order as the input, so a chip can be matched to its reference by index.
 */
export function expandClassRefs(assignments: RaidplanAssignment[], slots: { kind: string; n: number; userId: string }[], roster: RaidplanPlayer[], roles: Record<string, string>): RaidplanAssignment[] {
    const wantsExpansion = assignments.some((a) => a.assignees.some((r) => isClassRef(r)) || a.targets.some((tg) => tg.kind === "class") || hasPriority(a));
    if (!wantsExpansion) return assignments;
    const byId: Record<string, RaidplanPlayer> = {};
    for (const p of roster) byId[p.userId] = p;
    const used: Record<string, Record<string, boolean>> = {};
    const usedAt: Record<string, Record<string, boolean>> = {};
    function take(bag: Record<string, Record<string, boolean>>, type: string, id: string) {
        if (!bag[type]) bag[type] = {};
        bag[type][id] = true;
    }
    for (const a of assignments) {
        for (const r of a.assignees) {
            const q = r.split(":");
            if (q[0] === "user") take(used, a.type, q[1]);
            else if (q[0] === "slot") {
                const s = slots.find((x) => x.kind === q[1] && x.n === Number(q[2]) && x.userId);
                if (s) take(used, a.type, s.userId);
            }
        }
        const picks = a.picks || {};
        for (const key of Object.keys(picks)) if (byId[picks[key]]) take(key.indexOf("t:") === 0 ? usedAt : used, a.type, picks[key]);
    }
    // the ranking (#501): who tanks on this board and how many rows each raider has, counted on while references are resolved
    const ctx = boardContext(assignments, slots, roles);
    function counted(i: number, a: RaidplanAssignment, id: string) {
        if (!id || ctx.rowIds[i][id]) return;
        ctx.rowIds[i][id] = true;
        ctx.load[id] = (ctx.load[id] || 0) + 1;
        if (TANK_TYPES.indexOf(a.type) >= 0) ctx.tanks[id] = true;
    }
    function pick(bag: Record<string, Record<string, boolean>>, a: RaidplanAssignment, ref: string, key: string, ranked: boolean): string {
        const hand = (a.picks || {})[key];
        if (hand && byId[hand]) return hand;
        const q = parseClassRef(ref);
        if (!q) return "";
        const plain = poolOf(q, a.type, roster, roles);
        // an assignee: the pool in the row's order of preference (rankCandidates); a target (soulstone at a priest): the setup's order
        const pool = ranked ? rankCandidates(a, plain, ctx) : plain;
        const order = pool.slice(q.n - 1).concat(pool.slice(0, q.n - 1));
        const free = order.find((p) => !(bag[a.type] && bag[a.type][p.userId]));
        if (free) {
            take(bag, a.type, free.userId);
            return free.userId;
        }
        return a.allowMulti && pool.length > 0 ? pool[(q.n - 1) % pool.length].userId : "";
    }
    /**
     * One open place of a row with a class priority (#525): the best ranked raider of the first class nobody of that kind of task has yet,
     * else of the next class ...; nobody free in any of them = one who already does that task elsewhere (twice rather than open), never one
     * of this very row; nobody at all = "" (the place stays open).
     */
    function pickByPriority(a: RaidplanAssignment, i: number, prio: string[]): string {
        const pools = prio.map((c) => rankCandidates(a, poolOf({ classId: c, role: "" }, a.type, roster, roles), ctx).filter((p) => !ctx.rowIds[i][p.userId]));
        for (const pool of pools) {
            const free = pool.find((p) => !(used[a.type] && used[a.type][p.userId]));
            if (free) {
                take(used, a.type, free.userId);
                return free.userId;
            }
        }
        const again = pools.find((pool) => pool.length > 0);
        return again ? again[0].userId : "";
    }
    const got: Record<string, string> = {};
    const extra: Record<number, string[]> = {};
    // the tanking rows first (who tanks is known before a utility row picks), then the others; each time pass 1: a named class, pass 2: "Any"
    for (const tankPass of [true, false]) {
        for (const anyPass of [false, true]) {
            assignments.forEach((a, i) => {
                if ((TANK_TYPES.indexOf(a.type) >= 0) !== tankPass) return;
                a.assignees.forEach((r, j) => {
                    if (!isClassRef(r)) return;
                    const q = parseClassRef(r);
                    if (!q || (q.classId === ANY) !== anyPass) return;
                    const id = pick(used, a, r, r, true);
                    got[`${i}|a|${j}`] = id;
                    counted(i, a, id);
                });
                a.targets.forEach((tg, j) => {
                    if (tg.kind !== "class") return;
                    const q = parseClassRef(tg.ref);
                    if (q && (q.classId === ANY) === anyPass) got[`${i}|t|${j}`] = pick(usedAt, a, tg.ref, `t:${tg.ref}`, false);
                });
            });
        }
        // then the rows with a class priority (#525), in row order: their open places after the class references of this pass
        assignments.forEach((a, i) => {
            if ((TANK_TYPES.indexOf(a.type) >= 0) !== tankPass) return;
            const prio = classPriorityOf(a);
            if (prio.length === 0) return;
            const places: string[] = [];
            for (let k = a.assignees.length; k < rowCount(a.count); k += 1) {
                const id = pickByPriority(a, i, prio);
                places.push(id ? `user:${id}` : classRef(prio[0], k + 1, ""));
                counted(i, a, id);
            }
            extra[i] = places;
        });
    }
    return assignments.map((a, i) => {
        const assignees = a.assignees.map((r, j) => {
            const id = got[`${i}|a|${j}`];
            return id ? `user:${id}` : r;
        }).concat(extra[i] || []);
        const targets = a.targets.map((tg, j) => {
            const id = got[`${i}|t|${j}`];
            return id ? playerTarget(id) : tg;
        });
        return { ...a, assignees, targets };
    });
}

function playerTarget(id: string): RaidplanAssignTarget {
    return { kind: "player", ref: id };
}

/** The key under which a hand-made choice for a class reference is stored in `picks` (an assignee: the ref itself; a target: "t:" + its ref). */
export function pickKey(kind: string, ref: string): string {
    return kind === "class" ? `t:${ref}` : ref;
}

/** The raiders who could fill a class reference by hand (its pool, see poolOf), for the "who takes it" choice. */
export function candidatesOf(ref: string, type: string, roster: RaidplanPlayer[], roles: Record<string, string>): RaidplanPlayer[] {
    const q = parseClassRef(ref);
    return q ? poolOf(q, type, roster, roles) : [];
}

/** The colours of the nine classes (as WoW shows them), for the class chips. */
export const CLASS_COLOR: Record<string, string> = { Warrior: "#C79C6E", Paladin: "#F58CBA", Hunter: "#ABD473", Rogue: "#FFF569", Priest: "#FFFFFF", Shaman: "#0070DE", Mage: "#69CCF0", Warlock: "#9482C9", Druid: "#FF7D0A", Any: "#6aa7ff" };
