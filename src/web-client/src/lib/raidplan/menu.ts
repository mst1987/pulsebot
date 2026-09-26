import type { RaidplanBoard, RaidplanSlotKind } from "../../api";
import { t } from "../../i18n";
import { type InsertSpec, type MenuItem, type ObjectKind, RAID_MARKS, type Selection, ZONE_TYPES } from "./model";
import { COMPASS, normAngle } from "./facing";
import { scaleObject, setObjectPercent, SIZE_STEPS } from "./geometry";
import { duplicateObject, insertObject, patchLook, removeObject, reorderObject, updateIcon, updateSlot } from "./objects";
import { assignSlot, removeToken, takeOutOfGroup } from "./players";

export function item(id: string, section: string, disabled: boolean, danger: boolean): MenuItem {
    return { id, section, disabled, danger };
}

/**
 * The entries of the context menu of an object (`target` is its kind) or of the
 * empty board (`"board"`), in order. `id`s are what applyMenuAction() and the page
 * understand; `section` groups them (a separator between sections).
 */
export function contextMenuItems(target: string, opts: { locked: boolean; hasPlayer: boolean; isEvent: boolean; kind: string; hideMembers?: boolean; split?: boolean; ringOff?: boolean; inGroup?: boolean; faces?: boolean }): MenuItem[] {
    if (target === "board") {
        const out: MenuItem[] = [];
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) out.push(item(`insert:slot:${k}`, "slots", false, false));
        for (const m of RAID_MARKS) out.push(item(`insert:mark:${m}`, "marks", false, false));
        for (const z of ZONE_TYPES) out.push(item(`insert:zone:${z}`, "zones", false, false));
        for (const r of ["melee", "ranged"]) out.push(item(`insert:role:${r}`, "zones", false, false));
        out.push(item("insert:icon:enemy", "icons", false, false), item("insert:icon:bosspos", "icons", false, false));
        out.push(item("insert:line:arrow", "shapes", false, false), item("insert:line:line", "shapes", false, false), item("insert:text", "shapes", false, false));
        out.push(item("deselect", "end", false, false));
        return out;
    }
    if (target === "member") return [item("properties", "main", false, false), item("member:out", "main", false, false), item("resetpos", "end", false, false)];
    const out = [item("properties", "main", false, false)];
    if (target !== "token") out.push(item("duplicate", "main", false, false));
    if (target === "icon" && opts.faces) for (const a of COMPASS) out.push(item("face:" + a, "face", false, false));
    out.push(item("front", "order", false, false), item("back", "order", false, false));
    out.push(item(opts.locked ? "unlock" : "lock", "order", false, false));
    if (!opts.locked) for (const p of SIZE_STEPS) out.push(item(`size:${p}`, "size", false, false));
    if (target === "slot" && opts.isEvent && opts.kind !== "group") {
        out.push(item("assign", "player", false, false));
        if (opts.hasPlayer) out.push(item("unassign", "player", false, false));
    }
    if (target === "token") out.push(item("unassign", "player", false, false));
    if (target === "token" && opts.inGroup) out.push(item("token:back", "player", false, false));
    if (target === "slot" && opts.kind === "group") {
        out.push(item(opts.hideMembers ? "members:show" : "members:hide", "group", false, false));
        out.push(item(opts.split ? "split:off" : "split:on", "group", false, false));
        if (opts.split) out.push(item(opts.ringOff ? "ring:show" : "ring:hide", "group", false, false));
    }
    out.push(item("delete", "end", false, true));
    return out;
}

/** What an "insert:…" id means, or null. */
export function parseInsertId(id: string): InsertSpec | null {
    const parts = id.split(":");
    if (parts[0] !== "insert") return null;
    if (parts[1] === "slot") return { type: "slot", kind: parts[2] as RaidplanSlotKind, label: parts[2] === "label" ? t("raidBoard.slot.kind.label") : "" };
    if (parts[1] === "mark") return { type: "mark", mark: parts[2] };
    if (parts[1] === "zone") return { type: "zone", zoneType: parts[2], shape: "rect" };
    if (parts[1] === "role") return { type: "zone", zoneType: "role", shape: "ellipse", role: parts[2] };
    if (parts[1] === "line") return { type: "line", kind: parts[2] };
    if (parts[1] === "icon") return { type: "icon", iconKey: parts[2], label: "" };
    if (parts[1] === "text") return { type: "text", text: t("raidBoard.text.default") };
    return null;
}

/**
 * Carries out the entries that change the board (insert, duplicate, order, lock,
 * take a player out, delete); "properties", "assign" and "deselect" are the page's.
 * `at` is where the menu was opened (an insert lands there). Returns the new board
 * and what should be selected afterwards (null = nothing / keep).
 */
export function applyMenuAction(board: RaidplanBoard, id: string, kind: ObjectKind | "", objId: string, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection; blocked?: string } {
    const spec = parseInsertId(id);
    if (spec) return insertObject(board, spec, at);
    const sel = kind ? { kind, id: objId } : null;
    if (!kind) return { board, sel: null };
    if (id === "duplicate") return duplicateObject(board, kind, objId);
    if (id === "member:out") return { board: takeOutOfGroup(board, objId, at), sel: null };
    if (id === "token:back") return { board: removeToken(board, objId), sel: null };
    if (id.startsWith("size:")) {
        const pct = Number(id.slice(5));
        return { board: kind === "zone" ? scaleObject(board, "zone", objId, pct / 100) : setObjectPercent(board, kind, objId, pct), sel };
    }
    if (id.startsWith("face:")) return { board: updateIcon(board, objId, { rotation: normAngle(Number(id.slice(5))) }), sel };
    if (id === "ring:hide") return { board: updateSlot(board, objId, { showRing: false }), sel };
    if (id === "ring:show") return { board: updateSlot(board, objId, { showRing: true }), sel };
    if (id === "members:hide") return { board: updateSlot(board, objId, { hideMembers: true }), sel };
    if (id === "members:show") return { board: updateSlot(board, objId, { hideMembers: false }), sel };
    if (id === "split:on") return { board: updateSlot(board, objId, { split: true }), sel };
    if (id === "split:off") return { board: updateSlot(board, objId, { split: false }), sel };
    if (id === "resetpos") return { board: removeObject(board, kind, objId), sel };
    if (id === "front" || id === "back") return { board: reorderObject(board, kind, objId, id), sel };
    if (id === "lock") return { board: patchLook(board, kind, objId, { lock: true }), sel };
    if (id === "unlock") return { board: patchLook(board, kind, objId, { lock: false }), sel };
    if (id === "unassign") return { board: kind === "token" ? removeToken(board, objId) : assignSlot(board, objId, ""), sel: kind === "token" ? null : sel };
    if (id === "delete") return { board: removeObject(board, kind, objId), sel: null };
    return { board, sel };
}
