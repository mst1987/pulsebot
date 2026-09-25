import { REF_W, boardScale, canvasStyle } from "../../lib/boardScale";
import { HIDE_SCREEN_FONT, ICON_NAME_FACTOR, NAME_FACTOR, effectMetrics, labelMetrics } from "../../lib/labelScale";
import { FIT, type BoardView } from "../../lib/boardView";
import { ringShownFor, selectionDrawn } from "../../lib/viewRules";
import { groupColor, groupMark, inkOn } from "../../lib/groupStyle";
import { groupScales, rhNote } from "../../lib/raidplan";
import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type RefObject } from "react";
import { AlertTriangle, Crosshair, Swords, Users } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanMark, RaidplanPlayer, RaidplanSlot, RaidplanText, RaidplanToken, RaidplanZone } from "../../api";
import { classColorProps } from "../ClassSpec";
import Mentions from "./Mentions";
import WowIcon from "../ui/WowIcon";
import { MarkIcon } from "./MarkIcon";
import { wowIconUrl } from "../../lib/wowIcon";
import { SIZE_RANGES, canFace, groupListMembers, ownBadgeGroup, groupChipMode, groupTag, ringShown, GROUP_PLACEHOLDERS, ringCover, iconBoardLabel, iconKeyType, memberId, portraitUrl, ringNameWidth, ringOffsets, ringUnit, roleZoneMetrics, chipWidthOf, turnedBox, uprightInner, roleNamesLayout, roleTone, slotBoardLabel, slotTitle, splitMembers, textShown, zoneBoardLabel, type Corner, type ObjectKind, type Selection } from "../../lib/raidplan";
import { useT } from "../../i18n";
import { classPlaceNameFor, classRefIcon, facingOf, offRole, type AssignLink } from "../../lib/assign";
import { ANY } from "../../lib/classRefs";
import { autoFacing, mobIconNo, type AutoPlan, type AutoTank } from "../../lib/autoPlace";
import "../../styles/raidplan.css";

// The role icons the raid detail already uses for its role groups (meta.ts's ROLE_META).
const ROLE_ICONS: Record<string, string> = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_dualwield",
    ranged: "inv_weapon_bow_07",
    dps: "inv_misc_questionmark",
};

/** The type of a zone as a glyph, so it reads without its colour (danger, healthy, neutral, own). */
const PLACEHOLDER_ROLES = ["tank", "healer", "dps", "dps", "dps"];
export const ZONE_GLYPHS: Record<string, string> = { danger: "⚠", healthy: "✚", neutral: "○", custom: "◆" };

/**
 * A player's spec icon in a role-coloured ring (tank blue, healer cyan, damage
 * orange) on a tile tinted in the class colour — the game's own icon, never a
 * hand-drawn circle with letters. Used on the board, in the list of players not
 * placed yet and on the target rows.
 */
export function TokenIcon({ player, size = "md" }: { player: RaidplanPlayer; size?: "sm" | "md" }) {
    const style = (player.classColor ? { "--cc": player.classColor } : undefined) as CSSProperties | undefined;
    return (
        <span className={`rp-ico rp-ico-${size} rp-role-${roleTone(player.role)}`} style={style} aria-hidden="true">
            {player.iconUrl ? <img src={player.iconUrl} alt="" draggable={false} /> : <span className="rp-ico-ph" />}
        </span>
    );
}

/**
 * The player's name in the class colour. A Raid-Helper raider whose name no raider profile explains (a nickname, maybe) is set in
 * italics, one Raid-Helper no longer lists is dimmed ("nicht mehr im Setup", docs/raidplan.md).
 */
export function PlayerName({ player, className = "" }: { player: RaidplanPlayer; className?: string }) {
    const colored = classColorProps(player.classColor);
    const marks = [player.nameFromRh ? "rp-pname-rh" : "", player.gone ? "rp-pname-gone" : ""];
    return <span className={[colored.className, className, ...marks].filter(Boolean).join(" ")} style={colored.style}>{player.character || "?"}</span>;
}

/** One line of text describing a player for tooltips and screen readers: "Tanky, Protection Warrior" (+ what Raid-Helper calls him). */
export function playerLabel(player: RaidplanPlayer): string {
    const base = [player.character, [player.specLabel, player.className].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const note = rhNote(player);
    return note ? `${base} · ${note}` : base;
}

/** What a drag can grab on an object: a zone's corner, or one end of a line. */
export type Handle = Corner | "n" | "s" | "e" | "w" | "end1" | "end2" | "size" | "rot";
/** How the board reports a pointer or key event on one of its objects. */
export type ObjectDown = (e: PointerEvent<HTMLElement | SVGElement>, kind: ObjectKind, id: string, handle?: Handle) => void;
export type ObjectKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => void;

type BoardProps = {
    boardRef?: RefObject<HTMLDivElement>;
    bossName: string;
    bossIcon: string;
    mapUrl: string;
    /** how strongly the map shows, 0.1..1 */
    mapOpacity?: number;
    tokens: RaidplanToken[];
    slots?: RaidplanSlot[];
    marks?: RaidplanMark[];
    icons?: RaidplanIcon[];
    /** the default size of tokens, slots, marks and icons (1 = as they are) */
    objectScale?: number;
    zones?: RaidplanZone[];
    lines?: RaidplanLine[];
    texts?: RaidplanText[];
    players: Map<string, RaidplanPlayer>;
    /** Everyone of the setup, for what a group marker names. */
    roster?: RaidplanPlayer[];
    /** The viewer's own userId: that token or slot is highlighted. */
    me?: string | string[];
    selected?: Selection;
    /** The object being dragged right now ("kind:id"). */
    dragKey?: string;
    onObjectDown?: ObjectDown;
    onObjectKey?: ObjectKey;
    onObjectOpen?: (kind: ObjectKind, id: string) => void;
    /** Right click on an object (target) or on the empty board (null). */
    onContext?: (e: MouseEvent<HTMLElement>, target: Selection) => void;
    /** Thin connection lines (who heals whom), in board fractions. */
    links?: AssignLink[];
    /** The section's assignments: an icon that follows its tank needs the tank rows (none = nothing turns by itself). */
    assignments?: RaidplanAssignment[];
    /** The rings round split groups: all shown (default) or all hidden. */
    showRings?: boolean;
    /** zoom and pan (a view setting; default = fit) and the frame element, for the code that zooms and pans it */
    view?: BoardView;
    frameRef?: MutableRefObject<HTMLDivElement | null> | ((el: HTMLDivElement | null) => void);
    /** what the board shows besides the icons: the names, the group number badges, the role rings (all default on) */
    showNames?: boolean;
    showBadges?: boolean;
    showRoleRings?: boolean;
    /** the highlight of the viewer's own character (default on) and the frame + grips of the selection (editor, default on) */
    highlightMe?: boolean;
    showSelection?: boolean;
    /** the colour / raid mark of the groups (by group number) and the group the others dim for */
    groupColors?: Record<string, string>;
    groupMarks?: Record<string, string>;
    focusGroup?: number;
    /** The other selected objects when several are selected (`selected` is then null). */
    multi?: { kind: ObjectKind; id: string }[];
    /** The frame round the whole multi selection and the rubber band, in board fractions. */
    multiBox?: { x0: number; y0: number; x1: number; y1: number } | null;
    band?: { x0: number; y0: number; x1: number; y1: number } | null;
    /** Pointer down on a corner grip of the shared frame: the workspace scales the whole selection. */
    onMultiScale?: (e: PointerEvent<HTMLElement>, corner: string) => void;
    /** Pointer down on an edge of the frame: the workspace drags the whole selection. */
    onMultiMove?: (e: PointerEvent<HTMLElement>) => void;
    /** The map's height in px (the board is as wide as its aspect ratio makes it); without it: what fits the window. */
    maxHeight?: number;
    /** Shown on the grid when there is no map. */
    emptyText?: string;
    /** what the tank rows put on the map (lib/autoPlace.ts): the mobs and tanks nobody placed by hand */
    auto?: AutoPlan;
};

/** The pixel size of an element, kept up to date (the lines are drawn in pixels so an arrow head never stretches). */
function useElementSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
        if (!el) return undefined;
        const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, size];
}

