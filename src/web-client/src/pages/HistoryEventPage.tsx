import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryEvent, clearHistoryEvent, deleteLootItems, canAccess, type ApiError, type HistoryEventData, type LootItem } from "../api";
import { LootTable } from "../components/LootTable";
import ManualLootForm from "../components/ManualLootForm";
import type { ShellContext } from "../components/Shell";
import { ChevronLeftIcon, TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";
import { useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import { PartHead } from "../components/ui/PartHead";
import Badge from "../components/ui/Badge";
import "../styles/historie-loot.css";

export default function HistoryEventPage() {
    const ask = useConfirm();
    const { user, csrfToken } = useOutletContext<ShellContext>();
    // Reachable with the read-only "Loot-Ansichten" too, which sees the loot but
    // must not add to or delete from it (src/config/permissions.js).
    const canEdit = canAccess(user, "history", "write");
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const eventId = searchParams.get("event") || "";
    const toast = useToast();

    const [data, setData] = useState<HistoryEventData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        getHistoryEvent(eventId).then(setData).catch((err: ApiError) => setError(err));
    }, [eventId]);

    const clear = async () => {
        if (!(await ask({ title: "Event-Loot löschen?", text: `Der gesamte Loot dieses Events (${data?.items.length || 0} Einträge) wird gelöscht. Ein erneuter Import bringt ihn zurück.`, action: "Loot löschen" }))) return;
        setBusy(true);
        try {
            const r = await clearHistoryEvent(csrfToken, eventId);
            toast(`${r.removed} Loot-Eintrag/-Einträge gelöscht.`);
            setData((d) => (d ? { ...d, items: [] } : d));
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
            await deleteLootItems(csrfToken, [it.id]);
            setData((d) => (d ? { ...d, items: d.items.filter((row) => row.id !== it.id) } : d));
            toast(`„${it.itemName || `Item ${it.itemId}`}" gelöscht.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <div className="hl-inbox-head">
                <IconButton icon={<ChevronLeftIcon />} tip="Zurück zu Historie & Loot" onClick={() => navigate("/history?tab=loot")} />
                <div>
                    <div className="kicker">Historie &amp; Loot · Nach Raid</div>
                    <h1>{data.label}</h1>
                </div>
            </div>
            <div className="dash-card hl-card">
                <PartHead
                    icon="inv_misc_bag_10" tone="history" title="Loot" crumb="Loot › Nach Raid"
                    action={(
                        <>
                            <Badge count>{data.items.length} Items</Badge>
                            {/* Reloads the event afterwards instead of appending the
                                row: the new item has to land in the table's own sort
                                order, and one round trip per nachgetragenem Item is
                                nothing. */}
                            {canEdit && (
                                <ManualLootForm
                                    eventId={eventId}
                                    eventTitle={data.label}
                                    defaultAwardedAt={data.items[0]?.awardedAt || 0}
                                    csrfToken={csrfToken}
                                    onAdded={(msg) => { toast(msg); getHistoryEvent(eventId).then(setData).catch(() => {}); }}
                                />
                            )}
                            {canEdit && data.items.length > 0 && (
                                <Button variant="danger" icon={<TrashIcon />} disabled={busy} onClick={clear}>Loot löschen</Button>
                            )}
                        </>
                    )}
                />
                {data.items.length
                    ? <LootTable items={data.items} onDelete={canEdit ? removeItem : undefined} />
                    : <div className="empty">Kein Loot (mehr) für dieses Event.</div>}
            </div>
        </>
    );
}
