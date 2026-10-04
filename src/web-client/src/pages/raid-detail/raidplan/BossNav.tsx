import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { boardCount, boardOf, sectionLabel, severalInstances, sheetIncluded, type MenuItem } from "../../../lib/raidplan";
import ContextMenu from "./ContextMenu";
import AutoFollowToggle from "./AutoFollowToggle";
import type { FollowChip } from "../../../hooks/useRaidProgress";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The sections of the plan as chips: icon and NAME on every chip (the name tells what a section is; the icon only helps), in the raid's
 * order, wrapping to a second line rather than cutting a name. The chosen one is filled. A dot marks a section that already holds
 * something. The sheet's bar looks the same (PlanPublicPage). While the linked log is read (#534), a boss it shows killed is dimmed with a
 * small check (`killedKeys`) and "Automatisch mitgehen" ends the bar (`follow`).
 */
export default function BossNav({ bosses, selected, draft, onSelect, onSheet, onMap, dirtyKeys = [], killedKeys, follow }: {
    /** the sections whose boss the linked log shows killed (#534) */
    killedKeys?: Set<string>;
    /** the "Automatisch mitgehen" chip: a switch while a log is read, "Wartet auf Log" (`waiting`) inside the raid window without one; missing = none */
    follow?: FollowChip;
    /** the sections with unsaved changes: their chip carries an amber dot (and says so) */
    dirtyKeys?: string[];
    bosses: RaidplanBoss[];
    selected: string;
    draft: Record<string, Partial<RaidplanBoard>>;
    onSelect: (key: string) => void;
    /** switches a section in or out of the shared sheet (missing = no such switch, e.g. read-only) */
    onSheet?: (key: string, on: boolean) => void;
    /** shows or hides the map of a boss / trash section ("Karte anzeigen"; missing = read-only) */
    onMap?: (key: string, on: boolean) => void;
}) {
    const t = useT();
    // the right-click menu of a chip: in or out of the sheet, the map on or off
    const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
    const menuBoss = menu ? bosses.find((b) => b.key === menu.key) : undefined;
    const menuItems = (): MenuItem[] => {
        if (!menuBoss) return [];
        const out: MenuItem[] = [];
        if (onSheet && !menuBoss.defaults) out.push({ id: sheetIncluded(draft, menuBoss.key) ? "sheet:off" : "sheet:on", section: "main", disabled: false, danger: false });
        if (onMap && !menuBoss.defaults && !menuBoss.general) out.push({ id: boardOf(draft, menuBoss.key).showMap === false ? "map:on" : "map:off", section: "main", disabled: false, danger: false });
        return out;
    };
    const menuLabel = (item: MenuItem) => (item.id === "sheet:off" ? t("raidBoard.sheet.outAction") : item.id === "sheet:on" ? t("raidBoard.sheet.inAction") : item.id === "map:on" ? t("raidBoard.map.show") : t("raidBoard.map.hide"));
    const pick = (id: string) => {
        if (!menu) return;
        if (id.indexOf("sheet:") === 0 && onSheet) onSheet(menu.key, id === "sheet:on");
        if (id.indexOf("map:") === 0 && onMap) onMap(menu.key, id === "map:on");
        setMenu(null);
    };
    const several = severalInstances(bosses);
    const label = (b: RaidplanBoss) => sectionLabel(b, several);
    return (
        <nav className="rp-bossnav" aria-label={t("raidBoard.bosses.title")}>
            {bosses.map((b) => {
                const on = b.key === selected;
                const inSheet = b.defaults ? true : sheetIncluded(draft, b.key);
                const unsaved = dirtyKeys.indexOf(b.key) >= 0;
                const killed = !!killedKeys && killedKeys.has(b.key);
                const tips = [unsaved ? t("raidBoard.save.unsavedShort") : "", killed ? t("raidBoard.progress.killed") : ""].filter(Boolean);
                return (
                    <span key={b.key} className={`rp-bosschip-wrap${inSheet ? "" : " is-out"}`}>
                    <button
                        type="button" className={`rp-bosschip${on ? " is-on" : ""}${inSheet ? "" : " is-out"}${unsaved ? " is-unsaved" : ""}${killed ? " is-killed" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={`${label(b)}${tips.length ? ` (${tips.join(", ")})` : ""}`} data-tip={tips.length ? tips.join(" · ") : undefined}
                        onClick={() => onSelect(b.key)}
                        onContextMenu={(onSheet || onMap) && !b.defaults ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, key: b.key }); } : undefined}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                        <span className="rp-bosschip-name">{label(b)}</span>
                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                        {unsaved && <span className="rp-boss-unsaved" aria-hidden="true" />}
                        {killed && <span className="rp-bosschip-done" aria-hidden="true"><Check size={9} strokeWidth={3.5} /></span>}
                    </button>
                    {onSheet && !b.defaults && (
                        <button
                            type="button" className="rp-bosschip-eye" aria-pressed={!inSheet} aria-label={inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.inAction")}
                            data-tip={inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.notInSheet")} onClick={() => onSheet(b.key, !inSheet)}
                        >
                            {inSheet ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                    )}
                    </span>
                );
            })}
            {follow && <AutoFollowToggle on={follow.on} onToggle={follow.onToggle} waiting={follow.waiting} />}
            {menu && menuBoss && (
                <ContextMenu x={menu.x} y={menu.y} title={menuBoss.general ? t("raidBoard.assign.general") : menuBoss.trash ? t("raidBoard.assign.trash") : menuBoss.name} items={menuItems()} labelFor={menuLabel} onPick={pick} onClose={() => setMenu(null)} />
            )}
        </nav>
    );
}
