import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from "react";
import type { RaidplanMark, RaidplanPlayer, RaidplanSlot, RaidplanToken, RaidplanZone } from "../../api";
import { classColorProps } from "../ClassSpec";
import WowIcon from "../ui/WowIcon";
import { MarkIcon } from "./MarkIcon";
import { groupMembers, roleTone, slotTitle, type Corner, type ObjectKind, type Selection } from "../../lib/raidplan";
import { useT } from "../../i18n";
import "../../styles/raidplan.css";

// The role icons the raid detail already uses for its role groups (meta.ts's ROLE_META).
const ROLE_ICONS: Record<string, string> = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    dps: "ability_dualwield",
};

/** The type of a zone as a glyph, so it reads without its colour (danger, healthy, neutral, own). */
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

/** How the board reports a pointer or key event on one of its objects. */
export type ObjectDown = (e: PointerEvent<HTMLElement>, kind: ObjectKind, id: string, corner?: Corner) => void;
export type ObjectKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => void;

type BoardProps = {
    boardRef?: RefObject<HTMLDivElement>;
    bossName: string;
    bossIcon: string;
    mapUrl: string;
    tokens: RaidplanToken[];
    slots?: RaidplanSlot[];
    marks?: RaidplanMark[];
    zones?: RaidplanZone[];
    players: Map<string, RaidplanPlayer>;
    /** Everyone of the setup, for what a group marker names. */
    roster?: RaidplanPlayer[];
    /** The viewer's own userId: that token or slot is highlighted. */
    me?: string;
    selected?: Selection;
    /** The object being dragged right now ("kind:id"). */
    dragKey?: string;
    onObjectDown?: ObjectDown;
    onObjectKey?: ObjectKey;
    onObjectOpen?: (kind: ObjectKind, id: string) => void;
    /** Shown on the grid when there is no map. */
    emptyText?: string;
};

/**
 * The board of one boss: the room map (or a neutral grid with the boss icon) and
 * on it, back to front, the zones, the raid marks, the slots and the player
 * tokens at their relative positions. Presentational and shared by the event
 * editor, the template editor and the read view — the editors own the drag
 * (Pointer Events, no HTML5 drag and drop, so it works with a finger too) and
 * pass the handlers; the read view passes none.
 */
