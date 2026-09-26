import type { RaidplanBoard, RaidplanLook, RaidplanSlot, RaidplanSlotKind, RaidplanZone, RaidplanZoneType, RaidplanMarkName, RaidplanLine, RaidplanText, RaidplanIcon } from "../../api";
import { t } from "../../i18n";
import { clamp01, DEFAULT_LINE_COLOR, DEFAULT_TEXT_COLOR, type InsertSpec, newLook, newRowId, type ObjectKind, ROLE_GROUP_COLORS, ROLE_GROUPS, type Selection, SIZE_RANGES, ZONE_COLORS } from "./model";
import { isRoleKind, unplaceSlot } from "./besetzung";
import { nextSlotNumber, parseMemberId, removeToken } from "./players";
import { autoStyleOf, patchAutoStyle } from "./autoStyle";
import { moveLine, moveRect } from "./geometry";

// ---- adding ----------------------------------------------------------------------------------

// New objects appear near the middle, each a little off the last so they do not pile up.
export function spawnPoint(count: number): { x: number; y: number } {
    const step = count % 8;
    return { x: 0.42 + step * 0.03, y: 0.42 + step * 0.03 };
}

/** How many objects a board holds, tokens included. */
export function objectCount(board: RaidplanBoard): number {
    return board.tokens.length + board.slots.length + board.marks.length + board.icons.length + board.zones.length + board.lines.length + board.texts.length;
}

/**
 * Inserts one object of a kind: at `at` (the pointer, a drop or a right click), else
 * near the middle. Returns the new board and the selection of what was inserted.
 * A zone and a line are centred on the point, a slot, mark and text are anchored on it.
 */
export function insertObject(board: RaidplanBoard, spec: InsertSpec, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection; blocked?: string } {
    const p = at ? { x: clamp01(at.x), y: clamp01(at.y) } : spawnPoint(objectCount(board));
    const id = newRowId();
    if (spec.type === "slot") {
        const free = isRoleKind(spec.kind) ? board.slots.filter((s) => s.kind === spec.kind && s.placed === false).sort((a, b) => a.n - b.n)[0] : undefined;
        if (free) return { board: { ...board, slots: board.slots.map((s) => (s.id === free.id ? { ...s, placed: true, x: p.x, y: p.y } : s)) }, sel: { kind: "slot", id: free.id } };
        // a role slot belongs to the Besetzung: the palette never makes a new one (+/- in the Besetzung does), it says so instead
        if (isRoleKind(spec.kind)) return { board, sel: null, blocked: spec.kind };
        const slot = {
            id, kind: spec.kind, n: nextSlotNumber(board, spec.kind), label: spec.label || (spec.kind === "group" ? t("raidBoard.slot.group", { n: nextSlotNumber(board, spec.kind) }) : ""), x: p.x, y: p.y, userId: "", size: SIZE_RANGES.slot.def,
            hideMembers: false, split: false, offsets: {}, placed: true, ...newLook(1),
        };
        return { board: { ...board, slots: [...board.slots, slot] }, sel: { kind: "slot", id } };
    }
    if (spec.type === "mark") {
        return { board: { ...board, marks: [...board.marks, { id, mark: spec.mark as RaidplanMarkName, x: p.x, y: p.y, size: SIZE_RANGES.mark.def, ...newLook(1) }] }, sel: { kind: "mark", id } };
    }
    if (spec.type === "icon") {
        const icon = { id, iconKey: spec.iconKey, label: spec.label, x: p.x, y: p.y, size: SIZE_RANGES.icon.def, rotation: 0, showLabel: false, mobId: spec.mobId || "", autoFace: true, ...newLook(1) };
        return { board: { ...board, icons: [...board.icons, icon] }, sel: { kind: "icon", id } };
    }
    if (spec.type === "zone") {
        const zoneType = spec.zoneType as RaidplanZoneType;
        // a role group ("Melees") starts as a soft ellipse in its role colour, a little flatter than an area
        const role = (zoneType === "role" ? (ROLE_GROUPS.indexOf(spec.role || "") >= 0 ? spec.role : "melee") : "") as RaidplanZone["role"];
        const w = role ? 0.18 : 0.2;
        const h = role ? 0.16 : 0.2;
        const zone = {
            id, shape: spec.shape as RaidplanZone["shape"], type: zoneType, label: "", color: role ? ROLE_GROUP_COLORS[role] : ZONE_COLORS[zoneType],
            x: Math.max(0, Math.min(1 - w, p.x - w / 2)), y: Math.max(0, Math.min(1 - h, p.y - h / 2)), w, h, ...newLook(role ? 0.35 : 0.3),
            ...(role ? { role, count: 0, showNames: false } : {}),
        };
        return { board: { ...board, zones: [...board.zones, zone] }, sel: { kind: "zone", id } };
    }
    if (spec.type === "line") {
        const line = {
            id, kind: spec.kind as RaidplanLine["kind"], x1: Math.max(0, p.x - 0.1), y1: p.y, x2: Math.min(1, p.x + 0.1), y2: p.y,
            color: DEFAULT_LINE_COLOR, width: 4, ...newLook(1),
        };
        return { board: { ...board, lines: [...board.lines, line] }, sel: { kind: "line", id } };
    }
    if (spec.type !== "text") return { board, sel: null };
    const text = { id, text: spec.text, x: p.x, y: p.y, color: DEFAULT_TEXT_COLOR, size: 18, ...newLook(1) };
    return { board: { ...board, texts: [...board.texts, text] }, sel: { kind: "text", id } };
}

