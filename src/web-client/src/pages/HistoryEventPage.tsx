import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryEvent, clearHistoryEvent, deleteLootItems, canAccess, type ApiError, type HistoryEventData, type LootItem } from "../api";
import { LootTable } from "../components/LootTable";
import ManualLootForm from "../components/ManualLootForm";
import type { ShellContext } from "../components/Shell";
import { TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";

export default function HistoryEventPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    // Reachable with the read-only "Loot-Ansichten" too, which sees the loot but
    // must not add to or delete from it (src/config/permissions.js).
    const canEdit = canAccess(user, "history", "write");
    const [searchParams] = useSearchParams();
    const eventId = searchParams.get("event") || "";
    const toast = useToast();

    const [data, setData] = useState<HistoryEventData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        getHistoryEvent(eventId).then(setData).catch((err: ApiError) => setError(err));
    }, [eventId]);

    const clear = async () => {
        if (!confirm("Loot für dieses Event wirklich löschen?")) return;
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
            <p className="note"><Link className="mlink" to="/history">← Zurück zur Historie</Link></p>
            <h1 className="page-title">{data.label}</h1>
            <div className="row-actions" style={{ marginBottom: 16 }}>
                <span className="sub" style={{ margin: 0 }}>{data.items.length} Item(s)</span>
                {canEdit && data.items.length > 0 && (
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={clear}><TrashIcon />Loot löschen</button>
                )}
            </div>
            {/* Reloads the event afterwards instead of appending the row: the
                new item has to land in the table's own sort order, and one
                round trip per nachgetragenem Item is nothing. */}
            {canEdit && (
                <ManualLootForm
                    eventId={eventId}
                    eventTitle={data.label}
                    defaultAwardedAt={data.items[0]?.awardedAt || 0}
                    csrfToken={csrfToken}
                    onAdded={(msg) => { toast(msg); getHistoryEvent(eventId).then(setData).catch(() => {}); }}
                />
            )}
            {data.items.length
                ? <LootTable items={data.items} onDelete={canEdit ? removeItem : undefined} />
                : <p className="sub">Kein Loot (mehr) für dieses Event.</p>}
        </>
    );
}
