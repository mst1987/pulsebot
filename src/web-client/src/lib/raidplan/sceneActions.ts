// The animation editor's "who does what" (docs/raidplan/animation.md, design B "Aktionen als Sätze"), pure: who on the board can act
// (the actors, for the "Wer?" picker - a group with its raiders, players and places, enemies, marks and areas), what a frame does
// as readable parts ("Gruppe 3 läuft nach links unten", "… bekommt Bloodboil"), and applying one action to several actors at once
// (they keep their arrangement when they walk somewhere together). The stored model stays the scene's changes (raidplanScenes.js):
// an action is a part of an actor's change in a frame.
import type { RaidplanBoard, RaidplanChange, RaidplanLoop, RaidplanPlayer, RaidplanScene } from "../../api";
import { t } from "../../i18n";
import type { AutoPlan } from "./autoPlace";
import { groupColor } from "./groupStyle";
import { objectName, slotTitle } from "./labels";
import { groupRaiders } from "./members";
import { addLoop, changeOf, moveIn, newLoopId, patchChange } from "./sceneEdit";

type Pt = { x: number; y: number };
export type ActorSection = "groups" | "players" | "enemies" | "marks";
/** Someone or something on the board an action can be given to; `ref` = the scene's reference ("slot:…", "member:…", …). */
export type Actor = {
    ref: string;
    section: ActorSection;
    label: string;
    sub: string;
    color: string;
    ini: string;
    /** a group's raiders, each an actor of his own (only for a group that shows its raiders around it) */
    raiders: Actor[];
    /** it can fade out / in, turn (a raider of a group can only move and carry a badge or a pulse) */
    canFade: boolean;
    canTurn: boolean;
};
export type ActorBoard = RaidplanBoard & { autoUsers?: string[] };

const ROLE_COLORS: Record<string, string> = { tank: "#60a5fa", healer: "#35d6c4", melee: "#f97316", ranged: "#a78bfa", dps: "#f5c542" };
const ini = (s: string) => (s.trim()[0] || "?").toUpperCase();

/** The name of an icon: its label, the mob it stands for (the section's mobs or a row that names it), else its kind. */
function iconLabel(board: RaidplanBoard, id: string, players: Map<string, RaidplanPlayer>): string {
    const icon = board.icons.find((x) => x.id === id);
    if (icon && !icon.label && icon.mobId) {
        const mob = (board.mobs || []).find((m) => m.id === icon.mobId);
        if (mob) return mob.name;
        const target = board.assignments.flatMap((r) => r.targets).find((tg) => tg.kind === "mob" && tg.ref === icon.mobId) as { name?: string } | undefined;
        if (target && target.name) return target.name;
    }
    return objectName(board, "icon", id, players);
}

/**
 * Everyone and everything on the board an action can be given to, in the order the picker shows them: the groups (with their raiders
 * when they stand around the marker), the players and places (free tokens, role slots on the map, the tanks the rows put there), the
 * enemies (icons, the rows' mobs) and the marks and areas.
 */
