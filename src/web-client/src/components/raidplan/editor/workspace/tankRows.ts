import type { RaidplanAssignment, RaidplanAssignType, RaidplanBoard, RaidplanMobRef, RaidplanPlayer } from "../../../../api";
import type { useT } from "../../../../i18n";
import { deviate } from "../../../../lib/raidplan/inherit";
import { iconTarget, mobIconsOf, rowOfMob, tankTo, untank, type AutoPlan, type AutoTank } from "../../../../lib/raidplan/autoPlace";
import { classPlaceNameFor, mobTarget } from "../../../../lib/raidplan/assign";
import { ANY } from "../../../../lib/raidplan/classRefs";
import { isRoleKind, parseMemberId, type ObjectKind } from "../../../../lib/raidplan";

/**
 * What the map does with the tank rows: open a row's dialog from an object on
 * the map, give a mob a tank ("Tank wählen …"), make a raider or a slot tank a
 * mob or stop tanking ("Tankt → …" / "Tankt nicht mehr"), and name what the
 * rows put on the map. A row inherited from the Standard becomes the section's
 * own first. Built fresh each render from what the working area knows.
 */
export function tankRowActions({ board, edit, inherited, auto, mobs, scope, players, t, requestRow }: {
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    /** the rows this section inherits from the Standard */
    inherited: RaidplanAssignment[];
    auto: AutoPlan;
    mobs: RaidplanMobRef[];
    scope: string;
    players: Map<string, RaidplanPlayer>;
    t: ReturnType<typeof useT>;
    /** asks AssignPanel to open a row's dialog */
    requestRow: (id: string) => void;
}) {
    /** Opens a row's dialog from the map; a row inherited from the Standard becomes the section's own first (a copy that keeps its key). */
    const openRowFromMap = (rowId: string) => {
        const inh = inherited.find((a) => a.id === rowId);
        if (inh && !board.assignments.some((a) => a.id === rowId)) {
            const id = `a${Math.random().toString(36).slice(2, 9)}`;
            edit((b) => { const nb = deviate(b, inh); const list = nb.assignments.slice(); list[list.length - 1] = { ...list[list.length - 1], id }; return { ...nb, assignments: list }; });
            requestRow(id);
            return;
        }
        requestRow(rowId);
    };
    /** "Tank wählen …" of a mob: its tank row, else a new tank row with the mob as its target. */
    const pickTankFor = (mobKey: string, fallback: RaidplanMobRef | null, iconId = "") => {
        const rowId = mobKey ? rowOfMob(auto, mobKey) : "";
        if (rowId) { openRowFromMap(rowId); return; }
        const m = mobKey ? auto.mobs.find((x) => x.key === mobKey) : undefined;
        // an icon of a mob that stands on the map twice or more: the new row means THAT icon ("Flame 2"), not the kind
        const oneOf = iconId && fallback && mobIconsOf(board, fallback.id).length > 1 ? iconTarget(board, mobTarget(fallback), iconId) : null;
        const target = oneOf || (m ? { ...mobTarget({ id: m.ref, name: m.name, icon: m.icon }), ...(m.count > 1 ? { n: m.inst } : {}) } : fallback ? mobTarget(fallback) : null);
        if (!target) return;
        const id = `a${Math.random().toString(36).slice(2, 9)}`;
        edit((b) => ({ ...b, assignments: [...b.assignments, { id, type: (scope === "trash" ? "trashtank" : "tank") as RaidplanAssignType, title: "", spell: null, assignees: [], targets: [target], note: "", suggested: false, preferredClasses: [], allowOthers: false }] }));
        requestRow(id);
    };
    /** The own row of a tank of the rows (an inherited one becomes the section's own first) and the tank's reference in it as stored. */
    const ownRowOf = (b: RaidplanBoard, k: AutoTank): { board: RaidplanBoard; ref: string } => {
        let row = b.assignments.find((a) => a.id === k.rowId);
        let nb = b;
        if (!row) {
            const inh = inherited.find((a) => a.id === k.rowId);
            if (!inh) return { board: b, ref: "" };
            nb = deviate(b, inh);
            row = nb.assignments[nb.assignments.length - 1];
        }
        return { board: nb, ref: row.assignees[k.j - 1] || "" };
    };
    /** The assignee reference an object of the map stands for: a raider (token, group member) or a role slot; "" for anything else. */
    const refOfObject = (b: RaidplanBoard, sel: { kind: ObjectKind; id: string }): string => {
        if (sel.kind === "token") return `user:${sel.id}`;
        if (sel.kind === "member") return `user:${parseMemberId(sel.id).userId}`;
        if (sel.kind !== "slot") return "";
        const s = b.slots.find((x) => x.id === sel.id);
        return s && isRoleKind(s.kind) ? `slot:${s.kind}:${s.n}` : "";
    };
    /** "Tankt → <mob>" / "Tankt nicht mehr" (mobId "") from the right-click menu: writes the tank rows (lib/raidplan/autoPlace.ts tankTo / untank). */
    const tankAction = (sel: { kind: ObjectKind; id: string }, pick: string) => {
        // "<mob id>" = the mob as such, "<mob id>@<icon id>" = one of several icons of it on the map
        const at = pick.indexOf("@");
        const mobId = at >= 0 ? pick.slice(0, at) : pick;
        const m = mobs.find((x) => x.id === mobId);
        const target = m ? (at >= 0 ? iconTarget(board, mobTarget(m), pick.slice(at + 1)) : mobTarget(m)) : null;
        const type = (scope === "trash" ? "trashtank" : "tank") as RaidplanAssignType;
        edit((b) => {
            let nb = b;
            let ref = "";
            if (sel.kind === "auto") {
                const k = auto.tanks.find((x) => x.key === sel.id);
                if (!k) return b;
                const r = ownRowOf(b, k);
                nb = r.board;
                ref = r.ref;
            } else ref = refOfObject(b, sel);
            if (!ref) return b;
            return target ? tankTo(nb, ref, target, type) : untank(nb, ref);
        });
    };
    /** What an auto object is called (the menu's title). */
    const autoName = (key: string): string => {
        const k = auto.tanks.find((x) => x.key === key);
        if (k) {
            const p = k.userId ? players.get(k.userId) : undefined;
            if (p) return p.character;
            if (k.classId) return k.classId === ANY ? t(`raidBoard.class.roles.${k.role || "tank"}`) : classPlaceNameFor(k.classId, k.role, k.type);
            return t(`raidBoard.slot.${k.slotKind || "tank"}`, { n: k.slotN || 1 });
        }
        const m = auto.mobs.find((x) => x.key === key);
        return m ? (m.count > 1 ? `${m.name} ${m.inst}` : m.name) : "";
    };
    return { openRowFromMap, pickTankFor, refOfObject, tankAction, autoName };
}
