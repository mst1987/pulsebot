import { useState, type ReactNode } from "react";
import { Minus, Plus, Route, Trash2 } from "lucide-react";
import type { RaidplanLoop } from "../../../api";
import { NumberField } from "../NumberField";
import Switch from "../../ui/Switch";
import { buttonClass } from "../../ui/Button";
import { wowIconUrl } from "../../../lib/wow/wowIcon";
import { BADGE_PRESETS } from "../../../lib/raidplan/sceneEdit";
import { useT } from "../../../i18n";

const ICON_NAME = /^[a-z0-9_'-]{2,64}$/;

/** A number with − / + beside it (the field in the middle takes typing and the arrow keys). */
export function Stepper({ value, min, max, step, unit, decimals = 0, label, disabled, onChange }: {
    value: number; min: number; max: number; step: number; unit: string; decimals?: number; label: string; disabled?: boolean; onChange: (v: number) => void;
}) {
    const t = useT();
    const round = (v: number) => Math.round(Math.max(min, Math.min(max, v)) * 10 ** decimals) / 10 ** decimals;
    return (
        <span className="rp-anim-step" role="group" aria-label={label}>
            <button type="button" aria-label={t("raidBoard.anim.less", { what: label })} disabled={disabled || value <= min} onClick={() => onChange(round(value - step))}><Minus size={13} aria-hidden="true" /></button>
            <NumberField value={value} min={min} max={max} step={step} unit={unit} decimals={decimals} label={label} disabled={disabled} onChange={onChange} />
            <button type="button" aria-label={t("raidBoard.anim.more", { what: label })} disabled={disabled || value >= max} onClick={() => onChange(round(value + step))}><Plus size={13} aria-hidden="true" /></button>
        </span>
    );
}

/** One labelled line: the label at the left, the control at the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
    return <div className="rp-anim-prow"><span className="rp-anim-plabel">{label}</span><span className="rp-anim-pctl">{children}</span></div>;
}

/** The debuff icon: six presets with one click, or any WoW icon by its name. */
export function BadgePicker({ value, disabled, onPick }: { value: string; disabled?: boolean; onPick: (icon: string) => void }) {
    const t = useT();
    const [icon, setIcon] = useState("");
    const typed = icon.trim().toLowerCase().replace(/\s+/g, "_");
    return (
        <div className="rp-anim-badge">
            <div className="rp-anim-presets">
                {BADGE_PRESETS.map((p) => (
                    <button key={p} type="button" className={`rp-anim-preset${value === p ? " is-on" : ""}`} disabled={disabled} aria-pressed={value === p} aria-label={t(`raidBoard.anim.preset.${p}`)} data-tip={t(`raidBoard.anim.preset.${p}`)} onClick={() => onPick(p)}>
                        <img src={wowIconUrl(p, 36)} alt="" width={26} height={26} />
                    </button>
                ))}
            </div>
            <div className="rp-anim-iconname">
                <input className="inp-sm rp-anim-input" value={icon} placeholder="spell_fire_fireball" disabled={disabled} aria-label={t("raidBoard.anim.badgeName")} onChange={(e) => setIcon(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && ICON_NAME.test(typed)) { onPick(typed); setIcon(""); } }} />
                <button type="button" className={buttonClass("ghost", "sm")} disabled={disabled || !ICON_NAME.test(typed)} onClick={() => { onPick(typed); setIcon(""); }}>{t("raidBoard.anim.badgeSet")}</button>
            </div>
            {value && !BADGE_PRESETS.includes(value) && (
                <div className="rp-anim-badgenow"><img src={wowIconUrl(value, 36)} alt="" width={22} height={22} /><code>{value}</code></div>
            )}
        </div>
    );
}

/** A loop: its way (drawn on the map), round or there and back, how long a round takes, when it runs, a trail. */
export function LoopEditor({ loop, length, off, drawing, onDraw, onChange, onRemove }: {
    loop: RaidplanLoop;
    /** the scene's length (the latest a loop can start) */
    length: number;
    off: boolean;
    drawing: boolean;
    onDraw: (on: boolean) => void;
    onChange: (patch: Partial<RaidplanLoop>) => void;
    onRemove?: () => void;
}) {
    const t = useT();
    return (
        <div className={`rp-anim-loop${drawing ? " is-drawing" : ""}`}>
            <div className="rp-anim-loophead">
                <span className="rp-muted">{t("raidBoard.anim.wayN", { n: loop.path.length })}</span>
                <button type="button" className={buttonClass(drawing ? "primary" : "ghost", "sm", true)} disabled={off} aria-pressed={drawing} onClick={() => onDraw(!drawing)}>
                    <Route size={13} aria-hidden="true" />{drawing ? t("raidBoard.anim.drawDone") : t("raidBoard.anim.drawWay")}
                </button>
                {onRemove && <button type="button" className="rp-anim-iconbtn" disabled={off} aria-label={t("raidBoard.anim.removeLoopOne")} data-tip={t("raidBoard.anim.removeLoopOne")} onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></button>}
            </div>
            {drawing && <p className="rp-anim-drawnote" role="status">{loop.path.length < 2 ? t("raidBoard.anim.loopFirst") : t("raidBoard.anim.drawNote")}</p>}
            <Switch checked={loop.closed} disabled={off} onChange={(v) => onChange({ closed: v })} label={t("raidBoard.anim.closed")} tip={t("raidBoard.anim.closedTip")} />
            <Row label={t("raidBoard.anim.period")}>
                <Stepper value={loop.period} min={1} max={600} step={1} unit="s" decimals={1} label={t("raidBoard.anim.period")} disabled={off} onChange={(v) => onChange({ period: v })} />
            </Row>
            <Row label={t("raidBoard.anim.loopFrom")}>
                <Stepper value={loop.from} min={0} max={Math.max(0, length)} step={0.5} unit="s" decimals={1} label={t("raidBoard.anim.loopFrom")} disabled={off} onChange={(v) => onChange({ from: v })} />
            </Row>
            <Row label={loop.to > 0 ? t("raidBoard.anim.loopTo") : t("raidBoard.anim.loopToEnd")}>
                <Stepper value={loop.to} min={0} max={600} step={0.5} unit="s" decimals={1} label={t("raidBoard.anim.loopTo")} disabled={off} onChange={(v) => onChange({ to: v })} />
            </Row>
            <Switch checked={loop.trail} disabled={off} onChange={(v) => onChange({ trail: v })} label={t("raidBoard.anim.trail")} tip={t("raidBoard.anim.trailTip")} />
        </div>
    );
}