/** The head of an arrow at (x2, y2), for a line of a width, as an SVG polygon `points` string. */
function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): string {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.max(12, width * 4);
    const half = Math.max(6, width * 2);
    const bx = x2 - Math.cos(angle) * len;
    const by = y2 - Math.sin(angle) * len;
    const px = -Math.sin(angle) * half;
    const py = Math.cos(angle) * half;
    return `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

/**
 * The board of one boss: the room map (or a neutral grid with the boss icon) and
 * on it, back to front, the zones, the lines and arrows, the raid marks, the slots,
 * the texts and the player tokens at their relative positions. Presentational and
 * shared by the event editor, the template editor and the read view — the editors
 * own the drag (Pointer Events, no HTML5 drag and drop, so it works with a finger
 * too) and pass the handlers; the read view passes none.
 *
 * The board takes the aspect of its map (a nearly square room fills a nearly
 * square board; without a map it is 16:10), so any map fits as a whole.
 */
export default function PlanBoard({
    boardRef, bossName, bossIcon, mapUrl, mapOpacity = 1, tokens, slots = [], marks = [], icons = [], objectScale = 1, zones = [], lines = [], texts = [], players, roster = [],
    me = "", assignments, maxHeight, showRings = true, view = FIT, frameRef, showNames = true, showBadges = true, showRoleRings = true, highlightMe = true, showSelection = true, groupColors, groupMarks, focusGroup = 0, multi = [], multiBox = null, band = null, onMultiScale, onMultiMove, selected = null, dragKey = "", onObjectDown, onObjectKey, onObjectOpen, onContext, links, emptyText, auto,
}: BoardProps) {
    const t = useT();
    const [aspect, setAspect] = useState(0);
    const [setEl, outer] = useElementSize();
    const attach = useCallback((el: HTMLDivElement | null) => {
        setEl(el);
        if (typeof frameRef === "function") frameRef(el);
        else if (frameRef) frameRef.current = el;
    }, [frameRef, setEl]);
    // the canvas is what the code that drags things measures: its rectangle is the picture as it is shown, at any zoom and pan
    const attachCanvas = useCallback((el: HTMLDivElement | null) => {
        if (boardRef) (boardRef as MutableRefObject<HTMLDivElement | null>).current = el;
    }, [boardRef]);
    useEffect(() => { setAspect(0); }, [mapUrl]);

    const mineIds = !highlightMe ? [] : Array.isArray(me) ? me : me ? [me] : [];
    const isMe = (id: string) => mineIds.indexOf(id) >= 0;
    const editable = !!onObjectDown;
    /** the names of the visitor's own characters (a text on the map that names them is marked) */
    const mineNames = mineIds.map((id) => (players.get(id) || { character: "" }).character).filter((n) => n.length > 1);
    const isSel = (kind: ObjectKind, id: string) => !!selected && selected.kind === kind && selected.id === id;
    const picked = (kind: ObjectKind, id: string) => multi.some((m) => m.kind === kind && m.id === id);
    const cls = (base: string, kind: ObjectKind, id: string, extra = "", locked = false) => [base, editable ? "is-editable" : "", selectionDrawn(editable, isSel(kind, id) || picked(kind, id), showSelection) ? "is-selected" : "", picked(kind, id) ? "is-multi" : "", dragKey === `${kind}:${id}` ? "is-drag" : "", locked ? "is-locked" : "", extra].filter(Boolean).join(" ");
    const handlers = (kind: ObjectKind, id: string) => (editable ? {
        onPointerDown: (e: PointerEvent<HTMLElement>) => onObjectDown!(e, kind, id),
        onKeyDown: onObjectKey ? (e: KeyboardEvent<HTMLElement>) => onObjectKey(e, kind, id) : undefined,
        onDoubleClick: onObjectOpen ? () => onObjectOpen(kind, id) : undefined,
    } : {});
    const ar = aspect || 16 / 10;
    // ONE coordinate space for everything on the board: the content is laid out at a fixed reference width and the whole canvas is scaled to the
    // board's real width, so editor, template preview and read view look the same at any size (see lib/boardScale.ts)
    const size = outer.w > 0 ? { w: REF_W, h: REF_W / ar } : { w: 0, h: 0 };
    const canvas = canvasStyle(outer.w, outer.h, ar, view.z, view.ox, view.oy) as CSSProperties;
    const style = { aspectRatio: String(ar), maxWidth: maxHeight ? `${Math.round(maxHeight * ar)}px` : `calc((100vh - 420px) * ${ar})` } as CSSProperties;
    const px = (v: number, of: number) => v * of;
    /** The size of a token-like object on screen, in px. */
    const scaled = (size: number | undefined, def: number) => Math.round((size || def) * objectScale);
    // the name label follows the icon (lib/labelScale.ts): its font is set here in reference units, and it is hidden when legibility would blow it up
    const screenScale = boardScale(outer.w) * view.z;
    const factorOf = (def: number) => (def === SIZE_RANGES.icon.def ? ICON_NAME_FACTOR : NAME_FACTOR);
    const labelOf = (px: number, def: number) => labelMetrics(px, factorOf(def), screenScale);
    /** the effects round an icon (me ring and glow, selection glow, shadow, outline) as reference-unit variables: shares of the icon's size, like the label */
    const effectVars = (px: number) => { const e = effectMetrics(px); return { "--rp-ring": `${e.ring}px`, "--rp-glow": `${e.glow}px`, "--rp-gsp": `${e.spread}px`, "--rp-sel": `${e.select}px`, "--rp-shd": `${e.shadow}px`, "--rp-out": `${e.outline}px` }; };
    const sizeStyle = (size: number | undefined, def: number) => ({ "--rp-s": `${scaled(size, def)}px`, "--rp-nf": `${labelOf(scaled(size, def), def).font}px`, ...effectVars(scaled(size, def)) }) as CSSProperties;
    /** " is-noname" when the object's name is off or would not fit its icon */
    const noName = (size: number | undefined, def: number, mult: number, show: boolean | undefined) => (show === false || !labelOf(scaled(size, def) * mult, def).show ? " is-noname" : "");
    /** The grip that scales a selected object (drag it away from / towards the object). */
    const sizeHandle = (kind: ObjectKind, id: string, locked: boolean) => (editable && !locked && isSel(kind, id) ? (
        <span className="rp-handle rp-h-size" data-handle="size" onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, kind, id, "size"); }} />
    ) : null);
    // a raider the tank rows put on the map stands there on his own: his group ring closes up
    const boardOwn = { tokens, slots, assignments: assignments || [], autoUsers: auto ? auto.users : [] } as unknown as RaidplanBoard;
    // where the raiders of split group markers stand (the ring the board draws), so an icon that faces "its tank" also finds a tank who is in a ring
    const places: Record<string, { x: number; y: number }> = {};
    if (size.w > 0) {
        for (const s of slots) {
            if (s.kind !== "group" || s.hidden || s.placed === false || !s.split || s.hideMembers) continue;
            const members = splitMembers(boardOwn, s, roster);
            const { gs, sp } = groupScales(s);
            const { ts } = groupScales(s);
            const base = scaled(s.size, SIZE_RANGES.member.def) * gs;
            const ring = ringOffsets(members.length, size.w, size.h, ringUnit(base * sp, base * ts));
            members.forEach((p, i) => {
                const off = s.offsets ? s.offsets[p.userId] : undefined;
                const d = off ? { dx: off.dx * gs * sp, dy: off.dy * gs * sp } : ring[i] || { dx: 0, dy: 0 };
                places[p.userId] = { x: s.x + d.dx, y: s.y + d.dy };
            });
        }
    }
    const boardLike = { tokens, slots, icons, assignments: assignments || [], places } as unknown as RaidplanBoard;
    /** An icon's facing: the tank rows' tank of its mob when they know it (auto placement), else the older rule (lib/assign.ts facingOf). */
    const faceOf = (i: { id: string; x: number; y: number; rotation: number; autoFace?: boolean; mobId?: string; iconKey?: string }) => {
        if (auto && i.autoFace !== false) {
            const a = autoFacing(auto, i.id, i, boardLike, places, ar);
            if (a >= 0) return a;
            if (a === -2) return i.rotation || 0;
        }
        return facingOf(boardLike, i, ar);
    };
    /** What a tank of the rows is called: the class place ("Tank (Paladin)", "Magier-Tank", "Tank") or the slot. */
    const ruleName = (k: AutoTank) => (k.classId ? (k.classId === ANY ? t(`raidBoard.class.roles.${k.role || "tank"}`) : classPlaceNameFor(k.classId, k.role, k.type)) : k.slotKind ? t(`raidBoard.slot.${k.slotKind}`, { n: k.slotN }) : "");
    /** The facing wedge of an icon: its own size factor (--rp-ar), hidden, colour and opacity ("Pfeilgröße", "Pfeil ausblenden"). */
    const arrowVars = (o: { arrowScale?: number }) => ({ "--rp-ar": String(o.arrowScale || 1) }) as CSSProperties;
    const wedge = (o: { arrowHidden?: boolean; arrowColor?: string; arrowOpacity?: number }) => (o.arrowHidden ? null : (
        <svg className="rp-wedge" viewBox="0 0 22 20" aria-hidden="true" style={o.arrowOpacity !== undefined ? { opacity: o.arrowOpacity } : undefined}><path d="M11 1.5 L20.5 18.5 L1.5 18.5 Z" fill={o.arrowColor || "#ffb020"} stroke="#1c1305" strokeWidth="2.4" strokeLinejoin="round" /></svg>
    ));
    /**
     * A role group placeholder ("Melees", "Ranged" ...): the role's icon (a cluster of them for the shape "Symbole"), the label only when one
     * was written, the count badge when set; with "Namen anzeigen" the setup's players of that role (spec role) below it - never needed, so the
     * sheet shows it without anybody known.
     */
    const roleBody = (z: RaidplanZone) => {
        const role = z.role || "melee";
        const cluster = z.shape === "cluster";
        const n = cluster ? Math.max(3, Math.min(8, z.count || 5)) : 1;
        const zw = z.w * size.w;
        const zh = z.h * size.h;
        const deg = z.rotation || 0;
        // the content stands upright over the (turned) outline: the upright box of the turned zone, the area inside it for the content
        const box = turnedBox(zw, zh, deg, z.shape);
        const inner = uprightInner(zw, zh, deg, z.shape);
        const iconScale = z.iconScale && z.iconScale > 0 ? z.iconScale : 1;
        // everything of the placeholder is a share of the zone (lib/raidplan.ts): it scales as one piece, never distorted
        const m = roleZoneMetrics(inner.w, inner.h, cluster, z.count || 0);
        const members = z.showNames ? roster.filter((p) => (role === "dps" ? p.role !== "tank" && p.role !== "healer" : p.role === role)) : [];
        // the names INSIDE the zone, packed in lines; what does not fit is one "+N" chip (all names in its tooltip); too small on screen = not shown
        const lay = members.length > 0 ? roleNamesLayout(inner.w, inner.h, members.map((p) => p.character), iconScale) : null;
        const namesShown = !!lay && lay.shown > 0 && !(screenScale > 0 && lay.font * screenScale < HIDE_SCREEN_FONT);
        const icon = namesShown && lay ? lay.icon : Math.min(m.icon * iconScale, Math.min(inner.w, inner.h) * 0.95);
        const label = zoneBoardLabel(z);
        const pos = z.labelPos || "in";
        const rest = lay && namesShown ? members.slice(lay.shown) : [];
        // the names do not fit at all (a thin strip turned diagonally): one chip with their number, the names in its tooltip - never silently gone
        const noRoom = !!lay && lay.shown === 0 && !(screenScale > 0 && lay.font * screenScale < HIDE_SCREEN_FONT);
        const style = {
            left: `${(z.x + z.w / 2) * 100}%`, top: `${(z.y + z.h / 2) * 100}%`, width: `${(box.w / (size.w || 1)) * 100}%`, height: `${(box.h / (size.h || 1)) * 100}%`,
            "--zc": z.color, "--rp-iw": `${Math.round(inner.w)}px`, "--rp-ih": `${Math.round(inner.h)}px`, "--rp-rg": `${Math.round(cluster ? m.icon * iconScale : icon)}px`,
            "--rp-zl": `${m.label}px`, "--rp-zk": `${m.badge}px`, "--rp-zn": `${lay ? lay.font : m.names}px`,
        } as CSSProperties;
        return (
            <div key={`up-${z.id}`} className="rp-rg-up" style={style} aria-hidden="true">
                <div className="rp-rg-inner">
                    <span className="rp-rg-head">
                        {Array.from({ length: n }, (_, k) => <span key={k} className="rp-rg-ico"><WowIcon name={ROLE_ICONS[role] || ROLE_ICONS.dps} size={Math.max(8, Math.round((cluster ? m.icon * iconScale : icon) * 0.72))} /></span>)}
                        {(z.count || 0) > 0 && <span className="rp-rg-count">{z.count}</span>}
                    </span>
                    {label && pos === "in" && <span className="rp-rg-label">{label}</span>}
                    {noRoom && <span className="rp-rg-names"><span className="rp-rg-more" data-tip={members.map((p) => p.character).join(", ")}>{members.length}</span></span>}
                    {namesShown && lay && (
                        <span className="rp-rg-names">
                            {members.slice(0, lay.shown).map((p) => <PlayerName key={p.userId} player={p} className={isMe(p.userId) ? "is-me" : ""} />)}
                            {rest.length > 0 && <span className="rp-rg-more" data-tip={rest.map((p) => p.character).join(", ")}>+{rest.length}</span>}
                        </span>
                    )}
                </div>
                {label && pos !== "in" && <span className={`rp-rg-label is-out is-${pos}`}>{label}</span>}
            </div>
        );
    };
    const mobName = (key: string) => { const m = auto ? auto.mobs.find((x) => x.key === key) : undefined; return m ? (m.count > 1 ? `${m.name} ${m.inst}` : m.name) : ""; };
    const autoTip = (k: AutoTank, who: string) => `${who}${k.mobKey ? ` → ${mobName(k.mobKey)}` : ""} · ${t("raidBoard.auto.fromRow")}`;

    return (
        <div
            className={`rp-board${mapUrl ? " has-map" : ""}${showNames ? "" : " is-nonames"}${showBadges ? "" : " is-nobadges"}${showRoleRings ? "" : " is-noroles"}${view.z !== 1 ? " is-zoomed" : ""}${showSelection ? "" : " is-nosel"}`} ref={attach} style={style} data-rp-board
            onContextMenu={onContext ? (e) => {
                e.preventDefault();
                const el = (e.target as HTMLElement).closest("[data-obj]");
                const raw = el ? el.getAttribute("data-obj") || "" : "";
                const at = raw.indexOf(":");
                onContext(e, at > 0 ? { kind: raw.slice(0, at) as ObjectKind, id: raw.slice(at + 1) } : null);
            } : undefined}
        >
            <div className="rp-canvas" style={canvas} ref={attachCanvas}>
            {mapUrl ? (
                <img
                    className="rp-map" src={mapUrl} alt={t("raidBoard.board.mapAlt", { boss: bossName })} draggable={false}
                    style={{ opacity: mapOpacity }}
                    onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight); }}
                />
            ) : (
                <div className="rp-grid" aria-hidden="true">
                    <img className="rp-grid-icon" src={bossIcon} alt="" draggable={false} />
                    {emptyText && <span className="rp-grid-text">{emptyText}</span>}
                </div>
            )}

            {zones.filter((z) => !z.hidden).map((z) => {
                // a role group can be turned about its middle (degrees)
                const rm = z.type === "role" ? roleZoneMetrics(z.w * size.w, z.h * size.h, z.shape === "cluster", z.count || 0) : null;
                const zs = { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%`, "--zc": z.color, "--zo": z.opacity, ...(rm ? { "--rp-rg": `${rm.icon}px`, "--rp-zb": `${rm.border}px`, "--rp-zl": `${rm.label}px`, "--rp-zk": `${rm.badge}px`, "--rp-zn": `${rm.names}px` } : {}), ...(z.type === "role" && z.rotation ? { transform: `rotate(${z.rotation}deg)` } : {}) } as CSSProperties;
                const name = z.label || (z.type === "role" ? t(`raidBoard.roleGroup.${z.role || "melee"}`) : t(`raidBoard.zone.${z.type}`));
                const zoneLabel = zoneBoardLabel(z);
                return (
                    <div
                        key={z.id} style={zs} data-zone={z.id} data-obj={`zone:${z.id}`} tabIndex={editable ? 0 : undefined}
                        className={cls(`rp-zone rp-zone-${z.type} rp-shape-${z.shape}`, "zone", z.id, ringShownFor(true, z.ring) ? "" : "is-noborder", z.lock)}
                        aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}
                        {...handlers("zone", z.id)}
                    >
                        {z.type === "role" ? null : <span className={`rp-zone-label${zoneLabel ? "" : " is-glyph"}`}><span aria-hidden="true">{ZONE_GLYPHS[z.type]}</span>{zoneLabel ? ` ${zoneLabel}` : ""}</span>}
                        {editable && !z.lock && isSel("zone", z.id) && z.type === "role" && <span className="rp-handle rp-h-zrot" data-handle="rot" onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "zone", z.id, "rot"); }} />}
                        {editable && !z.lock && isSel("zone", z.id) && (["nw", "ne", "sw", "se", "n", "e", "s", "w"] as Handle[]).map((c) => (
                            <span key={c} className={`rp-handle rp-h-${c}`} data-handle={c} onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "zone", z.id, c); }} />
                        ))}
                    </div>
                );
            })}
            {/* the content of the role groups, upright over their outlines (after all zones, so a turned neighbour never covers it) */}
            {size.w > 0 && zones.filter((z) => !z.hidden && z.type === "role").map((z) => roleBody(z))}

            {size.w > 0 && links && links.length > 0 && (
                <svg className="rp-links" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
                    {links.map((k) => <line key={k.key} className={k.mine ? "is-yours" : undefined} x1={px(k.x1, size.w)} y1={px(k.y1, size.h)} x2={px(k.x2, size.w)} y2={px(k.y2, size.h)} stroke={k.color} />)}
                </svg>
            )}
            {size.w > 0 && lines.some((l) => !l.hidden) && (
                <svg className="rp-lines" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
                    {lines.filter((l) => !l.hidden).map((l) => {
                        const x1 = px(l.x1, size.w);
                        const y1 = px(l.y1, size.h);
                        const x2 = px(l.x2, size.w);
                        const y2 = px(l.y2, size.h);
                        return (
                            <g key={l.id} className={cls("rp-line", "line", l.id, "", l.lock)} style={{ opacity: l.opacity }}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0f1115" strokeWidth={l.width + 2.5} strokeLinecap="round" />
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={l.color} strokeWidth={l.width} strokeLinecap="round" />
                                {l.kind === "arrow" && <polygon points={arrowHead(x1, y1, x2, y2, l.width)} fill={l.color} stroke="#0f1115" strokeWidth={1.2} strokeLinejoin="round" />}
                                {editable && (
                                    <line
                                        className="rp-line-hit" x1={x1} y1={y1} x2={x2} y2={y2} data-obj={`line:${l.id}`}
                                        stroke="transparent" strokeWidth={Math.max(16, l.width + 10)} strokeLinecap="round"
                                        onPointerDown={(e) => onObjectDown!(e, "line", l.id)}
                                        onDoubleClick={onObjectOpen ? () => onObjectOpen("line", l.id) : undefined}
                                    />
                                )}
                            </g>
                        );
                    })}
                </svg>
            )}
            {editable && lines.filter((l) => !l.hidden && !l.lock && isSel("line", l.id)).map((l) => (
                ["end1", "end2"].map((end) => (
                    <span
                        key={`${l.id}-${end}`} className="rp-handle rp-h-end" data-handle={end}
                        style={{ left: `${(end === "end1" ? l.x1 : l.x2) * 100}%`, top: `${(end === "end1" ? l.y1 : l.y2) * 100}%` }}
                        onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "line", l.id, end as Handle); }}
                    />
                ))
            ))}

            {marks.filter((m) => !m.hidden).map((m) => (
                <div key={m.id} data-obj={`mark:${m.id}`} className={cls("rp-token rp-markobj", "mark", m.id, "", m.lock)} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, opacity: m.opacity, ...sizeStyle(m.size, SIZE_RANGES.mark.def) }}>
                    <button
                        type="button" className="rp-token-btn rp-mark-btn" tabIndex={editable ? 0 : -1}
                        aria-label={t(`raidBoard.mark.${m.mark}`)} data-tip={t(`raidBoard.mark.${m.mark}`)}
                        {...handlers("mark", m.id)}
                    >
                        <MarkIcon mark={m.mark} size={scaled(m.size, SIZE_RANGES.mark.def)} />
                    </button>
                    {sizeHandle("mark", m.id, m.lock)}
                </div>
            ))}

            {icons.filter((i) => !i.hidden).map((i) => {
                const type = iconKeyType(i.iconKey);
                const px = scaled(i.size, SIZE_RANGES.icon.def);
                // one of several icons of a mob: its number, as the assignments call it ("Flame 2")
                const no = mobIconNo(boardLike, i.id);
                const name = `${i.label || t(`raidBoard.icon.${type}`)}${no ? ` ${no}` : ""}`;
                const face = canFace(i.iconKey);
                const src = type === "boss" ? portraitUrl(i.iconKey) : type === "wow" ? wowIconUrl(i.iconKey.slice(4), px) : "";
                return (
                    <div key={i.id} data-obj={`icon:${i.id}`} className={cls("rp-token rp-iconobj", "icon", i.id, `${ringShownFor(showRoleRings, i.ring) ? "" : "is-noring"}${noName(i.size, SIZE_RANGES.icon.def, 1, i.showName)}`, i.lock)} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, opacity: i.opacity, ...sizeStyle(i.size, SIZE_RANGES.icon.def) }}>
                        <button type="button" className="rp-token-btn rp-icon-btn" tabIndex={editable ? 0 : -1} aria-label={name} data-tip={name} {...handlers("icon", i.id)}>
                            <span className={`rp-icon-face${face ? " is-round" : ""}`}>
                                {src ? <img src={src} alt="" draggable={false} /> : (
                                    <span className={`rp-icon-builtin rp-icon-${type}`} aria-hidden="true">
                                        {type === "bosspos" ? <Crosshair size={Math.round(px * 0.62)} /> : <Swords size={Math.round(px * 0.62)} />}
                                    </span>
                                )}
                                {face && (
                                    <span className="rp-facing" style={{ transform: `rotate(${faceOf(i)}deg)`, ...arrowVars(i) }} aria-hidden="true">
                                        {wedge(i)}
                                        {editable && !i.lock && isSel("icon", i.id) && (
                                            <span className="rp-handle rp-h-rot" data-handle="rot" onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "icon", i.id, "rot"); }} />
                                        )}
                                    </span>
                                )}
                            </span>
                        </button>
                        {iconBoardLabel(i) && <span className="rp-token-name">{iconBoardLabel(i)}</span>}
                        {sizeHandle("icon", i.id, i.lock)}
                    </div>
                );
            })}

            {auto && auto.mobs.filter((m) => !m.iconId && !m.style.hidden).sort((a, b) => (a.style.z || 0) - (b.style.z || 0)).map((m) => {
                // a mob the tank rows put on the map: like a hand-placed icon (size, opacity, ring, label, facing of its own look), marked as coming from the rows
                const st = m.style;
                const type = iconKeyType(m.iconKey);
                const ipx = scaled(m.size, SIZE_RANGES.icon.def);
                const face = canFace(m.iconKey);
                const src = type === "boss" ? portraitUrl(m.iconKey) : type === "wow" ? wowIconUrl(m.iconKey.slice(4), ipx) : "";
                const name = m.count > 1 ? `${m.name} ${m.inst}` : m.name;
                const a = st.autoFace === false ? st.rotation || 0 : autoFacing(auto, `auto:${m.key}`, m, boardLike, places, ar);
                const label = st.showLabel && st.label ? st.label : "";
                return (
                    <div key={`auto:${m.key}`} data-obj={`auto:${m.key}`} className={cls("rp-token rp-iconobj is-auto", "auto", m.key, `${ringShownFor(showRoleRings, st.ring) ? "" : "is-noring"}${label ? noName(m.size, SIZE_RANGES.icon.def, 1, st.showName) : " is-noname"}`, !!st.lock)} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, opacity: st.opacity === undefined ? 1 : st.opacity, ...sizeStyle(m.size, SIZE_RANGES.icon.def) }}>
                        <button type="button" className="rp-token-btn rp-icon-btn" tabIndex={editable ? 0 : -1} aria-label={`${label || name} · ${t("raidBoard.auto.fromRow")}`} data-tip={`${label || name} · ${t("raidBoard.auto.fromRow")}`} {...handlers("auto", m.key)}>
                            <span className={`rp-icon-face${face ? " is-round" : ""}`}>
                                {src ? <img src={src} alt="" draggable={false} /> : <span className="rp-icon-builtin rp-icon-enemy" aria-hidden="true"><Swords size={Math.round(ipx * 0.62)} /></span>}
                                {face && (
                                    <span className="rp-facing" style={{ transform: `rotate(${a >= 0 ? a : st.rotation || 0}deg)`, ...arrowVars(st) }} aria-hidden="true">
                                        {wedge(st)}
                                        {editable && !st.lock && isSel("auto", m.key) && (
                                            <span className="rp-handle rp-h-rot" data-handle="rot" onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "auto", m.key, "rot"); }} />
                                        )}
                                    </span>
                                )}
                            </span>
                        </button>
                        {label && <span className="rp-token-name">{label}</span>}
                        {sizeHandle("auto", m.key, !!st.lock)}
                    </div>
                );
            })}

            {slots.filter((s) => !s.hidden && s.placed !== false).map((s) => {
                const player = s.userId ? players.get(s.userId) || null : null;
                const tone = s.kind === "tank" || s.kind === "healer" || s.kind === "melee" || s.kind === "ranged" || s.kind === "dps" ? s.kind : "";
                const mine = isMe(s.userId);
                const title = slotTitle(s);
                const boardLabel = slotBoardLabel(s);
                const anchor = { left: `${s.x * 100}%`, top: `${s.y * 100}%`, opacity: s.opacity, ...sizeStyle(s.size, SIZE_RANGES.slot.def) };
                if (s.kind === "group") {
                    // who is shown in this group: its setup group minus everyone who has a place of his own (a free token, a role slot on the map): the ring closes up, the name list drops him
                    const members = groupListMembers(boardOwn, s, roster);
                    const showList = !s.hideMembers && !s.split;
                    const around = splitMembers(boardOwn, s, roster);
                    const everyone = around;
                    // the group's own scales: as a whole (gs), the spacing of its ring (sp) and its member tokens (ts); effective size = the board's symbol size x these
                    const { gs, sp, ts } = groupScales(s);
                    const memberBase = scaled(s.size, SIZE_RANGES.member.def);
                    const memberPx = memberBase * gs * ts;
                    // the ring is laid out for the tokens it really carries: never tighter than their size (lib/raidplan.ts ringUnit)
                    const spacePx = ringUnit(memberBase * gs * sp, memberPx);
                    const spread = gs * sp;
                    // a name under a ring member is never wider than the room to its neighbour (lib/raidplan.ts ringNameWidth): a long one ends in "…"
                    const nameRoom = ringNameWidth(Math.max(around.length, 1), spacePx, memberPx);
                    const memberSize = (sz: number | undefined) => ({ "--rp-s": `${Math.round(scaled(sz, SIZE_RANGES.member.def) * gs * ts)}px`, "--rp-nf": `${labelOf(scaled(sz, SIZE_RANGES.member.def) * gs * ts, SIZE_RANGES.member.def).font}px`, "--rp-nw": `${Math.round(nameRoom)}px`, ...effectVars(Math.round(scaled(sz, SIZE_RANGES.member.def) * gs * ts)) }) as CSSProperties;
                    const gcol = groupColor(groupColors, s.n);
                    const gmark = groupMark(groupMarks, s.n);
                    const ring = ringOffsets(everyone.length, size.w, size.h, spacePx);
                    const tag = groupTag(s, roster.filter((p) => p.group === s.n).length, roster.length > 0);
                    const chipMode = groupChipMode(editable, tag.badges, boardLabel);
                    const holders = ringOffsets(tag.placeholders, size.w, size.h, spacePx);
                    const shownOffsets = [...around.map((p) => { const off = s.offsets ? s.offsets[p.userId] : undefined; const at = everyone.findIndex((x) => x.userId === p.userId); return off ? { dx: off.dx * spread, dy: off.dy * spread } : ring[at] || { dx: 0, dy: 0 }; }), ...holders];
                    const cover = ringCover(shownOffsets, (memberPx * 0.9) / size.w, (memberPx * 0.9) / size.h);
                    return (
                        <div key={s.id} className={`rp-groupwrap${focusGroup > 0 && focusGroup !== s.n ? " rp-gdim" : ""}${focusGroup === s.n ? " is-focus" : ""}`} style={{ "--gc": gcol, "--gi": inkOn(gcol), "--rp-gs": String(gs * objectScale) } as CSSProperties}>
                            {tag.ring && ringShown(showRings, s) && shownOffsets.length > 0 && (
                                <div className={`rp-groupring${everyone.some((p) => isMe(p.userId)) ? " is-yours" : ""}`} aria-hidden="true" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${cover.rx * 200}%`, height: `${cover.ry * 200}%`, opacity: s.opacity * (s.ringOpacity === undefined ? 0.55 : s.ringOpacity) / 0.55, ...(s.ringColor ? { borderColor: s.ringColor } : {}) }} />
                            )}
                            <div data-obj={`slot:${s.id}`} className={cls("rp-token rp-slotobj", "slot", s.id, `${members.some((p) => isMe(p.userId)) ? "is-me" : ""}${ringShownFor(showRoleRings, s.ring) ? "" : " is-noring"}${noName(s.size, SIZE_RANGES.slot.def, 1, s.showName)}`, s.lock)} style={anchor} data-slot={s.id}>
                                {chipMode === "text" && <span className="rp-grouptext">{gmark && <MarkIcon mark={gmark as never} size={16} />}{boardLabel}</span>}
                                {chipMode === "chip" && (
                                <button type="button" className={`rp-token-btn rp-groupchip${tag.dim ? " is-gempty" : ""}${chipWidthOf(s) ? " is-sized" : ""}`} tabIndex={editable ? 0 : -1} aria-label={title} style={chipWidthOf(s) ? ({ "--rp-cw": `${chipWidthOf(s)}px` } as CSSProperties) : undefined} {...handlers("slot", s.id)}>
                                    <span className="rp-groupchip-head">
                                        <Users size={15} aria-hidden="true" />
                                        <span className="rp-groupchip-n">{tag.number}</span>
                                        {gmark && <MarkIcon mark={gmark as never} size={16} />}
                                        {boardLabel && <span className="rp-groupchip-title">{boardLabel}</span>}
                                    </span>
                                    {showList && members.length > 0 && (
                                        <span className="rp-groupchip-names">
                                            {members.map((p) => <PlayerName key={p.userId} player={p} className={isMe(p.userId) ? "is-me" : ""} />)}
                                        </span>
                                    )}
                                </button>
                                )}
                            </div>
                            {holders.map((h, i) => (
                                <div key={`ph-${i}`} className="rp-token rp-member rp-member-ph" aria-hidden="true" style={{ left: `${(s.x + h.dx) * 100}%`, top: `${(s.y + h.dy) * 100}%`, opacity: s.opacity, ...memberSize(s.size) }}>
                                    <span className="rp-token-btn"><span className={`rp-ico rp-ico-open rp-role-${PLACEHOLDER_ROLES[i % GROUP_PLACEHOLDERS]}`}>
                                        <WowIcon name={ROLE_ICONS[PLACEHOLDER_ROLES[i % GROUP_PLACEHOLDERS]]} size={Math.max(12, Math.round(memberPx * 0.58))} />
                                    </span><span className="rp-token-gbadge">{tag.number}</span></span>
                                </div>
                            ))}
                            {around.map((p) => {
                                const at = everyone.findIndex((x) => x.userId === p.userId);
                                const off = s.offsets ? s.offsets[p.userId] : undefined;
                                const dx = off ? off.dx * spread : ring[at] ? ring[at].dx : 0;
                                const dy = off ? off.dy * spread : ring[at] ? ring[at].dy : 0;
                                const id = memberId(s.id, p.userId);
                                const mineHere = isMe(p.userId);
                                return (
                                    <div
                                        key={id} data-obj={`member:${id}`} className={cls("rp-token rp-member", "member", id, `${mineHere ? "is-me" : ""}${ringShownFor(showRoleRings, s.ring) ? "" : " is-noring"}${noName(off && off.size ? off.size : s.size, SIZE_RANGES.member.def, gs * ts, s.showName)}`, s.lock)}
                                        style={{ left: `${(s.x + dx) * 100}%`, top: `${(s.y + dy) * 100}%`, opacity: s.opacity, ...memberSize(off && off.size ? off.size : s.size) }}
                                    >
                                        <button
                                            type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1}
                                            aria-label={t("raidBoard.board.tokenLabel", { name: p.character, spec: [p.specLabel, p.className].filter(Boolean).join(" ") })}
                                            data-tip={playerLabel(p)} {...handlers("member", id)}
                                        >
                                            <TokenIcon player={p} />
                                            {tag.badges && <span className="rp-token-gbadge" aria-hidden="true">{tag.number}</span>}
                                        </button>
                                        <span className="rp-token-name"><PlayerName player={p} /></span>
                                        {mineHere && <span className="rp-token-me">{t("raidBoard.board.you")}</span>}
                                        {sizeHandle("member", id, s.lock)}
                                    </div>
                                );
                            })}
                        </div>
                    );
                }
                return (
                    <div key={s.id} data-obj={`slot:${s.id}`} className={cls(`rp-token rp-slotobj rp-slot-${s.kind}`, "slot", s.id, `${mine ? "is-me" : ""}${player ? "" : " is-open"}${ringShownFor(showRoleRings, s.ring) ? "" : " is-noring"}${noName(s.size, SIZE_RANGES.slot.def, 1, s.showName)}`, s.lock)} style={anchor} data-slot={s.id}>
                        <button
                            type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1}
                            aria-label={player ? `${title}: ${playerLabel(player)}` : `${title} (${t("raidBoard.slot.open")})`}
                            data-tip={player ? playerLabel(player) : t("raidBoard.slot.open")}
                            {...handlers("slot", s.id)}
                        >
                            {player ? <TokenIcon player={player} /> : (
                                <span className={`rp-ico rp-ico-open${tone ? ` rp-role-${tone}` : ""}`} aria-hidden="true">
                                    {tone ? <WowIcon name={ROLE_ICONS[tone]} size={Math.max(14, Math.round(scaled(s.size, SIZE_RANGES.slot.def) * 0.58))} /> : <span className="rp-ico-ph" />}
                                </span>
                            )}
                        </button>
                        {(boardLabel || player) && (
                            <span className="rp-token-name rp-slot-name">
                                {boardLabel && <span className="rp-slot-title">{boardLabel}</span>}
                                {player && <PlayerName player={player} />}
                            </span>
                        )}
                        {player && showBadges && ownBadgeGroup(boardOwn, player) > 0 && <span className="rp-token-gbadge" aria-hidden="true" style={{ "--gc": groupColor(groupColors, player.group), "--gi": inkOn(groupColor(groupColors, player.group)) } as React.CSSProperties}>{player.group}</span>}
                        {sizeHandle("slot", s.id, s.lock)}
                    </div>
                );
            })}

            {texts.filter((x) => !x.hidden && textShown(x, isSel("text", x.id))).map((x) => (
                <div
                    key={x.id} data-obj={`text:${x.id}`} tabIndex={editable ? 0 : undefined}
                    className={cls("rp-text", "text", x.id, "", x.lock)}
                    style={{ left: `${x.x * 100}%`, top: `${x.y * 100}%`, color: x.color, fontSize: x.size, opacity: x.opacity }}
                    {...handlers("text", x.id)}
                >
                    {x.text ? <Mentions text={x.text} names={mineNames} /> : "\u2026"}
                    {sizeHandle("text", x.id, x.lock)}
                </div>
            ))}

            {tokens.filter((k) => !k.hidden).map((tok) => {
                const p = players.get(tok.userId);
                if (!p) return null;
                const mine = isMe(tok.userId);
                return (
                    <div key={tok.userId} data-obj={`token:${tok.userId}`} className={cls("rp-token", "token", tok.userId, `${mine ? "is-me" : ""}${ringShownFor(showRoleRings, tok.ring) ? "" : " is-noring"}${noName(tok.size, SIZE_RANGES.token.def, 1, tok.showName)}`, tok.lock)} style={{ left: `${tok.x * 100}%`, top: `${tok.y * 100}%`, opacity: tok.opacity, ...sizeStyle(tok.size, SIZE_RANGES.token.def) }}>
                        <button
                            type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1}
                            aria-label={t("raidBoard.board.tokenLabel", { name: p.character, spec: [p.specLabel, p.className].filter(Boolean).join(" ") })}
                            data-tip={playerLabel(p)}
                            {...handlers("token", tok.userId)}
                        >
                            <TokenIcon player={p} />
                        </button>
                        <span className="rp-token-name"><PlayerName player={p} /></span>
                        {mine && <span className="rp-token-me">{t("raidBoard.board.you")}</span>}
                        {showBadges && ownBadgeGroup(boardOwn, p) > 0 && <span className="rp-token-gbadge" aria-hidden="true" style={{ "--gc": groupColor(groupColors, p.group), "--gi": inkOn(groupColor(groupColors, p.group)) } as React.CSSProperties}>{p.group}</span>}
                        {sizeHandle("token", tok.userId, tok.lock)}
                    </div>
                );
            })}

            {auto && auto.tanks.filter((k) => !k.existing && !k.style.hidden).sort((a, b) => (a.style.z || 0) - (b.style.z || 0)).map((k) => {
                // a tank the tank rows put on the map: the raider (like his own token), the class place of a template ("Tank (Paladin)"), a
                // class nobody in the raid has ("Paladin fehlt", dimmed, never another class) or an open slot; size, opacity, ring, name and label of its own look
                const st = k.style;
                const p = k.state === "player" && k.userId ? players.get(k.userId) || null : null;
                const mine = !!p && isMe(p.userId);
                const base = `rp-token rp-autotank is-${k.state}${mine ? " is-me" : ""}`;
                const style = { left: `${k.x * 100}%`, top: `${k.y * 100}%`, opacity: st.opacity === undefined ? 1 : st.opacity, ...sizeStyle(k.size, SIZE_RANGES.token.def) };
                const ring = ringShownFor(showRoleRings, st.ring) ? "" : " is-noring";
                const label = st.label || "";
                if (p) {
                    const tip = autoTip(k, `${playerLabel(p)}${offRole(k.type, p) ? ` (${t("raidBoard.class.asTank")})` : ""}`);
                    return (
                        <div key={`auto:${k.key}`} data-obj={`auto:${k.key}`} className={cls(`${base} is-auto`, "auto", k.key, `${ring}${noName(k.size, SIZE_RANGES.token.def, 1, st.showName)}`, !!st.lock)} style={style}>
                            <button type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1} aria-label={tip} data-tip={tip} {...handlers("auto", k.key)}>
                                <TokenIcon player={p} />
                            </button>
                            <span className="rp-token-name rp-slot-name">{label && <span className="rp-slot-title">{label}</span>}<PlayerName player={p} /></span>
                            {mine && <span className="rp-token-me">{t("raidBoard.board.you")}</span>}
                            {sizeHandle("auto", k.key, !!st.lock)}
                        </div>
                    );
                }
                const who = ruleName(k);
                const missing = k.state === "missing";
                const miss = missing ? t("raidBoard.auto.missing", { cls: k.classId === ANY ? who : t(`wow.class.${k.classId}`) }) : "";
                const tip = autoTip(k, missing ? miss : who);
                const icon = k.classId ? classRefIcon(k.classId, k.role || "tank") : ROLE_ICONS[k.slotKind] || ROLE_ICONS.tank;
                const shown = missing || !!label;
                return (
                    <div key={`auto:${k.key}`} data-obj={`auto:${k.key}`} className={cls(`${base} is-auto is-open`, "auto", k.key, `${ring}${shown ? noName(k.size, SIZE_RANGES.token.def, 1, st.showName) : " is-noname"}`, !!st.lock)} style={style}>
                        <button type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1} aria-label={tip} data-tip={tip} {...handlers("auto", k.key)}>
                            <span className="rp-ico rp-ico-open rp-role-tank" aria-hidden="true"><WowIcon name={icon} size={Math.max(14, Math.round(scaled(k.size, SIZE_RANGES.token.def) * 0.58))} /></span>
                            {missing && <span className="rp-autowarn" aria-hidden="true"><AlertTriangle size={11} /></span>}
                        </button>
                        {shown && <span className={`rp-token-name${missing ? " rp-autotank-miss" : ""}`}>{label && <span className="rp-slot-title">{label}</span>}{miss}</span>}
                        {sizeHandle("auto", k.key, !!st.lock)}
                    </div>
                );
            })}

            {band && (
                <div className="rp-band" aria-hidden="true" style={{ left: `${band.x0 * 100}%`, top: `${band.y0 * 100}%`, width: `${(band.x1 - band.x0) * 100}%`, height: `${(band.y1 - band.y0) * 100}%` }} />
            )}
            {multiBox && multi.length > 1 && (
                <div className="rp-multibox" style={{ left: `${multiBox.x0 * 100}%`, top: `${multiBox.y0 * 100}%`, width: `${(multiBox.x1 - multiBox.x0) * 100}%`, height: `${(multiBox.y1 - multiBox.y0) * 100}%` }}>
                    <span className="rp-multi-count">{t("raidBoard.multi.count", { n: multi.length })}</span>
                    {editable && onMultiMove && ["n", "s", "w", "e"].map((s) => <span key={s} className={`rp-multi-edge rp-me-${s}`} onPointerDown={(e) => { e.stopPropagation(); onMultiMove(e); }} />)}
                    {editable && onMultiScale && (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                        <span key={c} className={`rp-handle rp-h-${c}`} data-handle={c} onPointerDown={(e) => { e.stopPropagation(); onMultiScale(e, c); }} />
                    ))}
                </div>
            )}
            </div>
        </div>
    );
}
