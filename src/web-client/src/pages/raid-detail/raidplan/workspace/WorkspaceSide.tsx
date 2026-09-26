import type { PointerEvent, RefObject } from "react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../../api";
import { PlayerName, TokenIcon } from "../../../../components/raidplan/PlanBoard";
import { useT } from "../../../../i18n";
import type { AutoPlan } from "../../../../lib/autoPlace";
import type { SelItem } from "../../../../lib/multiSelect";
import { autoStyleOf, rhNote, type Selection } from "../../../../lib/raidplan";
import AutoInfo from "../AutoInfo";
import Inspector, { MapOpacityField, ObjectScaleField } from "../Inspector";
import LayerList from "../LayerList";
import MapPanel, { type MapRow } from "../MapPanel";
import type { tankRowActions } from "./tankRows";

export type DockTab = "props" | "layers" | "bg";

/**
 * The column beside the board: the players not placed yet (an event plan; a
 * drop target for taking one off the map) and the dock with the properties of
 * the selection, the layer list and the background.
 */
export function WorkspaceSide({ isEvent, showPanel, roster, missing, overTray, canWrite, onTrayDown, panelRef, tab, setTab, board, edit, editAll, withAuto, noAuto, boardPx, players, selected, setSelected, multi, auto, rows, focusGroup, setFocusGroup, onLayerSelect, tanks, mapRows, onMapsChanged }: {
    isEvent: boolean;
    showPanel: boolean;
    roster: RaidplanPlayer[];
    /** the players nobody placed yet */
    missing: RaidplanPlayer[];
    /** a dragged object is over the list */
    overTray: boolean;
    canWrite: boolean;
    onTrayDown: (e: PointerEvent<HTMLElement>, userId: string) => void;
    panelRef: RefObject<HTMLElement>;
    tab: DockTab;
    setTab: (tab: DockTab) => void;
    board: RaidplanBoard;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    editAll: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    noAuto: (b: RaidplanBoard) => RaidplanBoard;
    boardPx: () => { w: number; h: number };
    players: Map<string, RaidplanPlayer>;
    selected: Selection;
    setSelected: (sel: Selection) => void;
    multi: SelItem[];
    auto: AutoPlan;
    /** the section's effective rows */
    rows: RaidplanAssignment[];
    focusGroup: number;
    setFocusGroup: (group: number) => void;
    onLayerSelect: (sel: Selection, mods?: { toggle: boolean; range: boolean }) => void;
    tanks: ReturnType<typeof tankRowActions>;
    mapRows: MapRow[];
    onMapsChanged: () => void;
}) {
    const t = useT();
    const autoSel = !!selected && selected.kind === "auto" && multi.length < 2;
    return (
        <div className="rp-side">
            {isEvent && (
                <section className={`rp-tray${overTray ? " is-over" : ""}`} data-rp-tray aria-label={t("raidBoard.tray.title")}>
                    <span className="rp-kicker">{t("raidBoard.tray.title")} · {missing.length}</span>
                    {roster.length === 0 && <span className="rp-muted">{t("raidBoard.tray.none")}</span>}
                    {roster.length > 0 && missing.length === 0 && <span className="rp-muted">{t("raidBoard.tray.empty")}</span>}
                    <div className="rp-tray-list">
                        {missing.map((p) => (
                            <span
                                key={p.userId}
                                className={`rp-chip${canWrite ? " is-drag" : ""}`}
                                data-tip={[`${p.specLabel} ${p.className}`.trim(), rhNote(p)].filter(Boolean).join(" · ")}
                                onPointerDown={canWrite ? (e) => onTrayDown(e, p.userId) : undefined}
                            >
                                <TokenIcon player={p} size="sm" />
                                <PlayerName player={p} />
                            </span>
                        ))}
                    </div>
                </section>
            )}
            {showPanel && (
                <aside className="rp-dock" ref={panelRef} aria-label={t("raidBoard.panel.props")}>
                    <div className="rp-dock-tabs" role="tablist">
                        <button type="button" role="tab" aria-selected={tab === "props"} className={tab === "props" ? "is-on" : ""} onClick={() => setTab("props")}>{t("raidBoard.panel.props")}</button>
                        <button type="button" role="tab" aria-selected={tab === "layers"} className={tab === "layers" ? "is-on" : ""} onClick={() => setTab("layers")}>{t("raidBoard.panel.layers")}</button>
                        <button type="button" role="tab" aria-selected={tab === "bg"} className={tab === "bg" ? "is-on" : ""} onClick={() => setTab("bg")}>{t("raidBoard.panel.background")}</button>
                    </div>
                    {tab === "props" && autoSel && <AutoInfo plan={auto} id={selected!.id} board={board} players={players} canWrite={canWrite} edit={edit} onRow={(k, mobKey) => (k ? tanks.openRowFromMap(k.rowId) : tanks.pickTankFor(mobKey, null))} />}
                    {tab === "props" && !autoSel && <Inspector board={withAuto(board)} selection={selected} multi={multi} boardPx={boardPx} players={players} roster={roster} isEvent={isEvent} canWrite={canWrite} edit={(fn, m) => edit((b) => noAuto(fn(withAuto(b))), m)} editAll={editAll} rows={rows} onSelect={setSelected} focusGroup={focusGroup} onFocusGroup={setFocusGroup} />}
                    {tab === "layers" && <LayerList board={board} players={players} selection={selected} multi={multi} canWrite={canWrite} edit={edit} onSelect={onLayerSelect} autoRows={[...auto.mobs.filter((m) => !m.iconId).map((m) => m.key), ...auto.tanks.filter((k) => !k.existing).map((k) => k.key)].map((key) => ({ id: key, name: tanks.autoName(key), moved: !!(board.autoPos || {})[key], hidden: !!autoStyleOf(board, key).hidden, lock: !!autoStyleOf(board, key).lock }))} />}
                    {tab === "bg" && (
                        <div className="rp-bg">
                            <MapOpacityField board={board} canWrite={canWrite} edit={edit} />
                            <ObjectScaleField board={board} canWrite={canWrite} edit={edit} />
                            <MapPanel rows={mapRows} canWrite={canWrite} onChanged={onMapsChanged} />
                        </div>
                    )}
                </aside>
            )}
        </div>
    );
}
