import { useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Crosshair, Minus, MoveUpRight, Swords, Type } from "lucide-react";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { ZONE_GLYPHS } from "../../../components/raidplan/PlanBoard";
import { RAID_MARKS, ROLE_GROUP_COLORS, ZONE_COLORS, ZONE_TYPES, iconKeyForBoss, type InsertSpec } from "../../../lib/raidplan";
import { wowIconUrl } from "../../../lib/wowIcon";
import type { RaidplanBoss, RaidplanMarkName, RaidplanZoneType } from "../../../api";
import { useT } from "../../../i18n";

const SLOT_ICONS: { kind: "tank" | "healer" | "melee" | "ranged" | "dps" | "group" | "label"; icon: string }[] = [
    { kind: "tank", icon: "ability_warrior_defensivestance" },
    { kind: "healer", icon: "spell_holy_flashheal" },
    { kind: "melee", icon: "ability_dualwield" },
    { kind: "ranged", icon: "inv_weapon_bow_07" },
    { kind: "dps", icon: "inv_misc_questionmark" },
    { kind: "group", icon: "achievement_guildperk_everybodysfriend" },
];

// the role group placeholders ("Melees", "Ranged" first): a whole role, never players
const ROLE_GROUP_ICONS: { role: "melee" | "ranged" | "healer" | "tank" | "dps"; icon: string }[] = [
    { role: "melee", icon: "ability_dualwield" },
    { role: "ranged", icon: "inv_weapon_bow_07" },
    { role: "healer", icon: "spell_holy_flashheal" },
    { role: "tank", icon: "ability_warrior_defensivestance" },
    { role: "dps", icon: "inv_misc_questionmark" },
];

/** What is typed as an icon name, cleaned the way the server checks it (lower case, underscores). */
function cleanIconName(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_'-]/g, "").slice(0, 64);
}

/**
 * The element palette on the left of the board: everything one can put on it
 * besides the players. Drag an entry onto the board (Pointer Events, so a finger
 * works too), or click / press Enter to put it near the middle. What each entry
 * inserts is an InsertSpec (lib/raidplan.ts), the same thing the tool bar and the
 * context menu insert.
 *
 * "Encounter": the icons of the plan's bosses (this boss first; a boss the
 * encounter list has no picture for shows its instance's icon), an enemy / add
 * and a boss-position symbol. "Icon-Name": any spell or ability icon of the icon
 * CDN the client already uses for its WoW icons, by its name (there is no search
 * over the names; the preview shows whether the name exists).
 */
