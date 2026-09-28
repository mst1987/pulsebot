import type { ReactNode } from "react";
import type { RaidplanBoard, RaidplanSlot } from "../../../api";
import { NumberField, SliderField } from "../../../components/raidplan/NumberField";
import { chipWidthOf, groupScales, patchLook, setAllGroupScale, setGroupScale, slotTitle, updateSlot } from "../../../lib/raidplan";
import { BADGE_SCALE_MAX, BADGE_SCALE_MIN, badgeScaleOf } from "../../../lib/raidplan/labelScale";
import GroupStyle from "./GroupStyle";
import InspectorTabs from "./InspectorTabs";
import { useT } from "../../../i18n";

type Edit = (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
type GroupTab = "group" | "look" | "badge";

/**
 * The fields of a selected group marker (#528), in three tabs instead of one long column: "Gruppe" (number, label, raiders, split, chip
 * width), "Darstellung" (group size, ring spacing, token size, role ring, name, opacity) and "Ring & Badge" (group colour, raid mark,
 * highlight, the ring round a split group and the group badge: shown, its size). Every field and value is the one the inspector had before;
 * `size` and `opacity` are the inspector's own fields, handed in.
 */
export default function GroupInspector({ board, slot, dis, canWrite, edit, editAll, size, opacity, nameAuto, focusGroup = 0, onFocusGroup }: {
    board: RaidplanBoard;
    slot: RaidplanSlot;
    dis: boolean;
    canWrite: boolean;
    edit: Edit;
    editAll?: Edit;
    /** the group size field ("Gruppengröße") and the opacity field of the inspector */
    size: ReactNode;
    opacity: ReactNode;
    /** the board hides the names by itself (too small on screen) */
    nameAuto: boolean;
    focusGroup?: number;
    onFocusGroup?: (n: number) => void;
}) {
    const t = useT();
    const id = slot.id;
    const tabs: { value: GroupTab; label: string }[] = [
        { value: "group", label: t("raidBoard.insp.tab.group") },
        { value: "look", label: t("raidBoard.insp.tab.look") },
        { value: "badge", label: t("raidBoard.insp.tab.ringBadge") },
    ];
    const scales = groupScales(slot);
    const badgeOn = slot.showBadge !== false;
    return (
        <InspectorTabs id="group" label={t("raidBoard.insp.tab.label")} tabs={tabs}>
            {(tab) => (
                <>
                    {tab === "group" && (
                        <>
                            <label className="rp-field">
                                <span className="rp-kicker">{t("raidBoard.slot.number")}</span>
                                <NumberField label={t("raidBoard.slot.number")} value={slot.n} min={1} max={99} disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { n: v }), true)} />
                            </label>
                            <label className="rp-field">
                                <span className="rp-kicker">{t("raidBoard.slot.customTitle")}</span>
                                <input value={slot.label} maxLength={40} disabled={dis} placeholder={slotTitle({ ...slot, label: "" })} onChange={(e) => edit((b) => updateSlot(b, id, { label: e.target.value }), true)} />
                            </label>
                            <p className="rp-muted">{t("raidBoard.slot.groupHint")}</p>
                            <label className="rp-check"><input type="checkbox" checked={!slot.hideMembers} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { hideMembers: !e.target.checked }))} /> {t("raidBoard.insp.showMembers")}</label>
                            <label className="rp-check"><input type="checkbox" checked={slot.split} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { split: e.target.checked }))} /> {t("raidBoard.insp.split")}</label>
                            {slot.split && Object.keys(slot.offsets || {}).length > 0 && (
                                <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateSlot(b, id, { offsets: {} }))}>{t("raidBoard.insp.resetMembers")}</button>
                            )}
                            <span className="rp-muted">{t("raidBoard.insp.splitHint")}</span>
                            {!slot.split && !slot.hideMembers && (
                                <div className="rp-field-row">
                                    <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.chipWidth")}</span><NumberField label={t("raidBoard.insp.chipWidth")} value={chipWidthOf(slot) || 0} min={0} max={400} unit="px" disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { chipWidth: v > 0 ? Math.max(60, Math.min(400, v)) : 0 }), true)} /></label>
                                    {chipWidthOf(slot) > 0 && <button type="button" className="rp-link" disabled={dis} data-tip={t("raidBoard.insp.chipAutoTip")} onClick={() => edit((b) => updateSlot(b, id, { chipWidth: 0 }))}>{t("raidBoard.insp.chipAuto")}</button>}
                                </div>
                            )}
                        </>
                    )}
                    {tab === "look" && (
                        <>
                            <div className="rp-field-row">
                                {size}
                                <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.tokenSize")}</span><NumberField label={t("raidBoard.insp.tokenSize")} value={Math.round(scales.ts * 100)} min={25} max={400} unit="%" disabled={dis} onChange={(v) => edit((b) => setGroupScale(b, id, { tokenScale: v / 100 }), true)} /></label>
                            </div>
                            <div className="rp-field-row">
                                <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.ringSpread")}</span><NumberField label={t("raidBoard.insp.ringSpread")} value={Math.round(scales.sp * 100)} min={25} max={400} unit="%" disabled={dis} onChange={(v) => edit((b) => setGroupScale(b, id, { ringSpread: v / 100 }), true)} /></label>
                                <span aria-hidden="true" />
                            </div>
                            <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => setAllGroupScale(b, scales.gs))}>{t("raidBoard.insp.allGroups")}</button>
                            <label className="rp-check"><input type="checkbox" checked={slot.ring !== false} disabled={dis} onChange={(e) => edit((b) => patchLook(b, "slot", id, { ring: e.target.checked }))} /> {t("raidBoard.insp.showRingObj")}</label>
                            {slot.showName !== false && nameAuto && <p className="rp-muted rp-name-auto">{t("raidBoard.insp.nameAuto")}</p>}
                            <label className="rp-check"><input type="checkbox" checked={slot.showName !== false} disabled={dis} onChange={(e) => edit((b) => patchLook(b, "slot", id, { showName: e.target.checked }))} /> {t("raidBoard.insp.showName")}</label>
                            {opacity}
                        </>
                    )}
                    {tab === "badge" && (
                        <>
                            <GroupStyle board={board} n={slot.n} canWrite={canWrite} edit={editAll || edit} focused={focusGroup === slot.n} onFocus={onFocusGroup ? () => onFocusGroup(focusGroup === slot.n ? 0 : slot.n) : undefined} />
                            <span className="rp-kicker">{t("raidBoard.insp.ringHead")}</span>
                            {slot.split ? (
                                <>
                                    <label className="rp-check"><input type="checkbox" checked={slot.showRing !== false} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { showRing: e.target.checked }))} /> {t("raidBoard.insp.showRing")}</label>
                                    {slot.showRing !== false && <SliderField label={t("raidBoard.insp.ringOpacity")} value={Math.round((slot.ringOpacity === undefined ? 0.55 : slot.ringOpacity) * 100)} min={10} max={100} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { ringOpacity: v / 100 }), true)} />}
                                </>
                            ) : <p className="rp-muted">{t("raidBoard.insp.ringOnlySplit")}</p>}
                            <span className="rp-kicker">{t("raidBoard.insp.badgeHead")}</span>
                            <label className="rp-check"><input type="checkbox" checked={badgeOn} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { showBadge: e.target.checked }))} /> {t("raidBoard.insp.showBadge")}</label>
                            {badgeOn && (
                                <SliderField label={t("raidBoard.insp.badgeScale")} value={Math.round(badgeScaleOf(slot.badgeScale) * 100)} min={BADGE_SCALE_MIN * 100} max={BADGE_SCALE_MAX * 100} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { badgeScale: badgeScaleOf(v / 100) }), true)} />
                            )}
                            {badgeOn && badgeScaleOf(slot.badgeScale) !== 1 && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateSlot(b, id, { badgeScale: 1 }))}>{t("raidBoard.insp.badgeReset")}</button>}
                            {board.showBadges === false && <p className="rp-muted">{t("raidBoard.insp.badgesBoardOff")}</p>}
                        </>
                    )}
                </>
            )}
        </InspectorTabs>
    );
}
