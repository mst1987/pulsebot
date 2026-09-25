import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkX, BoxSelect, CircleDashed, CircleUser, Hand, Hash, Link2, Map as MapIcon, Maximize, SlidersHorizontal, Star, Type, Wand2, ZoomIn, ZoomOut } from "lucide-react";
import type { RaidplanBoard } from "../../../api";
import { IconButton } from "../../../components/ui";
import { SliderField } from "../../../components/raidplan/NumberField";
import type { BoardView } from "../../../lib/boardView";
import { SCALE_MAX, SCALE_MIN, setAutoScale, setObjectScale } from "../../../lib/raidplan";
import type { ViewPrefs } from "../../../lib/useViewPrefs";
import { useT } from "../../../i18n";

/** Zoom out / in, the zoom in percent (a click fits the picture again: what the read view shows), the hand tool. */
export function ZoomControls({ view, zoomIn, zoomOut, fit, actual, hand, setHand, canWrite, hasSaved, onSaveView, onClearView }: { view: BoardView; zoomIn: () => void; zoomOut: () => void; fit: () => void; actual: () => void; hand: boolean; setHand: (on: boolean) => void; canWrite: boolean; hasSaved: boolean; onSaveView: () => void; onClearView: () => void }) {
    const t = useT();
    return (
        <div className="rp-tool-group rp-zoom" role="group" aria-label={t("raidBoard.zoom.title")} data-tip={t("raidBoard.zoom.pan")}>
            <IconButton size="sm" icon={<ZoomOut size={17} />} tip={t("raidBoard.zoom.out")} onClick={zoomOut} />
            <button type="button" className={`rp-zoom-pct${view.z !== 1 ? " is-on" : ""}`} data-tip={t("raidBoard.zoom.fitTip")} aria-label={t("raidBoard.zoom.fit")} onClick={fit}>{Math.round(view.z * 100)} %</button>
            <IconButton size="sm" icon={<ZoomIn size={17} />} tip={t("raidBoard.zoom.in")} onClick={zoomIn} />
            <IconButton size="sm" icon={<Maximize size={17} />} tip={t("raidBoard.zoom.fit")} onClick={fit} />
            <button type="button" className="rp-zoom-pct" data-tip={t("raidBoard.zoom.actualTip")} aria-label={t("raidBoard.zoom.actual")} onClick={actual}>{t("raidBoard.zoom.actual")}</button>
            <IconButton size="sm" icon={<Hand size={17} />} tip={t("raidBoard.zoom.hand")} aria-pressed={hand} className={hand ? "is-on" : ""} onClick={() => setHand(!hand)} />
            <IconButton size="sm" icon={<Bookmark size={17} />} tip={t("raidBoard.zoom.saveView")} disabled={!canWrite || !(view.z > 1)} onClick={onSaveView} />
            <IconButton size="sm" icon={<BookmarkX size={17} />} tip={t("raidBoard.zoom.clearView")} disabled={!canWrite || !hasSaved} onClick={onClearView} />
        </div>
    );
}

