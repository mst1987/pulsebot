// The two badge shapes the loot overviews are built from.
//
//   ReasonBadge  — a normalized award reason ("Mainspec", "Offspec", "PvP", …)
//                  in the colour of its tone, optionally with a count and a
//                  hover list of the items won for that reason.
//   RaiderBadge  — a raider as spec icon + class-coloured name, with a hover
//                  list of when/where/why they got an item.
//
// Colours are never decided here: the server hands every loot row its reason
// tone (utils/lootReasons.js) and every raider their class colour + spec icon
// (the same rule ClassSpec.tsx already documents). This file only maps a tone
// onto its CSS class, so a reason added on the server needs no client change.
import { Link } from "react-router-dom";
import type { CharLootPreview, LootAward } from "../api";
import { fmtMs } from "../lib/format";
import { itemQualityProps } from "../lib/itemQuality";
import { HoverPanel } from "./HoverPanel";
import { classColorProps } from "./ClassSpec";

// Tones the stylesheet knows (.rbadge-*). Anything else falls back to the
// neutral badge rather than rendering an unstyled chip.
const TONES = new Set([
    "bis", "mainspec", "upgrade", "minor", "offspec", "pvp", "greed", "disenchant", "bank", "other",
]);

export function reasonToneClass(tone?: string): string {
    return `rbadge rbadge-${tone && TONES.has(tone) ? tone : "other"}`;
}

/** A plain reason chip — the label, and the count when there is one. */
export function ReasonBadge({ label, tone, count, title }: {
    label: string;
    tone?: string;
    count?: number;
    /** Usually the addon's raw response text, so a guild-specific wording
     *  ("Zweitspec") stays readable behind the bucketed label. */
    title?: string;
}) {
    return (
        <span className={reasonToneClass(tone)} title={title}>
            {label}
            {count !== undefined && <span className="rbadge-count">{count}</span>}
        </span>
    );
}

/**
 * A reason chip that opens the items behind it. This is the overview's whole
 * point: "8× Offspec" is only useful if it can be unfolded into which eight
 * pieces those were.
 */
export function ReasonBadgeHover({ label, reasonLabel, tone, count, items }: {
    /** The guild's own wording where it is unambiguous (see lootStats.js). */
    label: string;
    /** The bucket this belongs to — only shown when it differs from the label. */
    reasonLabel?: string;
    tone?: string;
    count: number;
    items: CharLootPreview[];
}) {
    const trigger = (
        <>
            {label}
            <span className="rbadge-count">{count}</span>
        </>
    );
    const head = reasonLabel && reasonLabel !== label
        ? `${label} (${reasonLabel}) · ${count} Item${count === 1 ? "" : "s"}`
        : `${label} · ${count} Item${count === 1 ? "" : "s"}`;
    return (
        <HoverPanel
            trigger={trigger}
            head={head}
            className={reasonToneClass(tone)}
        >
            {items.map((it, i) => (
                <div className="loot-pop-row" key={`${it.itemId}-${it.awardedAt}-${i}`}>
                    {it.itemIconUrl
                        ? <img className="loot-pop-ico" src={it.itemIconUrl} alt="" loading="lazy" />
                        : <span className="loot-pop-ico loot-pop-ico-ph" />}
                    <div className="loot-pop-body">
                        <div {...itemQualityProps(it.itemQuality, "loot-pop-name")} title={it.itemName || `Item ${it.itemId}`}>{it.itemName || `Item ${it.itemId}`}</div>
                        <div className="loot-pop-meta">
                            {!!it.eventLabel && <span className="lbadge lbadge-neutral">{it.eventLabel}</span>}
                            {!!it.awardedAt && <span className="sub" style={{ margin: 0 }}>{fmtMs(it.awardedAt, false)}</span>}
                            {/* The raw response, when the guild wrote something
                                more specific than the bucket it landed in. */}
                            {!!it.response && it.response !== label && <span className="sub" style={{ margin: 0 }}>„{it.response}"</span>}
                        </div>
                    </div>
                </div>
            ))}
        </HoverPanel>
    );
}

/**
 * Spec icon + class-coloured name, linking to the character's loot history.
 * `className`/`spec` are only for the hover ("Restoration Shaman") — a spec icon
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
        <Link className="raider-badge" to={`/history/char?name=${encodeURIComponent(character)}`} title={specLabel || undefined}>
            {iconUrl
                ? <img className="raider-badge-ico" src={iconUrl} alt="" loading="lazy" />
                : <span className="raider-badge-ico raider-badge-ico-ph" />}
            <span {...classColorProps(classColor)}>{character}</span>
        </Link>
    );
}

/**
 * One recipient of an item: the raider chip, plus a hover telling when they got
 * it, in which raid and for what reason — the three things a raid lead asks
 * when they see a name under an item.
 */
export function AwardBadge({ award }: { award: LootAward }) {
    const specLabel = award.spec ? `${award.spec} ${award.className}` : award.className;
    const colored = classColorProps(award.classColor);
    const trigger = (
        <>
            {award.iconUrl
                ? <img className="raider-badge-ico" src={award.iconUrl} alt="" loading="lazy" />
                : <span className="raider-badge-ico raider-badge-ico-ph" />}
            <span {...colored}>{award.character}</span>
        </>
    );
    return (
        <HoverPanel trigger={trigger} head={specLabel || award.character} width={300} className="raider-badge">
            <div className="loot-pop-row">
                <div className="loot-pop-body" style={{ gap: 5 }}>
                    <div className={`loot-pop-name${colored.className ? ` ${colored.className}` : ""}`} style={colored.style}>{award.character}</div>
                    <div className="loot-pop-meta">
                        {/* The addon's own wording, coloured by the bucket it
                            belongs to — the bucket name is only spelled out in
                            the tooltip, and only when it says something else. */}
                        <ReasonBadge
                            label={award.response || award.reasonLabel}
                            tone={award.reasonTone}
                            title={award.response && award.response !== award.reasonLabel ? award.reasonLabel : undefined}
                        />
                    </div>
                    <div className="loot-pop-meta">
                        <span className="sub" style={{ margin: 0 }}>{award.eventLabel || award.eventId || "Unbekannter Raid"}</span>
                    </div>
                    {!!award.awardedAt && (
                        <div className="loot-pop-meta"><span className="sub" style={{ margin: 0 }}>{fmtMs(award.awardedAt)}</span></div>
                    )}
                </div>
            </div>
            <div className="loot-pop-row" style={{ paddingTop: 0 }}>
                <Link className="mlink" to={`/history/char?name=${encodeURIComponent(award.character)}`}>Loot-Historie öffnen →</Link>
            </div>
        </HoverPanel>
    );
}