export function sceneActors(board: ActorBoard, roster: RaidplanPlayer[], players: Map<string, RaidplanPlayer>, auto: AutoPlan | null): Actor[] {
    const out: Actor[] = [];
    const shown = <T extends { hidden?: boolean; placed?: boolean }>(o: T) => !o.hidden && o.placed !== false;
    const raiderBoard = { ...board, autoUsers: board.autoUsers || (auto ? auto.users : []) };
    for (const s of board.slots.filter((x) => x.kind === "group" && shown(x))) {
        const raiders = groupRaiders(raiderBoard, s.id, roster).map((p): Actor => ({
            ref: `member:${s.id}~${p.userId}`, section: "groups", label: p.character, sub: t("raidBoard.anim.ofGroup", { n: s.n }),
            color: p.classColor || "#9aa0aa", ini: ini(p.character), raiders: [], canFade: false, canTurn: false,
        }));
        const names = (raiders.length ? raiders.map((r) => r.label) : roster.filter((p) => p.group === s.n).map((p) => p.character)).join(", ");
        out.push({ ref: `slot:${s.id}`, section: "groups", label: s.label || t("raidBoard.anim.groupN", { n: s.n }), sub: names, color: groupColor(board.groupColors, s.n), ini: String(s.n), raiders, canFade: true, canTurn: false });
    }
    for (const tok of board.tokens.filter(shown)) {
        const p = players.get(tok.userId);
        if (!p) continue;
        out.push({ ref: `token:${tok.userId}`, section: "players", label: p.character, sub: [p.specLabel, p.className].filter(Boolean).join(" "), color: p.classColor || "#9aa0aa", ini: ini(p.character), raiders: [], canFade: true, canTurn: false });
    }
    for (const s of board.slots.filter((x) => x.kind !== "group" && x.kind !== "label" && shown(x))) {
        const p = s.userId ? players.get(s.userId) : undefined;
        out.push({ ref: `slot:${s.id}`, section: "players", label: p ? p.character : slotTitle(s), sub: p ? slotTitle(s) : t("raidBoard.anim.openPlace"), color: p && p.classColor ? p.classColor : ROLE_COLORS[s.kind] || "#9aa0aa", ini: p ? ini(p.character) : ini(slotTitle(s)), raiders: [], canFade: true, canTurn: false });
    }
    for (const k of auto ? auto.tanks.filter((x) => !x.existing && !x.style.hidden) : []) {
        const p = k.userId ? players.get(k.userId) : undefined;
        out.push({ ref: `auto:${k.key}`, section: "players", label: p ? p.character : t("raidBoard.anim.autoTank"), sub: t("raidBoard.anim.autoTankSub"), color: p && p.classColor ? p.classColor : ROLE_COLORS.tank, ini: p ? ini(p.character) : "T", raiders: [], canFade: true, canTurn: true });
    }
    for (const i of board.icons.filter(shown)) {
        const label = iconLabel(board, i.id, players);
        out.push({ ref: `icon:${i.id}`, section: "enemies", label, sub: t(`raidBoard.anim.iconKind.${i.iconKey.startsWith("wow:") ? "spell" : "enemy"}`), color: "#a78bfa", ini: ini(label), raiders: [], canFade: true, canTurn: true });
    }
    for (const m of auto ? auto.mobs.filter((x) => !x.iconId && !x.style.hidden) : []) {
        out.push({ ref: `auto:${m.key}`, section: "enemies", label: m.name, sub: t("raidBoard.anim.autoMob"), color: "#a78bfa", ini: ini(m.name), raiders: [], canFade: true, canTurn: true });
    }
    for (const m of board.marks.filter(shown)) out.push({ ref: `mark:${m.id}`, section: "marks", label: objectName(board, "mark", m.id, players), sub: t("raidBoard.anim.kindMark"), color: "#f8fafc", ini: "✦", raiders: [], canFade: true, canTurn: false });
    for (const z of board.zones.filter(shown)) out.push({ ref: `zone:${z.id}`, section: "marks", label: objectName(board, "zone", z.id, players), sub: t("raidBoard.anim.kindZone"), color: z.color || "#60a5fa", ini: "▢", raiders: [], canFade: true, canTurn: true });
    for (const x of board.texts.filter(shown)) out.push({ ref: `text:${x.id}`, section: "marks", label: x.text, sub: t("raidBoard.anim.kindText"), color: "#f8fafc", ini: "T", raiders: [], canFade: true, canTurn: false });
    for (const l of board.lines.filter(shown)) out.push({ ref: `line:${l.id}`, section: "marks", label: objectName(board, "line", l.id, players), sub: t("raidBoard.anim.kindLine"), color: l.color || "#f8fafc", ini: "↗", raiders: [], canFade: true, canTurn: false });
    return out;
}

/** Every actor by its reference, the raiders of the groups included. */
export function actorIndex(actors: Actor[]): Map<string, Actor> {
    const m = new Map<string, Actor>();
    for (const a of actors) { m.set(a.ref, a); for (const r of a.raiders) m.set(r.ref, r); }
    return m;
}

/** What the picked actors are, in a line and the names behind it: "Gruppe 3 · 5 Spieler" / "Heilbert" / "2 Gruppen · 10 Spieler". */
export function selectionSummary(sel: string[], index: Map<string, Actor>): { title: string; names: string[] } {
    const picked = sel.map((r) => index.get(r)).filter((a): a is Actor => !!a);
    if (picked.length === 0) return { title: "", names: [] };
    const people = picked.flatMap((a) => (a.raiders.length ? a.raiders.map((r) => r.label) : [a.label]));
    if (picked.length === 1) {
        const a = picked[0];
        if (a.raiders.length) return { title: t("raidBoard.anim.sumGroup", { label: a.label, n: a.raiders.length }), names: a.raiders.map((r) => r.label) };
        return { title: a.label, names: a.sub ? [a.sub] : [] };
    }
    const groups = picked.filter((a) => a.raiders.length).length;
    if (groups === picked.length) return { title: t("raidBoard.anim.sumGroups", { g: groups, n: people.length }), names: people };
    return { title: t("raidBoard.anim.sumMany", { n: picked.length }), names: people };
}

