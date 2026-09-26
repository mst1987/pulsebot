import type { ReactNode } from "react";
import { Eye, BoxSelect, Circle, CircleDashed, Image as ImageIcon, ImageOff, ListChecks, Minus, MoveUpRight, PanelLeft, PanelRight, Redo2, Square, Type, Undo2, Users } from "lucide-react";
import type { RaidplanBoard } from "../../../../api";
import { IconButton } from "../../../../components/ui";
import WowIcon from "../../../../components/ui/WowIcon";
import { useT } from "../../../../i18n";
import { savedView, viewFromSaved } from "../../../../lib/raidplan/boardView";
import type { useBoardView } from "../../../../hooks/useBoardView";
import type { useViewPrefs } from "../../../../hooks/useViewPrefs";
import type { InsertSpec, MapSize } from "../../../../lib/raidplan";
import { ViewOptions, ZoomControls } from "../ViewControls";

type Toggle = { on: boolean; toggle: () => void };

/**
 * The working area's sticky tool bar: undo / redo, the quick inserts, what is
 * shown (palette, roster, rings, selection mode, Besetzung, panel, map,
 * preview), zoom and view, the map's height, then the parent's status and
 * actions; the unsaved strip above it and the boss chips below.
 */
export function WorkspaceToolbar({ canWrite, saveState, notice, history, onInsert, palette, selectMode, bes, panel, preview, onRoster, board, edit, noBoard, noMap, mapOff, onMapOff, bv, prefs, setPref, links, onLinks, mapSize, chooseMapSize, status, actions, bossNav }: {
    canWrite: boolean;
    saveState?: "clean" | "dirty" | "conflict";
    notice?: ReactNode;
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
    noBoard: boolean;
    noMap: boolean;
    mapOff: boolean;
    /** the map switched off or on again */
    onMapOff: (off: boolean) => void;
    bv: ReturnType<typeof useBoardView>;
    prefs: ReturnType<typeof useViewPrefs>[0];
    setPref: ReturnType<typeof useViewPrefs>[1];
    links: boolean;
    onLinks: (on: boolean) => void;
    mapSize: MapSize;
    chooseMapSize: (size: MapSize) => void;
    status?: ReactNode;
    actions?: ReactNode;
    bossNav: ReactNode;
}) {
    const t = useT();
    const quick = (spec: InsertSpec, label: string, icon: ReactNode) => (
        <IconButton size="sm" icon={icon} tip={label} disabled={!canWrite} onClick={() => onInsert(spec)} />
    );
    return (
        <div className={`rp-sticky${saveState && saveState !== "clean" ? ` is-${saveState}` : ""}`}>
            {notice}
            <div className="rp-toolbar2" role="toolbar" aria-label={t("raidBoard.tool.label")}>
                <div className="rp-tool-group">
                    <IconButton size="sm" icon={<Undo2 size={17} />} tip={`${t("raidBoard.tool.undo")} (Ctrl+Z)`} disabled={!canWrite || !history.canUndo} onClick={history.undo} />
                    <IconButton size="sm" icon={<Redo2 size={17} />} tip={`${t("raidBoard.tool.redo")} (Ctrl+Y)`} disabled={!canWrite || !history.canRedo} onClick={history.redo} />
                </div>
                <span className="rp-tool-sep" aria-hidden="true" />
                <div className="rp-tool-group">
                    {quick({ type: "line", kind: "arrow" }, t("raidBoard.line.arrow"), <MoveUpRight size={17} />)}
                    {quick({ type: "line", kind: "line" }, t("raidBoard.line.line"), <Minus size={17} />)}
                    {quick({ type: "text", text: t("raidBoard.text.default") }, t("raidBoard.tool.text"), <Type size={17} />)}
                    {quick({ type: "zone", zoneType: "neutral", shape: "rect" }, t("raidBoard.zone.rect"), <Square size={17} />)}
                    {quick({ type: "zone", zoneType: "neutral", shape: "ellipse" }, t("raidBoard.zone.ellipse"), <Circle size={17} />)}
                    {quick({ type: "zone", zoneType: "role", shape: "ellipse", role: "melee" }, t("raidBoard.roleGroup.melee"), <WowIcon name="ability_dualwield" size={17} />)}
                    {quick({ type: "zone", zoneType: "role", shape: "ellipse", role: "ranged" }, t("raidBoard.roleGroup.ranged"), <WowIcon name="inv_weapon_bow_07" size={17} />)}
                </div>
                <span className="rp-tool-sep" aria-hidden="true" />
                <div className="rp-tool-group">
                    <IconButton size="sm" icon={<PanelLeft size={17} />} tip={t("raidBoard.tool.palette")} aria-pressed={palette.on} className={palette.on ? "is-on" : ""} onClick={palette.toggle} />
                    {!noBoard && <IconButton size="sm" icon={<ListChecks size={17} />} tip={t("raidBoard.roster.title")} onClick={onRoster} />}
                    {!noMap && <IconButton size="sm" icon={<CircleDashed size={17} />} tip={t("raidBoard.tool.rings")} aria-pressed={board.showRings !== false} className={board.showRings !== false ? "is-on" : ""} disabled={!canWrite} onClick={() => edit((b) => ({ ...b, showRings: b.showRings === false }))} />}
                    <IconButton size="sm" icon={<BoxSelect size={17} />} tip={t("raidBoard.tool.select")} aria-pressed={selectMode.on} className={selectMode.on ? "is-on" : ""} disabled={!canWrite} onClick={selectMode.toggle} />
                    <IconButton size="sm" icon={<Users size={17} />} tip={t("raidBoard.tool.bes")} aria-pressed={bes.on} className={bes.on ? "is-on" : ""} onClick={bes.toggle} />
                    <IconButton size="sm" icon={<PanelRight size={17} />} tip={t("raidBoard.tool.panel")} aria-pressed={panel.on} className={panel.on ? "is-on" : ""} onClick={panel.toggle} />
                </div>
                {!noBoard && <IconButton size="sm" icon={mapOff ? <ImageOff size={17} /> : <ImageIcon size={17} />} tip={mapOff ? t("raidBoard.map.show") : t("raidBoard.map.hide")} aria-pressed={!mapOff} className={mapOff ? "" : "is-on"} disabled={!canWrite} onClick={() => onMapOff(!mapOff)} />}
                {!noMap && <IconButton size="sm" icon={<Eye size={17} />} tip={t("raidBoard.tool.preview")} aria-pressed={preview.on} className={preview.on ? "is-on" : ""} onClick={preview.toggle} />}
                {!noMap && <ZoomControls view={bv.view} zoomIn={bv.zoomIn} zoomOut={bv.zoomOut} fit={bv.fit} actual={bv.actual} hand={bv.hand} setHand={bv.setHand} canWrite={canWrite} hasSaved={!!board.view} onSaveView={() => edit((b) => ({ ...b, view: savedView(bv.view) }))} onClearView={() => { edit((b) => ({ ...b, view: null })); bv.fit(); }} sheetView={viewFromSaved(board.view)} onSheetView={() => bv.set(viewFromSaved(board.view))} />}
                {!noMap && <ViewOptions board={board} canWrite={canWrite} edit={edit} prefs={prefs} setPref={setPref} links={links} onLinks={onLinks} />}
                {!noMap && (
                    <div className="rp-tool-group rp-mapsize" role="group" aria-label={t("raidBoard.split.size")}>
                        {["S", "M", "L"].map((k) => (
                            <button key={k} type="button" className={`rp-mapsize-btn${mapSize.step === k ? " is-on" : ""}`} aria-pressed={mapSize.step === k} data-tip={t(`raidBoard.split.step${k}`)} onClick={() => chooseMapSize({ step: k as "S" | "M" | "L", px: 0 })}>{k}</button>
                        ))}
                    </div>
                )}
                <div className="rp-tool-status">{status}</div>
                <div className="rp-tool-group rp-tool-actions">{actions}</div>
            </div>
            {bossNav}
        </div>
    );
}
