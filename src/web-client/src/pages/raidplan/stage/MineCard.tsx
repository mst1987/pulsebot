import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type { RaidplanPlayer, RaidplanPublicBoss } from "../../../api";
import type { AssignCtx } from "../../../lib/raidplan/assign";
import { splitMine } from "../../../lib/raidplan/mineView";
import { groupColor, groupMark, inkOn } from "../../../lib/raidplan/groupStyle";
import { myPlayer } from "../../../lib/raidplan/stage";
import { MINE_HOME, dragMinePos, nudgeMinePos, type MinePos } from "../../../lib/raidplan/sheetLayout";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { MineBlocks } from "../../../components/raidplan/editor/ReadTables";
import { useT } from "../../../i18n";

/**
 * "Deine Aufgaben" of the read view's stage (/p/<token>): the one card a raider opens the page for. Who he is and his group in the
 * head, then "Du machst" (his own tasks) and "Wirkt auf dich" (what others do for him) as the MineBlocks of the old "Meine Aufgaben",
 * and the sections where he has a task of his own as quick links. Floating over the map (the lower left corner unless the visitor
 * dragged it by its head somewhere else: arrow keys on the grip move it too, a double click on the head sends it home); it folds to
 * its head so the map stays free. Without a login or a place in the plan it is a single sentence.
 */
