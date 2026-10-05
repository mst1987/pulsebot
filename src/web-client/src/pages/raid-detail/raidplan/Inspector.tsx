import { useState } from "react";
import { NumberField, SliderField } from "../../../components/raidplan/NumberField";
import { BringToFront, Copy, Lock, LockOpen, SendToBack, Trash2, UserMinus } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanPlayer, RaidplanText, RaidplanZone, RaidplanZoneType } from "../../../api";
import { IconButton, Switch } from "../../../components/ui";
import {
    AREA_STYLES, areaStyleOf, arcSpanOf, arcWidthOf, ARROW_COLOR, ARROW_MAX, ARROW_MIN, ROLE_GROUPS, ROLE_GROUP_COLORS, arrowOf, patchArrow, COMPASS, COMPASS_NAMES, SCALE_MAX, SCALE_MIN, ZONE_COLORS, ZONE_TYPES, assignSlot, canFace, clampOpacity, iconKeyType, duplicateObject, lookOf, normAngle, objectName, patchLook, removeObject, reorderObject, setMapOpacity,
    setObjectScale, sizeOf, objectPercent, setObjectPercent, LABEL_POS, scaleObject, SIZE_STEPS, slotTitle, updateIcon, updateLine, updateSlot, updateText, updateZone, type ObjectKind, type Selection,
} from "../../../lib/raidplan";
import { PlayerName, TokenIcon, ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import Flyout from "../../../components/raidplan/Flyout";
import { followsTank } from "../../../lib/raidplan/assign";
import MultiInspector from "./MultiInspector";
import type { SelItem } from "../../../lib/raidplan/multiSelect";
import GroupInspector from "./GroupInspector";
import InspectorTabs from "./InspectorTabs";
import { REF_W } from "../../../lib/raidplan/boardScale";
import { ICON_NAME_FACTOR, NAME_FACTOR, labelMetrics } from "../../../lib/raidplan/labelScale";

const COMPASS_ARROWS = ["\u2191", "\u2197", "\u2192", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196"];
import { useT } from "../../../i18n";

/** A slider and a number field for an opacity in percent, 10..100. */
export function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return <SliderField label={label} value={Math.round(value * 100)} min={10} max={100} step={5} unit="%" onChange={(v) => onChange(clampOpacity(v / 100, value))} />;
}

/**
 * The facing wedge of an icon (a boss / mob / enemy, also one the tank rows put on the map): "Pfeilgröße" 25 - 300 % (slider + number),
 * "Pfeil ausblenden" (the facing stays stored), its colour (default amber) and opacity. Shared by the inspector and the auto objects' panel.
 */
export function ArrowFields({ board, kind, id, dis, edit }: { board: RaidplanBoard; kind: ObjectKind; id: string; dis: boolean; edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void }) {
    const t = useT();
    const a = arrowOf(board, kind, id);
    if (!a) return null;
    return (
        <div className="rp-field">
            <SliderField label={t("raidBoard.arrow.size")} value={Math.round(a.scale * 100)} min={ARROW_MIN * 100} max={ARROW_MAX * 100} step={5} unit="%" disabled={dis || a.hidden} onChange={(v) => edit((b) => patchArrow(b, kind, id, { scale: v / 100 }), true)} />
            <Switch className="rp-check" checked={a.hidden} disabled={dis} onChange={(on) => edit((b) => patchArrow(b, kind, id, { hidden: on }))} label={t("raidBoard.arrow.hide")} />
            {!a.hidden && (
                <>
                    <div className="rp-field-row">
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.arrow.color")}</span>
                            <input type="color" className="rp-color" value={a.color} disabled={dis} onChange={(e) => edit((b) => patchArrow(b, kind, id, { color: e.target.value }), true)} />
                        </label>
                        {a.color !== ARROW_COLOR && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => patchArrow(b, kind, id, { color: ARROW_COLOR }))}>{t("raidBoard.arrow.reset")}</button>}
                    </div>
                    <OpacityField label={t("raidBoard.arrow.opacity")} value={a.opacity} onChange={(v) => !dis && edit((b) => patchArrow(b, kind, id, { opacity: v }), true)} />
                </>
            )}
        </div>
    );
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
export default function Inspector({ board, selection, multi = [], boardPx, players, roster, isEvent, canWrite, edit, editAll, rows, onSelect, focusGroup = 0, onFocusGroup }: {
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
    /** the effective rows of the section (own + inherited, resolved): what an icon's auto facing follows */
    rows?: RaidplanAssignment[];
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
    const opacityField = <OpacityField label={t("raidBoard.insp.opacity")} value={look.opacity} onChange={(v) => opacity(v, true)} />;
    const head = (
        <div className="rp-insp-head">
            <strong className="rp-insp-name">{name}</strong>
            <span className="rp-muted">{zone && zone.type === "role" ? t("raidBoard.zone.role") : t(`raidBoard.obj.${kind}`)}</span>
        </div>
    );
    const actions = (
        <div className="rp-insp-actions">
            <IconButton size="sm" icon={look.lock ? <LockOpen size={16} /> : <Lock size={16} />} tip={look.lock ? t("raidBoard.insp.unlock") : t("raidBoard.insp.lock")} disabled={dis} onClick={() => edit((b) => patchLook(b, kind, id, { lock: !look.lock }))} />
            {kind !== "token" && <IconButton size="sm" icon={<Copy size={16} />} tip={t("raidBoard.insp.duplicate")} disabled={dis} onClick={() => { const r = duplicateObject(board, kind, id); edit(() => r.board); onSelect(r.sel); }} />}
            <IconButton size="sm" icon={<BringToFront size={16} />} tip={t("raidBoard.insp.front")} disabled={dis} onClick={() => edit((b) => reorderObject(b, kind, id, "front"))} />
            <IconButton size="sm" icon={<SendToBack size={16} />} tip={t("raidBoard.insp.back")} disabled={dis} onClick={() => edit((b) => reorderObject(b, kind, id, "back"))} />
            {slot && isEvent && slot.userId && <IconButton size="sm" icon={<UserMinus size={16} />} tip={t("raidBoard.ctx.unassign")} disabled={dis} onClick={() => edit((b) => assignSlot(b, id, ""))} />}
            <IconButton size="sm" tone="danger" icon={<Trash2 size={16} />} tip={t("raidBoard.selection.delete")} disabled={dis} onClick={() => { edit((b) => removeObject(b, kind, id)); onSelect(null); }} />
        </div>
    );
    if (slot && slot.kind === "group") {
        return (
            <div className="rp-insp">
                {head}
                <GroupInspector
                    board={board} slot={slot} dis={dis} canWrite={canWrite} edit={edit} editAll={editAll} focusGroup={focusGroup} onFocusGroup={onFocusGroup}
                    size={<PctField label={t("raidBoard.insp.groupSize")} board={board} kind="slot" id={id} dis={dis} edit={edit} />}
                    opacity={opacityField}
                    nameAuto={nameTooSmall(board, kind, id, boardPx ? boardPx().w : 0)}
                />
                {actions}
            </div>
        );
    }

    // a zone's size steps (its label on a line of its own, the steps wrap) and the ring / border switch
    const zoneSteps = kind === "zone" && (
        <div className="rp-field" role="group" aria-label={t("raidBoard.insp.zoneScale")}>
            <span className="rp-kicker">{t("raidBoard.insp.zoneScale")}</span>
            <span className="rp-insp-steps">
                {SIZE_STEPS.filter((x) => x !== 100).map((x) => <button key={x} type="button" className="rp-fchip" disabled={dis} onClick={() => edit((b) => scaleObject(b, "zone", id, x / 100))}>{x} %</button>)}
            </span>
        </div>
    );
    const ringCheck = (kind === "token" || kind === "slot" || kind === "icon" || kind === "zone") && (
        <Switch className="rp-check" checked={look.ring !== false} disabled={dis} onChange={(on) => edit((b) => patchLook(b, kind as ObjectKind, id, { ring: on }))} label={t(kind === "zone" ? "raidBoard.insp.showBorder" : "raidBoard.insp.showRingObj")} />
    );
    // size (or the zone's steps), ring and name: the first fields of every kind
    const sizeBlock = (
        <>
            {kind !== "zone" && <PctField label={t("raidBoard.insp.sizePct")} board={board} kind={kind as ObjectKind} id={id} dis={dis} edit={edit} />}
            {zoneSteps}
            {ringCheck}

            {(kind === "token" || kind === "slot" || kind === "icon") && look.showName !== false && nameTooSmall(board, kind, id, boardPx ? boardPx().w : 0) && (
                <p className="rp-muted rp-name-auto">{t("raidBoard.insp.nameAuto")}</p>
            )}
            {(kind === "token" || kind === "slot" || kind === "icon") && (
                <Switch className="rp-check" checked={look.showName !== false} disabled={dis} onChange={(on) => edit((b) => patchLook(b, kind as ObjectKind, id, { showName: on }))} label={t("raidBoard.insp.showName")} />
            )}
        </>
    );
    // a role group ("Melees", "Ranged" ...: group, shape, look) and an icon that faces (symbol, facing) are long: tabs like a group marker (#528)
    const roleMain = zone && zone.type === "role" && (
        <>
            <p className="rp-muted">{t("raidBoard.roleGroupUi.hint")}</p>
            <div className="rp-field">
                <span className="rp-kicker">{t("raidBoard.roleGroupUi.role")}</span>
                <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.roleGroupUi.role")}>
                    {ROLE_GROUPS.map((r) => <button key={r} type="button" role="radio" aria-checked={zone.role === r} className={zone.role === r ? "is-on" : ""} disabled={dis} onClick={() => edit((b) => updateZone(b, id, { role: r as never, color: ROLE_GROUP_COLORS[r] }))}>{t(`raidBoard.roleGroup.${r}`)}</button>)}
                </span>
            </div>
            <label className="rp-field">
                <span className="rp-kicker">{t("raidBoard.zone.label")}</span>
                <input value={zone.label} maxLength={40} disabled={dis} placeholder={t(`raidBoard.roleGroup.${zone.role || "melee"}`)} onChange={(e) => edit((b) => updateZone(b, id, { label: e.target.value }), true)} />
            </label>
            <label className="rp-field">
                <span className="rp-kicker">{t("raidBoard.roleGroupUi.count")}</span>
                <NumberField label={t("raidBoard.roleGroupUi.count")} value={zone.count || 0} min={0} max={40} disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { count: v }), true)} />
            </label>
            <Switch className="rp-check" checked={!!zone.showNames} disabled={dis} onChange={(on) => edit((b) => updateZone(b, id, { showNames: on }))} label={t("raidBoard.roleGroupUi.showNames")} />
        </>
    );
    // a role group area is drawn calm or as a ring / arc (#559); a cluster of symbols has no area and no style
    const areaStyle = zone && zone.type === "role" && zone.shape !== "cluster" ? areaStyleOf(zone) : "";
    const roleShape = zone && zone.type === "role" && (
        <>
            {areaStyle && (
                <div className="rp-field">
                    <span className="rp-kicker">{t("raidBoard.roleGroupUi.areaStyle")}</span>
                    <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.roleGroupUi.areaStyle")}>
                        {AREA_STYLES.map((s) => <button key={s} type="button" role="radio" aria-checked={areaStyle === s} className={areaStyle === s ? "is-on" : ""} disabled={dis} onClick={() => edit((b) => updateZone(b, id, { areaStyle: s }))}>{t(`raidBoard.roleGroupUi.style.${s}`)}</button>)}
                    </span>
                    <span className="rp-muted">{t(`raidBoard.roleGroupUi.styleHint.${areaStyle}`)}</span>
                </div>
            )}
            {areaStyle === "arc" && (
                <>
                    <SliderField label={t("raidBoard.roleGroupUi.arcSpan")} value={arcSpanOf(zone)} min={30} max={360} step={5} unit="°" disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { arcSpan: Math.max(30, Math.min(360, Math.round(v))) }), true)} />
                    {arcSpanOf(zone) !== 360 && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateZone(b, id, { arcSpan: 360 }))}>{t("raidBoard.roleGroupUi.arcRing")}</button>}
                    <SliderField label={t("raidBoard.roleGroupUi.arcWidth")} value={Math.round(arcWidthOf(zone) * 100)} min={10} max={80} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { arcWidth: Math.max(0.1, Math.min(0.8, v / 100)) }), true)} />
                </>
            )}
            <div className="rp-field">
                <span className="rp-kicker">{t("raidBoard.roleGroupUi.shape")}</span>
                <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.roleGroupUi.shape")}>
                    {["ellipse", "rect", "cluster"].map((sh) => <button key={sh} type="button" role="radio" aria-checked={zone.shape === sh} className={zone.shape === sh ? "is-on" : ""} disabled={dis} onClick={() => edit((b) => updateZone(b, id, { shape: sh as never }))}>{t(`raidBoard.roleGroupUi.${sh}`)}</button>)}
                </span>
            </div>
            {zoneSteps}
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
            <SizeField label={t("raidBoard.roleGroupUi.rotation")} value={zone.rotation || 0} min={0} max={359} step={1} unit="°" onChange={(v) => !dis && edit((b) => updateZone(b, id, { rotation: normAngle(v) }), true)} />
            {(zone.rotation || 0) !== 0 && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateZone(b, id, { rotation: 0 }))}>{t("raidBoard.roleGroupUi.rotationReset")}</button>}
            <span className="rp-muted">{t("raidBoard.roleGroupUi.rotationHint")}</span>
        </>
    );
    const roleLook = zone && zone.type === "role" && (
        <>
            {ringCheck}
            <SliderField label={t("raidBoard.roleGroupUi.iconScale")} value={Math.round((zone.iconScale || 1) * 100)} min={25} max={300} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => updateZone(b, id, { iconScale: v / 100 }), true)} />
            {(zone.iconScale || 1) !== 1 && <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateZone(b, id, { iconScale: 1 }))}>{t("raidBoard.roleGroupUi.iconAuto")}</button>}
            {/* an area carries its label in the badge on its edge (#559); only a cluster of symbols places it */}
            {zone.shape === "cluster" && (
                <div className="rp-field">
                    <span className="rp-kicker">{t("raidBoard.roleGroupUi.labelPos")}</span>
                    <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.roleGroupUi.labelPos")}>
                        {LABEL_POS.map((p) => <button key={p} type="button" role="radio" aria-checked={(zone.labelPos || "in") === p} className={(zone.labelPos || "in") === p ? "is-on" : ""} disabled={dis} onClick={() => edit((b) => updateZone(b, id, { labelPos: p as RaidplanZone["labelPos"] }))}>{t(`raidBoard.roleGroupUi.pos.${p}`)}</button>)}
                    </span>
                </div>
            )}
            <div className="rp-field-row">
                <label className="rp-field">
                    <span className="rp-kicker">{t("raidBoard.zone.color")}</span>
                    <input type="color" className="rp-color" value={zone.color} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { color: e.target.value }), true)} />
                </label>
                <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateZone(b, id, { color: ROLE_GROUP_COLORS[zone.role || "melee"] }))}>{t("raidBoard.zone.presetColor")}</button>
            </div>
        </>
    );
    const iconMain = icon && (
        <>
            <label className="rp-field">
                <span className="rp-kicker">{t("raidBoard.icon.label")}</span>
                <input value={icon.label} maxLength={40} disabled={dis} placeholder={t(`raidBoard.icon.${iconKeyType(icon.iconKey)}`)} onChange={(e) => edit((b) => updateIcon(b, id, { label: e.target.value }), true)} />
            </label>
            <Switch className="rp-check" checked={icon.showLabel} disabled={dis} onChange={(on) => edit((b) => updateIcon(b, id, { showLabel: on }))} label={t("raidBoard.icon.showLabel")} />
        </>
    );
    const iconFacing = icon && canFace(icon.iconKey) && (
        <>
            <Switch className="rp-check" checked={icon.autoFace !== false} disabled={dis} onChange={(on) => edit((b) => updateIcon(b, id, { autoFace: on }))}
                label={<>{t("raidBoard.icon.autoFace")}{followsTank({ ...board, assignments: rows || board.assignments }, icon) && <span className="rp-muted">· {t("raidBoard.icon.autoFaceOn")}</span>}</>} />
            {icon.autoFace === false && (
                <span className="rp-manual"><strong>{t("raidBoard.icon.manual")}</strong> <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateIcon(b, id, { autoFace: true }))}>{t("raidBoard.icon.backToAuto")}</button></span>
            )}
            <SizeField label={t("raidBoard.icon.facing")} value={icon.rotation} min={0} max={359} step={1} unit="°" onChange={(v) => !dis && edit((b) => updateIcon(b, id, { rotation: normAngle(v), autoFace: false }), true)} />
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
            <ArrowFields board={board} kind="icon" id={id} dis={dis} edit={edit} />
        </>
    );
    if (roleMain) {
        return (
            <div className="rp-insp">
                {head}
                <InspectorTabs id="role" label={t("raidBoard.insp.tab.roleLabel")} tabs={[{ value: "group", label: t("raidBoard.insp.tab.roleGroup") }, { value: "shape", label: t("raidBoard.insp.tab.roleShape") }, { value: "look", label: t("raidBoard.insp.tab.look") }]}>
                    {(tab) => (tab === "group" ? roleMain : tab === "shape" ? roleShape : <>{roleLook}{opacityField}</>)}
                </InspectorTabs>
                {actions}
            </div>
        );
    }
    if (iconFacing) {
        return (
            <div className="rp-insp">
                {head}
                <InspectorTabs id="icon" label={t("raidBoard.insp.tab.iconLabel")} tabs={[{ value: "icon", label: t("raidBoard.insp.tab.icon") }, { value: "facing", label: t("raidBoard.insp.tab.facing") }]}>
                    {(tab) => (tab === "icon" ? <>{sizeBlock}{iconMain}{opacityField}</> : iconFacing)}
                </InspectorTabs>
                {actions}
            </div>
        );
    }

    return (
        <div className="rp-insp">
            {head}
            {sizeBlock}

            {zone && zone.type !== "role" && (
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
                </>
            )}

            {iconMain}

            {opacityField}

            {actions}
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

/** Whether the board hides this object's name by itself because the icon is too small on screen to carry it (lib/raidplan/labelScale.ts); `width` = the board's width on screen in px. */
function nameTooSmall(board: RaidplanBoard, kind: string, id: string, width: number): boolean {
    if (!(width > 0)) return false;
    const size = sizeOf(board, kind as ObjectKind, id);
    if (size === null) return false;
    return !labelMetrics(Math.round(size * board.objectScale), kind === "icon" ? ICON_NAME_FACTOR : NAME_FACTOR, width / REF_W).show;
}