/** Adds a slot of a kind ("Tank 3"); a free label carries its own text. */
export function addSlot(board: RaidplanBoard, kind: RaidplanSlotKind, label: string): RaidplanBoard {
    // makes a slot outright (the palette never does for a role: it places one of the Besetzung)
    const n = nextSlotNumber(board, kind);
    const p = spawnPoint(objectCount(board));
    const slot = {
        id: newRowId(), kind, n, label: label || (kind === "group" ? t("raidBoard.slot.group", { n }) : ""), x: p.x, y: p.y, userId: "", size: SIZE_RANGES.slot.def,
        hideMembers: false, split: false, offsets: {}, placed: true, ...newLook(1),
    };
    return { ...board, slots: [...board.slots, slot] };
}

export function addMark(board: RaidplanBoard, mark: RaidplanMarkName): RaidplanBoard {
    return insertObject(board, { type: "mark", mark }, null).board;
}

/** Adds a zone of a type in that type's preset colour. */
export function addZone(board: RaidplanBoard, type: RaidplanZoneType, shape: "rect" | "ellipse"): RaidplanBoard {
    return insertObject(board, { type: "zone", zoneType: type, shape }, null).board;
}

// ---- changing ----------------------------------------------------------------------------------

export function patchIn<T>(list: T[], isTarget: (o: T) => boolean, patch: object): T[] {
    return list.map((o) => (isTarget(o) ? { ...o, ...patch } : o));
}

export function updateSlot(board: RaidplanBoard, id: string, patch: Partial<RaidplanSlot>): RaidplanBoard {
    return { ...board, slots: patchIn(board.slots, (s) => s.id === id, patch) };
}

export function updateZone(board: RaidplanBoard, id: string, patch: Partial<RaidplanZone>): RaidplanBoard {
    return { ...board, zones: patchIn(board.zones, (z) => z.id === id, patch) };
}

export function updateIcon(board: RaidplanBoard, id: string, patch: Partial<RaidplanIcon>): RaidplanBoard {
    return { ...board, icons: patchIn(board.icons, (i) => i.id === id, patch) };
}

export function updateLine(board: RaidplanBoard, id: string, patch: Partial<RaidplanLine>): RaidplanBoard {
    return { ...board, lines: patchIn(board.lines, (l) => l.id === id, patch) };
}