export default function Palette({ onStart, onInsert, bosses, currentBoss, tally }: {
    onStart: (e: PointerEvent<HTMLElement>, spec: InsertSpec) => void;
    onInsert: (spec: InsertSpec) => void;
    bosses: RaidplanBoss[];
    currentBoss: string;
    /** per role kind: how many of the Besetzung's slots are on the map — a kind with all of them placed is greyed out */
    tally: { kind: string; placed: number; total: number }[];
}) {
    const t = useT();
    const [name, setName] = useState("");
    const [found, setFound] = useState(false);
    const clean = cleanIconName(name);
    const entry = (key: string, spec: InsertSpec, label: string, body: ReactNode, disabled = false) => (
        <button
            key={key} type="button" className={`rp-pal-item${disabled ? " is-full" : ""}`} data-tip={label} aria-label={label} aria-disabled={disabled}
            onPointerDown={(e) => { if (!disabled) onStart(e, spec); }}
            onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onInsert(spec); } }}
        >
            {body}
        </button>
    );
    /** A role slot of the palette: it places one of the Besetzung's slots; once all are on the map it is greyed out and says so. */
    const slotEntry = (kind: string, icon: string) => {
        const tl = tally.find((x) => x.kind === kind);
        const off = !!tl && tl.placed >= tl.total;
        const name = t(`raidBoard.slot.kind.${kind}`);
        const label = tl ? `${name} ${tl.placed}/${tl.total}${off ? ` · ${t("raidBoard.palette.allPlaced")}` : ""}` : name;
        return entry(kind, { type: "slot", kind: kind as never, label: "" }, label, (
            <>
                <WowIcon name={icon} size={26} />
                {tl && <span className="rp-pal-tally">{tl.placed}/{tl.total}</span>}
            </>
        ), off);
    };
    const real = bosses.filter((b) => !b.trash && !b.general);
    const ordered = [...real.filter((b) => b.key === currentBoss), ...real.filter((b) => b.key !== currentBoss)];
    return (
        <aside className="rp-palette" aria-label={t("raidBoard.palette.title")}>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.marks")}</h3>
                <div className="rp-pal-grid rp-pal-marks">
                    {RAID_MARKS.map((m) => entry(m, { type: "mark", mark: m }, t(`raidBoard.mark.${m}`), <MarkIcon mark={m as RaidplanMarkName} size={22} />))}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.slots")}</h3>
                <div className="rp-pal-grid">
                    {SLOT_ICONS.map((s) => slotEntry(s.kind, s.icon))}
                    {entry("label", { type: "slot", kind: "label", label: t("raidBoard.slot.kind.label") }, t("raidBoard.slot.kind.label"), <span className="rp-pal-text">Abc</span>)}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.encounter")}</h3>
                <div className="rp-pal-grid">
                    {ordered.map((b) => entry(`boss-${b.key}`, { type: "icon", iconKey: iconKeyForBoss(b.iconUrl), label: b.name, mobId: `b:${b.key}` }, b.name, <img className="rp-pal-boss" src={b.iconUrl} alt="" width={28} height={28} draggable={false} />))}
                    {entry("enemy", { type: "icon", iconKey: "enemy", label: "" }, t("raidBoard.icon.enemy"), <Swords size={22} />)}
                    {entry("bosspos", { type: "icon", iconKey: "bosspos", label: "" }, t("raidBoard.icon.bosspos"), <Crosshair size={22} />)}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.iconByName")}</h3>
                <div className="rp-pal-name">
                    <input
                        value={name} placeholder="spell_fire_fireball" aria-label={t("raidBoard.palette.iconByName")}
                        onChange={(e) => { setName(e.target.value); setFound(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter" && found) { onInsert({ type: "icon", iconKey: `wow:${clean}`, label: "" }); } }}
                    />
                    {clean.length >= 2 && (
                        <button
                            type="button" className="rp-pal-item rp-pal-preview" disabled={!found} aria-label={t("raidBoard.palette.iconInsert")} data-tip={found ? t("raidBoard.palette.iconInsert") : t("raidBoard.palette.iconUnknown")}
                            onPointerDown={(e) => found && onStart(e, { type: "icon", iconKey: `wow:${clean}`, label: "" })}
                            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && found) { e.preventDefault(); onInsert({ type: "icon", iconKey: `wow:${clean}`, label: "" }); } }}
                        >
                            <img key={clean} src={wowIconUrl(clean, 56)} alt="" width={28} height={28} draggable={false} onLoad={() => setFound(true)} onError={() => setFound(false)} />
                        </button>
                    )}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.zones")}</h3>
                <div className="rp-pal-grid">
                    {ZONE_TYPES.map((z) => entry(z, { type: "zone", zoneType: z, shape: "rect" }, t(`raidBoard.zone.${z}`), (
                        <span className="rp-pal-swatch" style={{ background: ZONE_COLORS[z as RaidplanZoneType] }} aria-hidden="true">{ZONE_GLYPHS[z]}</span>
                    )))}
                    {entry("ellipse", { type: "zone", zoneType: "neutral", shape: "ellipse" }, t("raidBoard.zone.ellipse"), <span className="rp-pal-swatch rp-pal-round" style={{ background: ZONE_COLORS.neutral }} aria-hidden="true" />)}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker" data-tip={t("raidBoard.roleGroupUi.hint")}>{t("raidBoard.palette.roleGroups")}</h3>
                <div className="rp-pal-grid">
                    {ROLE_GROUP_ICONS.map((r) => entry(`role-${r.role}`, { type: "zone", zoneType: "role", shape: "ellipse", role: r.role }, t(`raidBoard.roleGroup.${r.role}`), <span className={`rp-rolechip-ico rp-role-${r.role}`} style={{ "--rc": ROLE_GROUP_COLORS[r.role] } as CSSProperties}><WowIcon name={r.icon} size={24} /></span>))}
                </div>
            </div>
            <div className="rp-palette-group">
                <h3 className="rp-kicker">{t("raidBoard.palette.shapes")}</h3>
                <div className="rp-pal-grid">
                    {entry("arrow", { type: "line", kind: "arrow" }, t("raidBoard.line.arrow"), <MoveUpRight size={22} />)}
                    {entry("line", { type: "line", kind: "line" }, t("raidBoard.line.line"), <Minus size={22} />)}
                    {entry("text", { type: "text", text: t("raidBoard.text.default") }, t("raidBoard.tool.text"), <Type size={22} />)}
                </div>

            </div>
            <p className="rp-muted rp-pal-hint">{t("raidBoard.palette.hint")}</p>
        </aside>
    );
}
