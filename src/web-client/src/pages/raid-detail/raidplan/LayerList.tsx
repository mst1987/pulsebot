import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, RotateCcw, Trash2, Wand2 } from "lucide-react";
import type { RaidplanBoard, RaidplanPlayer } from "../../../api";
import { layerList, patchLook, removeObject, reorderObject, resetAutoPos, type ObjectKind, type Selection } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/**
 * The layers of the board, front to back: every object — tokens, texts, slots,
 * marks, lines, zones — as one row. Click a row to select it; per row show / hide,
 * lock, one step forward / back within its kind, delete. It is the always-visible
 * list of everything on the board, including what is hidden or hard to hit.
 */
export default function LayerList({ board, players, selection, multi = [], canWrite, edit, onSelect, autoRows = [] }: {
    board: RaidplanBoard;
    players: Map<string, RaidplanPlayer>;
    selection: Selection;
    /** every selected object when there are several */
    multi?: { kind: ObjectKind; id: string }[];
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    /** Ctrl / Cmd + click toggles a row, Shift + click takes the rows from the last one to this one. */
    onSelect: (sel: Selection, mods?: { toggle: boolean; range: boolean }) => void;
    /** what the tank rows put on the map (not deletable here: it goes with its row) */
    autoRows?: { id: string; name: string; moved: boolean; hidden?: boolean; lock?: boolean }[];
}) {
    const t = useT();
    const rows = layerList(board, players);
    if (!rows.length && !autoRows.length) return <p className="rp-muted">{t("raidBoard.layers.empty")}</p>;
    const btn = (label: string, icon: JSX.Element, onClick: () => void, extra = "") => (
        <button type="button" className={`rp-layer-btn ${extra}`} aria-label={label} data-tip={label} disabled={!canWrite} onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
    );
    return (
        <ul className="rp-layers" aria-label={t("raidBoard.panel.layers")}>
            {rows.map((r) => {
                const on = (!!selection && selection.kind === r.kind && selection.id === r.id) || multi.some((m) => m.kind === r.kind && m.id === r.id);
                const kind = r.kind as ObjectKind;
                return (
                    <li key={`${r.kind}:${r.id}`} className={`rp-layer${on ? " is-on" : ""}${r.hidden ? " is-hidden" : ""}`} onClick={(e) => onSelect({ kind, id: r.id }, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}>
                        <button type="button" className="rp-layer-name" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onSelect({ kind, id: r.id }, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey }); }}>
                            <span className="rp-layer-kind">{t(`raidBoard.obj.${r.kind}`)}</span>
                            <span className="rp-layer-text">{r.name}</span>
                        </button>
                        {btn(r.hidden ? t("raidBoard.layers.show") : t("raidBoard.layers.hide"), r.hidden ? <EyeOff size={14} /> : <Eye size={14} />, () => edit((b) => patchLook(b, kind, r.id, { hidden: !r.hidden })))}
                        {btn(r.lock ? t("raidBoard.insp.unlock") : t("raidBoard.insp.lock"), r.lock ? <Lock size={14} /> : <LockOpen size={14} />, () => edit((b) => patchLook(b, kind, r.id, { lock: !r.lock })))}
                        {btn(t("raidBoard.layers.up"), <ChevronUp size={14} />, () => edit((b) => reorderObject(b, kind, r.id, "up")))}
                        {btn(t("raidBoard.layers.down"), <ChevronDown size={14} />, () => edit((b) => reorderObject(b, kind, r.id, "down")))}
                        {btn(t("raidBoard.selection.delete"), <Trash2 size={14} />, () => { edit((b) => removeObject(b, kind, r.id)); if (on) onSelect(null); }, "is-danger")}
                    </li>
                );
            })}
            {autoRows.map((r) => {
                const on = !!selection && selection.kind === "auto" && selection.id === r.id;
                return (
                    <li key={`auto:${r.id}`} className={`rp-layer is-auto${on ? " is-on" : ""}${r.hidden ? " is-hidden" : ""}`} onClick={() => onSelect({ kind: "auto", id: r.id })}>
                        <button type="button" className="rp-layer-name" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "auto", id: r.id }); }}>
                            <span className="rp-layer-kind"><Wand2 size={11} aria-hidden="true" /> {t("raidBoard.auto.fromRow")}</span>
                            <span className="rp-layer-text">{r.name}</span>
                        </button>
                        {btn(r.hidden ? t("raidBoard.layers.show") : t("raidBoard.layers.hide"), r.hidden ? <EyeOff size={14} /> : <Eye size={14} />, () => edit((b) => patchLook(b, "auto", r.id, { hidden: !r.hidden })))}
                        {btn(r.lock ? t("raidBoard.insp.unlock") : t("raidBoard.insp.lock"), r.lock ? <Lock size={14} /> : <LockOpen size={14} />, () => edit((b) => patchLook(b, "auto", r.id, { lock: !r.lock })))}
                        {btn(t("raidBoard.layers.up"), <ChevronUp size={14} />, () => edit((b) => reorderObject(b, "auto", r.id, "up")))}
                        {btn(t("raidBoard.layers.down"), <ChevronDown size={14} />, () => edit((b) => reorderObject(b, "auto", r.id, "down")))}
                        {r.moved && btn(t("raidBoard.auto.reset"), <RotateCcw size={14} />, () => edit((b) => resetAutoPos(b, r.id)))}
                    </li>
                );
            })}
        </ul>
    );
}
