import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import WowIcon from "./WowIcon";
import Badge, { type Tone } from "./Badge";
import { canAccessAny, type SessionUser } from "../../api";
import { matchesHref, menuFamily, menuLabel } from "../../lib/menu";
import { useT } from "../../i18n";

// The secondary navigation of a page with sub sections (design "C · Schmale
// Icon-Leiste"): the main menu stays short and flat, and the page carries its
// sections as a narrow column of icon buttons directly left of its content —
// Einstellungen its settings sections, Raid-Events its raid plan pages.
//
//   * one 44 px button per section with the section's WoW icon, groups apart
//     by a thin line; the name is the tooltip (the shell's data-tip layer, to
//     the right of the rail) and the accessible name;
//   * a count on the icon's corner for what is open there ("1 Verbindung
//     fehlt"); the count's sentence is in the tooltip and the accessible name too;
//   * a real button (a section of the same page, the page stays mounted) or a
//     real link (a page of its own), with a focus ring and aria-current.
//
// Below the shell's breakpoint (900 px, where the main menu becomes a drawer)
// the same markup is a wrapping row of chips with their labels and a heading
// per group — the CSS switches it (styles/shared.css, ".srail").

export type NavBadge = { count: number; tone?: Tone; tip?: string };
/** One section: a button that reports `onSelect`, or a link when it has an `href`. */
export type RailItem = { id: string; label: string; icon?: string; badge?: NavBadge | null; href?: string };
/** A run of sections; `group` is the heading the chip row prints above it. */
export type RailGroup = { group?: string; items: RailItem[] };

export default function SectionRail({ groups, active, onSelect, ariaLabel, area }: {
    groups: RailGroup[];
    active: string;
    onSelect?: (id: string) => void;
    ariaLabel: string;
    /** The area colour of the active button (`area-<id>` in shared.css); the accent without. */
    area?: string;
}) {
    return (
        <nav className={`srail${area ? ` area-${area}` : ""}`} aria-label={ariaLabel}>
            <div className="srail-list">
                {groups.map(({ group, items }, i) => (
                    <div className="srail-group" key={group || i}>
                        {group && <div className="srail-label">{group}</div>}
                        {items.map((item) => <RailButton key={item.id} item={item} on={item.id === active} onSelect={onSelect} />)}
                    </div>
                ))}
            </div>
        </nav>
    );
}

function RailButton({ item, on, onSelect }: { item: RailItem; on: boolean; onSelect?: (id: string) => void }) {
    const badge = item.badge && item.badge.count > 0 ? item.badge : null;
    const props = {
        className: `srail-item${on ? " active" : ""}`,
        "aria-label": badge?.tip ? `${item.label} · ${badge.tip}` : item.label,
        // The tooltip repeats the label: only while the label is hidden (the
        // rail), not on the chip row that shows it (ui/Tip.tsx).
        "data-tip": item.label,
        "data-tip-sub": badge?.tip,
        "data-tip-side": "right",
        "data-tip-repeats": "",
    };
    const body = (
        <>
            {item.icon && <WowIcon name={item.icon} size={24} />}
            <span className="srail-text" data-tip-label="">{item.label}</span>
            {badge && <Badge count size="sm" tone={badge.tone} className="srail-badge">{badge.count}</Badge>}
        </>
    );
    if (item.href) {
        return <Link to={item.href} aria-current={on ? "page" : undefined} {...props}>{body}</Link>;
    }
    return (
        <button type="button" aria-current={on ? "true" : undefined} onClick={() => onSelect?.(item.id)} {...props}>
            {body}
        </button>
    );
}

/** The rail beside a page: the rail in its own column, the page to its right. */
export function RailLayout({ rail, children, className }: { rail: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={`srail-layout${className ? ` ${className}` : ""}`}>
            {rail}
            <div className="srail-main">{children}</div>
        </div>
    );
}

/** The page a path belongs to: the longest href it lies under ("/raids/new" is the raid list's). */
function activeOf(items: { id: string; href: string }[], pathname: string): string {
    return [...items].sort((a, b) => b.href.length - a.href.length).find((i) => matchesHref(i.href, pathname))?.id || "";
}

/**
 * A page of a main menu entry's family inside the family's rail (lib/menu.ts:
 * the entry and its sub entries — Raid-Events, Raidplan-Vorlagen,
 * Raidplan-Katalog), as links, only the pages the account may open. One page
 * alone needs no rail: then the page stands on its own.
 */
export function MenuRailPage({ user, parent, children }: { user: SessionUser; parent: string; children: ReactNode }) {
    const t = useT();
    const { pathname } = useLocation();
    const family = menuFamily(parent);
    const items = family.filter((e) => canAccessAny(user, e.areas))
        .map((e) => ({ id: e.id, label: menuLabel(e), icon: e.wowIcon, href: e.href }));
    if (items.length < 2) return <>{children}</>;
    const rail = (
        <SectionRail
            groups={[{ items }]} active={activeOf(items, pathname)} area={family[0].area || parent}
            ariaLabel={t("shell.rail.aria", { name: menuLabel(family[0]) })}
        />
    );
    return <RailLayout rail={rail}>{children}</RailLayout>;
}
