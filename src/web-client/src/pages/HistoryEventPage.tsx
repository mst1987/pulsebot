import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryEvent, clearHistoryEvent, deleteLootItems, type ApiError, type HistoryEventData, type LootItem } from "../api";
import { LootTable } from "../components/LootTable";
import type { ShellContext } from "../components/Shell";
import { TrashIcon } from "../components/icons";

export default function HistoryEventPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams] = useSearchParams();
    const eventId = searchParams.get("event") || "";

    const [data, setData] = useState<HistoryEventData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    useEffect(() => {
        getHistoryEvent(eventId).then(setData).catch((err: ApiError) => setError(err));
    }, [eventId]);

    const clear = async () => {
        if (!confirm("Loot für dieses Event wirklich löschen?")) return;
        setBusy(true);
        try {
            const r = await clearHistoryEvent(csrfToken, eventId);
            setFlash(`${r.removed} Loot-Eintrag/-Einträge gelöscht.`);
            setData((d) => (d ? { ...d, items: [] } : d));
        } catch (err) {
            setFlash((err as ApiError).message);
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
            setFlash(`„${it.itemName || `Item ${it.itemId}`}" gelöscht.`);
        } catch (err) {
            setFlash((err as ApiError).message);
        }
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <p className="note"><Link className="mlink" to="/history">← Zurück zur Historie</Link></p>
            <h1 className="page-title">{data.label}</h1>
            {flash && <p className="sub" style={{ color: "var(--good)" }}>{flash}</p>}
            <div className="row-actions" style={{ marginBottom: 16 }}>
                <span className="sub" style={{ margin: 0 }}>{data.items.length} Item(s)</span>
                {data.items.length > 0 && (
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={clear}><TrashIcon />Loot löschen</button>
                )}
            </div>
            {data.items.length ? <LootTable items={data.items} onDelete={removeItem} /> : <p className="sub">Kein Loot (mehr) für dieses Event.</p>}
        </>
    );
}
