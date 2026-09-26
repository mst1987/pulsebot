// Shared loot table for the Raid-Detail "Loot" tab, the per-event history page,
// and the per-character history page (which adds an Event column since its rows
// span multiple raids). Sorted client-side — the list is already fully loaded,
// no server round trip needed like ClaPage's server-side SortTh. Defaults to
// sorting by character, since that's how a raid lead checks "who got what"
// right after an import.
import { useState } from "react";
import type { LootItem } from "../../api";
import { fmtMs } from "../../lib/format";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { itemQualityProps } from "../../lib/itemQuality";
import { SortTh } from "../SortTh";
import { RaiderBadge, reasonToneClass } from "./LootBadges";
import { TrashIcon } from "../icons";
import { useConfirm } from "../ui/Modal";
import { IconButton } from "../ui/Button";
import { t, useT } from "../../i18n";

// "manual" is a row somebody entered in the admin menu rather than one an addon
// exported (see lootImport.js's buildManualItem) — worth saying in the table,
// since it is the one kind of row no re-import will bring back.
const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil", get manual() { return t("raidDetail.lootTool.manual"); } };

type SortKey = "item" | "character" | "response" | "boss" | "event" | "time" | "source";

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
            data-tip={reasonLabel && reasonLabel !== label ? reasonLabel : undefined}
        >
            {label}
        </span>
    );
}

export function LootTable({ items, showEvent = false, onDelete }: {
    items: LootItem[];
    showEvent?: boolean;
    /**
     * Drop one awarded item (a double-logged row, one awarded to the wrong
     * raider). Passing it grows the table by a delete column; the table owns the
     * confirm and the per-row busy state, the page owns the request and the
     * reload afterwards.
     */
    onDelete?: (item: LootItem) => Promise<unknown> | void;
}) {
    const ask = useConfirm();
    const t = useT();
    // One shared memory for every place this table shows up (raid detail, event
    // loot, character history): it is the same table, so whoever sorts it by item
    // wants it that way in the next raid too.
    const { sort, dir, onSort, apply } = useTableSort<SortKey>("loot-table-sort", SORT_DEFAULTS, "character");
    const [busyId, setBusyId] = useState("");
    const sorted = apply(items, sortValue);

    const remove = async (it: LootItem) => {
        if (!onDelete) return;
        const label = it.itemName || t("raidDetail.loot.itemFallback", { id: it.itemId });
        if (!(await ask({ title: t("raidDetail.loot.deleteTitle"), text: t("raidDetail.loot.deleteText", { item: label, character: it.character }), action: t("raidDetail.loot.deleteAction") }))) return;
        setBusyId(it.id);
        try {
            await onDelete(it);
        } finally {
            setBusyId("");
        }
    };

    return (
        <table className="idx loot-table" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <SortTh sortKey="item" label={t("raidDetail.loot.colItem")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="character" label={t("raidDetail.loot.colCharacter")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="response" label={t("raidDetail.loot.colResponse")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="boss" label={t("raidDetail.loot.colBoss")} sort={sort} dir={dir} onSort={onSort} />
                    {showEvent && <SortTh sortKey="event" label={t("raidDetail.loot.colEvent")} sort={sort} dir={dir} onSort={onSort} />}
                    <SortTh sortKey="time" label={t("raidDetail.loot.colTime")} sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="source" label={t("raidDetail.loot.colSource")} sort={sort} dir={dir} onSort={onSort} />
                    {onDelete && <th />}
                </tr>
            </thead>
            <tbody>
                {sorted.map((it, i) => (
                    <tr key={it.id || i}>
                        <td>
                            {it.itemIconUrl && (
                                <img className="loot-ico" src={it.itemIconUrl} alt="" loading="lazy" />
                            )}
                            {it.itemLink
                                ? <a {...itemQualityProps(it.itemQuality, "mlink")} href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || t("raidDetail.loot.itemFallback", { id: it.itemId })}</a>
                                : <span {...itemQualityProps(it.itemQuality)}>{it.itemName || t("raidDetail.loot.itemFallback", { id: it.itemId })}</span>}
                        </td>
                        {/* Spec icon + class colour, not a plain link: "who got
                            what" is read down this column, and the class is the
                            first thing a raid lead checks a hunter bow or a
                            healer trinket against. The look comes from the
                            server (lootClassLook.js); a character whose class
                            nobody has resolved yet renders uncoloured. */}
                        <td><RaiderBadge character={it.character} classColor={it.classColor} iconUrl={it.specIconUrl} className={it.className} spec={it.spec} /></td>
                        <td className="small"><LootResponseBadge response={it.response} offspec={it.offspec} reasonLabel={it.reasonLabel} reasonTone={it.reasonTone} /></td>
                        <td className="small">{it.boss || ""}</td>
                        {showEvent && <td className="small">{it.eventLabel || it.eventId || ""}</td>}
                        <td className="small">{fmtMs(it.awardedAt)}</td>
                        <td className="small">{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</td>
                        {onDelete && (
                            <td className="cell-actions">
                                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                    <IconButton
                                        icon={<TrashIcon />} tone="danger" size="sm"
                                        tip={t("raidDetail.loot.deleteEntry")} tipSub={t("raidDetail.loot.deleteEntrySub")}
                                        aria-label={t("raidDetail.loot.deleteEntryAria", { item: it.itemName || t("raidDetail.loot.itemFallback", { id: it.itemId }), character: it.character })}
                                        disabled={busyId === it.id} onClick={() => remove(it)}
                                    />
                                </div>
                            </td>
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
