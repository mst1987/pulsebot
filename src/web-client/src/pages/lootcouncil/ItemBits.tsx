// The loot council's building blocks that both routes draw (the page,
// LootCouncilPage.tsx, and the drop check, DropCheckPage.tsx), so a raider looks
// the same wherever the council meets them: here a raider's identity, an item
// line and the loot count; the need bar (NeedBar.tsx), a worn item with its
// marks (GearBadges.tsx) and the candidate table of a drop (CandidateTable.tsx)
// sit next to it.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BisSpec, CouncilLootItem } from "../../api";
import { Badge, Expand, WowIcon } from "../../components/ui";
import { classColorProps } from "../../components/ClassSpec";
import { ReasonBadge } from "../../components/loot/LootBadges";
import { tParts, useT } from "../../i18n";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { specClassLabel } from "../../lib/wowNames";
import { WOWHEAD } from "./council";
import { RichTip } from "./RichTip";

/**
 * A raider as spec icon on a tile in their class colour, name and spec — the
 * same identity in the list, the dialog and the drop check. With `to` the name
 * is a link (into the raider's details).
 */
export function RaiderIdent({ name, classColor, specIconUrl, className, sub, size = 34, to, big = false }: {
    name: string;
    classColor: string;
    specIconUrl?: string;
    /** The WoW class ("Warlock"), for the class icon when no spec icon is known. */
    className?: string;
    sub?: ReactNode;
    size?: number;
    to?: string;
    big?: boolean;
}) {
    const colored = classColorProps(classColor);
    const nameNode = to
        ? <Link to={to} className={`lc-id-name ${colored.className || ""}`} style={colored.style}>{name}</Link>
        : <span className={`lc-id-name ${colored.className || ""}`} style={colored.style}>{name}</span>;
    return (
        <span className={`lc-id${big ? " big" : ""}`}>
            <span className="lc-id-tile" style={{ "--cc": classColor || "var(--muted)", "--lc-tile": `${size}px`, "--lc-tile-img": `${Math.round(size * 0.7)}px` } as CSSProperties}>
                {specIconUrl
                    ? <img className="lc-id-spec" src={specIconUrl} alt="" loading="lazy" />
                    : className ? <WowIcon name={`classicon_${className.toLowerCase().replace(/\s+/g, "")}`} size={Math.round(size * 0.7)} /> : null}
            </span>
            <span className="lc-id-text">
                {nameNode}
                {sub ? <span className="lc-id-sub">{sub}</span> : null}
            </span>
        </span>
    );
}

/**
 * Which raid a drop comes from, as a badge in that raid's own colour — the same
 * hue (`lc-h-<id>` in index.css) the content filter's buttons carry, so a raid
 * has one colour whether you switch it on or read it off a row.
 */
export function ContentBadge({ contentId, tier, label }: { contentId: string; tier?: string; label?: string }) {
    if (!contentId) return null;
    return (
        <span
            className={`lc-cbadge lc-h-${contentId}`}
            data-tip={[label || contentId.toUpperCase(), tier ? tier.toUpperCase() : ""].filter(Boolean).join(" · ")}
        >
            {contentId.toUpperCase()}
        </span>
    );
}

/** An item as icon + quality-coloured name, linked to Wowhead. */
export function ItemLink({ id, name, iconUrl, quality }: { id: number; name: string; iconUrl?: string; quality?: number | null }) {
    return (
        <a className="lc-item" href={WOWHEAD(id)} target="_blank" rel="noreferrer">
            {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : null}
            <span {...itemQualityProps(quality ?? null)}>{name || `Item ${id}`}</span>
        </a>
    );
}

/**
 * An item as the head of a card: big icon in its quality colour, the name
 * linked to Wowhead, and under the name where it comes from.
 */
export function ItemHead({ id, name, iconUrl, quality, meta }: {
    id: number;
    name: string;
    iconUrl?: string;
    quality?: number | null;
    meta: ReactNode;
}) {
    return (
        <span className="lc-itemhead">
            {iconUrl
                ? <img src={iconUrl} alt="" loading="lazy" {...itemQualityProps(quality ?? null, "lc-itemhead-icon")} />
                : <span className="lc-itemhead-icon lc-worn-blank" />}
            <span className="lc-itemhead-text">
                <a href={WOWHEAD(id)} target="_blank" rel="noreferrer" {...itemQualityProps(quality ?? null, "lc-itemhead-name")}>
                    {name || `Item ${id}`}
                </a>
                <span className="lc-gap-meta">{meta}</span>
            </span>
        </span>
    );
}

