import { useEffect, useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { getRaids, type ApiError, type RaidEventGroup, type RaidEvent } from "../api";
import { formatEventTime } from "../lib/format";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };

function CategoryTable({ group, guildId }: { group: RaidEventGroup; guildId: string }) {
    const newHref = `/raids/new${group.events[0] ? `?source=${group.events[0].id}` : ""}`;
    return (
        <>
            <div className="row-actions" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
                <Link className="btn btn-ghost btn-sm" to={newHref} title="Neues Event in dieser Kategorie anlegen (Format vorbelegt)">＋ Event</Link>
            </div>
            <table className="idx" style={{ margin: 0 }}>
                <thead><tr><th>Event</th><th>Termin</th><th>Anm.</th><th>Links</th><th /></tr></thead>
                <tbody>
                    {group.events.map((ev: RaidEvent) => (
                        <tr key={ev.id}>
                            <td><strong>{ev.title || "(ohne Titel)"}</strong><div className="small">#{ev.channelName || ev.channelId}</div></td>
                            <td className="small">{formatEventTime(ev.startTime)}</td>
                            <td className="small">{ev.signupCount || 0}</td>
                            <td className="small">
                                <a className="mlink" href={eventPostUrl(guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer">Discord</a>
                                {" · "}
                                <a className="mlink" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer">Setup/Comp</a>
                            </td>
                            <td className="cell-actions">
                                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                    <Link className="btn btn-ghost btn-sm" to={`/raids/detail?event=${encodeURIComponent(ev.id)}`}>Details</Link>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}

export default function RaidsPage() {
    useOutletContext<ShellContext>();
    const location = useLocation();
    const [data, setData] = useState<{ groups: RaidEventGroup[]; error: string | null; activeGuildId: string } | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [tab, setTab] = useState(0);
    // Passed via navigate(..., { state: { flash } }) after creating an event (RaidCreatePage.tsx).
    const [flash] = useState<Flash | null>((location.state as { flash?: Flash } | null)?.flash ?? null);

    useEffect(() => {
        getRaids()
            .then((d) => { setData(d); setTab(0); })
            .catch((err: ApiError) => setError(err));
    }, []);

    if (error) return <div className="empty">Fehler beim Laden der Raid-Events: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    let listing: React.ReactNode;
    if (!data.activeGuildId) {
        listing = <p className="sub">Wähle oben einen Server, um die Events zu sehen.</p>;
    } else if (data.error) {
        listing = <div className="sub" style={{ color: "var(--high)" }}>{data.error}</div>;
    } else if (!data.groups.length) {
        listing = <p className="sub">Keine anstehenden Events gefunden.</p>;
    } else {
        const active = data.groups[tab] ?? data.groups[0];
        listing = (
            <div className="tabwrap">
                <div className="tabs" role="tablist">
                    {data.groups.map((g, i) => (
                        <button key={g.categoryId || "none"} type="button" className={`tab-btn${i === tab ? " active" : ""}`} role="tab" onClick={() => setTab(i)}>
                            {g.categoryName || "Ohne Kategorie"}
                            <span className="tab-count">{g.events.length}</span>
                        </button>
                    ))}
                </div>
                <div className="tab-panel active" role="tabpanel">
                    <CategoryTable group={active} guildId={data.activeGuildId} />
                </div>
            </div>
        );
    }

    return (
        <>
            <h1 className="page-title">Raid-Events</h1>
            <p className="note">Alle anstehenden Events des Servers, gruppiert nach Discord-Kategorie. Über „Details" pro Event einen Anmelde-Aufruf posten oder das Raidsheet füllen.</p>
            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}
            <div className="row-actions" style={{ marginBottom: 16 }}>
                <Link className="btn" to="/raids/new">＋ Neues Event</Link>
                <Link className="btn btn-ghost" to="/raids/templates">Aufruf-Vorlagen</Link>
            </div>
            {listing}
        </>
    );
}
