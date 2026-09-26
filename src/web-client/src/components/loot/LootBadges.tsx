// The small shapes the loot views are built from.
//
//   ReasonBadge   — a normalized award reason ("Mainspec", "Offspec", …) in the
//                   colour of its tone, optionally with a count; as a button it
//                   opens what is behind it.
//   RaiderBadge   — a raider as spec icon + class-coloured name, linking to
//                   their loot history.
//   RaiderChip    — the same look without the link, for a row that is itself
//                   clickable (a link inside a clickable row would do two things).
//   StackBar      — how a set of awards splits over the reasons, as one
//                   stacked bar in the reason colours.
//   ItemIcon      — an item icon framed in its quality colour.
//
// Colours are never decided here: the server hands every loot row its reason
// tone (utils/lootReasons.js) and every raider their class colour + spec icon
// (the same rule ClassSpec.tsx already documents). This file only maps a tone
// onto its CSS class or token, so a reason added on the server needs no client
// change.
import { Link } from "react-router-dom";
import type { LootReason } from "../../api";
import { itemQualityColor } from "../../lib/itemQuality";
import { classColorProps } from "../ClassSpec";
import { useT } from "../../i18n";

// Tones the stylesheet knows (.rbadge-*, --reason-*). Anything else falls back to
// the neutral badge rather than rendering an unstyled chip.
const TONES = new Set([
    "bis", "mainspec", "upgrade", "minor", "offspec", "pvp", "greed", "disenchant", "bank", "other",
]);

export function reasonToneClass(tone?: string): string {
    return `rbadge rbadge-${tone && TONES.has(tone) ? tone : "other"}`;
}

/** The token a reason tone is drawn in — for a bar segment rather than a badge. */
function reasonColor(tone?: string): string {
    return tone && TONES.has(tone) && tone !== "other" ? `var(--reason-${tone})` : "var(--muted)";
}

// The raid an item comes from, as the achievement icon of its final boss — the
// icon every TBC player knows the raid by. Content ids from config/tbcContent.js.
// Names checked against the zamimg CDN (Archimonde only exists with the "-").
export const CONTENT_ICONS: Record<string, string> = {
    kara: "achievement_boss_prince_malchezaar",
    gruul: "achievement_boss_gruulthedragonkiller",
    mag: "achievement_boss_magtheridon",
    ssc: "achievement_boss_ladyvashj",
    tk: "achievement_boss_kael'thassunstrider_01",
    za: "achievement_boss_zuljin",
    hyjal: "achievement_boss_archimonde-",
    bt: "achievement_boss_illidan",
    swp: "achievement_boss_kiljaedan",
};

/** The raid icon for a content id; the question mark for an unknown one. */
export function contentIcon(contentId?: string): string {
    return (contentId && CONTENT_ICONS[contentId]) || "inv_misc_questionmark";
}

/** A plain reason chip — the label, and the count when there is one. */
export function ReasonBadge({ label, tone, count, title, tipSub }: {
    label: string;
    tone?: string;
    count?: number;
    /** Usually the addon's raw response text or the bucket, for the tooltip head. */
    title?: string;
    tipSub?: string;
}) {
    return (
        <span className={reasonToneClass(tone)} data-tip={title} data-tip-sub={title ? tipSub : undefined}>
            {label}
            {count !== undefined && <span className="rbadge-count">{count}</span>}
        </span>
    );
}

/**
 * A reason chip that opens the items behind it — "8× Offspec" is only useful if
 * it can be unfolded into which eight pieces those were. It opens the
 * raider's reason dialog instead of a hover panel (see LootReasonsTab).
 */
export function ReasonBadgeButton({ label, reasonLabel, tone, count, onOpen }: {
    label: string;
    reasonLabel?: string;
    tone?: string;
    count: number;
    onOpen: () => void;
}) {
    const t = useT();
    const differs = !!reasonLabel && reasonLabel !== label;
    return (
        <button
            type="button"
            className={reasonToneClass(tone)}
            data-tip={differs ? t("history.badges.reasonDiffers", { label, reason: reasonLabel }) : label}
            data-tip-sub={t("raidDetail.lootBadges.itemsClick", { count })}
            onClick={onOpen}
        >
            {label}
            <span className="rbadge-count">{count}</span>
        </button>
    );
}

/**
 * Spec icon + class-coloured name, linking to the character's loot history.
 * `className`/`spec` are only for the tooltip ("Restoration Shaman") — a spec icon
 * is quick to recognise but not everybody reads all thirty of them.
 */
