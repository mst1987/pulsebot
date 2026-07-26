// Shared loot table for the Raid-Detail "Loot" tab, the per-event history page,
// and the per-character history page (which adds an Event column since its rows
// span multiple raids). Sorted client-side — the list is already fully loaded,
// no server round trip needed like ClaPage's server-side SortTh. Defaults to
// sorting by character, since that's how a raid lead checks "who got what"
// right after an import.
import { useMemo, useState } from "react";
import type { LootItem } from "../api";
import { fmtMs } from "../lib/format";
import { CharacterLink } from "./ClassSpec";

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
    const [sort, setSort] = useState<SortKey>("character");
    const [dir, setDir] = useState<Dir>(SORT_DEFAULTS.character);

    const onSort = (key: SortKey) => {
        if (key === sort) { setDir((d) => (d === "asc" ? "desc" : "asc")); return; }
        setSort(key);
        setDir(SORT_DEFAULTS[key]);
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
        <table className="idx" style={{ margin: 0 }}>
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
                                <img
                                    src={it.itemIconUrl}
                                    alt=""
                                    width={20}
                                    height={20}
                                    loading="lazy"
                                    style={{ borderRadius: 4, verticalAlign: "-5px", marginRight: 6 }}
                                />
                            )}
                            {it.itemLink
                                ? <a className="mlink" href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a>
                                : (it.itemName || `Item ${it.itemId}`)}
                        </td>
                        <td><CharacterLink character={it.character} /></td>
                        <td className="small">
                            {it.offspec
                                ? <span className="lbadge lbadge-neutral">{it.response || "Off Spec"}</span>
                                : <span className="lbadge lbadge-ok">{it.response || "Main Spec"}</span>}
                        </td>
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