export default function PlanBoard({
    boardRef, bossName, bossIcon, mapUrl, tokens, slots = [], marks = [], zones = [], players, roster = [], me = "", selected = null,
    dragKey = "", onObjectDown, onObjectKey, onObjectOpen, emptyText,
}: BoardProps) {
    const t = useT();
    const editable = !!onObjectDown;
    const isSel = (kind: ObjectKind, id: string) => !!selected && selected.kind === kind && selected.id === id;
    const cls = (base: string, kind: ObjectKind, id: string, extra = "") => [base, editable ? "is-editable" : "", isSel(kind, id) ? "is-selected" : "", dragKey === `${kind}:${id}` ? "is-drag" : "", extra].filter(Boolean).join(" ");
    const handlers = (kind: ObjectKind, id: string) => (editable ? {
        onPointerDown: (e: PointerEvent<HTMLElement>) => onObjectDown!(e, kind, id),
        onKeyDown: onObjectKey ? (e: KeyboardEvent<HTMLElement>) => onObjectKey(e, kind, id) : undefined,
        onDoubleClick: onObjectOpen ? () => onObjectOpen(kind, id) : undefined,
    } : {});

    return (
        <div className={`rp-board${mapUrl ? " has-map" : ""}`} ref={boardRef} data-rp-board>
            {mapUrl ? (
                <img className="rp-map" src={mapUrl} alt={t("raidBoard.board.mapAlt", { boss: bossName })} draggable={false} />
            ) : (
                <div className="rp-grid" aria-hidden="true">
                    <img className="rp-grid-icon" src={bossIcon} alt="" draggable={false} />
                    {emptyText && <span className="rp-grid-text">{emptyText}</span>}
                </div>
            )}

            {zones.map((z) => {
                const style = { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%`, "--zc": z.color, "--zo": z.opacity } as CSSProperties;
                const name = z.label || t(`raidBoard.zone.${z.type}`);
                return (
                    <div
                        key={z.id} style={style} data-zone={z.id} tabIndex={editable ? 0 : undefined}
                        className={cls(`rp-zone rp-zone-${z.type} rp-shape-${z.shape}`, "zone", z.id)}
                        aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}
                        {...handlers("zone", z.id)}
                    >
                        <span className="rp-zone-label"><span aria-hidden="true">{ZONE_GLYPHS[z.type]}</span> {name}</span>
                        {editable && isSel("zone", z.id) && (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                            <span key={c} className={`rp-handle rp-h-${c}`} data-handle={c} onPointerDown={(e) => { e.stopPropagation(); onObjectDown!(e, "zone", z.id, c); }} />
                        ))}
                    </div>
                );
            })}

            {marks.map((m) => (
                <div key={m.id} className={cls("rp-token rp-markobj", "mark", m.id)} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}>
                    <button
                        type="button" className="rp-token-btn rp-mark-btn" tabIndex={editable ? 0 : -1}
                        aria-label={t(`raidBoard.mark.${m.mark}`)} data-tip={t(`raidBoard.mark.${m.mark}`)}
                        {...handlers("mark", m.id)}
                    >
                        <MarkIcon mark={m.mark} size={30} />
                    </button>
                </div>
            ))}

            {slots.map((s) => {
                const player = s.userId ? players.get(s.userId) || null : null;
                const tone = s.kind === "tank" || s.kind === "healer" || s.kind === "dps" ? s.kind : "";
                const mine = !!me && s.userId === me;
                const title = slotTitle(s);
                const anchor = { left: `${s.x * 100}%`, top: `${s.y * 100}%` };
                if (s.kind === "group") {
                    const members = groupMembers(s, roster);
                    return (
                        <div key={s.id} className={cls("rp-token rp-slotobj", "slot", s.id, me && members.some((p) => p.userId === me) ? "is-me" : "")} style={anchor} data-slot={s.id}>
                            <button type="button" className="rp-token-btn rp-groupchip" tabIndex={editable ? 0 : -1} aria-label={title} {...handlers("slot", s.id)}>
                                <span className="rp-groupchip-title">{title}</span>
                                {members.length > 0 && (
                                    <span className="rp-groupchip-names">
                                        {members.map((p) => <PlayerName key={p.userId} player={p} className={p.userId === me ? "is-me" : ""} />)}
                                    </span>
                                )}
                            </button>
                        </div>
                    );
                }
                return (
                    <div key={s.id} className={cls(`rp-token rp-slotobj rp-slot-${s.kind}`, "slot", s.id, `${mine ? "is-me" : ""}${player ? "" : " is-open"}`)} style={anchor} data-slot={s.id}>
                        <button
                            type="button" className="rp-token-btn" tabIndex={editable ? 0 : -1}
                            aria-label={player ? `${title}: ${playerLabel(player)}` : `${title} (${t("raidBoard.slot.open")})`}
                            data-tip={player ? playerLabel(player) : t("raidBoard.slot.open")}
                            {...handlers("slot", s.id)}
                        >
                            {player ? <TokenIcon player={player} /> : (
                                <span className={`rp-ico rp-ico-open${tone ? ` rp-role-${tone}` : ""}`} aria-hidden="true">
                                    {tone ? <WowIcon name={ROLE_ICONS[tone]} size={22} /> : <span className="rp-ico-ph" />}
                                </span>
                            )}
                        </button>
                        <span className="rp-token-name rp-slot-name">
                            <span className="rp-slot-title">{title}</span>
                            {player && <PlayerName player={player} />}
                        </span>
                    </div>
                );
            })}

            {tokens.map((tok) => {
                const p = players.get(tok.userId);
                if (!p) return null;
                const mine = !!me && tok.userId === me;
                return (
                    <div key={tok.userId} className={cls("rp-token", "token", tok.userId, mine ? "is-me" : "")} style={{ left: `${tok.x * 100}%`, top: `${tok.y * 100}%` }}>
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
                    </div>
                );
            })}
        </div>
    );
}
