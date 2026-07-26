import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { getHistoryEvent, clearHistoryEvent, type ApiError, type HistoryEventData, type LootItem } from "../api";
import { fmtMs } from "../lib/format";
import type { ShellContext } from "../components/Shell";

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

function LootTable({ items }: { items: LootItem[] }) {
    return (
        <table className="idx">
            <thead><tr><th>Item</th><th>Charakter</th><th>Response</th><th>Boss</th><th>Zeit</th><th>Quelle</th></tr></thead>
            <tbody>
                {items.map((it, i) => (
                    <tr key={i}>
                        <td>{it.itemLink ? <a className="mlink" href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a> : (it.itemName || `Item ${it.itemId}`)}</td>
                        {/* /admin/history/char isn't migrated yet (Part B) — plain link to the classic SSR page. */}
                        <td><a className="mlink" href={`/admin/history/char?name=${encodeURIComponent(it.character)}`}>{it.character}</a></td>
                        <td className="small">
                            {it.offspec
                                ? <span className="lbadge lbadge-neutral">{it.response || "Off Spec"}</span>
                                : <span className="lbadge lbadge-ok">{it.response || "Main Spec"}</span>}
                        </td>
                        <td className="small">{it.boss || ""}</td>
                        <td className="small">{fmtMs(it.awardedAt)}</td>
                        <td className="small">{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

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
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={clear}>Loot löschen</button>
                )}
            </div>
            {data.items.length ? <LootTable items={data.items} /> : <p className="sub">Kein Loot (mehr) für dieses Event.</p>}
        </>
    );
}
