import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { boardCount, boardOf, sheetIncluded, type MenuItem } from "../../../lib/raidplan";
import ContextMenu from "./ContextMenu";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The bosses of the plan as one compact row of chips (icon and number; the chosen
 * one also shows its name, the others carry it in the tooltip), so the board keeps
 * the width. A dot marks a boss that already holds something.
 */
export default function BossNav({ bosses, selected, draft, onSelect, onSheet, onMap, dirtyKeys = [] }: {
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
    const label = (b: RaidplanBoss) => (b.defaults ? t("raidBoard.defaults.title") : b.general ? t("raidBoard.assign.general") : b.trash ? `${b.instanceName ? `${b.instanceName}: ` : ""}${t("raidBoard.assign.trash")}` : b.name);
    return (
        <nav className="rp-bossnav" aria-label={t("raidBoard.bosses.title")}>
            {bosses.map((b, idx) => {
                const on = b.key === selected;
                const special = !!b.trash || !!b.general || !!b.defaults;
                const i = bosses.slice(0, idx).filter((x) => !x.trash && !x.general && !x.defaults).length;
                const inSheet = b.defaults ? true : sheetIncluded(draft, b.key);
                const unsaved = dirtyKeys.indexOf(b.key) >= 0;
                return (
                    <span key={b.key} className={`rp-bosschip-wrap${inSheet ? "" : " is-out"}`}>
                    <button
                        type="button" className={`rp-bosschip${on ? " is-on" : ""}${inSheet ? "" : " is-out"}${unsaved ? " is-unsaved" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={`${special ? label(b) : `${i + 1}. ${b.name}`}${unsaved ? ` (${t("raidBoard.save.unsavedShort")})` : ""}`} data-tip={`${special ? label(b) : `${i + 1}. ${b.name}`}${unsaved ? ` · ${t("raidBoard.save.unsavedShort")}` : ""}`}
                        onClick={() => onSelect(b.key)}
                        onContextMenu={(onSheet || onMap) && !b.defaults ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, key: b.key }); } : undefined}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                        {!special && <span className="rp-bosschip-no">{i + 1}</span>}
                        {on && <span className="rp-bosschip-name">{special ? label(b) : b.name}</span>}
                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                        {unsaved && <span className="rp-boss-unsaved" aria-hidden="true" />}
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
            {menu && menuBoss && (
                <ContextMenu x={menu.x} y={menu.y} title={menuBoss.general ? t("raidBoard.assign.general") : menuBoss.trash ? t("raidBoard.assign.trash") : menuBoss.name} items={menuItems()} labelFor={menuLabel} onPick={pick} onClose={() => setMenu(null)} />
            )}
        </nav>
    );
}
