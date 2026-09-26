import { useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryEvent, clearHistoryEvent, deleteLootItems, canAccess, type ApiError, type LootItem } from "../../api";
import { useApi } from "../../hooks/useApi";
import AsyncView from "../../components/ui/AsyncView";
import { LootTable } from "../../components/loot/LootTable";
import ManualLootForm from "./ManualLootForm";
import type { ShellContext } from "../../components/Shell";
import { ChevronLeftIcon, TrashIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import "../../styles/historie-loot.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { tParts, useT } from "../../i18n";

export default function HistoryEventPage() {
    const t = useT();
    const ask = useConfirm();
    const { user } = useOutletContext<ShellContext>();
    // Reachable with the read-only "Loot-Ansichten" too, which sees the loot but
    // must not add to or delete from it (src/config/permissions.js).
    const canEdit = canAccess(user, "history", "write");
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const eventId = searchParams.get("event") || "";
    const toast = useToast();

    const event = useApi(() => getHistoryEvent(eventId), [eventId]);
    const [busy, setBusy] = useState(false);

    const clear = async () => {
        if (!(await ask({ title: t("history.event.clearTitle"), text: t("history.event.clearText", { count: event.data?.items.length || 0 }), action: t("history.event.clearAction") }))) return;
        setBusy(true);
        try {
            const r = await clearHistoryEvent(eventId);
            toast(t("history.event.cleared", { count: r.removed }));
            event.setData((d) => (d ? { ...d, items: [] } : d));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    // One wrong row instead of the whole import — drop it from the list right
    // away rather than refetching the event for a single removal.
    const removeItem = async (it: LootItem) => {
        try {
            await deleteLootItems([it.id]);
            event.setData((d) => (d ? { ...d, items: d.items.filter((row) => row.id !== it.id) } : d));
            toast(t("history.shared.deleted", { item: it.itemName || t("history.shared.itemFallback", { id: it.itemId }) }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <AsyncView state={event} loading={<RaidLoader text={t("history.event.loading")} />} error={(err) => <div className="empty">{tParts("history.shared.loadError", { message: err.message })}</div>}>
            {(data) => {
                return (
                    <>
                        <div className="hl-inbox-head">
                            <IconButton icon={<ChevronLeftIcon />} tip={t("history.shared.back")} onClick={() => navigate("/history?tab=loot")} />
                            <div>
                                <div className="kicker">{t("history.event.kicker")}</div>
                                <h1>{data.label}</h1>
                            </div>
                        </div>
                        <div className="dash-card hl-card">
                            <PartHead
                                icon="inv_misc_bag_10" tone="history" title={t("history.shared.loot")} crumb={t("history.event.crumb")}
                                action={(
                                    <>
                                        <Badge count>{tParts("history.shared.items", { count: data.items.length })}</Badge>
                                        {/* Reloads the event afterwards instead of appending the
                                            row: the new item has to land in the table's own sort
                                            order, and one round trip per nachgetragenem Item is
                                            nothing. */}
                                        {canEdit && (
                                            <ManualLootForm
                                                eventId={eventId}
                                                eventTitle={data.label}
                                                defaultAwardedAt={data.items[0]?.awardedAt || 0}
                                                onAdded={(msg) => { toast(msg); event.reload(); }}
                                            />
                                        )}
                                        {canEdit && data.items.length > 0 && (
                                            <Button variant="danger" icon={<TrashIcon />} disabled={busy} onClick={clear}>{t("history.event.clearAction")}</Button>
                                        )}
                                    </>
                                )}
                            />
                            {data.items.length
                                ? <LootTable items={data.items} onDelete={canEdit ? removeItem : undefined} />
                                : <div className="empty">{t("history.event.empty")}</div>}
                        </div>
                    </>
                );
            }}
        </AsyncView>
    );
}