export type Dir = "up" | "upRight" | "right" | "downRight" | "down" | "downLeft" | "left" | "upLeft" | "";
const DIRS: Dir[] = ["right", "downRight", "down", "downLeft", "left", "upLeft", "up", "upRight"];
/** The way a movement goes in a word (the board is wider than high, so a vertical step counts a bit less); "" for a tiny one. */
export function direction(from: Pt, to: Pt): Dir {
    const dx = to.x - from.x;
    const dy = (to.y - from.y) * 0.625;
    if (Math.hypot(dx, dy) < 0.01) return "";
    const a = Math.atan2(dy, dx);
    return DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

export type PartKind = "move" | "badge" | "pulse" | "hidden" | "rotation" | "opacity" | "scale";
/** One readable part of what a frame does: an actor, what (move / badge / …) and its value, and the change it is part of. */
export type ActionPart = { obj: string; part: PartKind; dir: Dir; points: number; value: string | number | boolean | undefined; change: RaidplanChange };

/** What frame k does, part by part in the order of its changes; `fromOf` = where an actor stood before the frame (for the way it goes). */
export function frameParts(scene: RaidplanScene, k: number, fromOf: (ref: string) => Pt | null): ActionPart[] {
    const f = scene.frames[k];
    if (!f) return [];
    const out: ActionPart[] = [];
    for (const c of f.changes) {
        const base = { obj: c.obj, change: c, dir: "" as Dir, points: 0, value: undefined };
        if (c.x !== undefined && c.y !== undefined) {
            const from = fromOf(c.obj);
            out.push({ ...base, part: "move", dir: from ? direction(from, { x: c.x, y: c.y }) : "", points: (c.path || []).length });
        }
        if (c.badge !== undefined) out.push({ ...base, part: "badge", value: c.badge });
        if (c.pulse !== undefined) out.push({ ...base, part: "pulse", value: c.pulse });
        if (c.hidden !== undefined) out.push({ ...base, part: "hidden", value: c.hidden });
        if (c.rotation !== undefined) out.push({ ...base, part: "rotation", value: c.rotation });
        if (c.opacity !== undefined) out.push({ ...base, part: "opacity", value: c.opacity });
        if (c.scale !== undefined) out.push({ ...base, part: "scale", value: c.scale });
    }
    return out;
}

/** The fields a part of a change stands for (taking the part off takes these off). */
const PART_FIELDS: Record<PartKind, (keyof RaidplanChange)[]> = { move: ["x", "y", "path"], badge: ["badge"], pulse: ["pulse"], hidden: ["hidden"], rotation: ["rotation"], opacity: ["opacity"], scale: ["scale"] };
/** The scene without one part of an actor's change in frame k (a change left with nothing goes). */
export function removePart(scene: RaidplanScene, k: number, obj: string, part: PartKind): RaidplanScene {
    const patch: Partial<RaidplanChange> = {};
    for (const f of PART_FIELDS[part]) (patch as Record<string, undefined>)[f] = undefined;
    return patchChange(scene, k, obj, patch);
}

/** The loops that start during frame k (from its start to the next frame's), so the frame lists them as its actions. */
export function loopsInFrame(scene: RaidplanScene, k: number): RaidplanLoop[] {
    const f = scene.frames[k];
    if (!f) return [];
    const next = scene.frames[k + 1];
    const end = next ? next.at : Number.POSITIVE_INFINITY;
    return (scene.loops || []).filter((l) => l.from >= f.at && l.from < end);
}

/** The middle of some points. */
export function centroid(pts: Pt[]): Pt {
    if (pts.length === 0) return { x: 0.5, y: 0.5 };
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
}

/** The actors walk in frame k so that their middle ends at `target` (each keeps his place in the arrangement); actors without a place are left out. */
export function moveAllTo(scene: RaidplanScene, k: number, refs: string[], posOf: (ref: string) => Pt | null, target: Pt): RaidplanScene {
    const known = refs.map((r) => ({ r, p: posOf(r) })).filter((x): x is { r: string; p: Pt } => !!x.p);
    const mid = centroid(known.map((x) => x.p));
    return known.reduce((s, x) => moveIn(s, k, x.r, x.p.x + target.x - mid.x, x.p.y + target.y - mid.y), scene);
}

/** The same fields on every actor's change in frame k (a badge for a whole group, a pulse for three players …). */
export function patchAll(scene: RaidplanScene, k: number, refs: string[], patch: Partial<Omit<RaidplanChange, "obj">>): RaidplanScene {
    return refs.reduce((s, r) => patchChange(s, k, r, patch), scene);
}

/**
 * A loop for every actor along the clicked way: one actor starts it where he stands; several keep their arrangement - the way is
 * laid through their middle, each walks it shifted by his place. It runs from `from` seconds on. Returns the scene and the new ids.
 */
export function loopAll(scene: RaidplanScene, refs: string[], posOf: (ref: string) => Pt | null, way: Pt[], from: number): { scene: RaidplanScene; ids: string[] } {
    const known = refs.map((r) => ({ r, p: posOf(r) })).filter((x): x is { r: string; p: Pt } => !!x.p);
    const mid = centroid(known.map((x) => x.p));
    let s = scene;
    const ids: string[] = [];
    for (const { r, p } of known) {
        const id = newLoopId();
        const dx = p.x - mid.x;
        const dy = p.y - mid.y;
        const added = addLoop(s, r, p, from, id);
        if (!added.id) break;
        const loops = added.scene.loops.map((l) => (l.id === id ? { ...l, path: [...l.path, ...way.map((w) => [Math.max(0, Math.min(1, w.x + dx)), Math.max(0, Math.min(1, w.y + dy))] as [number, number])] } : l));
        s = { ...added.scene, loops };
        ids.push(id);
    }
    return { scene: s, ids };
}

/** Whether an actor already does something in frame k (the picker marks it). */
export function actsIn(scene: RaidplanScene, k: number, ref: string): boolean {
    return !!changeOf(scene, k, ref) || loopsInFrame(scene, k).some((l) => l.obj === ref);
}
