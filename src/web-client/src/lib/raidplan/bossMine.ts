// Which sections of the sheet (/p/<token>) the visitor is PERSONALLY assigned in, for the mark on their chips (issue #503). Stricter than
// "Only for me" (mineView.splitMine): only a row that names him - as the one who does it (his character or his slot) or as its
// target (him or his slot, i.e. "Wirkt auf dich") - and a tactic step with him among its participants. A row meant for his role group
// (`role:<role>`), his raid group ("Gruppe 2") or a name in a note does not count: those are in "Only for me", but they are nobody's
// own assignment. Pure and tested (bossMine.test.ts); written with function declarations and one-line signatures only.
import type { RaidplanAssignment, RaidplanPlayer, RaidplanSlot, RaidplanStep } from "../../api";
import { isMe, resolveAssignee, resolveTarget } from "./assign";
import type { AssignCtx } from "./assign";

/** The part of a section the mark needs (a public boss, or an editor section with its effective rows). */
export type MineSection = { key: string; slots: RaidplanSlot[]; assignments: RaidplanAssignment[]; steps?: RaidplanStep[]; roles?: Record<string, string> };

/** Whether a row names the visitor personally: he (or his slot) does it, or it acts on him (or his slot). Role groups, raid groups and words never count. */
export function isPersonalRow(a: RaidplanAssignment, ctx: AssignCtx, me: string[]): boolean {
    if (me.length === 0) return false;
    if (a.assignees.some((r) => r.indexOf("role:") !== 0 && isMe(resolveAssignee(r, ctx), me))) return true;
    return a.targets.some((tg) => tg.kind !== "role" && tg.kind !== "group" && isMe(resolveTarget(tg, ctx), me));
}

/** Whether a (resolved) tactic step has one of the visitor's own players among its participants by name (not only his group). */
export function isPersonalStep(s: RaidplanStep, me: string[]): boolean {
    return (s.participants || []).some((r) => r.indexOf("user:") === 0 && me.indexOf(r.slice(5)) >= 0);
}

/** Whether the visitor is personally assigned in one section. */
export function hasMine(b: MineSection, players: Map<string, RaidplanPlayer>, me: string[]): boolean {
    if (me.length === 0) return false;
    const ctx: AssignCtx = { slots: b.slots, players, roles: b.roles || {} };
    return b.assignments.some((a) => isPersonalRow(a, ctx, me)) || (b.steps || []).some((s) => isPersonalStep(s, me));
}

/** The keys of the sections the visitor is personally assigned in (empty without a visitor). */
export function bossesWithMine(bosses: MineSection[], players: Map<string, RaidplanPlayer>, me: string[]): Set<string> {
    return new Set(me.length === 0 ? [] : bosses.filter((b) => hasMine(b, players, me)).map((b) => b.key));
}
