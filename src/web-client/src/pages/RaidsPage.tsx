import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getRaids, type ApiError, type RaidEventGroup, type RaidEvent } from "../api";
import { formatEventTime } from "../lib/format";
import { usePersistedState } from "../lib/persistedState";
import { useTableSort, type Dir } from "../lib/tableSort";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import type { ShellContext } from "../components/Shell";
import { SortTh } from "../components/SortTh";

// The links column carries the same two links on every row — nothing to order
// by, so it stays a plain header.
type SortKey = "event" | "time" | "signups";
const SORT_DEFAULTS: Record<SortKey, Dir> = { event: "asc", time: "asc", signups: "desc" };

function CategoryTable({ group, guildId }: { group: RaidEventGroup; guildId: string }) {
    // Pre-fill the "＋ Event" form from this category's most recently started
    // event — mirrors renderAdmin.js's `g.events.slice().sort(...)[0]`, not just
    // whichever event happens to be first in the (not necessarily sorted) list.
    const latest = group.events.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
    const newHref = `/raids/new${latest ? `?source=${latest.id}` : ""}`;
    // One memory for all categories: they are the same table shown per raid
    // series, and sorting one by date means wanting the next one that way too.
    const { sort, dir, onSort, apply } = useTableSort<SortKey>("raids-events-sort", SORT_DEFAULTS, "time");
    const events = apply(group.events, (ev, key) => {
        switch (key) {
            case "event": return (ev.title || "").toLowerCase();
            case "time": return ev.startTime || 0;
            case "signups": return ev.signupCount || 0;
            default: return "";
        }
    });
    return (
        <>
            <div className="row-actions" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
                <Link className="btn btn-ghost btn-sm" to={newHref} title="Neues Event in dieser Kategorie anlegen (Format vorbelegt)">＋ Event</Link>
            </div>
            <table className="idx" style={{ margin: 0 }}>
                <thead>
                    <tr>
                        <SortTh sortKey="event" label="Event" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="time" label="Termin" sort={sort} dir={dir} onSort={onSort} />
                        <SortTh sortKey="signups" label="Anm." sort={sort} dir={dir} onSort={onSort} />
                        <th>Links</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {events.map((ev: RaidEvent) => (
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
    const [data, setData] = useState<{ groups: RaidEventGroup[]; error: string | null; activeGuildId: string } | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    // Remembered by category id, not by tab index: the groups come and go with the
    // scheduled events, so an index would point at a different raid type next week.
    const [categoryId, setCategoryId] = usePersistedState("raids-category", "");

    useEffect(() => {
        getRaids()
            .then(setData)
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
        // A remembered category whose events are all over falls back to the first
        // group instead of showing an empty page.
        const active = data.groups.find((g) => (g.categoryId || "") === categoryId) ?? data.groups[0];
        listing = (
            <div className="tabwrap">
                <div className="tabs" role="tablist">
                    {data.groups.map((g) => (
                        <button key={g.categoryId || "none"} type="button" className={`tab-btn${g === active ? " active" : ""}`} role="tab" onClick={() => setCategoryId(g.categoryId || "")}>
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
            <div className="row-actions" style={{ marginBottom: 16 }}>
                <Link className="btn" to="/raids/new">＋ Neues Event</Link>
                <Link className="btn btn-ghost" to="/raids/templates">Aufruf-Vorlagen</Link>
            </div>
            {listing}
        </>
    );
}
