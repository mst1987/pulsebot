import { useEffect, useRef } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, BringToFront, Copy, SendToBack, Trash2 } from "lucide-react";
import type { RaidplanBoard } from "../../../api";
import { IconButton } from "../../../components/ui";
import { NumberField, SliderField } from "../../../components/raidplan/NumberField";
import { alignSelection, resizeSelection, deleteSelection, duplicateSelection, lookSummary, optionSummary, patchArrowSelection, reorderSelection, roleZoneSummary, roleZonesOf, scaleSelection, setColorSelection, setFacingSelection, setRingSelection, setRoleZoneSelection, selectionBox, setLookSelection, sharedOptions, type BoardPx, type SelItem } from "../../../lib/multiSelect";
import { ARROW_COLOR, ARROW_MAX, ARROW_MIN, COMPASS, COMPASS_NAMES, LABEL_POS, clampOpacity } from "../../../lib/raidplan";
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

const COMPASS_ARROWS = ["\u2191", "\u2197", "\u2192", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196"];

/**
 * What a selection of several objects shares: the count, the opacity (a mixed value says "gemischt"), lock and hide, the
 * size in steps, aligning, and the actions - plus every option ALL of them have (lib/multiSelect.ts sharedOptions): ring, name, colour,
 * and for boss / mob icons the facing target and the arrow. A value all agree on is shown, else "gemischt"; a change goes to every one of
 * them and is one undo step. Nothing single is shown.
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
    const has = sharedOptions(board, sel);
    const opt = optionSummary(board, sel);
    const mixed = (label: string, v: unknown) => (v === null ? `${label} (${t("raidBoard.multi.mixed")})` : label);
    // only role groups selected: their angle, their symbol's scale and their label's place, for all of them at once
    const roles = roleZonesOf(board, sel).length > 0 ? roleZoneSummary(board, sel) : null;
    const dis = !canWrite;
    const box = selectionBox(board, sel, px);
    const groups = board.slots.filter((s) => s.kind === "group" && sel.some((it) => it.kind === "slot" && it.id === s.id));
    const center = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0.5, y: 0.5 };
    const btn = (label: string, icon: JSX.Element, fn: () => void, danger = false) => (
        <IconButton size="sm" tone={danger ? "danger" : undefined} icon={icon} tip={label} disabled={dis} onClick={fn} />
    );
    return (
        <div className="rp-insp rp-multi-insp" role="group" aria-label={t("raidBoard.multi.count", { n: sel.length })}>
            <div className="rp-insp-head">
                <strong className="rp-insp-name">{t("raidBoard.multi.count", { n: sel.length })}</strong>
            </div>
            <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.relative")}</span><NumberField label={t("raidBoard.insp.relative")} value={100} min={25} max={400} unit="%" disabled={dis} onChange={(v) => v !== 100 && edit((b) => resizeSelection(b, sel, v / 100))} /></label>
            <span className="rp-muted">{t("raidBoard.insp.relativeHint")}</span>
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
            {has.ring && <TriCheck label={t("raidBoard.multi.ring")} value={opt.ring} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { ring: v }))} />}
            {has.showName && <TriCheck label={t("raidBoard.insp.showName")} value={opt.showName} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { showName: v }))} />}
            {has.color && (
                <label className="rp-field">
                    <span className="rp-kicker">{mixed(t("raidBoard.zone.color"), opt.color)}</span>
                    <input type="color" className="rp-color" value={opt.color || "#888888"} disabled={dis} onChange={(e) => edit((b) => setColorSelection(b, sel, e.target.value), true)} />
                </label>
            )}
            {has.facing && (
                <div className="rp-field rp-multi-facing">
                    <span className="rp-kicker">{t("raidBoard.multi.facing")}</span>
                    <TriCheck label={t("raidBoard.multi.faceOwnTank")} value={opt.autoFace} disabled={dis} onChange={(v) => edit((b) => setFacingSelection(b, sel, { autoFace: v }))} />
                    <div className="rp-compass" role="group" aria-label={t("raidBoard.icon.compass")}>
                        {COMPASS.map((a, n) => (
                            <button
                                key={a} type="button" className={`rp-compass-btn${opt.autoFace === false && opt.rotation === a ? " is-on" : ""}`} disabled={dis} aria-pressed={opt.autoFace === false && opt.rotation === a}
                                aria-label={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)} data-tip={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)}
                                onClick={() => edit((b) => setFacingSelection(b, sel, { rotation: a }))}
                            >{COMPASS_ARROWS[n]}</button>
                        ))}
                    </div>
                    <span className="rp-muted">{t("raidBoard.multi.faceHint")}</span>
                    <span className="rp-kicker">{t("raidBoard.multi.arrow")}</span>
                    <SliderField label={mixed(t("raidBoard.arrow.size"), opt.arrowScale)} value={Math.round((opt.arrowScale || 1) * 100)} min={ARROW_MIN * 100} max={ARROW_MAX * 100} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => patchArrowSelection(b, sel, { scale: v / 100 }), true)} />
                    <TriCheck label={t("raidBoard.arrow.hide")} value={opt.arrowHidden} disabled={dis} onChange={(v) => edit((b) => patchArrowSelection(b, sel, { hidden: v }))} />
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{mixed(t("raidBoard.arrow.color"), opt.arrowColor)}</span>
                            <input type="color" className="rp-color" value={opt.arrowColor || ARROW_COLOR} disabled={dis} onChange={(e) => edit((b) => patchArrowSelection(b, sel, { color: e.target.value }), true)} />
                        </label>
                        {opt.arrowColor !== ARROW_COLOR && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => patchArrowSelection(b, sel, { color: ARROW_COLOR }))}>{t("raidBoard.arrow.reset")}</button>}
                    </div>
                    <SliderField label={mixed(t("raidBoard.arrow.opacity"), opt.arrowOpacity)} value={Math.round((opt.arrowOpacity === null ? 1 : opt.arrowOpacity) * 100)} min={10} max={100} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => patchArrowSelection(b, sel, { opacity: clampOpacity(v / 100, 1) }), true)} />
                </div>
            )}
            {roles && (
                <div className="rp-field">
                    <SliderField label={mixed(t("raidBoard.roleGroupUi.rotation"), roles.rotation)} value={roles.rotation === null ? 0 : roles.rotation} min={0} max={359} step={1} unit="°" disabled={dis} onChange={(v) => edit((b) => setRoleZoneSelection(b, sel, { rotation: v }), true)} />
                    <SliderField label={mixed(t("raidBoard.roleGroupUi.iconScale"), roles.iconScale)} value={Math.round((roles.iconScale === null ? 1 : roles.iconScale) * 100)} min={25} max={300} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => setRoleZoneSelection(b, sel, { iconScale: v / 100 }), true)} />
                    <span className="rp-kicker">{mixed(t("raidBoard.roleGroupUi.labelPos"), roles.labelPos)}</span>
                    <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.roleGroupUi.labelPos")}>
                        {LABEL_POS.map((p) => <button key={p} type="button" role="radio" aria-checked={roles.labelPos === p} className={roles.labelPos === p ? "is-on" : ""} disabled={dis} onClick={() => edit((b) => setRoleZoneSelection(b, sel, { labelPos: p as "in" }))}>{t(`raidBoard.roleGroupUi.pos.${p}`)}</button>)}
                    </span>
                </div>
            )}
            <TriCheck label={t("raidBoard.insp.lock")} value={sum.lock} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { lock: v }))} />
            <TriCheck label={t("raidBoard.multi.hide")} value={sum.hidden} disabled={dis} onChange={(v) => edit((b) => setLookSelection(b, sel, { hidden: v }))} />
            {groups.length > 0 && <TriCheck label={t("raidBoard.insp.showRing")} value={groups.every((g) => g.showRing !== false) ? true : groups.every((g) => g.showRing === false) ? false : null} disabled={dis} onChange={(v) => edit((b) => setRingSelection(b, sel, v))} />}
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
