import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { boardCount, boardOf, sectionLabel, severalInstances, sheetIncluded, type MenuItem } from "../../../lib/raidplan";
import { belowStartPlacement } from "../../../lib/popoverPosition";
import Popover from "../../../components/ui/Popover";
import { Badge, IconButton } from "../../../components/ui";
import ContextMenu from "./ContextMenu";
import AutoFollowToggle from "./AutoFollowToggle";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { useT } from "../../../i18n";
import { sectionPosition } from "./planView";


/**
 * The section choice of the editor as ONE strip (Oct 2026, replaces the chip rows): "◀ [icon] Teron Gorefiend · Boss 4 von 9 ▾ ▶"
 * and the open assignments of this section as a badge. The ▾ lists every section (Standard, Allgemein, the bosses, trash) with its
 * icon and the states the chips had: chosen, killed in the linked log (#534: dimmed, a check), out of the sheet (dimmed, struck
 * through; the eye beside it switches), unsaved changes (amber), content (a dot) and its open assignments. A right click on an entry
 * opens the small menu (in / out of the sheet, the map on / off). While a log is read, "Automatisch mitgehen" follows the strip.
 */
export default function SectionStrip({ bosses, selected, draft, onSelect, onSheet, onMap, dirtyKeys = [], killedKeys, follow, openCounts = {} }: {
    bosses: RaidplanBoss[];
    selected: string;
    draft: Record<string, Partial<RaidplanBoard>>;
    onSelect: (key: string) => void;
    /** switches a section in or out of the shared sheet (missing = no such switch, e.g. read-only) */
    onSheet?: (key: string, on: boolean) => void;
    /** shows or hides the map of a boss / trash section ("Karte anzeigen"; missing = read-only) */
    onMap?: (key: string, on: boolean) => void;
    /** the sections with unsaved changes: amber (and they say so) */
    dirtyKeys?: string[];
    /** the sections whose boss the linked log shows killed (#534) */
    killedKeys?: Set<string>;
    /** the "Automatisch mitgehen" switch; missing = no log is read, no switch */
    follow?: { on: boolean; onToggle: () => void };
    /** per section: how many of its assignments have an open place (an event plan; a template has none) */
    openCounts?: Record<string, number>;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
    const pick = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const several = severalInstances(bosses);
    const label = (b: RaidplanBoss) => sectionLabel(b, several);
    const at = bosses.findIndex((b) => b.key === selected);
    const cur = at >= 0 ? bosses[at] : null;
    const prev = at > 0 ? bosses[at - 1] : null;
    const next = at >= 0 && at < bosses.length - 1 ? bosses[at + 1] : null;
    const pos = sectionPosition(bosses, selected);
    const posText = pos.boss ? t("raidBoard.strip.boss", { n: pos.n, of: pos.of }) : t("raidBoard.strip.section", { n: pos.n, of: pos.of });
    const openHere = openCounts[selected] || 0;
    const unsavedHere = dirtyKeys.indexOf(selected) >= 0;

    // the chosen entry gets the focus when the list opens
    useEffect(() => {
        if (!open || !list.current) return;
        const el = list.current.querySelector<HTMLButtonElement>(".rp-strip-item[aria-current]") || list.current.querySelector<HTMLButtonElement>(".rp-strip-item");
        if (el) el.focus();
    }, [open]);

    const choose = (key: string) => {
        setOpen(false);
        onSelect(key);
        if (pick.current) pick.current.focus();
    };
    const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const items = list.current ? Array.from(list.current.querySelectorAll<HTMLButtonElement>(".rp-strip-item")) : [];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const go = (n: number) => { if (items.length > 0) items[(n + items.length) % items.length].focus(); };
        if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
        else if (e.key === "Home") { e.preventDefault(); go(0); }
        else if (e.key === "End") { e.preventDefault(); go(items.length - 1); }
        else if (e.key === "Escape") { e.preventDefault(); setOpen(false); if (pick.current) pick.current.focus(); }
    };

    // the right-click menu of an entry: in or out of the sheet, the map on or off
    const menuBoss = menu ? bosses.find((b) => b.key === menu.key) : undefined;
    const menuItems = (): MenuItem[] => {
        if (!menuBoss) return [];
        const out: MenuItem[] = [];
        if (onSheet && !menuBoss.defaults) out.push({ id: sheetIncluded(draft, menuBoss.key) ? "sheet:off" : "sheet:on", section: "main", disabled: false, danger: false });
        if (onMap && !menuBoss.defaults && !menuBoss.general) out.push({ id: boardOf(draft, menuBoss.key).showMap === false ? "map:on" : "map:off", section: "main", disabled: false, danger: false });
        return out;
    };
    const menuLabel = (item: MenuItem) => (item.id === "sheet:off" ? t("raidBoard.sheet.outAction") : item.id === "sheet:on" ? t("raidBoard.sheet.inAction") : item.id === "map:on" ? t("raidBoard.map.show") : t("raidBoard.map.hide"));
    const pickMenu = (id: string) => {
        if (!menu) return;
        if (id.indexOf("sheet:") === 0 && onSheet) onSheet(menu.key, id === "sheet:on");
        if (id.indexOf("map:") === 0 && onMap) onMap(menu.key, id === "map:on");
        setMenu(null);
    };

    return (
        <nav className="rp-strip-nav" aria-label={t("raidBoard.bosses.title")}>
            <span className="rp-strip-step">
                <IconButton size="sm" icon={<ChevronLeft size={17} />} tip={prev ? t("raidBoard.strip.prev", { name: label(prev) }) : t("raidBoard.strip.first")} disabled={!prev} onClick={() => prev && onSelect(prev.key)} />
                <button
                    ref={pick} type="button" className={`rp-strip-pick${unsavedHere ? " is-unsaved" : ""}`} aria-haspopup="dialog" aria-expanded={open}
                    aria-label={`${t("raidBoard.strip.choose")}: ${cur ? label(cur) : ""}, ${posText}${unsavedHere ? ` (${t("raidBoard.save.unsavedShort")})` : ""}`}
                    data-tip={open ? undefined : t("raidBoard.strip.choose")} data-tip-sub={open ? undefined : t("raidBoard.strip.chooseSub")}
                    onClick={() => setOpen((o) => !o)}
                >
                    {cur && <img src={cur.iconUrl} alt="" width={30} height={30} />}
                    <span className="rp-strip-titles">
                        <span className="rp-strip-name">{cur ? label(cur) : ""}</span>
                        <span className="rp-strip-pos">{posText}</span>
                    </span>
                    {unsavedHere && <span className="rp-boss-unsaved" aria-hidden="true" />}
                    <ChevronDown className="rp-strip-chev" size={16} aria-hidden="true" />
                </button>
                <IconButton size="sm" icon={<ChevronRight size={17} />} tip={next ? t("raidBoard.strip.next", { name: label(next) }) : t("raidBoard.strip.last")} disabled={!next} onClick={() => next && onSelect(next.key)} />
            </span>
            {openHere > 0 && <Badge tone="mid" tip={t("raidBoard.strip.openTip")} tipSub={t("raidBoard.aline.openHint")}>{t("raidBoard.aline.open", { n: openHere })}</Badge>}
            {follow && <AutoFollowToggle on={follow.on} onToggle={follow.onToggle} />}
            {open && (
                <Popover anchor={pick} place={belowStartPlacement(6)} follow="reposition" onClose={() => setOpen(false)} className="rp-strip-pop" role="dialog" aria-label={t("raidBoard.strip.choose")} boxRef={list} onKeyDown={onListKey}>
                    <ul className="rp-strip-list">
                        {bosses.map((b) => {
                            const on = b.key === selected;
                            const inSheet = b.defaults ? true : sheetIncluded(draft, b.key);
                            const unsaved = dirtyKeys.indexOf(b.key) >= 0;
                            const killed = !!killedKeys && killedKeys.has(b.key);
                            const n = openCounts[b.key] || 0;
                            const p = sectionPosition(bosses, b.key);
                            const tips = [unsaved ? t("raidBoard.save.unsavedShort") : "", killed ? t("raidBoard.progress.killed") : "", inSheet ? "" : t("raidBoard.sheet.notInSheet")].filter(Boolean);
                            return (
                                <li key={b.key} className={`rp-strip-row${inSheet ? "" : " is-out"}`}>
                                    <button
                                        type="button" className={`rp-bosschip rp-strip-item${on ? " is-on" : ""}${inSheet ? "" : " is-out"}${unsaved ? " is-unsaved" : ""}${killed ? " is-killed" : ""}`} aria-current={on ? "true" : undefined}
                                        aria-label={`${label(b)}${n > 0 ? `, ${t("raidBoard.aline.open", { n })}` : ""}${tips.length ? ` (${tips.join(", ")})` : ""}`} data-tip={tips.length ? tips.join(" · ") : undefined}
                                        onClick={() => choose(b.key)}
                                        onContextMenu={(onSheet || onMap) && !b.defaults ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, key: b.key }); } : undefined}
                                    >
                                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                                        <span className="rp-bosschip-name">{label(b)}</span>
                                        {p.boss && <span className="rp-strip-no">{p.n}</span>}
                                        {n > 0 && <span className="rp-acard-open">{t("raidBoard.aline.open", { n })}</span>}
                                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                                        {unsaved && <span className="rp-boss-unsaved" aria-hidden="true" />}
                                        {killed && <span className="rp-bosschip-done" aria-hidden="true"><Check size={9} strokeWidth={3.5} /></span>}
                                    </button>
                                    {onSheet && !b.defaults && (
                                        <button
                                            type="button" className="rp-strip-eye" aria-pressed={!inSheet} aria-label={`${label(b)}: ${inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.inAction")}`}
                                            data-tip={inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.notInSheet")} onClick={() => onSheet(b.key, !inSheet)}
                                        >
                                            {inSheet ? <Eye size={14} /> : <EyeOff size={14} />}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Popover>
            )}
            {menu && menuBoss && (
                <ContextMenu x={menu.x} y={menu.y} title={menuBoss.general ? t("raidBoard.assign.general") : menuBoss.trash ? t("raidBoard.assign.trash") : menuBoss.name} items={menuItems()} labelFor={menuLabel} onPick={pickMenu} onClose={() => setMenu(null)} />
            )}
        </nav>
    );
}
