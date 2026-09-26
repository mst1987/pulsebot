import type { RaidplanBoard, RaidplanPlayer, RaidplanSlot, RaidplanZone, RaidplanText, RaidplanIcon } from "../../api";
import { t } from "../../i18n";
import type { LayerRow, ObjectKind } from "./model";
import { iconKeyType } from "./facing";
import { parseMemberId } from "./players";

/** How far apart two neighbours of a group ring stand at least, in token sizes: room for a name under each of them, side by side. */
export const RING_CHORD = 2.2;

/**
 * The size a group ring is laid out with (reference px): its spacing (the group's size x "Ring spacing"), but never less than the tokens
 * it carries (the group's size x "Token size") - bigger tokens push the ring out, so neighbours and their names never cover each other.
 */
export function ringUnit(spacePx: number, memberPx: number): number {
    return Math.max(spacePx > 0 ? spacePx : 0, memberPx > 0 ? memberPx : 0);
}

/** The radius of a group ring (reference px) for `count` raiders of `tokenPx`: it grows with their number, and neighbours are RING_CHORD tokens apart. */
export function ringRadius(count: number, tokenPx: number): number {
    if (count <= 0 || !(tokenPx > 0)) return 0;
    const chord = count > 1 ? (RING_CHORD * tokenPx) / (2 * Math.sin(Math.PI / count)) : 0;
    return Math.max(tokenPx * 1.7, (count * tokenPx * 1.3) / (2 * Math.PI), chord);
}

/**
 * The widest a name under a ring member may be (reference px): the distance to its neighbour less a little air, never more than the
 * usual 2.6 icons - a longer name ends in "…" instead of lying on the next raider (docs/raidplan.md, "Names on the map").
 * `spacePx` = the ring's spacing unit, `memberPx` = the size the member tokens are drawn with.
 */
export function ringNameWidth(count: number, spacePx: number, memberPx: number): number {
    const most = memberPx * 2.6;
    if (count <= 1) return most;
    const chord = 2 * ringRadius(count, spacePx) * Math.sin(Math.PI / count);
    return Math.max(memberPx * 1.2, Math.min(most, chord - memberPx * 0.25));
}

/**
 * Where the raiders of a split group stand around their marker: evenly on a ring
 * whose radius grows with their number, so they never overlap - neither their icons
 * nor the names under them (ringRadius). Offsets from the marker in board fractions
 * (the ring is a circle in pixels, whatever the board's shape is), for a board of
 * w × h px and tokens of tokenPx.
 */
export function ringOffsets(count: number, w: number, h: number, tokenPx: number): { dx: number; dy: number }[] {
    const out: { dx: number; dy: number }[] = [];
    if (count <= 0 || w <= 0 || h <= 0) return out;
    const radius = ringRadius(count, tokenPx);
    for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
        out.push({ dx: (Math.cos(angle) * radius) / w, dy: (Math.sin(angle) * radius) / h });
    }
    return out;
}

// ---- names, layers -----------------------------------------------------------------------

/** How a slot is called: "Tank 2", "Group 3", or its own label. */
export function slotTitle(slot: RaidplanSlot): string {
    if (slot.kind === "label") return slot.label;
    if (slot.label) return slot.label;
    return t(`raidBoard.slot.${slot.kind}`, { n: slot.n });
}

/**
 * What a board object prints next to itself. Only what was typed is drawn: no
 * fallback such as "Tank 1" or the zone's type (those names belong to the layer list,
 * the tooltips and the screen readers, see slotTitle / objectName).
 */
export function slotBoardLabel(slot: RaidplanSlot): string {
    return (slot.label || "").trim();
}

export function zoneBoardLabel(zone: RaidplanZone): string {
    return (zone.label || "").trim();
}

/** An icon's label is drawn only when it was switched on (inspector) and has words. */
export function iconBoardLabel(icon: RaidplanIcon): string {
    return icon.showLabel ? (icon.label || "").trim() : "";
}

/** A text object with no words is not drawn (only while it is selected, so it can be filled in). */
export function textShown(text: RaidplanText, selected: boolean): boolean {
    return (text.text || "").trim() !== "" || selected;
}

/** The players of the setup group a group marker stands for. */
export function groupMembers(slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    return roster.filter((p) => p.group === slot.n);
}

/** The height steps of the map (S / M / L: a share of the window's height), or a height set by hand with the splitter (C). */
type StepShares = Record<string, number>;

export const MAP_STEPS = { S: 0.27, M: 0.36, L: 0.52 } as StepShares;

export type MapSize = { step: "S" | "M" | "L" | "C"; px: number };

export const DEFAULT_MAP_SIZE = { step: "M", px: 0 } as MapSize;

/** The map's height in px for a window height: a step is a share of it, a hand-set height stays (kept inside 200 px .. window - 160). */
export function mapHeight(size: MapSize, vh: number): number {
    const share = MAP_STEPS[size.step];
    const px = size.step === "C" ? size.px : Math.round(vh * (share || 0.36));
    return Math.max(200, Math.min(Math.max(200, vh - 160), Math.round(px)));
}

