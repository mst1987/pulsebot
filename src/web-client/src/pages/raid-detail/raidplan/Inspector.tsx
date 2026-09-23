import { BringToFront, Copy, Lock, LockOpen, SendToBack, Trash2, UserMinus } from "lucide-react";
import type { RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanPlayer, RaidplanText, RaidplanZone, RaidplanZoneType } from "../../../api";
import { IconButton } from "../../../components/ui";
import {
    SCALE_MAX, SCALE_MIN, SIZE_RANGES, ZONE_COLORS, ZONE_TYPES, assignSlot, clampOpacity, duplicateObject, lookOf, objectName, patchLook, removeObject, reorderObject, setMapOpacity,
    setObjectScale, setObjectSize, sizeOf, slotTitle, updateIcon, updateLine, updateSlot, updateText, updateZone, type ObjectKind, type Selection,
} from "../../../lib/raidplan";
import { ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import { useT } from "../../../i18n";

/** A slider and a number field for an opacity in percent, 10..100. */
export function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    const pct = Math.round(value * 100);
    const set = (raw: string) => onChange(clampOpacity(Number(raw) / 100, value));
    return (
        <div className="rp-field">
            <span className="rp-kicker">{label}</span>
            <div className="rp-opacity">
                <input type="range" min={10} max={100} step={5} value={pct} aria-label={label} onChange={(e) => set(e.target.value)} />
                <input type="number" min={10} max={100} value={pct} aria-label={`${label} %`} onChange={(e) => set(e.target.value)} />
                <span className="rp-muted">%</span>
            </div>
        </div>
    );
}

/** A slider and a number field for a size (px, or the multiplier of the whole board), between min and max. */
export function SizeField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
    return (
        <div className="rp-field">
            <span className="rp-kicker">{label}</span>
            <div className="rp-opacity">
                <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
                <input type="number" min={min} max={max} step={step} value={value} aria-label={`${label} (number)`} onChange={(e) => onChange(Number(e.target.value))} />
            </div>
        </div>
    );
}

/**
 * The properties of the selected object, always in view next to the board: name,
 * the fields of its kind (a zone's label, type, shape, colour, opacity and size; a
 * line's kind, colour, width; a text's words, colour, size; a slot's title, number
 * and player), opacity for every kind, and the actions — lock, duplicate, front /
 * back, delete — as icon buttons. Nothing selected: a hint.
 */
