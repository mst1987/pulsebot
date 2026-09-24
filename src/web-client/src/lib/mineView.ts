// "Meine Aufgaben" and "Auf mich wirkend": the assignments of a section split by their relation to the visitor. Derived from the rows
// (nothing to maintain). Two kinds never mix: a row where the visitor is the one who does it is a task of his (even when it also
// targets him, marked "auch auf dich"); a row of somebody else that targets him, his group, his slot or names him in words acts ON him.
// Pure and tested (test/web-client/mineView.test.js); written with function declarations and one-line signatures only.
import type { RaidplanAssignment } from "../api";
import { isMe, resolveAssignee, resolveTarget } from "./assign";
import type { AssignCtx } from "./assign";
import { mentionsInRow } from "./mention";

/** The groups of tasks in the fixed order they are shown; `badge` = the type whose icon and colour heads the group. */
export const TASK_GROUPS = [
    { id: "tank", types: ["tank", "trashtank"], badge: "tank" },
    { id: "heal", types: ["heal"], badge: "heal" },
    { id: "kick", types: ["kick"], badge: "kick" },
    { id: "md", types: ["md"], badge: "md" },
    { id: "ss", types: ["ss"], badge: "ss" },
    { id: "fearward", types: ["fearward"], badge: "fearward" },
    { id: "support", types: ["dispel", "cc", "buff"], badge: "dispel" },
    { id: "curse", types: ["curse"], badge: "curse" },
    { id: "warrior", types: ["thunderclap", "demoshout"], badge: "thunderclap" },
    { id: "other", types: ["special", "other"], badge: "other" },
];

/** Which group of tasks a row type belongs to (unknown types are "other"). */
export function taskGroupOf(type: string): string {
    const hit = TASK_GROUPS.find((g) => g.types.indexOf(type) >= 0);
    return hit ? hit.id : "other";
}

/** One row as it concerns the visitor: mode "do" (he does it) or "on" (it acts on him); how it reaches him (via: "player" = him or his slot, "group", "text" = named in words). */
export type MineRow = { a: RaidplanAssignment; mode: string; via: string; group: number; order: number; alsoOnMe: boolean };
export type MineBlock = { group: string; badge: string; rows: MineRow[] };

/** The raid groups the visitor's own players are in. */
export function myGroups(ctx: AssignCtx, me: string[]): number[] {
    return me.map((id) => (ctx.players.get(id) || { group: -1 }).group);
}

/** How a row concerns the visitor, or null when it does not. `names` = the names of his own characters (for the ones in words). */
export function rowMode(a: RaidplanAssignment, ctx: AssignCtx, me: string[], names: string[]): MineRow | null {
    if (me.length === 0) return null;
    const groups = myGroups(ctx, me);
    const at = a.assignees.findIndex((r) => isMe(resolveAssignee(r, ctx), me));
    let via = "";
    let group = 0;
    for (const tg of a.targets) {
        const r = resolveTarget(tg, ctx);
        if (isMe(r, me)) { via = "player"; group = 0; break; }
        if (r.kind === "group" && groups.indexOf(r.group) >= 0 && via === "") { via = "group"; group = r.group; }
    }
    if (via === "" && names.length > 0 && mentionsInRow(a, names)) via = "text";
    if (at >= 0) return { a, mode: "do", via, group, order: a.type === "kick" && a.assignees.length > 1 ? at + 1 : 0, alsoOnMe: via === "player" || via === "group" };
    if (via !== "") return { a, mode: "on", via, group, order: 0, alsoOnMe: false };
    return null;
}

function blocksOf(rows: MineRow[]): MineBlock[] {
    const out = [];
    for (const g of TASK_GROUPS) {
        const list = rows.filter((r) => taskGroupOf(r.a.type) === g.id);
        if (list.length > 0) out.push({ group: g.id, badge: g.badge, rows: list });
    }
    return out;
}

/** The visitor's tasks and what acts on him, each grouped by kind of task in the fixed order, and the mode of every row by id (for highlighting the tables). */
export function splitMine(assignments: RaidplanAssignment[], ctx: AssignCtx, me: string[], names: string[]): { mine: MineBlock[]; onMe: MineBlock[]; modes: Record<string, string> } {
    const mine = [];
    const onMe = [];
    const modes = {};
    for (const a of assignments) {
        const r = rowMode(a, ctx, me, names);
        if (!r) continue;
        modes[a.id] = r.mode;
        (r.mode === "do" ? mine : onMe).push(r);
    }
    return { mine: blocksOf(mine), onMe: blocksOf(onMe), modes };
}
