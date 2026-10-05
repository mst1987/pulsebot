import type { ReactNode } from "react";
import { Bookmark, BookmarkX, BoxSelect, Circle, Eye, Image as ImageIcon, ImageOff, LayoutGrid, ListChecks, Minus, MoveUpRight, PanelRight, Redo2, Shapes, Square, Type, Undo2, Users } from "lucide-react";
import type { RaidplanBoard } from "../../../../api";
import { IconButton, Switch } from "../../../../components/ui";
import RoleGlyph from "../../../../components/raidplan/RoleGlyph";
import { useT } from "../../../../i18n";
import { savedView, viewFromSaved } from "../../../../lib/raidplan/boardView";
import type { useBoardView } from "../../../../hooks/useBoardView";
import type { useViewPrefs } from "../../../../hooks/useViewPrefs";
import type { InsertSpec, MapSize } from "../../../../lib/raidplan";
import { ViewOptions, ZoomControls } from "../ViewControls";
import ToolMenu, { type ToolItem } from "../ToolMenu";

type Toggle = { on: boolean; toggle: () => void };

/**
 * The tool row of the view "Karte" (Oct 2026): ONE labelled row instead of the icon strip. "Zeichnen ▾" (arrow, line, text),
 * "Formen ▾" (rectangle, ellipse, the melee and ranged areas), "Ansicht ▾" (the elements palette, the Besetzung, selection mode, the
 * sheet preview, the roster dialog, the map on / off - above the board's own view options), the zoom, the map's size S / M / L,
 * then undo / redo and "Eigenschaften" (properties, layers and background beside the board). Every icon of the old strip is here.
 */