/**
 * For which specs an item is BiS — the question "BiS" alone never answers.
 * One badge per list; a spec that borrows another's list (Fire/Frost from
 * Arcane) is folded into it as "+2" and named in the tooltip, otherwise a
 * contested item would show nine badges carrying five claims.
 */
export function BisSpecs({ specs }: { specs: BisSpec[] }) {
    const t = useT();
    if (!specs.length) return null;
    return (
        <span className="lc-bisspecs">
            {specs.map((s) => {
                const colored = classColorProps(s.classColor);
                return (
                    <Badge
                        key={s.specKey}
                        icon={s.iconUrl ? <img className="wi" src={s.iconUrl} alt="" loading="lazy" /> : undefined}
                        tip={t("lootcouncil.items.bisForTip", { spec: specClassLabel(s.specKey, s.label) })}
                        tipSub={s.alsoFor.length
                            ? t("lootcouncil.items.alsoFor", { specs: s.alsoFor.join(` ${t("lootcouncil.word.and")} `) })
                            : undefined}
                    >
                        <span className={colored.className} style={colored.style}>{specClassLabel(s.specKey, s.label)}</span>
                        {s.alsoFor.length ? <span className="lc-muted">+{s.alsoFor.length}</span> : null}
                    </Badge>
                );
            })}
        </span>
    );
}

// How many awards the loot tooltip shows. A peek, not the full history — the
// raider's details carry the complete list.
const TIP_ITEMS = 6;

/**
 * A loot count, with the newest items behind it in the tooltip. `total` is the
 * real count; off-spec rolls, shards and bank items are named, never counted.
 */
export function LootCount({ items, total, other = 0 }: { items: CouncilLootItem[]; total: number; other?: number }) {
    const t = useT();
    if (!total) {
        return other
            ? <span className="lc-num lc-muted" data-tip={t("lootcouncil.items.noLootTip")} data-tip-sub={t("lootcouncil.items.otherTipSub", { count: other })}>—</span>
            : <span className="lc-num lc-muted">—</span>;
    }
    const shown = items.slice(0, TIP_ITEMS);
    return (
        <RichTip width={440} label={t("lootcouncil.word.itemCount", { count: total })} trigger={<span className="lc-num">{total}</span>}>
            <b>{t("lootcouncil.items.recent")}</b>
            <span className="lc-loot-list">
                {shown.map((item, i) => (
                    <span key={`${item.itemId}-${item.awardedAt}-${i}`} className="lc-loot-row">
                        <ItemLink id={item.itemId} name={item.itemName} iconUrl={item.itemIconUrl} quality={item.itemQuality} />
                        <ContentBadge contentId={item.contentId} tier={item.tier} />
                        {item.reasonLabel ? <ReasonBadge label={item.reasonLabel} tone={item.reasonTone} /> : <span />}
                        <span className="lc-loot-date">{item.awardedAt ? fmtMs(item.awardedAt, false) : ""}</span>
                    </span>
                ))}
            </span>
            {total > shown.length ? <i>{tParts("lootcouncil.items.more", { count: total - shown.length })}</i> : null}
            {other ? <i>{tParts("lootcouncil.items.otherNote", { count: other })}</i> : null}
        </RichTip>
    );
}

/** A folded line with a tile, a count and names — "Nicht eingeplant", "Können es nicht tragen". */
export function FoldRow({ icon, title, count, names, open, onToggle, children }: {
    icon: string;
    title: string;
    count: number;
    names: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    return (
        <div className="lc-panel lc-fold">
            <div className="lc-fold-head">
                <span className="itile t-none" aria-hidden="true"><WowIcon name={icon} size={22} /></span>
                <b>{title}</b>
                <Badge count>{count}</Badge>
                <span className="lc-fold-names">{names}</span>
                <Expand open={open} onToggle={onToggle} />
            </div>
            {open ? <div className="lc-fold-body">{children}</div> : null}
        </div>
    );
}
