import type { ReactNode } from "react";
import type { EmbedImage, GameVersion, RoleRange } from "../api";
import { EMBED_ACCENT, allowedSizes, instancesOf, leadInstance } from "../lib/raidTemplates";
import Segment from "./ui/Segment";
import Badge from "./ui/Badge";
import WowIcon from "./ui/WowIcon";
import { WarnIcon } from "./settingsUi";
import { roleLabel } from "../lib/wowNames";
import { useT } from "../i18n";
import "../styles/raid-templates.css";

// The fields of a raid plan besides CompositionEditor, shared by the "Event
// anlegen" dialog (#261) and the Raid-Vorlagen editor (#266): instance chips from
// the rule set, the size segment, the melee/ranged ranges, the required buffs, a
// small number field, a switch row — and the "Aussehen" line (#307), which is
// one row for both editors so a template and an event never drift apart.
// Styled with the Raid-Vorlagen classes (rt-), so an event and a template look
// alike.

const FREE = "free";

/** A small label with its explanation in the tooltip. */
export function FieldLabel({ text, tip }: { text: string; tip?: string }) {
    return <span className="rt-flabel" data-tip={tip ? text : undefined} data-tip-sub={tip}>{text}</span>;
}

/** The instances of a version as icon chips; "Infos fehlen" marks an incomplete one. */
export function InstancePicker({ version, value, onToggle }: {
    version: GameVersion | null;
    value: string[];
    onToggle: (id: string) => void;
}) {
    const t = useT();
    const chosen = instancesOf(version, value);
    return (
        <div className="rt-field">
            <FieldLabel text={t("raidPlan.fields.instances")} tip={t("raidPlan.fields.instancesTip")} />
            <div className="rt-insts" role="group" aria-label={t("raidPlan.fields.instances")}>
                {(version?.instances || []).map((inst) => {
                    const on = value.includes(inst.id);
                    return (
                        <button key={inst.id} type="button" className={`rt-inst${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(inst.id)}
                            data-tip={inst.name} data-tip-sub={inst.status === "incomplete" ? t("raidPlan.fields.incompleteTip") : t("raidPlan.fields.players", { sizes: inst.sizes.join("/") })}>
                            <WowIcon name={inst.icon} size={20} />{inst.short}
                            {inst.status === "incomplete" && <WarnIcon />}
                        </button>
                    );
                })}
            </div>
            {chosen.some((i) => i.status === "incomplete") && <Badge tone="mid" icon={<WarnIcon />}>{t("raidPlan.fields.incomplete")}</Badge>}
        </div>
    );
}

/**
 * The allowed sizes of the chosen instances as a segment, plus "frei" with a
 * number field. `size` null = not set yet (a migrated template): nothing is
 * selected; an emptied free field reports null. `children` sit beside it (a
 * "Größe ergänzen" badge).
 */
export function SizePicker({ version, instanceIds, size, free, onFree, onSize, children }: {
    version: GameVersion | null;
    instanceIds: string[];
    size: number | null;
    free: boolean;
    onFree: (free: boolean) => void;
    onSize: (size: number | null) => void;
    children?: ReactNode;
}) {
    const t = useT();
    const sizes = allowedSizes(version, instanceIds);
    const isFree = free || (size !== null && !sizes.includes(size));
    return (
        <div className="rt-field">
            <FieldLabel text={t("raidPlan.fields.size")} tip={t("raidPlan.fields.sizeTip")} />
            <div className="rt-sizes">
                <Segment
                    size="sm"
                    ariaLabel={t("raidPlan.fields.size")}
                    value={size === null && !free ? "" : (isFree ? FREE : String(size))}
                    onChange={(v) => {
                        if (v === FREE) { onFree(true); return; }
                        onFree(false);
                        onSize(Number(v));
                    }}
                    options={[...sizes.map((s) => ({ value: String(s), label: String(s) })), { value: FREE, label: t("raidPlan.fields.free") }]}
                />
                {isFree && (
                    <input className="inp-sm rt-size-input" type="number" min={1} max={40} aria-label={t("raidPlan.fields.freeAria")} value={size || ""}
                        onChange={(e) => onSize(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                )}
                {children}
            </div>
        </div>
    );
}

/** A small labelled number field (0–40 by default); empty = null. */
export function NumberInput({ id, label, value, onChange, placeholder = "–", max = 40 }: {
    id: string;
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    placeholder?: string;
    max?: number;
}) {
    return (
        <div className="rt-num-field">
            <label htmlFor={id}>{label}</label>
            <input id={id} className="inp-sm" type="number" min={0} max={max} value={value === null ? "" : value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
    );
}

/** Melee and ranged as optional "min – max" ranges; both empty = no target. */
export function RoleRanges({ melee, ranged, onChange, idPrefix }: {
    melee: RoleRange | null;
    ranged: RoleRange | null;
    onChange: (next: { melee: RoleRange | null; ranged: RoleRange | null }) => void;
    idPrefix: string;
}) {
    const t = useT();
    const row = (key: "melee" | "ranged", label: string, value: RoleRange | null) => {
        const set = (min: number | null, max: number | null) => {
            const range = min === null && max === null ? null : { min: min || 0, max };
            onChange({ melee, ranged, [key]: range });
        };
        return (
            <div className="rt-range">
                <span className="rt-range-lbl">{label}</span>
                <NumberInput id={`${idPrefix}-${key}-min`} label={t("raidPlan.fields.min")} value={value ? value.min : null} onChange={(min) => set(min, value ? value.max : null)} />
                <NumberInput id={`${idPrefix}-${key}-max`} label={t("raidPlan.fields.max")} value={value ? value.max : null} onChange={(max) => set(value ? value.min : null, max)} />
            </div>
        );
    };
    return (
        <div className="rt-ranges">
            {row("melee", roleLabel("melee"), melee)}
            {row("ranged", roleLabel("ranged"), ranged)}
        </div>
    );
}

/**
 * "Aussehen" (#307): the colour bar and the picture of the bot's event message,
 * in one row — a colour field with a swatch, a picture URL with Thumbnail /
 * Banner, and a small preview of the embed's left edge so the choice is visible
 * instead of a hex code nobody can picture.
 *
 * Both fields may stay empty: then the leading instance of the night decides
 * (its colour and its boss icon), which the preview says in as many words.
 */
export function AppearanceFields({ version, instanceIds, color, image, onChange, idPrefix }: {
    version: GameVersion | null;
    instanceIds: string[];
    color: string;
    image: EmbedImage;
    onChange: (next: { color?: string; image?: EmbedImage }) => void;
    idPrefix: string;
}) {
    const t = useT();
    const lead = leadInstance(version, instanceIds);
    const ownColor = /^#[0-9a-f]{6}$/i.test(String(color || "").trim());
    const shown = ownColor ? color.trim().toLowerCase() : ((lead && lead.color) || EMBED_ACCENT);
    const url = String(image.url || "").trim();
    const banner = image.mode === "banner";
    const from = ownColor
        ? t("raidPlan.fields.ownColor")
        : (lead && lead.color ? t("raidPlan.fields.colorOf", { name: lead.short }) : t("raidPlan.fields.defaultColor"));
    const picture = url
        ? (banner ? t("raidPlan.fields.ownImageBanner") : t("raidPlan.fields.ownImageThumb"))
        : (lead ? t("raidPlan.fields.bossIconOf", { name: lead.short }) : t("raidPlan.fields.noImage"));

    return (
        <div className="rt-field">
            <FieldLabel text={t("raidPlan.fields.look")} tip={t("raidPlan.fields.lookTip")} />
            <div className="rt-look">
                <div className="rt-look-prev" aria-hidden="true">
                    <span className="rt-look-bar" style={{ background: shown }} />
                    {url
                        ? <img className={banner ? "rt-look-banner" : "rt-look-thumb"} src={url} alt="" />
                        : (lead ? <WowIcon name={lead.icon} size={40} /> : null)}
                </div>
                <div className="rt-look-fields">
                    <div className="rt-look-row">
                        <input id={`${idPrefix}-color-pick`} className="rt-look-swatch" type="color" aria-label={t("raidPlan.fields.pickColor")}
                            value={shown} onChange={(e) => onChange({ color: e.target.value.toLowerCase() })} />
                        <input id={`${idPrefix}-color`} className="inp-sm mono rt-look-hex" type="text" aria-label={t("raidPlan.fields.colorHex")}
                            value={color} placeholder={shown} onChange={(e) => onChange({ color: e.target.value })} />
                        {ownColor && (
                            <button type="button" className="rt-look-reset" onClick={() => onChange({ color: "" })}
                                data-tip={t("raidPlan.fields.reset")} data-tip-sub={t("raidPlan.fields.resetTip")}>{t("raidPlan.fields.reset")}</button>
                        )}
                        <span className="rt-look-note">{from} · {picture}</span>
                    </div>
                    <div className="rt-look-row">
                        <input id={`${idPrefix}-image`} className="inp-sm rt-look-url" type="url" aria-label={t("raidPlan.fields.imageUrl")}
                            value={image.url} placeholder={t("raidPlan.fields.imagePlaceholder")}
                            onChange={(e) => onChange({ image: { mode: image.mode, url: e.target.value } })} />
                        <Segment size="sm" ariaLabel={t("raidPlan.fields.image")} value={image.mode}
                            onChange={(mode) => onChange({ image: { mode: mode === "banner" ? "banner" : "thumbnail", url: image.url } })}
                            options={[
                                { value: "thumbnail", label: t("raidPlan.fields.thumbnail"), tip: t("raidPlan.fields.thumbnailTip") },
                                { value: "banner", label: t("raidPlan.fields.banner"), tip: t("raidPlan.fields.bannerTip") },
                            ]} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/** The version's raid and party buffs as icon toggles. */
export function BuffPicker({ version, value, onToggle }: { version: GameVersion | null; value: string[]; onToggle: (key: string) => void }) {
    const t = useT();
    const buffs = version ? [...version.raidBuffs, ...version.partyBuffs] : [];
    return (
        <div className="rt-field">
            <FieldLabel text={t("raidPlan.fields.buffs")} tip={t("raidPlan.fields.buffsTip")} />
            <div className="rt-buffs">
                {buffs.map((b) => {
                    const on = value.includes(b.key);
                    return (
                        <button key={`${b.scope}-${b.key}`} type="button" className={`rt-buff${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(b.key)}
                            data-tip={b.label} data-tip-sub={b.scope === "party" ? t("raidPlan.fields.partyBuff") : t("raidPlan.fields.raidBuff")}>
                            <WowIcon name={b.icon} size={24} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** One labelled switch, its explanation in the tooltip. */
export function SwitchRow({ label, tip, checked, onChange }: { label: string; tip: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="switch-row" data-tip={label} data-tip-sub={tip}>
            <span className="switch">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            {label}
        </label>
    );
}