/** The symbol size (tokens, slot icons, marks, boss / mob icons and the names with them) and what the board shows besides the icons. Stored on the board, so the read view looks the same. */
export function ViewOptions({ board, canWrite, edit, prefs, setPref, links, onLinks }: { board: RaidplanBoard; canWrite: boolean; edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void; prefs: ViewPrefs; setPref: (p: Partial<ViewPrefs>) => void; links: boolean; onLinks: (on: boolean) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", esc);
        return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
    }, [open]);
    const flag = (key: "showNames" | "showBadges" | "showRoleRings" | "showRings" | "autoPlace", label: string, icon: JSX.Element) => (
        <label className="rp-check rp-view-row"><input type="checkbox" checked={board[key] !== false} disabled={!canWrite} onChange={(e) => edit((b) => ({ ...b, [key]: e.target.checked }))} />{icon}{label}</label>
    );
    const local = (label: string, on: boolean, set: (v: boolean) => void, icon: JSX.Element) => (
        <label className="rp-check rp-view-row"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{icon}{label}</label>
    );
    return (
        <div className="rp-viewopts" ref={box}>
            <IconButton size="sm" icon={<SlidersHorizontal size={17} />} tip={t("raidBoard.view.title")} aria-expanded={open} aria-haspopup="dialog" className={open || board.objectScale !== 1 ? "is-on" : ""} onClick={() => setOpen((v) => !v)} />
            {open && (
                <div className="rp-viewopts-pop" role="dialog" aria-label={t("raidBoard.view.title")}>
                    <SliderField label={t("raidBoard.view.iconSize")} value={Math.round(board.objectScale * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} step={5} unit="%" disabled={!canWrite} onChange={(v) => canWrite && edit((b) => setObjectScale(b, v / 100), true)} />
                    <button type="button" className="rp-link" disabled={!canWrite || board.objectScale === 1} onClick={() => edit((b) => setObjectScale(b, 1))}>{t("raidBoard.view.reset")}</button>
                    <span className="rp-muted">{t("raidBoard.view.iconSizeHint")}</span>
                    <span className="rp-kicker">{t("raidBoard.view.planHead")}</span>
                    {flag("showNames", t("raidBoard.view.names"), <Type size={15} aria-hidden="true" />)}
                    {flag("showBadges", t("raidBoard.view.badges"), <Hash size={15} aria-hidden="true" />)}
                    {flag("showRoleRings", t("raidBoard.view.roleRings"), <CircleUser size={15} aria-hidden="true" />)}
                    {flag("showRings", t("raidBoard.view.groupRings"), <CircleDashed size={15} aria-hidden="true" />)}
                    {flag("autoPlace", t("raidBoard.auto.place"), <Wand2 size={15} aria-hidden="true" />)}
                    {board.autoPlace !== false && <SliderField label={t("raidBoard.auto.scale")} value={Math.round((board.autoScale || 1) * 100)} min={40} max={200} step={5} unit="%" disabled={!canWrite} onChange={(v) => canWrite && edit((b) => setAutoScale(b, v / 100), true)} />}
                    <span className="rp-kicker" data-tip={t("raidBoard.view.forMe")}>{t("raidBoard.view.localHead")}</span>
                    {local(t("raidBoard.view.mine"), prefs.highlight, (v) => setPref({ highlight: v }), <Star size={15} aria-hidden="true" />)}
                    {local(t("raidBoard.view.selection"), prefs.selection, (v) => setPref({ selection: v }), <BoxSelect size={15} aria-hidden="true" />)}
                    {local(t("raidBoard.view.links"), links, onLinks, <Link2 size={15} aria-hidden="true" />)}
                    {local(t("raidBoard.view.minimap"), prefs.minimap, (v) => setPref({ minimap: v }), <MapIcon size={15} aria-hidden="true" />)}
                </div>
            )}
        </div>
    );
}

/** The read view's small view menu: what one viewer wants to see (remembered in this browser); it can only hide more than the plan shows. */
export function SheetViewMenu({ prefs, setPref, hasLinks }: { prefs: ViewPrefs; setPref: (p: Partial<ViewPrefs>) => void; hasLinks: boolean }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", esc);
        return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
    }, [open]);
    const row = (label: string, on: boolean, set: (v: boolean) => void, icon: JSX.Element) => (
        <label className="rp-check rp-view-row"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{icon}{label}</label>
    );
    return (
        <span className="rp-sheetview" ref={box}>
            <button type="button" aria-label={t("raidBoard.view.menu")} aria-expanded={open} aria-haspopup="dialog" data-tip={t("raidBoard.view.menu")} onClick={() => setOpen((v) => !v)}><SlidersHorizontal size={16} /></button>
            {open && (
                <div className="rp-viewopts-pop rp-sheetview-pop" role="dialog" aria-label={t("raidBoard.view.menu")}>
                    <span className="rp-kicker">{t("raidBoard.view.menu")}</span>
                    {row(t("raidBoard.view.names"), prefs.names, (v) => setPref({ names: v }), <Type size={15} aria-hidden="true" />)}
                    {row(t("raidBoard.view.roleRings"), prefs.roleRings, (v) => setPref({ roleRings: v }), <CircleUser size={15} aria-hidden="true" />)}
                    {row(t("raidBoard.view.groupRings"), prefs.groupRings, (v) => setPref({ groupRings: v }), <CircleDashed size={15} aria-hidden="true" />)}
                    {row(t("raidBoard.view.mine"), prefs.highlight, (v) => setPref({ highlight: v }), <Star size={15} aria-hidden="true" />)}
                    {row(t("raidBoard.view.minimap"), prefs.minimap, (v) => setPref({ minimap: v }), <MapIcon size={15} aria-hidden="true" />)}
                    {hasLinks && row(t("raidBoard.view.links"), prefs.links, (v) => setPref({ links: v }), <Link2 size={15} aria-hidden="true" />)}
                    <span className="rp-muted">{t("raidBoard.view.forMe")}</span>
                </div>
            )}
        </span>
    );
}
