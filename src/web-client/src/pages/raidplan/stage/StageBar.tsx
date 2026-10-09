import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useDismiss } from "../../../hooks/useDismiss";
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks, RefreshCw } from "lucide-react";
import type { RaidplanPublicBoss } from "../../../api";
import type { FollowChip } from "../../../hooks/useRaidProgress";
import type { StripMode } from "../../../lib/raidplan/sheetLayout";
import { groupColor, groupMark, inkOn } from "../../../lib/raidplan/groupStyle";
import { neighbours, sectionPlace } from "../../../lib/raidplan/stage";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import LangToggle from "../../../components/shell/LangToggle";
import ThemeToggle from "../../../components/shell/ThemeToggle";
import AutoFollowToggle from "../../../components/raidplan/editor/AutoFollowToggle";
import SectionMenu from "./SectionMenu";
import { useT } from "../../../i18n";

/**
 * The one bar of the read view's stage (/p/<token>, "Karte als Bühne"): the section with its portrait, place ("Hyjal · Boss 2 von 5")
 * and arrows to the sections before and after it, "Alle N Abschnitte" for the rest, the groups to highlight on the map, "Automatisch
 * mitgehen", the switch "Alle Einteilungen" (the panel of every table, remembered in this browser), the live note, language and theme.
 * It replaces the old row of 14 chips: the bar shows one section, the menu all of them (and switches the extra boss strip on).
 * The title has a fixed width, so the arrows stay where they are from boss to boss; a longer name ends in "...".
 */
export default function StageBar({ boss, sections, mineKeys, killedKeys, label, head, onPick, groups, focusGroup, onFocusGroup, follow, onlyMine, strip, allTasks, updated }: {
    boss: RaidplanPublicBoss;
    /** the sections shown ("Nur für mich" leaves some out; the open one is always among them) */
    sections: RaidplanPublicBoss[];
    mineKeys: Set<string>;
    killedKeys?: Set<string>;
    label: (b: RaidplanPublicBoss) => string;
    head: string;
    onPick: (key: string) => void;
    groups: number[];
    focusGroup: number;
    onFocusGroup: (n: number) => void;
    follow?: FollowChip;
    onlyMine: { on: boolean; toggle: () => void } | null;
    strip: { mode: StripMode; set: (mode: StripMode) => void };
    /** "Alle Einteilungen": the panel open or closed */
    allTasks: { on: boolean; toggle: () => void } | null;
    updated: boolean;
}) {
    const t = useT();
    const [menu, setMenu] = useState(false);
    const closeMenu = useCallback(() => setMenu(false), []);
    // the button and the list count as inside: the button's own click toggles instead of closing and reopening
    const menuWrap = useRef<HTMLDivElement>(null);
    useDismiss(menuWrap, menu, closeMenu);
    const { prev, next } = neighbours(sections, boss.key);
    const place = sectionPlace(sections, boss.key);
    const kicker = place.count > 0 ? t("raidBoard.stage.place", { instance: place.instance, i: place.index, n: place.count }) : place.instance || t("raidBoard.public.kicker");
    const pick = (key: string) => { setMenu(false); onPick(key); };
    return (
        <header className="rp-sheet-bar">
            <div className="rp-sheet-boss">
                <button type="button" className="rp-sheet-arrow" disabled={!prev} aria-label={prev ? t("raidBoard.stage.prev", { name: label(prev) }) : undefined} data-tip={prev ? label(prev) : undefined} onClick={() => prev && pick(prev.key)}>
                    <ChevronLeft size={20} aria-hidden="true" />
                </button>
                {boss.iconUrl && <img className="rp-sheet-portrait" src={boss.iconUrl} alt="" width={44} height={44} />}
                <div className="rp-sheet-titles">
                    <span className="rp-kicker">{kicker}</span>
                    <h1 className="rp-sheet-title">{label(boss)}</h1>
                </div>
                <button type="button" className="rp-sheet-arrow" disabled={!next} aria-label={next ? t("raidBoard.stage.next", { name: label(next) }) : undefined} data-tip={next ? label(next) : undefined} onClick={() => next && pick(next.key)}>
                    <ChevronRight size={20} aria-hidden="true" />
                </button>
            </div>
            {/* beside the section, not in it: on a phone the section takes the first line and this the second */}
            <div ref={menuWrap} className="rp-sheet-menuwrap">
                <button type="button" className={`rp-sheet-menubtn${menu ? " is-on" : ""}`} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                    {t("raidBoard.stage.sections", { n: sections.length })}<ChevronDown size={16} aria-hidden="true" />
                </button>
                {menu && <SectionMenu sections={sections} selectedKey={boss.key} mineKeys={mineKeys} killedKeys={killedKeys} label={label} head={head} onlyMine={onlyMine} strip={strip} onPick={pick} />}
            </div>
            {groups.length > 0 && (
                <div className="rp-sheet-groups" role="group" aria-label={t("raidBoard.group.legend")}>
                    {groups.map((n) => {
                        const c = groupColor(boss.groupColors, n);
                        const mk = groupMark(boss.groupMarks, n);
                        return (
                            <button key={n} type="button" className={focusGroup === n ? "is-on" : ""} aria-pressed={focusGroup === n} aria-label={t("raidBoard.stage.focusGroup", { n })} data-tip={t("raidBoard.group.legendFocus")} style={{ "--gc": c, "--gi": inkOn(c) } as CSSProperties} onClick={() => onFocusGroup(focusGroup === n ? 0 : n)}>
                                <span className="rp-sheet-gnum">{n}</span>
                                {mk && <MarkIcon mark={mk as never} size={15} />}
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="rp-sheet-tools">
                {allTasks && (
                    <button type="button" className={`rp-sheet-alltasks${allTasks.on ? " is-on" : ""}`} aria-pressed={allTasks.on} aria-label={t("raidBoard.stage.allTasksToggle")} data-tip={t("raidBoard.stage.allTasksTip")} onClick={allTasks.toggle}>
                        <ListChecks size={16} aria-hidden="true" /><span className="rp-sheet-alltasks-word">{t("raidBoard.stage.allTasksToggle")}</span>
                    </button>
                )}
                {follow && <AutoFollowToggle on={follow.on} onToggle={follow.onToggle} waiting={follow.waiting} />}
                {/* the live update's note (#555): always in the page so a screen reader hears it, text only for a moment */}
                <span className="rp-live-note" role="status" aria-live="polite">
                    {updated && <><RefreshCw size={13} aria-hidden="true" />{t("raidBoard.public.updated")}</>}
                </span>
                <LangToggle />
                <ThemeToggle />
            </div>
        </header>
    );
}
