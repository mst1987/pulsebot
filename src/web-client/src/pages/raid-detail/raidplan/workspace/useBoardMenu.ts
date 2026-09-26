import type { Dispatch, MouseEvent, SetStateAction } from "react";
import type { RaidplanBoard, RaidplanMobRef, RaidplanPlayer } from "../../../../api";
import type { useT } from "../../../../i18n";
import { mobIconNo, mobIconsOf, mobOfIcon, type AutoPlan } from "../../../../lib/autoPlace";
import { alignSelection, hasItem, reorderSelection, scaleArrowSelection, setLookSelection, setRingSelection, type SelItem } from "../../../../lib/multiSelect";
import {
    applyMenuAction, autoStyleOf, canFace, compassName, contextMenuItems, lookOf, ownBadgeGroup, resetAutoAll, resetAutoPos, scaleArrow, SIZE_STEPS,
    type MenuItem, type ObjectKind, type Selection,
} from "../../../../lib/raidplan";
import type { tankRowActions } from "./tankRows";
import type { BoardPoint, Menu } from "./types";

/**
 * The board's own menu: right click (long press on touch) on an object, on
 * several selected ones (then it acts on all of them) or on empty ground
 * (insert here). Which entries, what they are called and what they do.
 */
export function useBoardMenu({ menu, setMenu, canWrite, isEvent, board, auto, mobs, players, t, toBoard, boardPx, multi, setMulti, setSelected, chooseItems, edit, multiAction, doDuplicate, doDelete, focusProperties, tanks, onBlocked, onInserted }: {
    menu: Menu | null;
    setMenu: Dispatch<SetStateAction<Menu | null>>;
    canWrite: boolean;
    isEvent: boolean;
    board: RaidplanBoard;
    auto: AutoPlan;
    mobs: RaidplanMobRef[];
    players: Map<string, RaidplanPlayer>;
    t: ReturnType<typeof useT>;
    toBoard: (x: number, y: number) => BoardPoint | null;
    boardPx: () => { w: number; h: number };
    multi: SelItem[];
    setMulti: (items: SelItem[]) => void;
    setSelected: (sel: Selection) => void;
    chooseItems: (items: SelItem[]) => void;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    multiAction: (fn: (b: RaidplanBoard, sel: SelItem[]) => RaidplanBoard, merge?: boolean) => void;
    doDuplicate: () => void;
    doDelete: () => void;
    focusProperties: (selector?: string) => void;
    tanks: ReturnType<typeof tankRowActions>;
    /** "Hier einfügen" of a slot kind that is all placed already */
    onBlocked: (kind: string) => void;
    /** something was inserted or duplicated from the menu: show its properties */
    onInserted: () => void;
}) {
    const openMenu = (x: number, y: number, target: Selection | "board") => {
        if (!canWrite) return;
        const p = toBoard(x, y);
        // a right click on one of several selected objects keeps the selection (the menu then acts on all of them)
        if (target !== "board" && target && multi.length > 1 && hasItem(multi, target as SelItem)) { /* keep */ }
        else if (target !== "board" && target) { setMulti([]); setSelected(target); }
        else chooseItems([]);
        setMenu({ x, y, target, at: p ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) } : null });
    };
    const onContext = (e: MouseEvent<HTMLElement>, target: Selection) => openMenu(e.clientX, e.clientY, target || "board");

    const inMulti = (target: Selection | "board") => !!target && target !== "board" && multi.length > 1 && hasItem(multi, target as SelItem);
    const multiMenu = (): MenuItem[] => {
        const it = (id: string, section: string, danger = false): MenuItem => ({ id, section, disabled: false, danger });
        return [
            it("m:duplicate", "main"), it("m:front", "order"), it("m:back", "order"), it("m:lock", "order"), it("m:unlock", "order"), it("m:hide", "order"),
            it("m:alignLeft", "align"), it("m:alignRight", "align"), it("m:alignTop", "align"), it("m:alignBottom", "align"), it("m:alignCenterH", "align"), it("m:alignCenterV", "align"),
            it("m:distH", "align"), it("m:distV", "align"), it("m:ringHide", "order"), it("m:ringShow", "order"), it("m:arrowUp", "size"), it("m:arrowDown", "size"), it("m:delete", "end", true),
        ];
    };
    const menuItems = (): MenuItem[] => {
        if (!menu) return [];
        if (inMulti(menu.target)) return multiMenu();
        if (menu.target === "board") return contextMenuItems("board", { locked: false, hasPlayer: false, isEvent, kind: "" });
        const sel = menu.target;
        if (!sel) return [];
        const it = (id: string, section: string): MenuItem => ({ id, section, disabled: false, danger: false });
        // "Tankt → <mob>" for everything that can tank, "Tankt nicht mehr" when it does
        // one entry per mob; a mob placed twice or more on the map: one per icon ("Tankt -> Flame 2")
        const tankItems = (tanksNow: boolean): MenuItem[] => [...mobs.flatMap((m) => { const icons = mobIconsOf(board, m.id); return icons.length > 1 ? icons.map((ic) => it(`tankt:${m.id}@${ic.id}`, "tank")) : [it(`tankt:${m.id}`, "tank")]; }), ...(tanksNow ? [it("tankt:", "tank")] : [])];
        if (sel.kind === "auto") {
            const k = auto.tanks.find((x) => x.key === sel.id);
            const moved = !!(board.autoPos || {})[sel.id];
            const styled = !!(board.autoStyle || {})[sel.id];
            const locked = !!autoStyleOf(board, sel.id).lock;
            // like any object: order, lock, the size steps; plus its row, and back to its own place / look
            return [it("properties", "main"), ...(k ? [it("auto:row", "main"), ...tankItems(true)] : [it("auto:tank", "main")]),
                it("front", "order"), it("back", "order"), it(locked ? "unlock" : "lock", "order"), ...(locked ? [] : SIZE_STEPS.map((p) => it(`size:${p}`, "size"))),
                ...(!k && !locked ? [it("arrow:up", "size"), it("arrow:down", "size")] : []),
                ...(moved ? [it("auto:reset", "end")] : []), ...(moved || styled ? [it("auto:resetAll", "end")] : [])];
        }
        const look = lookOf(board, sel.kind, sel.id);
        const slot = sel.kind === "slot" ? board.slots.find((s) => s.id === sel.id) : undefined;
        const ic = sel.kind === "icon" ? board.icons.find((s) => s.id === sel.id) : undefined;
        const ref = tanks.refOfObject(board, sel);
        // the facing wedge of a boss / mob / enemy icon: bigger / smaller
        const arrows = ic && canFace(ic.iconKey) && !(look && look.lock) ? [it("arrow:up", "size"), it("arrow:down", "size")] : [];
        const extra = ref ? tankItems(board.assignments.some((a) => (a.type === "tank" || a.type === "trashtank" || a.type === "special") && a.assignees.indexOf(ref) >= 0)) : ic && (ic.mobId || mobOfIcon(auto, ic.id)) ? [it("auto:tank", "tank")] : [];
        return [...contextMenuItems(sel.kind, { locked: !!look && look.lock, hasPlayer: !!slot && !!slot.userId, isEvent, kind: slot ? slot.kind : "", hideMembers: !!slot && slot.hideMembers, split: !!slot && slot.split, ringOff: !!slot && slot.showRing === false, faces: !!ic && canFace(ic.iconKey), inGroup: sel.kind === "token" && ownBadgeGroup(board, players.get(sel.id) || ({ group: 0 } as RaidplanPlayer)) > 0 }), ...arrows, ...extra];
    };
    const menuLabel = (item: MenuItem): string => {
        if (item.id.startsWith("tankt:")) {
            const pick = item.id.slice(6);
            const at = pick.indexOf("@");
            const m = mobs.find((x) => x.id === (at >= 0 ? pick.slice(0, at) : pick));
            const no = at >= 0 ? mobIconNo(board, pick.slice(at + 1)) : 0;
            return m ? t("raidBoard.auto.tanksMob", { mob: no ? `${m.name} ${no}` : m.name }) : t("raidBoard.auto.untank");
        }
        if (item.id.startsWith("auto:")) return t(`raidBoard.auto.menu.${item.id.slice(5)}`);
        if (item.id.startsWith("arrow:")) return t(`raidBoard.arrow.${item.id.slice(6)}`);
        const parts = item.id.split(":");
        if (parts[0] === "size") return t("raidBoard.ctx.sizeTo", { pct: parts[1] });
        if (parts[0] === "face") return t("raidBoard.ctx.face", { dir: t(`raidBoard.compass.${compassName(Number(parts[1]))}`) });
        if (parts[0] === "insert") {
            if (parts[1] === "mark") return t(`raidBoard.mark.${parts[2]}`);
            const what = parts[1] === "slot" ? t(`raidBoard.slot.kind.${parts[2]}`) : parts[1] === "role" ? t(`raidBoard.roleGroup.${parts[2]}`) : parts[1] === "zone" ? t(`raidBoard.zone.${parts[2]}`) : parts[1] === "line" ? t(`raidBoard.line.${parts[2]}`) : parts[1] === "icon" ? t(`raidBoard.icon.${parts[2]}`) : t("raidBoard.tool.text");
            return t("raidBoard.ctx.insertHere", { what });
        }
        return t(`raidBoard.ctx.${item.id.replace(":", "_")}`);
    };
    const pickMenu = (id: string) => {
        if (!menu) return;
        const target = menu.target;
        if (id === "properties") { focusProperties(); return; }
        if (id === "assign") { focusProperties("[data-insp-player]"); return; }
        if (id === "deselect") { chooseItems([]); return; }
        const one = target && target !== "board" ? target : null;
        if (id === "auto:reset" && one) { edit((b) => resetAutoPos(b, one.id)); return; }
        if (id === "auto:resetAll" && one) { edit((b) => resetAutoAll(b, one.id)); return; }
        if (id === "auto:row" && one) { const k = auto.tanks.find((x) => x.key === one.id); if (k) tanks.openRowFromMap(k.rowId); return; }
        if (id === "auto:tank" && one) {
            if (one.kind === "auto") tanks.pickTankFor(one.id, null);
            else { const m = mobOfIcon(auto, one.id); const ic = board.icons.find((x) => x.id === one.id); tanks.pickTankFor(m ? m.key : "", ic && ic.mobId ? mobs.find((x) => x.id === ic.mobId) || null : null, one.id); }
            return;
        }
        if (id.startsWith("tankt:") && one) { tanks.tankAction(one, id.slice(6)); return; }
        if (id.startsWith("arrow:") && one) { const f = id === "arrow:up" ? 1.25 : 0.8; edit((b) => scaleArrow(b, one.kind, one.id, f)); return; }
        if (id.startsWith("m:")) {
            const px = boardPx();
            const act = id.slice(2);
            if (act === "duplicate") doDuplicate();
            else if (act === "delete") doDelete();
            else if (act === "front" || act === "back") multiAction((b, sel) => reorderSelection(b, sel, act));
            else if (act === "lock") multiAction((b, sel) => setLookSelection(b, sel, { lock: true }));
            else if (act === "unlock") multiAction((b, sel) => setLookSelection(b, sel, { lock: false }));
            else if (act === "ringHide") multiAction((b, sel) => setRingSelection(b, sel, false));
            else if (act === "ringShow") multiAction((b, sel) => setRingSelection(b, sel, true));
            else if (act === "arrowUp" || act === "arrowDown") multiAction((b, sel) => scaleArrowSelection(b, sel, act === "arrowUp" ? 1.25 : 0.8));
            else if (act === "hide") { multiAction((b, sel) => setLookSelection(b, sel, { hidden: true })); chooseItems([]); }
            else {
                const modes: Record<string, string> = { alignLeft: "left", alignRight: "right", alignTop: "top", alignBottom: "bottom", alignCenterH: "centerH", alignCenterV: "centerV", distH: "distH", distV: "distV" };
                if (modes[act]) multiAction((b, sel) => alignSelection(b, sel, modes[act], px));
            }
            return;
        }
        const sel = target === "board" ? null : target;
        const r = applyMenuAction(board, id, sel ? sel.kind : "", sel ? sel.id : "", menu.at);
        if (r.blocked) { onBlocked(r.blocked); return; }
        edit(() => r.board);
        setSelected(r.sel);
        if (id.startsWith("insert:") || id === "duplicate") onInserted();
    };
    /** The menu's title: the object's name, or "Board". */
    const menuTitle = (objectName: (kind: ObjectKind, id: string) => string, autoName: (key: string) => string): string => {
        if (!menu || menu.target === "board" || !menu.target) return t("raidBoard.ctx.board");
        return menu.target.kind === "auto" ? autoName(menu.target.id) : objectName(menu.target.kind, menu.target.id) || t(`raidBoard.obj.${menu.target.kind}`);
    };
    return { openMenu, onContext, menuItems, menuLabel, pickMenu, menuTitle };
}
