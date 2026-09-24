// The read view's tables, derived from the assignments (nothing to maintain): "Tank | Ziel | Heiler", the group healing,
// and the slim tables of the other types. Pure; the component (pages/raid-detail/raidplan/ReadTables.tsx) only draws them.
// Written with function declarations and one-line signatures only, so the tests can load it (test/web-client/i18nHelper.js).
import type { RaidplanAssignment } from "../api";
import { resolveAssignee, resolveTarget } from "./assign";
import type { AssignCtx, Resolved } from "./assign";

export type TankRow = { key: string; rowId: string; tank: Resolved; target: Resolved | null; healers: Resolved[]; own: boolean };
export type GroupHealRow = { key: string; rowId: string; healers: Resolved[]; groups: number[] };
export type SimpleRow = { key: string; rowId: string; order: number; task: string; spell: string; who: Resolved[]; targets: Resolved[]; note: string };
export type SimpleTable = { type: string; rows: SimpleRow[] };

/** Whether a tank (an assignee of a tank row) is the thing a heal row's target names: the same slot, or the same person in it. */
export function sameTank(tank: Resolved, target: Resolved): boolean {
    if (tank.kind === "slot" && target.kind === "slot") return tank.ref === `slot:${target.ref}`;
    return !!tank.player && !!target.player && tank.player.userId === target.player.userId;
}

/** The healers that heal a tank: the assignees of every heal row that targets him (each once, in the order of the rows). */
export function healersOf(tank: Resolved, assignments: RaidplanAssignment[], ctx: AssignCtx): Resolved[] {
    const out = [];
    for (const h of assignments) {
        if (String(h.type) !== "heal") continue;
        if (!h.targets.some((tg) => sameTank(tank, resolveTarget(tg, ctx)))) continue;
        for (const ref of h.assignees) if (!out.some((x) => x.ref === ref)) out.push(resolveAssignee(ref, ctx));
    }
    return out;
}

/** "Tank | Ziel | Heiler": a row per tank and target of the tank rows (the trash tank rows too); a tank row without a target has an empty target. */
export function tankTable(assignments: RaidplanAssignment[], ctx: AssignCtx, isOwn: (a: RaidplanAssignment) => boolean): TankRow[] {
    const rows = [];
    for (const a of assignments) {
        const type = String(a.type);
        if (type !== "tank" && type !== "trashtank") continue;
        const targets = a.targets.map((tg) => resolveTarget(tg, ctx));
        a.assignees.forEach((ref) => {
            const tank = resolveAssignee(ref, ctx);
            const list = targets.length > 0 ? targets : [null];
            list.forEach((target, i) => {
                rows.push({ key: `${a.id}:${ref}:${i}`, rowId: a.id, tank, target, healers: healersOf(tank, assignments, ctx), own: isOwn(a) });
            });
        });
    }
    return rows;
}

/** "Heiler | Gruppen": the heal rows that name raid groups (their tank targets are in the tank table). */
export function groupHealTable(assignments: RaidplanAssignment[], ctx: AssignCtx): GroupHealRow[] {
    const rows = [];
    for (const a of assignments) {
        if (String(a.type) !== "heal") continue;
        const groups = a.targets.filter((tg) => tg.kind === "group").map((tg) => Number(tg.ref)).sort((x, y) => x - y);
        if (groups.length === 0 || a.assignees.length === 0) continue;
        rows.push({ key: a.id, rowId: a.id, healers: a.assignees.map((ref) => resolveAssignee(ref, ctx)), groups });
    }
    return rows;
}

/** The types with their own small table, in the order they are shown. */
export const SIMPLE_ORDER = ["kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "curse", "thunderclap", "demoshout", "other"];

/**
 * A slim table per other type. Interrupts get a row per assignee with their place in the rotation (1, 2, 3 ...);
 * every other row is one line: the task (spell / free text), who, at what.
 */
export function simpleTables(assignments: RaidplanAssignment[], ctx: AssignCtx): SimpleTable[] {
    const out = [];
    for (const type of SIMPLE_ORDER) {
        const rows = [];
        for (const a of assignments) {
            if (String(a.type) !== type) continue;
            const targets = a.targets.map((tg) => resolveTarget(tg, ctx));
            const base = { rowId: a.id, task: a.title, spell: a.spell ? a.spell.name : "", targets, note: a.note };
            if (type === "kick" && a.assignees.length > 1) {
                a.assignees.forEach((ref, i) => rows.push({ ...base, key: `${a.id}:${i}`, order: i + 1, who: [resolveAssignee(ref, ctx)] }));
            } else {
                rows.push({ ...base, key: a.id, order: 0, who: a.assignees.map((ref) => resolveAssignee(ref, ctx)) });
            }
        }
        if (rows.length > 0) out.push({ type, rows });
    }
    return out;
}