export function updateText(board: RaidplanBoard, id: string, patch: Partial<RaidplanText>): RaidplanBoard {
    return { ...board, texts: patchIn(board.texts, (x) => x.id === id, patch) };
}

/** Changes what every object shares — opacity, lock, hidden — of any kind. */
export function patchLook(board: RaidplanBoard, kind: ObjectKind, id: string, patch: Partial<RaidplanLook>): RaidplanBoard {
    if (kind === "auto") return patchAutoStyle(board, id, patch);
    if (kind === "token") return { ...board, tokens: patchIn(board.tokens, (o) => o.userId === id, patch) };
    if (kind === "slot") return { ...board, slots: patchIn(board.slots, (o) => o.id === id, patch) };
    if (kind === "mark") return { ...board, marks: patchIn(board.marks, (o) => o.id === id, patch) };
    if (kind === "icon") return { ...board, icons: patchIn(board.icons, (o) => o.id === id, patch) };
    if (kind === "member") return board;
    if (kind === "zone") return { ...board, zones: patchIn(board.zones, (o) => o.id === id, patch) };
    if (kind === "line") return { ...board, lines: patchIn(board.lines, (o) => o.id === id, patch) };
    return { ...board, texts: patchIn(board.texts, (o) => o.id === id, patch) };
}

/** The `lock` / `hidden` / `opacity` of one object, or null when it is gone. */
export function lookOf(board: RaidplanBoard, kind: ObjectKind, id: string): RaidplanLook | null {
    if (kind === "auto") {
        const s = autoStyleOf(board, id);
        return { opacity: s.opacity === undefined ? 1 : s.opacity, lock: !!s.lock, hidden: !!s.hidden, ...(s.ring === false ? { ring: false } : {}), ...(s.showName === false ? { showName: false } : {}) };
    }
    const list = kind === "token" ? board.tokens.filter((o) => o.userId === id)
        : kind === "slot" ? board.slots.filter((o) => o.id === id)
            : kind === "mark" ? board.marks.filter((o) => o.id === id)
                : kind === "icon" ? board.icons.filter((o) => o.id === id)
                    : kind === "member" ? board.slots.filter((o) => o.id === parseMemberId(id).slotId)
                        : kind === "zone" ? board.zones.filter((o) => o.id === id)
                            : kind === "line" ? board.lines.filter((o) => o.id === id)
                                : board.texts.filter((o) => o.id === id);
    return list[0] ? { opacity: list[0].opacity, lock: !!list[0].lock, hidden: !!list[0].hidden, ...(list[0].ring === false ? { ring: false } : {}), ...(list[0].showName === false ? { showName: false } : {}) } : null;
}

/** A locked object cannot be moved or scaled. */
export function isLocked(board: RaidplanBoard, kind: ObjectKind, id: string): boolean {
    const look = lookOf(board, kind, id);
    return !!look && look.lock;
}

/** Deletes a board object. A slot's player is simply not placed any more. */
export function removeObject(board: RaidplanBoard, kind: ObjectKind, id: string): RaidplanBoard {
    // what the tank rows put on the map goes with its row (or with "Automatisch platzieren" off): it cannot be deleted on its own
    if (kind === "auto") return board;
    if (kind === "token") return removeToken(board, id);
    if (kind === "slot") {
        // a role slot belongs to the Besetzung: taking it off the map keeps it (the counts remove it)
        const o = board.slots.find((s) => s.id === id);
        if (o && isRoleKind(o.kind)) return unplaceSlot(board, id);
        return { ...board, slots: board.slots.filter((s) => s.id !== id) };
    }
    if (kind === "mark") return { ...board, marks: board.marks.filter((m) => m.id !== id) };
    if (kind === "icon") return { ...board, icons: board.icons.filter((m) => m.id !== id) };
    if (kind === "member") {
        // "deleting" a raider's own place puts him back into the ring
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        if (!slot) return board;
        const offsets = { ...slot.offsets };
        delete offsets[ref.userId];
        return updateSlot(board, ref.slotId, { offsets });
    }
    if (kind === "line") return { ...board, lines: board.lines.filter((l) => l.id !== id) };
    if (kind === "text") return { ...board, texts: board.texts.filter((x) => x.id !== id) };
    return { ...board, zones: board.zones.filter((z) => z.id !== id) };
}