/** What was remembered (JSON text) as a map size; anything else is the default. */
export function parseMapSize(raw: string | null): MapSize {
    try {
        const v = JSON.parse(raw || "null");
        if (v && (v.step === "S" || v.step === "M" || v.step === "L")) return { step: v.step, px: 0 };
        if (v && v.step === "C" && Number.isFinite(v.px)) return { step: "C", px: Math.max(200, Math.min(4000, Math.round(v.px))) };
    } catch { /* not JSON */ }
    return DEFAULT_MAP_SIZE;
}

/** How many placeholder tokens a split group shows in a template (no roster there): the size of a raid group. */
export const GROUP_PLACEHOLDERS = 5;

/**
 * What a group marker draws (pure, so the rule is testable). The tag is ALWAYS there, in every view: the group's icon and
 * its number — the number is the group's identity, not a text label, so the "only what was typed" rule does not apply
 * (a typed label is added next to it). A split group also puts a number badge on each of its tokens and a ring round
 * them; in a template (no roster) the ring shows placeholder tokens. An event group nobody is in has a dimmed number.
 */
export function groupTag(slot: RaidplanSlot, memberCount: number, rosterKnown: boolean): { number: string; label: string; dim: boolean; badges: boolean; placeholders: number; ring: boolean } {
    const around = !!slot.split && !slot.hideMembers;
    return {
        number: String(slot.n),
        label: (slot.label || "").trim(),
        dim: rosterKnown && memberCount === 0,
        badges: around,
        placeholders: around && !rosterKnown ? GROUP_PLACEHOLDERS : 0,
        ring: around && (memberCount > 0 || !rosterKnown),
    };
}

/**
 * How a group marker is drawn: in the editor and the template always as the chip (icon + number, the grip one drags); in the read
 * view a SPLIT group has no chip at all (the number badges on its tokens say who belongs together; a typed label is plain text
 * without a chip or grip look), a group that is not split keeps its chip with the names.
 */
export function groupChipMode(editable: boolean, split: boolean, label: string): string {
    if (editable || !split) return "chip";
    return label.trim() !== "" ? "text" : "none";
}

/** Whether the ring round a split group is drawn: the board's switch for all rings and the group's own one (both default to shown). */
export function ringShown(boardShowRings: boolean | undefined, slot: { showRing?: boolean }): boolean {
    return boardShowRings !== false && slot.showRing !== false;
}

/** The ellipse (half width / height, as fractions of the board) that covers the offsets of a ring, with a little room for the tokens. */
export function ringCover(offsets: { dx: number; dy: number }[], padX: number, padY: number): { rx: number; ry: number } {
    let rx = 0;
    let ry = 0;
    for (const o of offsets) { rx = Math.max(rx, Math.abs(o.dx)); ry = Math.max(ry, Math.abs(o.dy)); }
    return { rx: rx + padX, ry: ry + padY };
}

/** How many slots of a board are still open (a group marker and a label are not places to fill). */
export function openSlots(board: RaidplanBoard): number {
    return board.slots.filter((s) => (s.kind === "tank" || s.kind === "healer" || s.kind === "melee" || s.kind === "ranged" || s.kind === "dps") && !s.userId).length;
}

/** The name an object goes by in the layer list and the inspector. */
export function objectName(board: RaidplanBoard, kind: ObjectKind, id: string, players: Map<string, RaidplanPlayer>): string {
    if (kind === "token") return (players.get(id) || { character: id }).character;
    if (kind === "slot") {
        const s = board.slots.find((o) => o.id === id);
        return s ? slotTitle(s) : "";
    }
    if (kind === "mark") {
        const m = board.marks.find((o) => o.id === id);
        return m ? t(`raidBoard.mark.${m.mark}`) : "";
    }
    if (kind === "zone") {
        const z = board.zones.find((o) => o.id === id);
        return z ? z.label || (z.type === "role" ? t(`raidBoard.roleGroup.${z.role || "melee"}`) : t(`raidBoard.zone.${z.type}`)) : "";
    }
    if (kind === "icon") {
        const i = board.icons.find((o) => o.id === id);
        return i ? i.label || t(`raidBoard.icon.${iconKeyType(i.iconKey)}`) : "";
    }
    if (kind === "member") return (players.get(parseMemberId(id).userId) || { character: "" }).character;
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? t(`raidBoard.line.${l.kind}`) : "";
    }
    const x = board.texts.find((o) => o.id === id);
    return x ? x.text : "";
}

/** Every object of the board, front to back — the layer list. Within a kind the last one added is in front. */
export function layerList(board: RaidplanBoard, players: Map<string, RaidplanPlayer>): LayerRow[] {
    const rows: LayerRow[] = [];
    const add = (kind, list, idOf) => {
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            rows.push({ kind, id: idOf(o), name: objectName(board, kind, idOf(o), players), lock: !!o.lock, hidden: !!o.hidden });
        }
    };
    add("token", board.tokens, (o) => o.userId);
    add("text", board.texts, (o) => o.id);
    add("slot", board.slots.filter((o) => o.placed !== false), (o) => o.id);
    add("mark", board.marks, (o) => o.id);
    add("icon", board.icons, (o) => o.id);
    add("line", board.lines, (o) => o.id);
    add("zone", board.zones, (o) => o.id);
    return rows;
}
