// Where the board's ring puts each raider of a split group (docs/raidplan/animation.md, "single raiders"): the same layout PlanBoard
// draws (lib/raidplan/labels.ts ringOffsets on the reference canvas), as offsets to the group marker in board fractions. An animation
// moves a single raider from there (lib/raidplan/scene.ts MemberAt); a raider with a stored offset is not listed (the board keeps
// his place itself). Pure.
import type { RaidplanBoard, RaidplanPlayer } from "../../api";
import { REF_W } from "./boardScale";
import { groupScales } from "./geometry";
import { ringOffsets, ringUnit } from "./labels";
import { SIZE_RANGES } from "./model";
import { splitMembers } from "./players";
import type { MemberAt } from "./scene";

type MemberBoard = Pick<RaidplanBoard, "tokens" | "slots"> & { autoUsers?: string[]; objectScale?: number };

/**
 * The ring offsets of every raider of every split group on the board ("<slotId>~<userId>" -> { x, y }). `aspect` = the board's
 * width / height (its map's; 16:10 without one), `autoUsers` = the raiders the tank rows put on the map (they leave their ring).
 */
export function memberOffsets(board: MemberBoard, roster: RaidplanPlayer[], aspect = 16 / 10): MemberAt {
    const out: MemberAt = {};
    const objectScale = board.objectScale || 1;
    const own = { ...board, assignments: [], autoUsers: board.autoUsers || [] } as unknown as RaidplanBoard;
    for (const s of board.slots) {
        if (s.kind !== "group" || s.hidden || s.placed === false) continue;
        const around = splitMembers(own, s, roster);
        if (around.length === 0) continue;
        const { gs, sp, ts } = groupScales(s);
        const memberBase = Math.round((s.size || SIZE_RANGES.member.def) * objectScale);
        const ring = ringOffsets(around.length, REF_W, REF_W / (aspect || 16 / 10), ringUnit(memberBase * gs * sp, memberBase * gs * ts));
        around.forEach((p, i) => {
            if (s.offsets && s.offsets[p.userId]) return;
            if (ring[i]) out[`${s.id}~${p.userId}`] = { x: ring[i].dx, y: ring[i].dy };
        });
    }
    return out;
}

/** The raiders a group marker shows as tokens (who can be picked one by one), in ring order. */
export function groupRaiders(board: MemberBoard, slotId: string, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    const s = board.slots.find((x) => x.id === slotId);
    if (!s) return [];
    return splitMembers({ ...board, assignments: [], autoUsers: board.autoUsers || [] } as unknown as RaidplanBoard, s, roster);
}
