import { useState } from "react";
import { NumberField, SliderField } from "../../../components/raidplan/NumberField";
import { BringToFront, Copy, Lock, LockOpen, SendToBack, Trash2, UserMinus } from "lucide-react";
import type { RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanPlayer, RaidplanText, RaidplanZone, RaidplanZoneType } from "../../../api";
import { IconButton } from "../../../components/ui";
import {
    COMPASS, COMPASS_NAMES, SCALE_MAX, SCALE_MIN, ZONE_COLORS, ZONE_TYPES, assignSlot, canFace, clampOpacity, iconKeyType, duplicateObject, lookOf, normAngle, objectName, patchLook, removeObject, reorderObject, setMapOpacity,
    setObjectScale, objectPercent, setObjectPercent, groupScales, setGroupScale, setAllGroupScale, scaleObject, SIZE_STEPS, slotTitle, updateIcon, updateLine, updateSlot, updateText, updateZone, type ObjectKind, type Selection,
} from "../../../lib/raidplan";
import { PlayerName, TokenIcon, ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import Flyout from "../../../components/raidplan/Flyout";
import { followsTank } from "../../../lib/assign";
import MultiInspector from "./MultiInspector";
import type { SelItem } from "../../../lib/multiSelect";
import GroupStyle from "./GroupStyle";

const COMPASS_ARROWS = ["\u2191", "\u2197", "\u2192", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196"];
import { useT } from "../../../i18n";

/** A slider and a number field for an opacity in percent, 10..100. */
export function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return <SliderField label={label} value={Math.round(value * 100)} min={10} max={100} step={5} unit="%" onChange={(v) => onChange(clampOpacity(v / 100, value))} />;
}

/** A slider and a number field for a size (px, or the multiplier of the whole board), between min and max. */
/** "Größe %": the size of any element as percent of its default (25 - 400 %); for a group its scale as a whole. Shown first in the inspector, the same for every kind. */
function PctField({ label, board, kind, id, dis, edit }: { label: string; board: RaidplanBoard; kind: ObjectKind; id: string; dis: boolean; edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void }) {
    const v = objectPercent(board, kind, id);
    if (v === null) return null;
    return (
        <label className="rp-field">
            <span className="rp-kicker">{label}</span>
            <NumberField label={label} value={v} min={25} max={400} unit="%" disabled={dis} onChange={(n) => edit((b) => setObjectPercent(b, kind, id, n), true)} />
        </label>
    );
}

export function SizeField({ label, value, min, max, step = 1, unit = "px", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
    return <SliderField label={label} value={value} min={min} max={max} step={step} unit={unit} onChange={onChange} />;
}

/**
 * The properties of the selected object, always in view next to the board: name,
 * the fields of its kind (a zone's label, type, shape, colour, opacity and size; a
 * line's kind, colour, width; a text's words, colour, size; a slot's title, number
 * and player), opacity for every kind, and the actions — lock, duplicate, front /
 * back, delete — as icon buttons. Nothing selected: a hint.
 */
export default function Inspector({ board, selection, multi = [], boardPx, players, roster, isEvent, canWrite, edit, editAll, onSelect, focusGroup = 0, onFocusGroup }: {
    board: RaidplanBoard;
    selection: Selection;
    /** several objects selected: only what they share is shown */
    multi?: SelItem[];
    boardPx?: () => { w: number; h: number };
    players: Map<string, RaidplanPlayer>;
    roster: RaidplanPlayer[];
    isEvent: boolean;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    onSelect: (sel: Selection) => void;
    editAll?: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    /** the group the map highlights (0 = none) and the switch for it */
    focusGroup?: number;
    onFocusGroup?: (n: number) => void;
}) {
    const t = useT();
    const [pick, setPick] = useState<HTMLElement | null>(null);
    if (multi.length > 1) return <MultiInspector board={board} sel={multi} px={boardPx ? boardPx() : { w: 1000, h: 625 }} canWrite={canWrite} edit={edit} />;
    if (!selection) return <p className="rp-muted rp-insp-empty">{t("raidBoard.insp.none")}</p>;
    const { kind, id } = selection;
    const look = lookOf(board, kind, id);
    if (!look) return <p className="rp-muted rp-insp-empty">{t("raidBoard.insp.none")}</p>;
    const dis = !canWrite;
    if (kind === "member") {
        const at = objectPercent(board, kind, id);
        return (
            <div className="rp-insp">
                <div className="rp-insp-head">
                    <strong className="rp-insp-name">{objectName(board, kind, id, players)}</strong>
                    <span className="rp-muted">{t("raidBoard.obj.member")}</span>
                </div>
                {at !== null && <PctField label={t("raidBoard.insp.sizePct")} board={board} kind="member" id={id} dis={dis} edit={edit} />}
                <p className="rp-muted">{t("raidBoard.insp.memberHint")}</p>
                <div className="rp-insp-actions">
                    <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => removeObject(b, "member", id))}>{t("raidBoard.ctx.resetpos")}</button>
                </div>
            </div>
        );
    }
    const zone: RaidplanZone | undefined = kind === "zone" ? board.zones.find((z) => z.id === id) : undefined;
    const line: RaidplanLine | undefined = kind === "line" ? board.lines.find((l) => l.id === id) : undefined;
    const text: RaidplanText | undefined = kind === "text" ? board.texts.find((x) => x.id === id) : undefined;
    const slot = kind === "slot" ? board.slots.find((s) => s.id === id) : undefined;
    const name = objectName(board, kind, id, players);
    const icon: RaidplanIcon | undefined = kind === "icon" ? board.icons.find((i) => i.id === id) : undefined;
    const opacity = (v: number, merge = false) => edit((b) => patchLook(b, kind as ObjectKind, id, { opacity: v }), merge);

    return (
        <div className="rp-insp">
            <div className="rp-insp-head">
                <strong className="rp-insp-name">{name}</strong>
                <span className="rp-muted">{t(`raidBoard.obj.${kind}`)}</span>
            </div>

            {kind !== "zone" && !(slot && slot.kind === "group") && <PctField label={t("raidBoard.insp.sizePct")} board={board} kind={kind as ObjectKind} id={id} dis={dis} edit={edit} />}
            {slot && slot.kind === "group" && (
                <div className="rp-field">
                    <PctField label={t("raidBoard.insp.groupSize")} board={board} kind="slot" id={id} dis={dis} edit={edit} />
                    <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.ringSpread")}</span><NumberField label={t("raidBoard.insp.ringSpread")} value={Math.round(groupScales(slot).sp * 100)} min={25} max={400} unit="%" disabled={dis} onChange={(v) => edit((b) => setGroupScale(b, id, { ringSpread: v / 100 }), true)} /></label>
                    <label className="rp-field"><span className="rp-kicker">{t("raidBoard.insp.tokenSize")}</span><NumberField label={t("raidBoard.insp.tokenSize")} value={Math.round(groupScales(slot).ts * 100)} min={25} max={400} unit="%" disabled={dis} onChange={(v) => edit((b) => setGroupScale(b, id, { tokenScale: v / 100 }), true)} /></label>
                    <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => setAllGroupScale(b, groupScales(slot).gs))}>{t("raidBoard.insp.allGroups")}</button>
                </div>
            )}
            {kind === "zone" && (
                <span className="rp-cpick-roles" role="group" aria-label={t("raidBoard.insp.zoneScale")}>
                    <span className="rp-muted">{t("raidBoard.insp.zoneScale")}</span>
                    {SIZE_STEPS.filter((x) => x !== 100).map((x) => <button key={x} type="button" className="rp-fchip" disabled={dis} onClick={() => edit((b) => scaleObject(b, "zone", id, x / 100))}>{x} %</button>)}
                </span>
            )}

            {(kind === "token" || kind === "slot" || kind === "icon" || kind === "zone") && (
                <label className="rp-check"><input type="checkbox" checked={look.ring !== false} disabled={dis} onChange={(e) => edit((b) => patchLook(b, kind as ObjectKind, id, { ring: e.target.checked }))} /> {t(kind === "zone" ? "raidBoard.insp.showBorder" : "raidBoard.insp.showRingObj")}</label>
            )}

            {(kind === "token" || kind === "slot" || kind === "icon") && (
                <label className="rp-check"><input type="checkbox" checked={look.showName !== false} disabled={dis} onChange={(e) => edit((b) => patchLook(b, kind as ObjectKind, id, { showName: e.target.checked }))} /> {t("raidBoard.insp.showName")}</label>
            )}

            {zone && (
                <>
                    <label className="rp-field">
                        <span className="rp-kicker">{t("raidBoard.zone.label")}</span>
                        <input value={zone.label} maxLength={40} disabled={dis} placeholder={t(`raidBoard.zone.${zone.type}`)} onChange={(e) => edit((b) => updateZone(b, id, { label: e.target.value }), true)} />
                    </label>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.zone.type")}</span>
                            <select value={zone.type} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { type: e.target.value as RaidplanZoneType, color: ZONE_COLORS[e.target.value as RaidplanZoneType] }))}>
                                {ZONE_TYPES.map((z) => <option key={z} value={z}>{ZONE_GLYPHS[z]} {t(`raidBoard.zone.${z}`)}</option>)}
                            </select>
                        </label>
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.zone.shape")}</span>
                            <select value={zone.shape} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { shape: e.target.value as "rect" | "ellipse" }))}>
                                <option value="rect">{t("raidBoard.zone.rect")}</option>
                                <option value="ellipse">{t("raidBoard.zone.ellipse")}</option>
                            </select>
                        </label>
                    </div>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.zone.color")}</span>
                            <input type="color" className="rp-color" value={zone.color} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { color: e.target.value }), true)} />
                        </label>
                        <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateZone(b, id, { color: ZONE_COLORS[zone.type] }))}>{t("raidBoard.zone.presetColor")}</button>
                    </div>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.insp.width")}</span>
                            <NumberField label={t("raidBoard.insp.width")} value={Math.round(zone.w * 100)} min={3} max={100} unit="%" disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { w: Math.max(0.03, Math.min(1 - zone.x, v / 100)) }), true)} />
                        </label>
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.insp.height")}</span>
                            <NumberField label={t("raidBoard.insp.height")} value={Math.round(zone.h * 100)} min={3} max={100} unit="%" disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { h: Math.max(0.03, Math.min(1 - zone.y, v / 100)) }), true)} />
                        </label>
                    </div>
                </>
            )}

            {line && (
                <>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.insp.lineKind")}</span>
                            <select value={line.kind} disabled={dis} onChange={(e) => edit((b) => updateLine(b, id, { kind: e.target.value as "arrow" | "line" }))}>
                                <option value="arrow">{t("raidBoard.line.arrow")}</option>
                                <option value="line">{t("raidBoard.line.line")}</option>
                            </select>
                        </label>
                    </div>
                    <label className="rp-field">
                        <span className="rp-kicker">{t("raidBoard.zone.color")}</span>
                        <input type="color" className="rp-color" value={line.color} disabled={dis} onChange={(e) => edit((b) => updateLine(b, id, { color: e.target.value }), true)} />
                    </label>
                </>
            )}

            {text && (
                <>
                    <label className="rp-field">
                        <span className="rp-kicker">{t("raidBoard.slot.text")}</span>
                        <input value={text.text} maxLength={60} disabled={dis} onChange={(e) => edit((b) => updateText(b, id, { text: e.target.value }), true)} />
                    </label>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.zone.color")}</span>
                            <input type="color" className="rp-color" value={text.color} disabled={dis} onChange={(e) => edit((b) => updateText(b, id, { color: e.target.value }), true)} />
                        </label>
                    </div>
                </>
            )}

            {slot && (
                <>
                    {slot.kind !== "label" && (
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.slot.number")}</span>
                            <NumberField label={t("raidBoard.slot.number")} value={slot.n} min={1} max={99} disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { n: v }), true)} />
                        </label>
                    )}
                    <label className="rp-field">
                        <span className="rp-kicker">{slot.kind === "label" ? t("raidBoard.slot.text") : t("raidBoard.slot.customTitle")}</span>
                        <input value={slot.label} maxLength={40} disabled={dis} placeholder={slot.kind === "label" ? "" : slotTitle({ ...slot, label: "" })} onChange={(e) => edit((b) => updateSlot(b, id, { label: e.target.value }), true)} />
                    </label>
                    {isEvent && slot.kind !== "group" && (
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.slot.player")}</span>
                            <button type="button" className="rp-assign-btn" disabled={dis} data-insp-player aria-haspopup="dialog" onClick={(e) => setPick(pick ? null : e.currentTarget)}>
                                <span>{slot.userId ? (roster.find((p) => p.userId === slot.userId) || { character: slot.userId }).character : t("raidBoard.slot.open")}</span>
                            </button>
                            {pick && (
                                <Flyout
                                    anchor={pick} title={t("raidBoard.slot.player")} multi={false}
                                    options={roster.map((p) => ({ key: p.userId, label: p.character, group: p.role === "tank" || p.role === "healer" ? t(`raidBoard.slot.kind.${p.role}`) : t("raidBoard.slot.kind.dps"), on: p.userId === slot.userId, node: <span className="rp-pchip"><TokenIcon player={p} size="sm" /><PlayerName player={p} /></span> }))}
                                    onToggle={(uid) => { edit((b) => assignSlot(b, id, uid === slot.userId ? "" : uid)); setPick(null); }} onClose={() => setPick(null)}
                                />
                            )}
                        </label>
                    )}
                    {slot.kind === "group" && <p className="rp-muted">{t("raidBoard.slot.groupHint")}</p>}
                </>
            )}

            {icon && (
                <>
                    <label className="rp-field">
                        <span className="rp-kicker">{t("raidBoard.icon.label")}</span>
                        <input value={icon.label} maxLength={40} disabled={dis} placeholder={t(`raidBoard.icon.${iconKeyType(icon.iconKey)}`)} onChange={(e) => edit((b) => updateIcon(b, id, { label: e.target.value }), true)} />
                    </label>
                    <label className="rp-check"><input type="checkbox" checked={icon.showLabel} disabled={dis} onChange={(e) => edit((b) => updateIcon(b, id, { showLabel: e.target.checked }))} /> {t("raidBoard.icon.showLabel")}</label>
                    {canFace(icon.iconKey) && (
                        <>
                            {icon.mobId && (
                                <label className="rp-check">
                                    <input type="checkbox" checked={icon.autoFace} disabled={dis} onChange={(e) => edit((b) => updateIcon(b, id, { autoFace: e.target.checked }))} /> {t("raidBoard.icon.autoFace")}
                                    {followsTank(board, icon) && <span className="rp-muted"> · {t("raidBoard.icon.autoFaceOn")}</span>}
                                </label>
                            )}
                            <SizeField label={t("raidBoard.icon.facing")} value={icon.rotation} min={0} max={359} step={1} onChange={(v) => !dis && edit((b) => updateIcon(b, id, { rotation: normAngle(v), autoFace: false }), true)} />
                            <div className="rp-compass" role="group" aria-label={t("raidBoard.icon.compass")}>
                                {COMPASS.map((a, n) => (
                                    <button
                                        key={a} type="button" className={`rp-compass-btn${icon.rotation === a ? " is-on" : ""}`} disabled={dis} aria-pressed={icon.rotation === a}
                                        aria-label={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)} data-tip={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)}
                                        onClick={() => edit((b) => updateIcon(b, id, { rotation: a, autoFace: false }))}
                                    >{COMPASS_ARROWS[n]}</button>
                                ))}
                            </div>
                            <span className="rp-muted">{t("raidBoard.icon.facingHint")}</span>
                        </>
                    )}
                </>
            )}

            {slot && slot.kind === "group" && (
                <div className="rp-field">
                    <GroupStyle board={board} n={slot.n} canWrite={canWrite} edit={editAll || edit} focused={focusGroup === slot.n} onFocus={onFocusGroup ? () => onFocusGroup(focusGroup === slot.n ? 0 : slot.n) : undefined} />
                    <label className="rp-check"><input type="checkbox" checked={!slot.hideMembers} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { hideMembers: !e.target.checked }))} /> {t("raidBoard.insp.showMembers")}</label>
                    <label className="rp-check"><input type="checkbox" checked={slot.split} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { split: e.target.checked }))} /> {t("raidBoard.insp.split")}</label>
                    {slot.split && Object.keys(slot.offsets || {}).length > 0 && (
                        <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateSlot(b, id, { offsets: {} }))}>{t("raidBoard.insp.resetMembers")}</button>
                    )}
                    {slot.split && (
                        <>
                            <label className="rp-check"><input type="checkbox" checked={slot.showRing !== false} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { showRing: e.target.checked }))} /> {t("raidBoard.insp.showRing")}</label>
                            {slot.showRing !== false && <SliderField label={t("raidBoard.insp.ringOpacity")} value={Math.round((slot.ringOpacity === undefined ? 0.55 : slot.ringOpacity) * 100)} min={10} max={100} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => updateSlot(b, id, { ringOpacity: v / 100 }), true)} />}
                        </>
                    )}
                    <span className="rp-muted">{t("raidBoard.insp.splitHint")}</span>
                </div>
            )}


            <OpacityField label={t("raidBoard.insp.opacity")} value={look.opacity} onChange={(v) => opacity(v, true)} />

            <div className="rp-insp-actions">
                <IconButton size="sm" icon={look.lock ? <LockOpen size={16} /> : <Lock size={16} />} tip={look.lock ? t("raidBoard.insp.unlock") : t("raidBoard.insp.lock")} disabled={dis} onClick={() => edit((b) => patchLook(b, kind, id, { lock: !look.lock }))} />
                {kind !== "token" && <IconButton size="sm" icon={<Copy size={16} />} tip={t("raidBoard.insp.duplicate")} disabled={dis} onClick={() => { const r = duplicateObject(board, kind, id); edit(() => r.board); onSelect(r.sel); }} />}
                <IconButton size="sm" icon={<BringToFront size={16} />} tip={t("raidBoard.insp.front")} disabled={dis} onClick={() => edit((b) => reorderObject(b, kind, id, "front"))} />
                <IconButton size="sm" icon={<SendToBack size={16} />} tip={t("raidBoard.insp.back")} disabled={dis} onClick={() => edit((b) => reorderObject(b, kind, id, "back"))} />
                {slot && isEvent && slot.userId && <IconButton size="sm" icon={<UserMinus size={16} />} tip={t("raidBoard.ctx.unassign")} disabled={dis} onClick={() => edit((b) => assignSlot(b, id, ""))} />}
                <IconButton size="sm" tone="danger" icon={<Trash2 size={16} />} tip={t("raidBoard.selection.delete")} disabled={dis} onClick={() => { edit((b) => removeObject(b, kind, id)); onSelect(null); }} />
            </div>
        </div>
    );
}

/** The default size of tokens, slots, marks and icons of the whole board (50–200 %). */
export function ObjectScaleField({ board, canWrite, edit }: { board: RaidplanBoard; canWrite: boolean; edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void }) {
    const t = useT();
    return <SliderField label={t("raidBoard.bg.objectScale")} value={Math.round(board.objectScale * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} step={5} unit="%" disabled={!canWrite} onChange={(v) => canWrite && edit((b) => setObjectScale(b, v / 100), true)} />;
}

/** How strongly the map shows: dim it so the objects stand out. Shown when nothing is selected, and always on the background tab. */
export function MapOpacityField({ board, canWrite, edit }: { board: RaidplanBoard; canWrite: boolean; edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void }) {
    const t = useT();
    return (
        <div className={canWrite ? "" : "rp-disabled"}>
            <OpacityField label={t("raidBoard.bg.mapOpacity")} value={board.mapOpacity} onChange={(v) => canWrite && edit((b) => setMapOpacity(b, v), true)} />
        </div>
    );
}
