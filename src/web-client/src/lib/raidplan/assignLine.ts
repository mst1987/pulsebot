// One assignment row as ONE container ("Zeile mit Chip-Container", option 1 of the Raidplan canvas), pure: what its two columns show
// (who -> at whom), how class references with a count are bracketed ("Jäger x2" -> the players they resolve to), which state the row
// is in (empty / open / resolved), the counter of a card ("4 Zeilen · 1 offen") and the sentence a screen reader hears. The chips only
// show; everything is edited in the row dialog. Tested in test/web-client/assignLine.test.js; function declarations and one-line
// signatures only.
import { classPlaceNameFor, classRefLabelFor, offRole, resolveAssignee, resolveTarget, type AssignCtx, type Resolved } from "./assign";
import { classGroups, expandClassRefs, isClassRef, parseClassRef } from "./classRefs";
import type { RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../api";

/** One entry of a column: a single chip, or a bracket of a class reference with a count ("Jäger x2") holding what it resolves to. */
export type LineItem = { key: string; kind: string; r: Resolved | null; order: number; open: boolean; mine: boolean; classId: string; role: string; count: number; items: Resolved[]; /** a player on a tanking row outside his spec role (a mage who tanks: "als Tank") */ asTank: boolean };
/** A row of the plan with a place nobody fills: its section, kind of task and what is missing ("Magier-Tank", "Jäger"). */
export type OpenRow = { key: string; name: string; rowId: string; type: string; missing: string[] };

export type CardSum = { rows: number; open: number };

/** Whether a resolved chip is an open place that is missing (yellow): a class nobody fills, or an empty role slot in an EVENT (in a template a slot is only a placeholder, grey). */
export function isMissing(r: Resolved, isEvent: boolean): boolean {
    if (!r.open) return false;
    if (r.kind === "class") return true;
    return isEvent && r.kind === "slot";
}

/** A resolved chip as the row names it: an open class place on a tanking row is "Magier-Tank 1". */
function named(r: Resolved, type: string): Resolved {
    return r.kind === "class" ? { ...r, label: classRefLabelFor(r.ref, type) } : r;
}

/**
 * The assignee column of a row: every reference as it resolves now (`filled` = the row with its class references resolved, same order),
 * a class with more than one reference in the row as ONE bracket at the place of its first reference (label "Jäger x2", inside the players
 * it resolves to or its open places). `me` = the viewer's own players (the "DU" chip of the sheet). `rotation` numbers the chips (kick).
 */
export function assigneeItems(row: RaidplanAssignment, filled: RaidplanAssignment, ctx: AssignCtx, me: string[], rotation: boolean, isEvent: boolean): LineItem[] {
    const groups = classGroups(row.assignees.filter((r) => isClassRef(r))).filter((g) => g.refs.length > 1);
    const done = {};
    const out = [];
    row.assignees.forEach((ref, i) => {
        const q = isClassRef(ref) ? parseClassRef(ref) : null;
        const g = q ? groups.find((x) => x.classId === q.classId && x.role === q.role) : undefined;
        if (g) {
            const key = `${g.classId}|${g.role}`;
            if (done[key]) return;
            done[key] = true;
            const items = g.refs.map((r) => named(resolveAssignee(filled.assignees[row.assignees.indexOf(r)] || r, ctx), row.type));
            out.push({ key: `ref:${key}`, kind: "ref", r: null, order: 0, open: items.some((x) => isMissing(x, isEvent)), mine: items.some((x) => !!x.player && me.indexOf(x.player.userId) >= 0), classId: g.classId, role: g.role, count: g.refs.length, items, asTank: false });
            return;
        }
        const r = named(resolveAssignee(filled.assignees[i] || ref, ctx), row.type);
        out.push({ key: ref, kind: "one", r, order: rotation ? i + 1 : 0, open: isMissing(r, isEvent), mine: !!r.player && me.indexOf(r.player.userId) >= 0, classId: q ? q.classId : "", role: q ? q.role : "", count: 1, items: [], asTank: offRole(row.type, r.player) });
    });
    return out;
}

/** The target column: every target as it resolves now (a class target resolved like an assignee; groups, marks, mobs, text as they are). */
export function targetItems(row: RaidplanAssignment, filled: RaidplanAssignment, ctx: AssignCtx, me: string[], isEvent: boolean): LineItem[] {
    return row.targets.map((tg, i) => {
        const r = resolveTarget((filled.targets || [])[i] || tg, ctx);
        const q = tg.kind === "class" ? parseClassRef(tg.ref) : null;
        return { key: `${tg.kind}|${tg.ref}`, kind: "one", r, order: 0, open: isMissing(r, isEvent), mine: !!r.player && me.indexOf(r.player.userId) >= 0, classId: q ? q.classId : "", role: q ? q.role : "", count: 1, items: [], asTank: false };
    });
}

/** The state of a row: "empty" (nothing chosen: a dashed placeholder), "open" (a place nobody fills: one yellow chip), "ok" (quiet). */
export function lineState(row: RaidplanAssignment, filled: RaidplanAssignment, ctx: AssignCtx, isEvent: boolean): string {
    if (row.assignees.length === 0 && row.targets.length === 0) return "empty";
    const items = [...assigneeItems(row, filled, ctx, [], false, isEvent), ...targetItems(row, filled, ctx, [], isEvent)];
    return items.some((x) => x.open) ? "open" : "ok";
}

/** The counter of a card: how many rows and how many of them have an open place ("4 Zeilen · 1 offen"). */
export function cardSummary(rows: RaidplanAssignment[], filled: RaidplanAssignment[], ctx: AssignCtx, isEvent: boolean): CardSum {
    let open = 0;
    for (const a of rows) if (lineState(a, filled.find((x) => x.id === a.id) || a, ctx, isEvent) === "open") open += 1;
    return { rows: rows.length, open };
}

/** The small line under a row, only when there is something: the spell's name, the task text (when it is not just the type) and the note. */
export function subLine(row: RaidplanAssignment): string[] {
    const out = [];
    if (row.spell && row.spell.name) out.push(row.spell.name);
    if (row.title) out.push(row.title);
    if (row.note) out.push(row.note);
    return out;
}

/** What a screen reader hears for a row: "Heilen: Heilbert, Disziplin -> Tankwart, Gruppe 3". */
export function lineLabel(typeName: string, who: LineItem[], at: LineItem[], openWord: string): string {
    const w = who.map((x) => itemName(x, openWord)).join(", ");
    const a = at.map((x) => itemName(x, openWord)).join(", ");
    return `${typeName}: ${w || "-"}${a ? ` -> ${a}` : ""}`;
}

function itemName(x: LineItem, openWord: string): string {
    if (x.kind === "ref") return x.items.map((r) => (r.player ? r.player.character : `${r.label} (${openWord})`)).join(", ");
    if (x.r && x.r.player) return x.r.player.character;
    return `${x.r ? x.r.label : ""}${x.open ? ` (${openWord})` : ""}`;
}

/** What an open place is missing, by name: a class place as the row names it ("Magier-Tank", "Jäger"), an open slot by its label. */
function missingName(x: LineItem, r: Resolved, type: string): string {
    if (r.kind === "class") {
        const q = parseClassRef(r.ref);
        return q ? classPlaceNameFor(q.classId, q.role, type) : r.label;
    }
    return x.kind === "ref" ? classPlaceNameFor(x.classId, x.role, type) : r.label;
}

/**
 * Every row of the plan with a place nobody fills (plan-wide badge "n offene Einteilungen"), per section in the order given, with what is
 * missing. Only for an event plan (a template has no setup, nothing can be missing there). Each section's rows are resolved round robin
 * like the editor does.
 */
export function openAssignments(sections: { key: string; name: string; board: RaidplanBoard }[], roster: RaidplanPlayer[]): OpenRow[] {
    const players = new Map(roster.map((p) => [p.userId, p]));
    const out = [];
    for (const sec of sections) {
        const list = (sec.board && sec.board.assignments) || [];
        if (list.length === 0) continue;
        const slots = sec.board.slots || [];
        const filledAll = expandClassRefs(list, slots, roster, sec.board.roles || {});
        const ctx = { slots, players };
        list.forEach((a, i) => {
            const items = [...assigneeItems(a, filledAll[i], ctx, [], false, true), ...targetItems(a, filledAll[i], ctx, [], true)];
            const missing = [];
            for (const x of items) {
                if (!x.open) continue;
                const rs = x.kind === "ref" ? x.items.filter((r) => isMissing(r, true)) : x.r ? [x.r] : [];
                for (const r of rs) { const n = missingName(x, r, a.type); if (missing.indexOf(n) < 0) missing.push(n); }
            }
            if (missing.length > 0) out.push({ key: sec.key, name: sec.name, rowId: a.id, type: a.type, missing });
        });
    }
    return out;
}

/** The names of what is missing over a list of open rows, each once ("Magier, Jäger"), for the summary toast. */
export function missingNames(list: OpenRow[]): string[] {
    const out = [];
    for (const o of list) for (const n of o.missing) if (out.indexOf(n) < 0) out.push(n);
    return out;
}
