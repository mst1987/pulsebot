// The look of a group: its colour and its raid mark. Group n gets a fixed default colour from a palette that tells the groups apart for people with
// colour-blindness too (Okabe-Ito plus a grey; the number is always shown next to it, colour is never the only sign); a colour can be set per group
// and a raid mark (skull, cross ...) once per board. Stored on the board as `groupColors` / `groupMarks` (group number -> value), empty = the defaults.
// Pure and tested (src/web-client/src/lib/groupStyle.test.ts); written with function declarations and one-line signatures only.
import type { RaidplanBoard } from "../api";

/** The default colours of groups 1..8; group 9 starts over. */
export const GROUP_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999"];

/** The raid marks a group can carry, in the order the game lists them. */
export const GROUP_MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];

export function defaultGroupColor(n: number): string {
    return GROUP_PALETTE[(Math.max(1, Math.round(n)) - 1) % GROUP_PALETTE.length];
}

/** The colour of group n: the board's own choice, else the default. */
export function groupColor(colors: Record<string, string> | undefined, n: number): string {
    const own = colors ? colors[String(n)] : "";
    return /^#[0-9a-fA-F]{6}$/.test(own || "") ? own : defaultGroupColor(n);
}

/** The raid mark of group n, or "". */
export function groupMark(marks: Record<string, string> | undefined, n: number): string {
    const m = marks ? marks[String(n)] : "";
    return GROUP_MARKS.indexOf(m || "") >= 0 ? m : "";
}

/** Sets (or, with "", resets to the default) the colour of a group. */
export function setGroupColor(board: RaidplanBoard, n: number, color: string): RaidplanBoard {
    const next = { ...(board.groupColors || {}) };
    if (color) next[String(n)] = color.toLowerCase();
    else delete next[String(n)];
    return { ...board, groupColors: next };
}

/** Gives a group a raid mark ("" = none). A mark is on one group only: when another has it, the two swap (that one gets this group's old mark, or none). */
export function setGroupMark(board: RaidplanBoard, n: number, mark: string): RaidplanBoard {
    const marks = { ...(board.groupMarks || {}) };
    const mine = marks[String(n)] || "";
    if (mark) {
        const holder = Object.keys(marks).find((k) => marks[k] === mark && k !== String(n));
        if (holder) {
            if (mine) marks[holder] = mine;
            else delete marks[holder];
        }
        marks[String(n)] = mark;
    } else {
        delete marks[String(n)];
    }
    return { ...board, groupMarks: marks };
}

function linearChannel(c: number): number {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Black or white, whichever reads better on a colour (for a number in a coloured badge). */
export function inkOn(color: string): string {
    const m = /^#([0-9a-fA-F]{6})$/.exec(color);
    if (!m) return "#000000";
    const v = parseInt(m[1], 16);
    const lum = 0.2126 * linearChannel((v >> 16) & 255) + 0.7152 * linearChannel((v >> 8) & 255) + 0.0722 * linearChannel(v & 255);
    return lum > 0.4 ? "#000000" : "#ffffff";
}
