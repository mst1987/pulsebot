import { useMemo, type CSSProperties } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { RaidplanPlayer, RaidplanPublicBoss } from "../../../../api";
import type { AssignCtx } from "../../../../lib/raidplan/assign";
import { splitMine } from "../../../../lib/raidplan/mineView";
import { groupColor, groupMark, inkOn } from "../../../../lib/raidplan/groupStyle";
import { myPlayer } from "../../../../lib/raidplan/stage";
import { MarkIcon } from "../../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../../components/raidplan/PlanBoard";
import { MineBlocks } from "../ReadTables";
import { useT } from "../../../../i18n";

/**
 * "Deine Aufgaben" of the read view's stage (/p/<token>): the one card a raider opens the page for. Who he is and his group in the
 * head, then "Du machst" (his own tasks) and "Wirkt auf dich" (what others do for him) as the MineBlocks of the old "Meine Aufgaben",
 * and the sections where he has a task of his own as quick links. Floating over the map's lower left corner; it folds to its head
 * so the map stays free. Without a login or a place in the plan it is a single sentence.
 */
export default function MineCard({ boss, ctx, roster, meIds, names, loggedIn, loginHref, elsewhere, label, onPick, collapsed, onToggle, inline = false }: {
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
}) {
    const t = useT();
    const split = useMemo(() => splitMine(boss.assignments, ctx, meIds, names), [boss.assignments, ctx, meIds, names]);
    const { player, group } = myPlayer(roster, meIds);
    const cls = `rp-sheet-mine${inline ? " is-inline" : ""}${collapsed ? " is-collapsed" : ""}`;

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
        <section className={cls} aria-label={t("raidBoard.stage.mineAt", { boss: label(boss) })}>
            <div className="rp-sheet-mine-head">
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
                                        {label(b)}
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