export function RaiderBadge({ character, classColor, iconUrl, className, spec }: {
    character: string;
    classColor?: string;
    iconUrl?: string;
    className?: string;
    spec?: string;
}) {
    const specLabel = className ? (spec ? `${spec} ${className}` : className) : "";
    return (
        <Link className="raider-badge" to={`/history/char?name=${encodeURIComponent(character)}`} data-tip={specLabel || undefined}>
            {iconUrl
                ? <img className="raider-badge-ico" src={iconUrl} alt="" loading="lazy" />
                : <span className="raider-badge-ico raider-badge-ico-ph" />}
            <span {...classColorProps(classColor)}>{character}</span>
        </Link>
    );
}

/** RaiderBadge without the link — inside a row that opens a dialog on click. */
export function RaiderChip({ character, classColor, iconUrl }: {
    character: string;
    classColor?: string;
    iconUrl?: string;
}) {
    return (
        <span className="raider-badge">
            {iconUrl
                ? <img className="raider-badge-ico" src={iconUrl} alt="" loading="lazy" />
                : <span className="raider-badge-ico raider-badge-ico-ph" />}
            <span {...classColorProps(classColor)}>{character}</span>
        </span>
    );
}

export type ReasonCount = { id: string; label: string; reasonLabel: string; tone: string; count: number; order: number };

/**
 * How a set of awards splits over the reasons, strongest reason first. The label
 * is the guild's own wording when every award of a bucket carries the same one
 * ("Zweitspec" rather than "Offspec") — the same rule lootStats.js applies.
 */
export function tallyReasons(
    awards: { reason: string; reasonLabel: string; reasonTone: string; response?: string }[],
    catalog: LootReason[] = [],
): ReasonCount[] {
    const order = new Map(catalog.map((r) => [r.id, r.order]));
    const byReason = new Map<string, { entry: ReasonCount; responses: Set<string> }>();
    for (const a of awards) {
        const key = a.reason || "other";
        if (!byReason.has(key)) {
            byReason.set(key, {
                entry: { id: key, label: a.reasonLabel || key, reasonLabel: a.reasonLabel || key, tone: a.reasonTone, count: 0, order: order.get(key) ?? 99 },
                responses: new Set(),
            });
        }
        const slot = byReason.get(key)!;
        slot.entry.count += 1;
        slot.responses.add(String(a.response || "").trim());
    }
    return [...byReason.values()]
        .map(({ entry, responses }) => {
            const only = responses.size === 1 ? [...responses][0] : "";
            return only ? { ...entry, label: only } : entry;
        })
        .sort((a, b) => a.order - b.order || b.count - a.count);
}

/** "BiS 2 · Mainspec 6 · Zweitspec 1" — the tooltip line under a stacked bar. */
function reasonSummary(parts: ReasonCount[]): string {
    return parts.map((p) => `${p.label} ${p.count}`).join(" · ");
}

/**
 * The reasons as one stacked bar in their tone colours. Fixed width by class
 * (120 px, `mid` 200 px, `wide` the container), so bars in one column compare.
 */
export function StackBar({ parts, size, tip, tipSub }: {
    parts: ReasonCount[];
    size?: "mid" | "wide";
    tip?: string;
    tipSub?: string;
}) {
    const t = useT();
    const total = parts.reduce((n, p) => n + p.count, 0);
    return (
        <span
            className={["hl-stack", size || ""].filter(Boolean).join(" ")}
            data-tip={tip ?? t("raidDetail.lootBadges.awards", { count: total })}
            data-tip-sub={tipSub ?? reasonSummary(parts)}
            role="img"
            aria-label={reasonSummary(parts)}
        >
            {total > 0 && parts.map((p) => (
                <span key={p.id} style={{ "--hl-w": `${(p.count / total) * 100}%`, "--hl-c": reasonColor(p.tone) } as React.CSSProperties} />
            ))}
        </span>
    );
}

/** An item icon framed in its quality colour. */
export function ItemIcon({ url, quality, size }: { url?: string; quality?: number | null; size?: "md" | "lg" }) {
    const color = itemQualityColor(quality);
    const style = color ? ({ "--iqb": color } as React.CSSProperties) : undefined;
    const cls = ["hl-ico", size || ""].filter(Boolean).join(" ");
    return url
        ? <img className={cls} src={url} alt="" loading="lazy" style={style} />
        : <span className={cls} style={style} />;
}