export function MapToolRow({ canWrite, history, onInsert, palette, selectMode, bes, panel, preview, onRoster, board, edit, noMap, mapOff, onMapOff, bv, prefs, setPref, links, onLinks, mapSize, chooseMapSize }: {
    canWrite: boolean;
    history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
    onInsert: (spec: InsertSpec) => void;
    palette: Toggle;
    selectMode: Toggle;
    bes: Toggle;
    panel: Toggle;
    preview: Toggle;
    onRoster: () => void;
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    /** the map is switched off for this section: no drawing, no zoom */
    noMap: boolean;
    mapOff: boolean;
    onMapOff: (off: boolean) => void;
    bv: ReturnType<typeof useBoardView>;
    prefs: ReturnType<typeof useViewPrefs>[0];
    setPref: ReturnType<typeof useViewPrefs>[1];
    links: boolean;
    onLinks: (on: boolean) => void;
    mapSize: MapSize;
    chooseMapSize: (size: MapSize) => void;
}) {
    const t = useT();
    const item = (id: string, spec: InsertSpec, label: string, icon: ReactNode): ToolItem => ({ id, label, icon, disabled: !canWrite, onSelect: () => onInsert(spec) });
    const draw = [
        item("arrow", { type: "line", kind: "arrow" }, t("raidBoard.line.arrow"), <MoveUpRight size={16} />),
        item("line", { type: "line", kind: "line" }, t("raidBoard.line.line"), <Minus size={16} />),
        item("text", { type: "text", text: t("raidBoard.text.default") }, t("raidBoard.tool.text"), <Type size={16} />),
    ];
    const shapes = [
        item("rect", { type: "zone", zoneType: "neutral", shape: "rect" }, t("raidBoard.zone.rect"), <Square size={16} />),
        item("ellipse", { type: "zone", zoneType: "neutral", shape: "ellipse" }, t("raidBoard.zone.ellipse"), <Circle size={16} />),
        item("melee", { type: "zone", zoneType: "role", shape: "ellipse", role: "melee" }, t("raidBoard.roleGroup.melee"), <RoleGlyph role="melee" size={18} />),
        item("ranged", { type: "zone", zoneType: "role", shape: "ellipse", role: "ranged" }, t("raidBoard.roleGroup.ranged"), <RoleGlyph role="ranged" size={18} />),
    ];
    // the saved cutout the sheet opens this section with (behind "Ansicht ▾", with their names)
    const saveView = () => edit((b) => ({ ...b, view: savedView(bv.view) }));
    const clearView = () => { edit((b) => ({ ...b, view: null })); bv.fit(); };
    const check = (label: string, on: boolean, flip: () => void, icon: ReactNode, disabled = false) => (
        <Switch className="rp-check rp-view-row" checked={on} disabled={disabled} onChange={flip} label={<>{icon}{label}</>} />
    );
    const extra = (
        <>
            <span className="rp-kicker">{t("raidBoard.views.workHead")}</span>
            {!noMap && check(t("raidBoard.views.palette"), palette.on, palette.toggle, <LayoutGrid size={15} aria-hidden="true" />, !canWrite)}
            {check(t("raidBoard.views.bes"), bes.on, bes.toggle, <Users size={15} aria-hidden="true" />)}
            {!noMap && check(t("raidBoard.views.select"), selectMode.on, selectMode.toggle, <BoxSelect size={15} aria-hidden="true" />, !canWrite)}
            {!noMap && check(t("raidBoard.views.preview"), preview.on, preview.toggle, <Eye size={15} aria-hidden="true" />)}
            {check(t("raidBoard.views.showMap"), !mapOff, () => onMapOff(!mapOff), mapOff ? <ImageOff size={15} aria-hidden="true" /> : <ImageIcon size={15} aria-hidden="true" />, !canWrite)}
            <button type="button" className="rp-link rp-view-row" onClick={onRoster}><ListChecks size={15} aria-hidden="true" />{t("raidBoard.roster.title")}</button>
            {!noMap && (
                <>
                    <button type="button" className="rp-link rp-view-row" disabled={!canWrite || !(bv.view.z > 1)} data-tip={t("raidBoard.views.saveViewHint")} onClick={saveView}><Bookmark size={15} aria-hidden="true" />{t("raidBoard.zoom.saveView")}</button>
                    <button type="button" className="rp-link rp-view-row" disabled={!canWrite || !board.view} onClick={clearView}><BookmarkX size={15} aria-hidden="true" />{t("raidBoard.zoom.clearView")}</button>
                </>
            )}
        </>
    );
    return (
        <div className="rp-toolbar2 rp-maptools" role="toolbar" aria-label={t("raidBoard.tool.label")}>
            {!noMap && <ToolMenu label={t("raidBoard.views.draw")} icon={<MoveUpRight size={15} aria-hidden="true" />} items={draw} tip={t("raidBoard.views.draw")} tipSub={t("raidBoard.views.drawSub")} disabled={!canWrite} />}
            {!noMap && <ToolMenu label={t("raidBoard.views.shapes")} icon={<Shapes size={15} aria-hidden="true" />} items={shapes} tip={t("raidBoard.views.shapes")} tipSub={t("raidBoard.views.shapesSub")} disabled={!canWrite} />}
            <ViewOptions board={board} canWrite={canWrite} edit={edit} prefs={prefs} setPref={setPref} links={links} onLinks={onLinks} label={t("raidBoard.view.menu")} extra={extra} />
            {!noMap && (
                <>
                    <span className="rp-tool-sep" aria-hidden="true" />
                    <span className="rp-tool-kicker" aria-hidden="true">{t("raidBoard.zoom.title")}</span>
                    <ZoomControls view={bv.view} zoomIn={bv.zoomIn} zoomOut={bv.zoomOut} fit={bv.fit} actual={bv.actual} hand={bv.hand} setHand={bv.setHand} canWrite={canWrite} hasSaved={!!board.view} onSaveView={saveView} onClearView={clearView} sheetView={viewFromSaved(board.view)} onSheetView={() => bv.set(viewFromSaved(board.view))} bookmarks={false} />
                    <span className="rp-tool-sep" aria-hidden="true" />
                    <span className="rp-tool-kicker" aria-hidden="true">{t("raidBoard.views.size")}</span>
                    <div className="rp-tool-group rp-mapsize" role="group" aria-label={t("raidBoard.split.size")}>
                        {["S", "M", "L"].map((k) => (
                            <button key={k} type="button" className={`rp-mapsize-btn${mapSize.step === k ? " is-on" : ""}`} aria-pressed={mapSize.step === k} data-tip={t(`raidBoard.split.step${k}`)} onClick={() => chooseMapSize({ step: k as "S" | "M" | "L", px: 0 })}>{k}</button>
                        ))}
                    </div>
                </>
            )}
            <div className="rp-tool-group rp-maptools-end">
                <IconButton size="sm" icon={<Undo2 size={17} />} tip={`${t("raidBoard.tool.undo")} (Ctrl+Z)`} disabled={!canWrite || !history.canUndo} onClick={history.undo} />
                <IconButton size="sm" icon={<Redo2 size={17} />} tip={`${t("raidBoard.tool.redo")} (Ctrl+Y)`} disabled={!canWrite || !history.canRedo} onClick={history.redo} />
                {!noMap && (
                    <button type="button" className={`btn btn-ghost btn-sm rp-props-btn${panel.on ? " is-on" : ""}`} aria-pressed={panel.on} data-tip={t("raidBoard.views.propsTip")} onClick={panel.toggle}>
                        <PanelRight size={15} aria-hidden="true" /><span>{t("raidBoard.panel.props")}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