/** A copy of an object, a little off the original and unlocked, with a new id. A player is unique, so a token is not duplicated; a slot's copy is open. */
export function duplicateObject(board: RaidplanBoard, kind: ObjectKind, id: string): { board: RaidplanBoard; sel: Selection } {
    const nid = newRowId();
    const off = 0.03;
    if (kind === "slot") {
        const o = board.slots.find((s) => s.id === id);
        if (!o) return { board, sel: null };
        const copy = { ...o, id: nid, userId: "", offsets: {}, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off), n: nextSlotNumber(board, o.kind) };
        return { board: { ...board, slots: [...board.slots, copy] }, sel: { kind, id: nid } };
    }
    if (kind === "mark") {
        const o = board.marks.find((m) => m.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, marks: [...board.marks, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    if (kind === "icon") {
        const o = board.icons.find((m) => m.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, icons: [...board.icons, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    if (kind === "zone") {
        const o = board.zones.find((z) => z.id === id);
        if (!o) return { board, sel: null };
        const r = moveRect(o, off, off);
        return { board: { ...board, zones: [...board.zones, { ...o, ...r, id: nid, lock: false }] }, sel: { kind, id: nid } };
    }
    if (kind === "line") {
        const o = board.lines.find((l) => l.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, lines: [...board.lines, { ...o, ...moveLine(o, off, off), id: nid, lock: false }] }, sel: { kind, id: nid } };
    }
    if (kind === "text") {
        const o = board.texts.find((x) => x.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, texts: [...board.texts, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    return { board, sel: null };
}

function moveInList<T>(list: T[], index: number, dir: string): T[] {
    if (index < 0) return list;
    const to = dir === "front" ? list.length - 1 : dir === "back" ? 0 : dir === "up" ? Math.min(list.length - 1, index + 1) : Math.max(0, index - 1);
    if (to === index) return list;
    const out = list.slice();
    const item = out.splice(index, 1)[0];
    out.splice(to, 0, item);
    return out;
}

/** Changes an object's place in its layer: "front" / "back" (all the way) or "up" / "down" (one step). Objects keep the order of their kind (zones behind lines behind marks behind slots behind texts behind tokens). */
export function reorderObject(board: RaidplanBoard, kind: ObjectKind, id: string, dir: string): RaidplanBoard {
    if (kind === "auto") {
        // among the objects of the tank rows: an order number (front = above all of them, back = below)
        const zs = Object.keys(board.autoStyle || {}).map((k) => (board.autoStyle || {})[k].z || 0);
        const z = autoStyleOf(board, id).z || 0;
        const to = dir === "front" ? Math.max(0, ...zs) + 1 : dir === "back" ? Math.min(0, ...zs) - 1 : dir === "up" ? z + 1 : z - 1;
        return patchAutoStyle(board, id, { z: to });
    }
    if (kind === "token") return { ...board, tokens: moveInList(board.tokens, board.tokens.findIndex((o) => o.userId === id), dir) };
    if (kind === "slot") return { ...board, slots: moveInList(board.slots, board.slots.findIndex((o) => o.id === id), dir) };
    if (kind === "mark") return { ...board, marks: moveInList(board.marks, board.marks.findIndex((o) => o.id === id), dir) };
    if (kind === "icon") return { ...board, icons: moveInList(board.icons, board.icons.findIndex((o) => o.id === id), dir) };
    if (kind === "member") return board;
    if (kind === "zone") return { ...board, zones: moveInList(board.zones, board.zones.findIndex((o) => o.id === id), dir) };
    if (kind === "line") return { ...board, lines: moveInList(board.lines, board.lines.findIndex((o) => o.id === id), dir) };
    return { ...board, texts: moveInList(board.texts, board.texts.findIndex((o) => o.id === id), dir) };
}
