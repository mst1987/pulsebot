import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setLootCategory, type ApiError, type LootEventSummary, type Category } from "../../api";
import { fmtMs } from "../../lib/format";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { ChevronRightIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { IconButton } from "../../components/ui/Button";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import { tParts, useT } from "../../i18n";

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

type LootEventSortKey = "event" | "date" | "category" | "count" | "source";

const LOOT_EVENT_SORT_DEFAULTS: Record<LootEventSortKey, Dir> = {
    event: "asc", date: "desc", category: "asc", count: "desc", source: "asc",
};

export function LootEventsTab({ lootEvents, categories, onChanged, canEdit }: {
    lootEvents: LootEventSummary[];
    categories: Category[];
    onChanged: (msg: string) => void;
    // Without write access to "Historie & Loot" the category is shown, not set —
    // the loot views are read-only (src/config/permissions.js).
    canEdit: boolean;
}) {
    const t = useT();
    const [saving, setSaving] = useState<string | null>(null);
    const toast = useToast();
    const navigate = useNavigate();
    // Newest import first by default — that is the one just pasted in, and the
    // reason this list is opened at all.
    const { sort, dir, onSort, apply } = useTableSort<LootEventSortKey>(
        "history-loot-events-sort", LOOT_EVENT_SORT_DEFAULTS, "date",
    );
    const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

    // Assigning a category is what makes loot imported without a Raid-Helper
    // event show up in the category-grouped overviews at all; changing it on a
    // bucket that came from an event is allowed too, but a re-import of that
    // event writes its own category back onto the new rows.
    const save = async (eventId: string, categoryId: string) => {
        setSaving(eventId);
        try {
            const r = await setLootCategory({ event: eventId, categoryId });
            onChanged(t("history.lootEvents.categorySet", { count: r.updated }));
        } catch (err) {
            // Not onChanged: nothing changed, so this must not reload the list
            // and must not be reported in the success tone.
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(null);
        }
    };

    const head = (
        <PartHead
            icon="inv_misc_bag_10" tone="history" title={t("history.page.view.loot")} crumb={t("history.event.crumb")}
            tip={t("history.page.view.loot")} tipSub={t("history.lootEvents.tipSub")}
            action={<Badge count>{tParts("history.lootEvents.count", { count: lootEvents.length })}</Badge>}
        />
    );

    if (!lootEvents.length) return <div className="dash-card hl-card">{head}<div className="empty">{t("history.shared.noLoot")}</div></div>;

    const sorted = apply(lootEvents, (e, key) => {
        switch (key) {
            case "event": return (e.label || e.eventId).toLowerCase();
            case "date": return e.awardedAt || e.importedAt || 0;
            // By the name shown in the select, not the snowflake id; a bucket
            // without a category sorts last instead of first.
            case "category": return (categoryNameById.get(e.categoryId || "") || e.categoryId || "zzz").toLowerCase();
            case "count": return e.count;
            case "source": return (e.sources || []).map((s) => LOOT_TOOL_LABELS[s] || s).sort().join(", ").toLowerCase();
            default: return "";
        }
    });

    return (
        <div className="dash-card hl-card">
            {head}
            <table className="idx" style={{ margin: 0 }}>
                <thead>
                    <tr>
                        <SortTh sortKey="event" label={t("history.shared.colEvent")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="date" label={t("history.shared.colDate")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="category" label={t("history.shared.category")} sort={sort} dir={dir} onSort={onSort} tip={t("history.shared.category")} tipSub={t("history.lootEvents.categorySub")} />
                        <SortTh sortKey="count" label={t("history.shared.colItems")} sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="source" label={t("history.shared.colSource")} sort={sort} dir={dir} onSort={onSort} />
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((e) => (
                        <tr key={e.eventId}>
                            <td><strong>{e.label || e.eventId}</strong></td>
                            <td className="small">{fmtMs(e.awardedAt || e.importedAt, false)}</td>
                            <td className="small">
                                {canEdit ? (
                                    <select
                                        aria-label={t("history.shared.category")}
                                        value={e.categoryId || ""}
                                        disabled={saving === e.eventId}
                                        onChange={(ev) => save(e.eventId, ev.target.value)}
                                    >
                                        <option value="">{t("history.lootEvents.noCategoryOption")}</option>
                                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        {/* A category the bot can't see right now (channel gone / Discord offline)
                                            must stay selectable, else opening the tab silently reassigns it. */}
                                        {e.categoryId && !categories.some((c) => c.id === e.categoryId) && (
                                            <option value={e.categoryId}>{tParts("history.lootEvents.unknownCategory", { id: e.categoryId })}</option>
                                        )}
                                    </select>
                                ) : (categoryNameById.get(e.categoryId || "") || e.categoryId || "—")}
                            </td>
                            <td className="small"><Badge count>{e.count}</Badge></td>
                            <td className="small">
                                <div className="badge-row">{(e.sources || []).map((s) => <Badge key={s}>{LOOT_TOOL_LABELS[s] || s}</Badge>)}</div>
                            </td>
                            <td className="cell-actions">
                                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                    <IconButton
                                        icon={<ChevronRightIcon />} size="sm" tip={t("history.shared.viewLoot")} tipSub={t("history.lootEvents.viewSub")}
                                        onClick={() => navigate(`/history/event?event=${encodeURIComponent(e.eventId)}`)}
                                    />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
