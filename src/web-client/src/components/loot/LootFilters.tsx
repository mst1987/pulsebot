// The filter row the loot views share (design issue #225): a search box, the
// raids as icon chips, the reason as a select, and everything rarer behind one
// "Filter" button with a count. What is active below that button shows up as
// removable badges under the row, so a filter remembered from last week is never
// invisible.
import { useRef, useState, type ReactNode } from "react";
import type { LootContent } from "../../api";
import { Button } from "../ui/Button";
import Badge from "../ui/Badge";
import WowIcon from "../ui/WowIcon";
import { InfoIcon, SearchIcon } from "../icons";
import { contentIcon } from "./LootBadges";
import { useDismiss } from "../../hooks/useDismiss";

export function SearchBox({ id, value, onChange, placeholder }: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}) {
    return (
        <span className="hl-search">
            <SearchIcon />
            <input id={id} type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        </span>
    );
}

/** "Alle Raids" plus one chip per raid, with the raid's boss icon. */
export function RaidChips({ contents, value, onChange, unknownCount = 0 }: {
    contents: LootContent[];
    value: string;
    onChange: (contentId: string) => void;
    /** Items whose raid the table does not know — offered as their own chip. */
    unknownCount?: number;
}) {
    return (
        <div className="hl-chips" role="radiogroup" aria-label="Raid">
            <button type="button" role="radio" aria-checked={!value} className={`hl-fchip plain${!value ? " on" : ""}`} onClick={() => onChange("")}>
                Alle Raids
            </button>
            {contents.map((c) => (
                <button
                    key={c.id} type="button" role="radio" aria-checked={value === c.id}
                    className={`hl-fchip${value === c.id ? " on" : ""}`}
                    data-tip={c.label}
                    onClick={() => onChange(value === c.id ? "" : c.id)}
                >
                    <WowIcon name={contentIcon(c.id)} size={22} />
                    {c.short}
                </button>
            ))}
            {unknownCount > 0 && (
                <button
                    type="button" role="radio" aria-checked={value === UNKNOWN_CONTENT}
                    className={`hl-fchip${value === UNKNOWN_CONTENT ? " on" : ""}`}
                    data-tip="Raid unbekannt" data-tip-sub="Items, die nicht in der Content-Tabelle stehen (scripts/fetch-tbc-loot.js)."
                    onClick={() => onChange(value === UNKNOWN_CONTENT ? "" : UNKNOWN_CONTENT)}
                >
                    <WowIcon name="inv_misc_questionmark" size={22} />
                    Unbekannt <span className="rbadge-count">{unknownCount}</span>
                </button>
            )}
        </div>
    );
}

/**
 * The bucket for loot whose raid the content table doesn't know (a world drop, a
 * badge item). Never silently filed into a raid — an own filter value so it can
 * be found and the table fixed. Same value the server understands.
 */
export const UNKNOWN_CONTENT = "__unknown__";

/** "Filter" with the number of active rare filters, opening a small panel. */
export function FilterPopover({ active, children }: { active: number; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useDismiss(ref, open, () => setOpen(false));

    return (
        <div ref={ref} className="hl-filter-btn">
            <Button variant="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
                Filter
                {active > 0 && <Badge tone="accent" count>{active}</Badge>}
            </Button>
            {open && <div className="hl-pop" role="dialog" aria-label="Weitere Filter">{children}</div>}
        </div>
    );
}

export type ActiveFilter = { key: string; label: string; tone?: "accent"; onRemove: () => void };

/** The active filters as removable badges; nothing when there are none. */
export function ActiveFilters({ filters, onReset }: { filters: ActiveFilter[]; onReset?: () => void }) {
    if (!filters.length) return null;
    return (
        <div className="hl-active">
            <span className="kicker">aktiv</span>
            {filters.map((f) => (
                <Badge key={f.key} tone={f.tone} onRemove={f.onRemove} removeLabel={`Filter „${f.label}" entfernen`} removeTip="Filter entfernen">
                    {f.label}
                </Badge>
            ))}
            {onReset && filters.length > 1 && (
                <button type="button" className="mlink hl-reset" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={onReset}>
                    Alle zurücksetzen
                </button>
            )}
        </div>
    );
}

/**
 * The line "i" for an explanation that lives in the tooltip. Kept here rather
 * than in components/icons.tsx, which belongs to the shared foundation.
 */
/** An info icon whose explanation opens in the tooltip box. */
export function InfoTip({ tip, sub }: { tip: string; sub: string }) {
    return (
        <span className="hl-info" tabIndex={0} role="img" aria-label={`${tip}: ${sub}`} data-tip={tip} data-tip-sub={sub}>
            <InfoIcon />
        </span>
    );
}

/** A labelled switch for the popover (same look as the settings switches). */
export function SwitchRow({ checked, onChange, label, tip }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip?: string }) {
    return (
        <label className="switch-row" data-tip={tip}>
            <span className="switch">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            {label}
        </label>
    );
}
