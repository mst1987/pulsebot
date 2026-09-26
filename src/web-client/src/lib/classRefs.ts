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
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanPlayer } from "../api";

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
    const taken = {};
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
    const out = [];
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
    const out = [];
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
    const add = [];
    const drop = {};
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
    const before = assignments.slice(0, assignments.indexOf(row)).filter((a) => a.type === row.type && a.assignees.some((r) => isClassRef(r)));
    if (before.length === 0) return assignments;
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
    const wantsExpansion = assignments.some((a) => a.assignees.some((r) => isClassRef(r)) || a.targets.some((tg) => tg.kind === "class"));
    if (!wantsExpansion) return assignments;
    const byId = {};
    for (const p of roster) byId[p.userId] = p;
    const used = {};
    const usedAt = {};
    function take(bag, type, id) {
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
    function pick(bag, a, ref, key) {
        const hand = (a.picks || {})[key];
        if (hand && byId[hand]) return hand;
        const q = parseClassRef(ref);
        if (!q) return "";
        const pool = poolOf(q, a.type, roster, roles);
        const order = pool.slice(q.n - 1).concat(pool.slice(0, q.n - 1));
        const free = order.find((p) => !(bag[a.type] && bag[a.type][p.userId]));
        if (free) {
            take(bag, a.type, free.userId);
            return free.userId;
        }
        return a.allowMulti && pool.length > 0 ? pool[(q.n - 1) % pool.length].userId : "";
    }
    const got = {};
    // pass 1: a named class; pass 2: "Any"
    for (const anyPass of [false, true]) {
        assignments.forEach((a, i) => {
            a.assignees.forEach((r, j) => {
                if (!isClassRef(r)) return;
                const q = parseClassRef(r);
                if (q && (q.classId === ANY) === anyPass) got[`${i}|a|${j}`] = pick(used, a, r, r);
            });
            a.targets.forEach((tg, j) => {
                if (tg.kind !== "class") return;
                const q = parseClassRef(tg.ref);
                if (q && (q.classId === ANY) === anyPass) got[`${i}|t|${j}`] = pick(usedAt, a, tg.ref, `t:${tg.ref}`);
            });
        });
    }
    return assignments.map((a, i) => {
        const assignees = a.assignees.map((r, j) => {
            const id = got[`${i}|a|${j}`];
            return id ? `user:${id}` : r;
        });
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
export const CLASS_COLOR = { Warrior: "#C79C6E", Paladin: "#F58CBA", Hunter: "#ABD473", Rogue: "#FFF569", Priest: "#FFFFFF", Shaman: "#0070DE", Mage: "#69CCF0", Warlock: "#9482C9", Druid: "#FF7D0A", Any: "#6aa7ff" };
