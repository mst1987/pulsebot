import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import type { CSSProperties } from "react";
import type { RaidplanPlayer, RaidplanToken } from "../../api";
import { classColorProps } from "../ClassSpec";
import { roleTone } from "../../lib/raidplan";
import { useT } from "../../i18n";
import "../../styles/raidplan.css";

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

/**
 * The board of one boss: the room map (or a neutral grid with the boss icon)
 * and the player tokens on it at their relative positions. Presentational — the
 * editor owns the drag (Pointer Events, no HTML5 drag and drop, so it works with
 * a finger too) and passes the handlers; the read view passes none.
 */
export default function PlanBoard({ boardRef, bossName, bossIcon, mapUrl, tokens, players, me = "", dragId = "", onTokenDown, onTokenKey, emptyText }: {
    boardRef?: RefObject<HTMLDivElement>;
    bossName: string;
    bossIcon: string;
    mapUrl: string;
    tokens: RaidplanToken[];
    players: Map<string, RaidplanPlayer>;
    /** The viewer's own userId: that token is highlighted. */
    me?: string;
    /** The token being dragged right now. */
    dragId?: string;
    onTokenDown?: (e: PointerEvent<HTMLButtonElement>, userId: string) => void;
    onTokenKey?: (e: KeyboardEvent<HTMLButtonElement>, userId: string) => void;
    /** Shown on the grid when there is no map. */
    emptyText?: string;
}) {
    const t = useT();
    const editable = !!onTokenDown;
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
            {tokens.map((tok) => {
                const p = players.get(tok.userId);
                if (!p) return null;
                const mine = !!me && tok.userId === me;
                const cls = ["rp-token", editable ? "is-editable" : "", mine ? "is-me" : "", dragId === tok.userId ? "is-drag" : ""].filter(Boolean).join(" ");
                return (
                    <div key={tok.userId} className={cls} style={{ left: `${tok.x * 100}%`, top: `${tok.y * 100}%` }}>
                        <button
                            type="button"
                            className="rp-token-btn"
                            aria-label={t("raidBoard.board.tokenLabel", { name: p.character, spec: [p.specLabel, p.className].filter(Boolean).join(" ") })}
                            data-tip={playerLabel(p)}
                            tabIndex={editable ? 0 : -1}
                            onPointerDown={editable ? (e) => onTokenDown!(e, tok.userId) : undefined}
                            onKeyDown={editable && onTokenKey ? (e) => onTokenKey(e, tok.userId) : undefined}
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
