// A class as who does a task or at whom: "class:Hunter:1" = the first free Hunter of the raid, "class:Priest:1:healer" limits it to a role.
// The reference is only stored in the row; who it means is worked out from the setup each time (expandClassRefs), so a template needs no
// slot to be pre-chosen ("misdirect = Hunter, else Rogue") and an event fills it from the players it really has. A class nobody plays stays an
// open reference ("Hunter missing"), never a stranger. A choice made by hand (`picks`) wins and stays. Pure and tested (test/web-client/classRefs.test.js);
// written with function declarations and one-line signatures only.
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanPlayer } from "../api";

/** The role filters of a class reference (empty = any spec). "dps" = melee or ranged. */
export const CLASS_ROLES = ["tank", "healer", "dps", "melee", "ranged"];

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

/** The next free number for a class among references already chosen (Hunter 1 taken -> 2), at most 9. */
export function nextClassN(refs: string[], classId: string): number {
    let top = 0;
    for (const r of refs) {
        const q = parseClassRef(r);
        if (q && q.classId === classId && q.n > top) top = q.n;
    }
    return Math.min(9, top + 1);
}

/** Whether a player of this role (on this boss) passes the role filter of a class reference. */
export function roleFits(filter: string, role: string): boolean {
    if (!filter) return true;
    if (filter === "dps") return role !== "tank" && role !== "healer";
    return role === filter;
}

/**
 * The assignments with every class reference replaced by the raider it means: the n-th free player of the class (setup order, role
 * filter applied), starting at the n-th and wrapping round. "Free" = not yet doing the same kind of task in this section (by another
 * row, by a slot or by name), unless the row allows several; a hand-made `picks` entry wins and counts as taken. Nobody free = the
 * reference stays as it is (an open place with the class icon). Targets ("Soulstone at a Priest") are resolved the same way among
 * themselves. Same length and order as the input, so a chip can be matched to its reference by index.
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
        const pool = roster.filter((p) => p.classId === q.classId && roleFits(q.role, roles[p.userId] || p.role));
        const order = pool.slice(q.n - 1).concat(pool.slice(0, q.n - 1));
        const free = order.find((p) => !(bag[a.type] && bag[a.type][p.userId]));
        if (free) {
            take(bag, a.type, free.userId);
            return free.userId;
        }
        return a.allowMulti && pool.length > 0 ? pool[(q.n - 1) % pool.length].userId : "";
    }
    return assignments.map((a) => {
        const assignees = a.assignees.map((r) => {
            if (!isClassRef(r)) return r;
            const id = pick(used, a, r, r);
            return id ? `user:${id}` : r;
        });
        const targets = a.targets.map((tg) => {
            if (tg.kind !== "class") return tg;
            const id = pick(usedAt, a, tg.ref, `t:${tg.ref}`);
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

/** The colours of the nine classes (as WoW shows them), for the class chips. */
export const CLASS_COLOR = { Warrior: "#C79C6E", Paladin: "#F58CBA", Hunter: "#ABD473", Rogue: "#FFF569", Priest: "#FFFFFF", Shaman: "#0070DE", Mage: "#69CCF0", Warlock: "#9482C9", Druid: "#FF7D0A" };
