import { useState } from "react";
import type { RaidplanPlayer, RaidplanSlot, RaidplanSlotKind, RaidplanZone, RaidplanZoneType, RaidplanMarkName } from "../../../api";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import { RAID_MARKS, ZONE_COLORS, ZONE_TYPES, slotTitle } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

const SLOT_BUTTONS: { kind: RaidplanSlotKind; icon: string }[] = [
    { kind: "tank", icon: "ability_warrior_defensivestance" },
    { kind: "healer", icon: "spell_holy_flashheal" },
    { kind: "dps", icon: "ability_dualwield" },
    { kind: "group", icon: "achievement_guildperk_everybodysfriend" },
];

/**
 * "Objekt hinzufügen": the three things one puts on a board besides players — a
 * placeholder slot (tank, healer, dps, a group marker, or a free label), one of
 * the eight raid marks, and a zone (rectangle or ellipse, of a type). Picking one
 * adds it near the middle of the board; the orga drags it where it belongs.
 */
export function AddObjectModal({ open, onClose, onSlot, onMark, onZone }: {
    open: boolean;
    onClose: () => void;
    onSlot: (kind: RaidplanSlotKind, label: string) => void;
    onMark: (mark: RaidplanMarkName) => void;
    onZone: (type: RaidplanZoneType, shape: "rect" | "ellipse") => void;
}) {
    const t = useT();
    const [label, setLabel] = useState("");
    const [shape, setShape] = useState<"rect" | "ellipse">("rect");
    const done = (fn: () => void) => { fn(); onClose(); };
    return (
        <Modal open={open} onClose={onClose} icon="inv_misc_map02" title={t("raidBoard.add.title")} width={560} hint={t("raidBoard.add.hint")}>
            <div className="rp-add-group">
                <h4 className="rp-kicker">{t("raidBoard.add.slots")}</h4>
                <div className="rp-add-grid">
                    {SLOT_BUTTONS.map((b) => (
                        <button key={b.kind} type="button" className="rp-add-btn" onClick={() => done(() => onSlot(b.kind, ""))}>
                            <WowIcon name={b.icon} size={26} />
                            {t(`raidBoard.slot.kind.${b.kind}`)}
                        </button>
                    ))}
                </div>
                <div className="rp-add-line">
                    <input value={label} maxLength={40} placeholder={t("raidBoard.add.labelPlaceholder")} onChange={(e) => setLabel(e.target.value)} aria-label={t("raidBoard.add.labelPlaceholder")} />
                    <Button variant="ghost" disabled={!label.trim()} onClick={() => done(() => { onSlot("label", label.trim()); setLabel(""); })}>{t("raidBoard.add.label")}</Button>
                </div>
            </div>
            <div className="rp-add-group">
                <h4 className="rp-kicker">{t("raidBoard.add.marks")}</h4>
                <div className="rp-add-marks">
                    {RAID_MARKS.map((m) => (
                        <button key={m} type="button" className="rp-add-btn rp-add-mark" onClick={() => done(() => onMark(m as RaidplanMarkName))} data-tip={t(`raidBoard.mark.${m}`)} aria-label={t(`raidBoard.mark.${m}`)}>
                            <MarkIcon mark={m as RaidplanMarkName} size={32} />
                        </button>
                    ))}
                </div>
            </div>
            <div className="rp-add-group">
                <h4 className="rp-kicker">{t("raidBoard.add.zones")}</h4>
                <div className="rp-add-line">
                    <label className="rp-inline"><input type="radio" name="rp-shape" checked={shape === "rect"} onChange={() => setShape("rect")} /> {t("raidBoard.zone.rect")}</label>
                    <label className="rp-inline"><input type="radio" name="rp-shape" checked={shape === "ellipse"} onChange={() => setShape("ellipse")} /> {t("raidBoard.zone.ellipse")}</label>
                </div>
                <div className="rp-add-grid">
                    {ZONE_TYPES.map((z) => (
                        <button key={z} type="button" className="rp-add-btn" onClick={() => done(() => onZone(z as RaidplanZoneType, shape))}>
                            <span className="rp-add-swatch" style={{ background: ZONE_COLORS[z as RaidplanZoneType] }} aria-hidden="true">{ZONE_GLYPHS[z]}</span>
                            {t(`raidBoard.zone.${z}`)}
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

/** A slot's details: its title, its number, and — in an event plan — the player who stands in it. */
export function SlotModal({ slot, roster, showPlayers, onChange, onAssign, onDelete, onClose }: {
    slot: RaidplanSlot | null;
    roster: RaidplanPlayer[];
    /** An event plan: a slot can take a player. */
    showPlayers: boolean;
    onChange: (patch: Partial<RaidplanSlot>) => void;
    onAssign: (userId: string) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const t = useT();
    return (
        <Modal
            open={!!slot} onClose={onClose} icon="inv_misc_map02" title={slot ? slotTitle(slot) || t("raidBoard.slot.kind.label") : ""} width={460}
            footer={<><Button variant="danger" onClick={onDelete}>{t("raidBoard.selection.delete")}</Button><Button onClick={onClose}>{t("raidBoard.selection.done")}</Button></>}
        >
            {slot && (
                <div className="rp-form">
                    {slot.kind !== "label" && (
                        <label>
                            <span className="rp-kicker">{t("raidBoard.slot.number")}</span>
                            <input type="number" min={1} max={99} value={slot.n} onChange={(e) => onChange({ n: Math.max(1, Math.min(99, Math.floor(Number(e.target.value)) || 1)) })} />
                        </label>
                    )}
                    <label>
                        <span className="rp-kicker">{slot.kind === "label" ? t("raidBoard.slot.text") : t("raidBoard.slot.customTitle")}</span>
                        <input value={slot.label} maxLength={40} placeholder={slot.kind === "label" ? "" : slotTitle({ ...slot, label: "" })} onChange={(e) => onChange({ label: e.target.value })} />
                    </label>
                    {showPlayers && slot.kind !== "group" && (
                        <label>
                            <span className="rp-kicker">{t("raidBoard.slot.player")}</span>
                            <select value={slot.userId} onChange={(e) => onAssign(e.target.value)}>
                                <option value="">{t("raidBoard.slot.open")}</option>
                                {roster.map((p) => <option key={p.userId} value={p.userId}>{p.character} — {[p.specLabel, p.className].filter(Boolean).join(" ")}</option>)}
                            </select>
                        </label>
                    )}
                    {slot.kind === "group" && <p className="rp-muted">{t("raidBoard.slot.groupHint")}</p>}
                </div>
            )}
        </Modal>
    );
}

/** A zone's details: label, type, shape, colour (a preset per type, free to change) and opacity. */
export function ZoneModal({ zone, onChange, onDelete, onClose }: {
    zone: RaidplanZone | null;
    onChange: (patch: Partial<RaidplanZone>) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const t = useT();
    return (
        <Modal
            open={!!zone} onClose={onClose} icon="inv_misc_map02" title={zone ? t(`raidBoard.zone.${zone.type}`) : ""} width={460}
            footer={<><Button variant="danger" onClick={onDelete}>{t("raidBoard.selection.delete")}</Button><Button onClick={onClose}>{t("raidBoard.selection.done")}</Button></>}
        >
            {zone && (
                <div className="rp-form">
                    <label>
                        <span className="rp-kicker">{t("raidBoard.zone.label")}</span>
                        <input value={zone.label} maxLength={40} placeholder={t(`raidBoard.zone.${zone.type}`)} onChange={(e) => onChange({ label: e.target.value })} />
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.zone.type")}</span>
                        {/* Changing the type also moves the colour to that type's preset — the colour stays free to be changed afterwards. */}
                        <select value={zone.type} onChange={(e) => onChange({ type: e.target.value as RaidplanZoneType, color: ZONE_COLORS[e.target.value as RaidplanZoneType] })}>
                            {ZONE_TYPES.map((z) => <option key={z} value={z}>{ZONE_GLYPHS[z]} {t(`raidBoard.zone.${z}`)}</option>)}
                        </select>
                    </label>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.zone.shape")}</span>
                        <select value={zone.shape} onChange={(e) => onChange({ shape: e.target.value as "rect" | "ellipse" })}>
                            <option value="rect">{t("raidBoard.zone.rect")}</option>
                            <option value="ellipse">{t("raidBoard.zone.ellipse")}</option>
                        </select>
                    </label>
                    <div className="rp-color-line">
                        <label>
                            <span className="rp-kicker">{t("raidBoard.zone.color")}</span>
                            <input type="color" className="rp-color" value={zone.color} onChange={(e) => onChange({ color: e.target.value })} />
                        </label>
                        <Button variant="ghost" size="sm" onClick={() => onChange({ color: ZONE_COLORS[zone.type] })}>{t("raidBoard.zone.presetColor")}</Button>
                    </div>
                    <label>
                        <span className="rp-kicker">{t("raidBoard.zone.opacity")} · {Math.round(zone.opacity * 100)} %</span>
                        <input type="range" min={10} max={60} step={5} value={Math.round(zone.opacity * 100)} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
                    </label>
                    <p className="rp-muted">{t("raidBoard.zone.patternHint")}</p>
                </div>
            )}
        </Modal>
    );
}