export default function MineCard({ boss, ctx, roster, meIds, names, loggedIn, loginHref, elsewhere, label, onPick, collapsed, onToggle, inline = false, pos = null, onMove }: {
    boss: RaidplanPublicBoss;
    ctx: AssignCtx;
    /** the planned players (the approved setup) */
    roster: RaidplanPlayer[];
    meIds: string[];
    names: string[];
    loggedIn: boolean;
    loginHref: string;
    /** the other sections where the visitor has a task of his own */
    elsewhere: RaidplanPublicBoss[];
    label: (b: RaidplanPublicBoss) => string;
    onPick: (key: string) => void;
    collapsed: boolean;
    onToggle: () => void;
    /** in the page's flow (a section without a map) instead of floating */
    inline?: boolean;
    /** where the floating card stands (lib/raidplan/sheetLayout.ts MinePos), null = bottom left */
    pos?: MinePos | null;
    /** a new place after a drag or an arrow key, null = back home; without it the card does not move */
    onMove?: (pos: MinePos | null) => void;
}) {
    const t = useT();
    const split = useMemo(() => splitMine(boss.assignments, ctx, meIds, names), [boss.assignments, ctx, meIds, names]);
    const { player, group } = myPlayer(roster, meIds);
    const ref = useRef<HTMLElement>(null);
    // the place while a drag runs: drawn at once, handed to onMove (and so to the browser's storage) only when the pointer lets go
    const [live, setLive] = useState<MinePos | null>(null);
    const drag = useRef<{ id: number; x: number; y: number; start: MinePos; free: { w: number; h: number } } | null>(null);
    const movable = !inline && !!onMove;
    const at = live || pos || MINE_HOME;
    const [dragging, setDragging] = useState(false);
    const cls = `rp-sheet-mine${inline ? " is-inline" : ""}${collapsed ? " is-collapsed" : ""}${movable ? " is-movable" : ""}${dragging ? " is-dragging" : ""}`;

    const onDown = (e: PointerEvent<HTMLDivElement>) => {
        // the head's own buttons (fold) keep their click; the grip and the rest of the head start a drag
        if (!movable || e.button !== 0 || (e.target as HTMLElement).closest("button:not(.rp-sheet-mine-grip), a")) return;
        const card = ref.current;
        const stage = card && (card.offsetParent as HTMLElement | null);
        // on a phone stage.css pins the card to the bottom (no transform): nothing to drag there
        if (!card || !stage || window.getComputedStyle(card).transform === "none") return;
        // the room the card can travel: the stage less the card and its margins (16px; on the right --rp-side, the tab's 64px or the
        // panel beside the map; as in stage.css)
        const side = parseFloat(window.getComputedStyle(stage).getPropertyValue("--rp-side")) || 64;
        const free = { w: stage.clientWidth - 16 - side - card.offsetWidth, h: stage.clientHeight - 32 - card.offsetHeight };
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: at, free };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
    };
    const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d && d.id === e.pointerId) setLive(dragMinePos(d.start, e.clientX - d.x, e.clientY - d.y, d.free));
    };
    const onUp = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        drag.current = null;
        setDragging(false);
        if (live && onMove) onMove(live);
        setLive(null);
    };
    const onGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (!onMove) return;
        if (e.key === "Home") { e.preventDefault(); onMove(null); return; }
        const next = nudgeMinePos(at, e.key);
        if (next) { e.preventDefault(); onMove(next); }
    };
    const place = movable ? ({ "--mx": at.x, "--my": at.y } as CSSProperties) : undefined;

    if (!loggedIn || !player) {
        return (
            <section className={`${cls} is-note`} aria-label={t("raidBoard.mine.title")}>
                {!loggedIn
                    ? <p>{t("raidBoard.read.loginHint")} <a className="mlink" href={loginHref}>{t("raidBoard.public.login")}</a></p>
                    : <p>{t("raidBoard.read.notInPlan")}</p>}
            </section>
        );
    }

    const gc = group ? groupColor(boss.groupColors, group) : "";
    const mark = group ? groupMark(boss.groupMarks, group) : "";
    return (
        <section ref={ref} className={cls} style={place} aria-label={t("raidBoard.stage.mineAt", { boss: label(boss) })}>
            {/* the head is the pointer's drag handle; the keyboard moves the card through the grip button */}
            <div
                className="rp-sheet-mine-head" onPointerDown={onDown} onPointerMove={onDragMove} onPointerUp={onUp} onPointerCancel={onUp}
                onDoubleClick={(e) => { if (movable && onMove && !(e.target as HTMLElement).closest("button:not(.rp-sheet-mine-grip), a")) onMove(null); }}
            >
                {movable && (
                    <button type="button" className="rp-sheet-mine-grip" aria-label={t("raidBoard.stage.move")} data-tip={t("raidBoard.stage.move")} data-tip-sub={t("raidBoard.stage.moveSub")} onKeyDown={onGripKey}>
                        <GripVertical size={16} aria-hidden="true" />
                    </button>
                )}
                <TokenIcon player={player} />
                <span className="rp-sheet-mine-who">
                    <span className="rp-kicker">{t("raidBoard.stage.mineAt", { boss: label(boss) })}</span>
                    <PlayerName player={player} className="rp-sheet-mine-name" />
                </span>
                {group > 0 && (
                    <span className="rp-sheet-mine-group" style={{ "--gc": gc, "--gi": inkOn(gc) } as CSSProperties}>
                        <span className="rp-sheet-gnum">{group}</span>
                        {t("raidBoard.slot.group", { n: group })}
                        {mark && <MarkIcon mark={mark as never} size={15} />}
                    </span>
                )}
                <button type="button" className="rp-sheet-iconbtn" aria-expanded={!collapsed} aria-label={t(collapsed ? "raidBoard.stage.expand" : "raidBoard.stage.collapse")} data-tip={t(collapsed ? "raidBoard.stage.expand" : "raidBoard.stage.collapse")} onClick={onToggle}>
                    {collapsed ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                </button>
            </div>
            {!collapsed && (
                <div className="rp-sheet-mine-body">
                    <div className="rp-sheet-mine-sec">
                        <span className="rp-kicker">{t("raidBoard.stage.doing")}</span>
                        {split.mine.length > 0
                            ? <MineBlocks blocks={split.mine} ctx={ctx} me={meIds} names={names} />
                            : <p className="rp-sheet-mine-none">{t("raidBoard.stage.noOwn")}</p>}
                    </div>
                    {split.onMe.length > 0 && (
                        <div className="rp-sheet-mine-sec">
                            <span className="rp-kicker">{t("raidBoard.mine.onMe")}</span>
                            <MineBlocks blocks={split.onMe} ctx={ctx} me={meIds} names={names} />
                        </div>
                    )}
                    {elsewhere.length > 0 && (
                        <div className="rp-sheet-mine-else">
                            <span className="rp-kicker">{t("raidBoard.stage.elsewhere")}</span>
                            <span className="rp-sheet-mine-links">
                                {elsewhere.map((b) => (
                                    <button key={b.key} type="button" onClick={() => onPick(b.key)}>
                                        {b.iconUrl && <img src={b.iconUrl} alt="" width={24} height={24} />}
                                        <span>{label(b)}</span>
                                    </button>
                                ))}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
