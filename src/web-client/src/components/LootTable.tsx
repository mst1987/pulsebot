// Shared loot table for the Raid-Detail "Loot" tab, the per-event history page,
// and the per-character history page (which adds an Event column since its rows
// span multiple raids). Sorted client-side — the list is already fully loaded,
// no server round trip needed like ClaPage's server-side SortTh. Defaults to
// sorting by character, since that's how a raid lead checks "who got what"
// right after an import.
import { useMemo } from "react";
import type { LootItem } from "../api";
import { fmtMs } from "../lib/format";
import { usePersistedState } from "../lib/persistedState";
import { itemQualityProps } from "../lib/itemQuality";
import { CharacterLink } from "./ClassSpec";
import { reasonToneClass } from "./LootBadges";

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

type SortKey = "item" | "character" | "response" | "boss" | "event" | "time" | "source";
type Dir = "asc" | "desc";

const SORT_DEFAULTS: Record<SortKey, Dir> = {
    item: "asc", character: "asc", response: "asc", boss: "asc", event: "asc", time: "desc", source: "asc",
};

function sortValue(it: LootItem, key: SortKey): string | number {
    switch (key) {
        case "item": return (it.itemName || `Item ${it.itemId}`).toLowerCase();
        case "character": return it.character.toLowerCase();
        case "response": return (it.response || (it.offspec ? "Off Spec" : "Main Spec")).toLowerCase();
        case "boss": return (it.boss || "").toLowerCase();
        case "event": return (it.eventLabel || it.eventId || "").toLowerCase();
        case "time": return it.awardedAt || 0;
        case "source": return (LOOT_TOOL_LABELS[it.source] || it.source || "").toLowerCase();
        default: return "";
    }
}

// The award reason, coloured by its bucket. The label stays the addon's own
// wording ("BiS", "Zweitspec", "Upgrade" — RCLootcouncil ships free text,
// Gargul only an offspec flag); what the server adds is which reason bucket
// that wording belongs to, and that picks the colour (utils/lootReasons.js).
// Shared with the Charaktere tab's Items hover and the raid-detail loot tab, so
// a response reads the same everywhere.
export function LootResponseBadge({ response, offspec, reasonLabel, reasonTone }: {
    response?: string;
    offspec?: boolean;
    reasonLabel?: string;
    reasonTone?: string;
}) {
    const label = response || reasonLabel || (offspec ? "Off Spec" : "Main Spec");
    return (
        <span
            className={reasonToneClass(reasonTone)}
            title={reasonLabel && reasonLabel !== label ? reasonLabel : undefined}
        >
            {label}
        </span>
    );
}

function SortTh({ sortKey, label, sort, dir, onSort }: {
    sortKey: SortKey;
    label: string;
    sort: SortKey;
    dir: Dir;
    onSort: (key: SortKey) => void;
}) {
    const active = sort === sortKey;
    const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
    return (
        <th>
            <button type="button" className={`sort-link${active ? " active" : ""}`} onClick={() => onSort(sortKey)}>
                {label}{arrow}
            </button>
        </th>
    );
}

export function LootTable({ items, showEvent = false }: { items: LootItem[]; showEvent?: boolean }) {
    // One shared memory for every place this table shows up (raid detail, event
    // loot, character history): it is the same table, so whoever sorts it by item
    // wants it that way in the next raid too. A stored key from an older build
    // falls back to the default instead of sorting by nothing.
    const [view, setView] = usePersistedState<{ sort: SortKey; dir: Dir }>("loot-table-sort", {
        sort: "character", dir: SORT_DEFAULTS.character,
    });
    const sort: SortKey = SORT_DEFAULTS[view.sort] ? view.sort : "character";
    const dir: Dir = view.dir === "desc" ? "desc" : "asc";

    const onSort = (key: SortKey) => {
        if (key === sort) { setView({ sort, dir: dir === "asc" ? "desc" : "asc" }); return; }
        setView({ sort: key, dir: SORT_DEFAULTS[key] });
    };

    const sorted = useMemo(() => {
        const mul = dir === "asc" ? 1 : -1;
        return [...items].sort((a, b) => {
            const va = sortValue(a, sort);
            const vb = sortValue(b, sort);
            if (va < vb) return -1 * mul;
            if (va > vb) return 1 * mul;
            return 0;
        });
    }, [items, sort, dir]);

    return (
        <table className="idx loot-table" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <SortTh sortKey="item" label="Item" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="response" label="Response" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="boss" label="Boss" sort={sort} dir={dir} onSort={onSort} />
                    {showEvent && <SortTh sortKey="event" label="Event" sort={sort} dir={dir} onSort={onSort} />}
                    <SortTh sortKey="time" label="Zeit" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} />
                </tr>
            </thead>
            <tbody>
                {sorted.map((it, i) => (
                    <tr key={i}>
                        <td>
                            {it.itemIconUrl && (
                                <img className="loot-ico" src={it.itemIconUrl} alt="" loading="lazy" />
                            )}
                            {it.itemLink
                                ? <a {...itemQualityProps(it.itemQuality, "mlink")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                : <span {...itemQualityProps(it.itemQuality)}>{it.itemName || `Item ${it.itemId}`}</span>}
                        </td>
                        <td><CharacterLink character={it.character} /></td>
                        <td className="small"><LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} /></td>
                        <td className="small">{it.boss || ""}</td>
                        {showEvent && <td className="small">{it.eventLabel || it.eventId || ""}</td>}
                        <td className="small">{fmtMs(it.awardedAt)}</td>
                        <td className="small">{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
