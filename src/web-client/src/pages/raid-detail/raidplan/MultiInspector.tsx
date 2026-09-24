import { useEffect, useRef } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, BringToFront, Copy, SendToBack, Trash2 } from "lucide-react";
import type { RaidplanBoard } from "../../../api";
import { IconButton } from "../../../components/ui";
import { SliderField } from "../../../components/raidplan/NumberField";
import { alignSelection, deleteSelection, duplicateSelection, lookSummary, reorderSelection, scaleSelection, selectionBox, setLookSelection, type BoardPx, type SelItem } from "../../../lib/multiSelect";
import { clampOpacity } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/** A checkbox that can say "mixed" (some of the selection have it, some not). */
function TriCheck({ label, value, disabled, onChange }: { label: string; value: boolean | null; disabled: boolean; onChange: (v: boolean) => void }) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = value === null; }, [value]);
    return (
        <label className="rp-check">
            <input ref={ref} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
        </label>
    );
}

/**
 * What a selection of several objects shares: the count, the opacity (a mixed value says "gemischt"), lock and hide, the
 * size in steps, aligning, and the actions. Everything is one undo step (lib/multiSelect.ts); nothing single is shown.
 */
export default function MultiInspector({ board, sel, px, canWrite, edit }: {
    board: RaidplanBoard;
    sel: SelItem[];
    px: BoardPx;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
}) {
    const t = useT();
    const sum = lookSummary(board, sel);
    const dis = !canWrite;
    const box = selectionBox(board, sel, px);
    const center = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0.5, y: 0.5 };
    const btn = (label: string, icon: JSX.Element, fn: () => void, danger = false) => (
        <IconButton size="sm" tone={danger ? "danger" : undefined} icon={icon} tip={label} disabled={dis} onClick={fn} />
    );
    return (
        <div className="rp-insp rp-multi-insp" role="group" aria-label={t("raidBoard.multi.count", { n: sel.length })}>
            <div className="rp-insp-head">
                <strong className="rp-insp-name">{t("raidBoard.multi.count", { n: sel.length })}</strong>
            </div>
            <SliderField
                label={sum.opacity === null ? `${t("raidBoard.insp.opacity")} (${t("raidBoard.multi.mixed")})` : t("raidBoard.insp.opacity")} value={sum.opacity === null ? 100 : Math.round(sum.opacity * 100)} min={10} max={100} step={5} unit="%" disabled={dis}
                onChange={(v) => edit((b) => setLookSelection(b, sel, { opacity: clampOpacity(v / 100, 1) }), true)}
            />
            <div className="rp-field">
                <span className="rp-kicker">{t("raidBoard.insp.size")}</span>
                <div className="rp-insp-actions">
                    <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => scaleSelection(b, sel, 1 / 1.1, center), true)}>−10 %</button>
                    <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => scaleSelection(b, sel, 1.1, center), true)}>+10 %</button>
                </div>
            </div>
            <TriCheck label={t("raidBoard.insp.lock")} value={sum.lock} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { lock: v }))} />
            <TriCheck label={t("raidBoard.multi.hide")} value={sum.hidden} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { hidden: v }))} />
            <div className="rp-field">
                <span className="rp-kicker">{t("raidBoard.multi.align")}</span>
                <div className="rp-insp-actions">
                    {btn(t("raidBoard.ctx.m_alignLeft"), <AlignStartVertical size={15} />, () => edit((b) => alignSelection(b, sel, "left", px)))}
                    {btn(t("raidBoard.ctx.m_alignCenterH"), <AlignCenterVertical size={15} />, () => edit((b) => alignSelection(b, sel, "centerH", px)))}
                    {btn(t("raidBoard.ctx.m_alignRight"), <AlignEndVertical size={15} />, () => edit((b) => alignSelection(b, sel, "right", px)))}
                    {btn(t("raidBoard.ctx.m_alignTop"), <AlignStartHorizontal size={15} />, () => edit((b) => alignSelection(b, sel, "top", px)))}
                    {btn(t("raidBoard.ctx.m_alignCenterV"), <AlignCenterHorizontal size={15} />, () => edit((b) => alignSelection(b, sel, "centerV", px)))}
                    {btn(t("raidBoard.ctx.m_alignBottom"), <AlignEndHorizontal size={15} />, () => edit((b) => alignSelection(b, sel, "bottom", px)))}
                    {btn(t("raidBoard.ctx.m_distH"), <AlignHorizontalSpaceBetween size={15} />, () => edit((b) => alignSelection(b, sel, "distH", px)))}
                    {btn(t("raidBoard.ctx.m_distV"), <AlignVerticalSpaceBetween size={15} />, () => edit((b) => alignSelection(b, sel, "distV", px)))}
                </div>
            </div>
            <div className="rp-insp-actions">
                {btn(t("raidBoard.ctx.m_duplicate"), <Copy size={15} />, () => edit((b) => duplicateSelection(b, sel).board))}
                {btn(t("raidBoard.ctx.front"), <BringToFront size={15} />, () => edit((b) => reorderSelection(b, sel, "front")))}
                {btn(t("raidBoard.ctx.back"), <SendToBack size={15} />, () => edit((b) => reorderSelection(b, sel, "back")))}
                {btn(t("raidBoard.selection.delete"), <Trash2 size={15} />, () => edit((b) => deleteSelection(b, sel)), true)}
            </div>
            <p className="rp-muted">{t("raidBoard.multi.hint")}</p>
        </div>
    );
}