export default function Inspector({ board, selection, players, roster, isEvent, canWrite, edit, onSelect }: {
    board: RaidplanBoard;
    selection: Selection;
    players: Map<string, RaidplanPlayer>;
    roster: RaidplanPlayer[];
    isEvent: boolean;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    onSelect: (sel: Selection) => void;
}) {
    const t = useT();
    if (!selection) return <p className="rp-muted rp-insp-empty">{t("raidBoard.insp.none")}</p>;
    const { kind, id } = selection;
    const look = lookOf(board, kind, id);
    if (!look) return <p className="rp-muted rp-insp-empty">{t("raidBoard.insp.none")}</p>;
    const dis = !canWrite;
    if (kind === "member") {
        const at = sizeOf(board, kind, id);
        return (
            <div className="rp-insp">
                <div className="rp-insp-head">
                    <strong className="rp-insp-name">{objectName(board, kind, id, players)}</strong>
                    <span className="rp-muted">{t("raidBoard.obj.member")}</span>
                </div>
                {at !== null && <SizeField label={t("raidBoard.insp.size")} value={at} min={SIZE_RANGES.member.min} max={SIZE_RANGES.member.max} onChange={(v) => !dis && edit((b) => setObjectSize(b, "member", id, v), true)} />}
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
    const size = sizeOf(board, kind, id);
    const range = SIZE_RANGES[kind];
    const opacity = (v: number, merge = false) => edit((b) => patchLook(b, kind as ObjectKind, id, { opacity: v }), merge);

    return (
        <div className="rp-insp">
            <div className="rp-insp-head">
                <strong className="rp-insp-name">{name}</strong>
                <span className="rp-muted">{t(`raidBoard.obj.${kind}`)}</span>
            </div>

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
                            <span className="rp-kicker">{t("raidBoard.insp.width")} %</span>
                            <input type="number" min={3} max={100} value={Math.round(zone.w * 100)} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { w: Math.max(0.03, Math.min(1 - zone.x, Number(e.target.value) / 100 || 0.03)) }), true)} />
                        </label>
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.insp.height")} %</span>
                            <input type="number" min={3} max={100} value={Math.round(zone.h * 100)} disabled={dis} onChange={(e) => edit((b) => updateZone(b, id, { h: Math.max(0.03, Math.min(1 - zone.y, Number(e.target.value) / 100 || 0.03)) }), true)} />
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
                        <SizeField label={t("raidBoard.insp.thickness")} value={line.width} min={SIZE_RANGES.line.min} max={SIZE_RANGES.line.max} onChange={(v) => !dis && edit((b) => setObjectSize(b, "line", id, v), true)} />
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
                        <SizeField label={t("raidBoard.insp.fontSize")} value={text.size} min={SIZE_RANGES.text.min} max={SIZE_RANGES.text.max} onChange={(v) => !dis && edit((b) => setObjectSize(b, "text", id, v), true)} />
                    </div>
                </>
            )}

            {slot && (
                <>
                    {slot.kind !== "label" && (
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.slot.number")}</span>
                            <input type="number" min={1} max={99} value={slot.n} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { n: Math.max(1, Math.min(99, Math.floor(Number(e.target.value)) || 1)) }), true)} />
                        </label>
                    )}
                    <label className="rp-field">
                        <span className="rp-kicker">{slot.kind === "label" ? t("raidBoard.slot.text") : t("raidBoard.slot.customTitle")}</span>
                        <input value={slot.label} maxLength={40} disabled={dis} placeholder={slot.kind === "label" ? "" : slotTitle({ ...slot, label: "" })} onChange={(e) => edit((b) => updateSlot(b, id, { label: e.target.value }), true)} />
                    </label>
                    {isEvent && slot.kind !== "group" && (
                        <label className="rp-field">
                            <span className="rp-kicker">{t("raidBoard.slot.player")}</span>
                            <select value={slot.userId} disabled={dis} data-insp-player onChange={(e) => edit((b) => assignSlot(b, id, e.target.value))}>
                                <option value="">{t("raidBoard.slot.open")}</option>
                                {roster.map((p) => <option key={p.userId} value={p.userId}>{p.character} — {[p.specLabel, p.className].filter(Boolean).join(" ")}</option>)}
                            </select>
                        </label>
                    )}
                    {slot.kind === "group" && <p className="rp-muted">{t("raidBoard.slot.groupHint")}</p>}
                </>
            )}

            {icon && (
                <>
                    <label className="rp-field">
                        <span className="rp-kicker">{t("raidBoard.icon.label")}</span>
                        <input value={icon.label} maxLength={40} disabled={dis} onChange={(e) => edit((b) => updateIcon(b, id, { label: e.target.value }), true)} />
                    </label>
                    <SizeField label={t("raidBoard.insp.rotation")} value={icon.rotation} min={-180} max={180} step={5} onChange={(v) => !dis && edit((b) => updateIcon(b, id, { rotation: Math.max(-180, Math.min(180, Math.round(v))) }), true)} />
                </>
            )}

            {slot && slot.kind === "group" && (
                <div className="rp-field">
                    <label className="rp-check"><input type="checkbox" checked={!slot.hideMembers} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { hideMembers: !e.target.checked }))} /> {t("raidBoard.insp.showMembers")}</label>
                    <label className="rp-check"><input type="checkbox" checked={slot.split} disabled={dis} onChange={(e) => edit((b) => updateSlot(b, id, { split: e.target.checked }))} /> {t("raidBoard.insp.split")}</label>
                    {slot.split && Object.keys(slot.offsets || {}).length > 0 && (
                        <button type="button" className="rp-link" disabled={dis} onClick={() => edit((b) => updateSlot(b, id, { offsets: {} }))}>{t("raidBoard.insp.resetMembers")}</button>
                    )}
                    <span className="rp-muted">{t("raidBoard.insp.splitHint")}</span>
                </div>
            )}

            {size !== null && kind !== "line" && kind !== "text" && (
                <SizeField label={slot && slot.kind === "group" ? t("raidBoard.insp.memberSize") : t("raidBoard.insp.size")} value={size} min={range.min} max={range.max} onChange={(v) => !dis && edit((b) => setObjectSize(b, kind as ObjectKind, id, v), true)} />
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
    const pct = Math.round(board.objectScale * 100);
    const set = (raw: number) => canWrite && edit((b) => setObjectScale(b, raw / 100), true);
    return (
        <div className={`rp-field${canWrite ? "" : " rp-disabled"}`}>
            <span className="rp-kicker">{t("raidBoard.bg.objectScale")}</span>
            <div className="rp-opacity">
                <input type="range" min={SCALE_MIN * 100} max={SCALE_MAX * 100} step={5} value={pct} aria-label={t("raidBoard.bg.objectScale")} onChange={(e) => set(Number(e.target.value))} />
                <input type="number" min={SCALE_MIN * 100} max={SCALE_MAX * 100} value={pct} aria-label={`${t("raidBoard.bg.objectScale")} %`} onChange={(e) => set(Number(e.target.value))} />
                <span className="rp-muted">%</span>
            </div>
        </div>
    );
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
