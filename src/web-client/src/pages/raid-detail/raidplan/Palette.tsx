import type { PointerEvent, ReactNode } from "react";
import { MoveUpRight, Minus, Type } from "lucide-react";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import { RAID_MARKS, ZONE_COLORS, ZONE_TYPES, type InsertSpec } from "../../../lib/raidplan";
import type { RaidplanMarkName, RaidplanZoneType } from "../../../api";
import { useT } from "../../../i18n";

const SLOT_ICONS: { kind: "tank" | "healer" | "dps" | "group" | "label"; icon: string }[] = [
    { kind: "tank", icon: "ability_warrior_defensivestance" },
    { kind: "healer", icon: "spell_holy_flashheal" },
    { kind: "dps", icon: "ability_dualwield" },
    { kind: "group", icon: "achievement_guildperk_everybodysfriend" },
];

/**
 * The element palette on the left of the board: everything one can put on it
 * besides the players. Drag an entry onto the board (Pointer Events, so a finger
 * works too), or click / press Enter to put it near the middle. What each entry
 * inserts is an InsertSpec (lib/raidplan.ts), the same thing the tool bar and the
 * context menu insert.
 */
export default function Palette({ onStart, onInsert }: {
    onStart: (e: PointerEvent<HTMLElement>, spec: InsertSpec) => void;
    onInsert: (spec: InsertSpec) => void;
}) {
    const t = useT();
    const entry = (key: string, spec: InsertSpec, label: string, body: ReactNode) => (
        <button
            key={key} type="button" className="rp-pal-item" data-tip={label} aria-label={label}
            onPointerDown={(e) => onStart(e, spec)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onInsert(spec); } }}
        >
            {body}
        </button>
    );
    return (
        <aside className="rp-palette" aria-label={t("raidBoard.palette.title")}>
            <h3 className="rp-kicker">{t("raidBoard.palette.marks")}</h3>
            <div className="rp-pal-grid rp-pal-marks">
                {RAID_MARKS.map((m) => entry(m, { type: "mark", mark: m }, t(`raidBoard.mark.${m}`), <MarkIcon mark={m as RaidplanMarkName} size={22} />))}
            </div>
            <h3 className="rp-kicker">{t("raidBoard.palette.slots")}</h3>
            <div className="rp-pal-grid">
                {SLOT_ICONS.map((s) => entry(s.kind, { type: "slot", kind: s.kind, label: "" }, t(`raidBoard.slot.kind.${s.kind}`), <WowIcon name={s.icon} size={26} />))}
                {entry("label", { type: "slot", kind: "label", label: t("raidBoard.slot.kind.label") }, t("raidBoard.slot.kind.label"), <span className="rp-pal-text">Abc</span>)}
            </div>
            <h3 className="rp-kicker">{t("raidBoard.palette.zones")}</h3>
            <div className="rp-pal-grid">
                {ZONE_TYPES.map((z) => entry(z, { type: "zone", zoneType: z, shape: "rect" }, t(`raidBoard.zone.${z}`), (
                    <span className="rp-pal-swatch" style={{ background: ZONE_COLORS[z as RaidplanZoneType] }} aria-hidden="true">{ZONE_GLYPHS[z]}</span>
                )))}
                {entry("ellipse", { type: "zone", zoneType: "neutral", shape: "ellipse" }, t("raidBoard.zone.ellipse"), <span className="rp-pal-swatch rp-pal-round" style={{ background: ZONE_COLORS.neutral }} aria-hidden="true" />)}
            </div>
            <h3 className="rp-kicker">{t("raidBoard.palette.shapes")}</h3>
            <div className="rp-pal-grid">
                {entry("arrow", { type: "line", kind: "arrow" }, t("raidBoard.line.arrow"), <MoveUpRight size={22} />)}
                {entry("line", { type: "line", kind: "line" }, t("raidBoard.line.line"), <Minus size={22} />)}
                {entry("text", { type: "text", text: t("raidBoard.text.default") }, t("raidBoard.tool.text"), <Type size={22} />)}
            </div>
            <p className="rp-muted rp-pal-hint">{t("raidBoard.palette.hint")}</p>
        </aside>
    );
}
