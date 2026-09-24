import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type RefObject } from "react";
import { Crosshair, Swords, Users } from "lucide-react";
import type { RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanMark, RaidplanPlayer, RaidplanSlot, RaidplanText, RaidplanToken, RaidplanZone } from "../../api";
import { classColorProps } from "../ClassSpec";
import WowIcon from "../ui/WowIcon";
import { MarkIcon } from "./MarkIcon";
import { wowIconUrl } from "../../lib/wowIcon";
import { SIZE_RANGES, canFace, groupMembers, groupTag, GROUP_PLACEHOLDERS, ringCover, iconBoardLabel, iconKeyType, memberId, portraitUrl, ringOffsets, roleTone, slotBoardLabel, slotTitle, splitMembers, textShown, zoneBoardLabel, type Corner, type ObjectKind, type Selection } from "../../lib/raidplan";
import { useT } from "../../i18n";
import { facingOf, type AssignLink } from "../../lib/assign";
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

/** The player's name in the class colour. */
export function PlayerName({ player, className = "" }: { player: RaidplanPlayer; className?: string }) {
    const colored = classColorProps(player.classColor);
    return <span className={[colored.className, className].filter(Boolean).join(" ")} style={colored.style}>{player.character || "?"}</span>;
}

/** One line of text describing a player for tooltips and screen readers: "Tanky, Protection Warrior". */
export function playerLabel(player: RaidplanPlayer): string {
    return [player.character, [player.specLabel, player.className].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** What a drag can grab on an object: a zone's corner, or one end of a line. */
export type Handle = Corner | "end1" | "end2" | "size" | "rot";
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
    /** The map's height in px (the board is as wide as its aspect ratio makes it); without it: what fits the window. */
    maxHeight?: number;
    /** Shown on the grid when there is no map. */
    emptyText?: string;
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
    me = "", maxHeight, selected = null, dragKey = "", onObjectDown, onObjectKey, onObjectOpen, onContext, links, emptyText,
}: BoardProps) {
    const t = useT();
    const [aspect, setAspect] = useState(0);
    const [setEl, size] = useElementSize();
    const attach = useCallback((el: HTMLDivElement | null) => {
        setEl(el);
        if (boardRef) (boardRef as MutableRefObject<HTMLDivElement | null>).current = el;
    }, [boardRef, setEl]);
    useEffect(() => { setAspect(0); }, [mapUrl]);

    const mineIds = Array.isArray(me) ? me : me ? [me] : [];
    const isMe = (id: string) => mineIds.indexOf(id) >= 0;
    const editable = !!onObjectDown;
    const isSel = (kind: ObjectKind, id: string) => !!selected && selected.kind === kind && selected.id === id;
    const cls = (base: string, kind: ObjectKind, id: string, extra = "", locked = false) => [base, editable ? "is-editable" : "", isSel(kind, id) ? "is-selected" : "", dragKey === `${kind}:${id}` ? "is-drag" : "", locked ? "is-locked" : "", extra].filter(Boolean).join(" ");
    const handlers = (kind: ObjectKind, id: string) => (editable ? {
        onPointerDown: (e: PointerEvent<HTMLElement>) => onObjectDown!(e, kind, id),
        onKeyDown: onObjectKey ? (e: KeyboardEvent<HTMLElement>) => onObjectKey(e, kind, id) : undefined,
        onDoubleClick: onObjectOpen ? () => onObjectOpen(kind, id) : undefined,
    } : {});
    const ar = aspect || 16 / 10;
    const style = { aspectRatio: String(ar), maxWidth: maxHeight ? `${Math.round(maxHeight * ar)}px` : `calc((100vh - 420px) * ${ar})` } as CSSProperties;
    const px = (v: number, of: number) => v * of;
    /** The size of a token-like object on screen, in px. */
    const scaled = (size: number | undefined, def: number) => Math.round((size || def) * objectScale);
    const sizeStyle = (size: number | undefined, def: number) => ({ "--rp-s": `${scaled(size, def)}px` }) as CSSProperties;
    /** The grip that scales a selected object (drag it away from / towards the object). */
    const sizeHandle = (kind: ObjectKind, id: string, locked: boolean) => (editable && !locked && isSel(kind, id) ? (
        <span className="rp-handle rp-h-size" data-handle="size" onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, kind, id, "size"); }} />
    ) : null);
    const boardLike = { tokens, slots } as unknown as RaidplanBoard;

    return (
        <div
            className={`rp-board${mapUrl ? " has-map" : ""}`} ref={attach} style={style} data-rp-board
            onContextMenu={onContext ? (e) => {
                e.preventDefault();
                const el = (e.target as HTMLElement).closest("[data-obj]");
                const raw = el ? el.getAttribute("data-obj") || "" : "";
                const at = raw.indexOf(":");
                onContext(e, at > 0 ? { kind: raw.slice(0, at) as ObjectKind, id: raw.slice(at + 1) } : null);
            } : undefined}
        >
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
                const zs = { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%`, "--zc": z.color, "--zo": z.opacity } as CSSProperties;
                const name = z.label || t(`raidBoard.zone.${z.type}`);
                const zoneLabel = zoneBoardLabel(z);
                return (
                    <div
                        key={z.id} style={zs} data-zone={z.id} data-obj={`zone:${z.id}`} tabIndex={editable ? 0 : undefined}
                        className={cls(`rp-zone rp-zone-${z.type} rp-shape-${z.shape}`, "zone", z.id, "", z.lock)}
                        aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}
                        {...handlers("zone", z.id)}
                    >
                        <span className={`rp-zone-label${zoneLabel ? "" : " is-glyph"}`}><span aria-hidden="true">{ZONE_GLYPHS[z.type]}</span>{zoneLabel ? ` ${zoneLabel}` : ""}</span>
                        {editable && !z.lock && isSel("zone", z.id) && (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                            <span key={c} className={`rp-handle rp-h-${c}`} data-handle={c} onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "zone", z.id, c); }} />
                        ))}
                    </div>
                );
            })}

            {size.w > 0 && links && links.length > 0 && (
                <svg className="rp-links" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
                    {links.map((k) => <line key={k.key} x1={px(k.x1, size.w)} y1={px(k.y1, size.h)} x2={px(k.x2, size.w)} y2={px(k.y2, size.h)} stroke={k.color} />)}
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
                const name = i.label || t(`raidBoard.icon.${type}`);
                const face = canFace(i.iconKey);
                const src = type === "boss" ? portraitUrl(i.iconKey) : type === "wow" ? wowIconUrl(i.iconKey.slice(4), px) : "";
                return (
                    <div key={i.id} data-obj={`icon:${i.id}`} className={cls("rp-token rp-iconobj", "icon", i.id, "", i.lock)} style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, opacity: i.opacity, ...sizeStyle(i.size, SIZE_RANGES.icon.def) }}>
                        <button type="button" className="rp-token-btn rp-icon-btn" tabIndex={editable ? 0 : -1} aria-label={name} data-tip={name} {...handlers("icon", i.id)}>
                            <span className={`rp-icon-face${face ? " is-round" : ""}`}>
                                {src ? <img src={src} alt="" draggable={false} /> : (
                                    <span className={`rp-icon-builtin rp-icon-${type}`} aria-hidden="true">
                                        {type === "bosspos" ? <Crosshair size={Math.round(px * 0.62)} /> : <Swords size={Math.round(px * 0.62)} />}
                                    </span>
                                )}
                                {face && (
                                    <span className="rp-facing" style={{ transform: `rotate(${facingOf(boardLike, i, ar)}deg)` }} aria-hidden="true">
                                        <svg className="rp-wedge" viewBox="0 0 22 20" aria-hidden="true"><path d="M11 1.5 L20.5 18.5 L1.5 18.5 Z" fill="#ffb020" stroke="#1c1305" strokeWidth="2.4" strokeLinejoin="round" /></svg>
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

            {slots.filter((s) => !s.hidden && s.placed !== false).map((s) => {
                const player = s.userId ? players.get(s.userId) || null : null;
                const tone = s.kind === "tank" || s.kind === "healer" || s.kind === "melee" || s.kind === "ranged" || s.kind === "dps" ? s.kind : "";
                const mine = isMe(s.userId);
                const title = slotTitle(s);
                const boardLabel = slotBoardLabel(s);
                const anchor = { left: `${s.x * 100}%`, top: `${s.y * 100}%`, opacity: s.opacity, ...sizeStyle(s.size, SIZE_RANGES.slot.def) };
                if (s.kind === "group") {
                    const members = groupMembers(s, roster);
                    const showList = !s.hideMembers && !s.split;
                    const around = splitMembers(boardLike, s, roster);
                    const everyone = s.split && !s.hideMembers ? roster.filter((p) => p.group === s.n) : [];
                    const memberPx = scaled(s.size, SIZE_RANGES.member.def);
                    const ring = ringOffsets(everyone.length, size.w, size.h, memberPx);
                    const tag = groupTag(s, roster.filter((p) => p.group === s.n).length, roster.length > 0);
                    const holders = ringOffsets(tag.placeholders, size.w, size.h, memberPx);
                    const shownOffsets = [...around.map((p) => { const off = s.offsets ? s.offsets[p.userId] : undefined; const at = everyone.findIndex((x) => x.userId === p.userId); return off || ring[at] || { dx: 0, dy: 0 }; }), ...holders];
                    const cover = ringCover(shownOffsets, (memberPx * 0.9) / size.w, (memberPx * 0.9) / size.h);
                    return (
                        <div key={s.id} className="rp-groupwrap">
                            {tag.ring && shownOffsets.length > 0 && (
                                <div className="rp-groupring" aria-hidden="true" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${cover.rx * 200}%`, height: `${cover.ry * 200}%`, opacity: s.opacity }} />
                            )}
                            <div data-obj={`slot:${s.id}`} className={cls("rp-token rp-slotobj", "slot", s.id, members.some((p) => isMe(p.userId)) ? "is-me" : "", s.lock)} style={anchor} data-slot={s.id}>
                                <button type="button" className={`rp-token-btn rp-groupchip${tag.dim ? " is-gempty" : ""}`} tabIndex={editable ? 0 : -1} aria-label={title} {...handlers("slot", s.id)}>
                                    <span className="rp-groupchip-head">
                                        <Users size={15} aria-hidden="true" />
                                        <span className="rp-groupchip-n">{tag.number}</span>
                                        {boardLabel && <span className="rp-groupchip-title">{boardLabel}</span>}
                                    </span>
                                    {showList && members.length > 0 && (
                                        <span className="rp-groupchip-names">
                                            {members.map((p) => <PlayerName key={p.userId} player={p} className={isMe(p.userId) ? "is-me" : ""} />)}
                                        </span>
                                    )}
                                </button>
                            </div>
                            {holders.map((h, i) => (
                                <div key={`ph-${i}`} className="rp-token rp-member rp-member-ph" aria-hidden="true" style={{ left: `${(s.x + h.dx) * 100}%`, top: `${(s.y + h.dy) * 100}%`, opacity: s.opacity, ...sizeStyle(s.size, SIZE_RANGES.member.def) }}>
                                    <span className="rp-token-btn"><span className={`rp-ico rp-ico-open rp-role-${PLACEHOLDER_ROLES[i % GROUP_PLACEHOLDERS]}`}>
                                        <WowIcon name={ROLE_ICONS[PLACEHOLDER_ROLES[i % GROUP_PLACEHOLDERS]]} size={Math.max(12, Math.round(memberPx * 0.58))} />
                                    </span><span className="rp-token-gbadge">{tag.number}</span></span>
                                </div>
                            ))}
                            {around.map((p) => {
                                const at = everyone.findIndex((x) => x.userId === p.userId);
                                const off = s.offsets ? s.offsets[p.userId] : undefined;
                                const dx = off ? off.dx : ring[at] ? ring[at].dx : 0;
                                const dy = off ? off.dy : ring[at] ? ring[at].dy : 0;
                                const id = memberId(s.id, p.userId);
                                const mineHere = isMe(p.userId);
                                return (
                                    <div
                                        key={id} data-obj={`member:${id}`} className={cls("rp-token rp-member", "member", id, mineHere ? "is-me" : "", s.lock)}
                                        style={{ left: `${(s.x + dx) * 100}%`, top: `${(s.y + dy) * 100}%`, opacity: s.opacity, ...sizeStyle(off && off.size ? off.size : s.size, SIZE_RANGES.member.def) }}
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
                    <div key={s.id} data-obj={`slot:${s.id}`} className={cls(`rp-token rp-slotobj rp-slot-${s.kind}`, "slot", s.id, `${mine ? "is-me" : ""}${player ? "" : " is-open"}`, s.lock)} style={anchor} data-slot={s.id}>
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
                    {x.text || "\u2026"}
                    {sizeHandle("text", x.id, x.lock)}
                </div>
            ))}

            {tokens.filter((k) => !k.hidden).map((tok) => {
                const p = players.get(tok.userId);
                if (!p) return null;
                const mine = isMe(tok.userId);
                return (
                    <div key={tok.userId} data-obj={`token:${tok.userId}`} className={cls("rp-token", "token", tok.userId, mine ? "is-me" : "", tok.lock)} style={{ left: `${tok.x * 100}%`, top: `${tok.y * 100}%`, opacity: tok.opacity, ...sizeStyle(tok.size, SIZE_RANGES.token.def) }}>
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
                        {sizeHandle("token", tok.userId, tok.lock)}
                    </div>
                );
            })}
        </div>
    );
}
