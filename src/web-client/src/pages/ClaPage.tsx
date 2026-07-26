import { useEffect, useState, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
    getClaData, createReport, evalLog, scanLogs, deleteLogEntry, linkLog, unlinkLog, autoMatchLogs,
    type ApiError, type ClaData, type ClaPage, type ReportSummary, type LogRow, type MatchCandidate,
} from "../api";
import { formatEventTime, fmtMs } from "../lib/format";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: ReactNode };
type View = "reports" | "logs";
type Dir = "asc" | "desc";

// Default sort direction per column — mirrors renderAdmin.js's REPORT_DIR/LOG_DIR
// maps used by claSortHeader().
const REPORT_SORT_DEFAULTS: Record<string, Dir> = { title: "asc", zone: "asc", date: "desc", players: "desc", issues: "desc" };
const LOG_SORT_DEFAULTS: Record<string, Dir> = { title: "asc", status: "asc", date: "desc" };

// "vor/nach Start" hint for a candidate event — mirrors formatMatchOffset() in
// renderAdmin.js exactly (hours+minutes, or "pünktlich zum Start" on an exact match).
function formatMatchOffset(diffMs: number): string {
    const ms = Number(diffMs) || 0;
    const mins = Math.round(Math.abs(ms) / 60000);
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    const span = hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${mins} min`;
    if (mins === 0) return "pünktlich zum Start";
    return ms >= 0 ? `${span} nach Start` : `${span} vor Start`;
}

// A candidate label for the assignment dropdown — mirrors matchOptionLabel().
function matchOptionLabel(c: MatchCandidate): string {
    const when = c.startTime ? formatEventTime(c.startTime) : "";
    return `${c.title || c.eventId}${when ? ` · ${when}` : ""} (${formatMatchOffset(c.diffMs)})`;
}

// WCL report link for a detected log (prefer the stored link, else derive it
// from the reportId) — mirrors logWclUrl().
function logWclUrl(l: LogRow): string {
    return l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
}

// A clickable sortable <th>: toggles asc/desc on the active column (using its
// configured default direction the first time it's clicked), resets to page 1.
function SortTh({ sortKey, label, page, defaults, onSort }: {
    sortKey: string;
    label: string;
    page: { sort: string; dir: Dir };
    defaults: Record<string, Dir>;
    onSort: (key: string, dir: Dir) => void;
}) {
    const active = page.sort === sortKey;
    const nextDir: Dir = active ? (page.dir === "asc" ? "desc" : "asc") : (defaults[sortKey] || "desc");
    const arrow = active ? (page.dir === "asc" ? " ▲" : " ▼") : "";
    return (
        <th>
            <button type="button" className={`sort-link${active ? " active" : ""}`} onClick={() => onSort(sortKey, nextDir)}>
                {label}{arrow}
            </button>
        </th>
    );
}

// Prev/next pager — mirrors claPager()'s exact text ("Seite X / Y · Z gesamt").
function Pager({ page, onPage }: { page: { page: number; totalPages: number; total: number }; onPage: (p: number) => void }) {
    if (!page.total) return null;
    return (
        <div className="pager">
            <button type="button" className={`pager-btn${page.page <= 1 ? " disabled" : ""}`} disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>‹ Zurück</button>
            <span className="pager-info">Seite {page.page} / {page.totalPages} · {page.total} gesamt</span>
            <button type="button" className={`pager-btn${page.page >= page.totalPages ? " disabled" : ""}`} disabled={page.page >= page.totalPages} onClick={() => onPage(page.page + 1)}>Weiter ›</button>
        </div>
    );
}

function ReportsTab({ reportPage, csrfToken, onSort, onPage, onChanged }: {
    reportPage: ClaPage<ReportSummary> | null;
    csrfToken: string | null;
    onSort: (key: string, dir: Dir) => void;
    onPage: (p: number) => void;
    onChanged: (msg: ReactNode) => void;
}) {
    const [link, setLink] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await createReport(csrfToken, link);
            onChanged(<>Auswertung erstellt. <a href={r.url} target="_blank" rel="noopener noreferrer">Report ansehen ↗</a></>);
            setLink("");
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <h2>Neue Auswertung</h2>
            <form className="card-form" onSubmit={submit}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
                <div className="field">
                    <label>Warcraft-Logs-Report-Link oder Report-ID</label>
                    <input
                        type="text" value={link} onChange={(e) => setLink(e.target.value)}
                        placeholder="https://classic.warcraftlogs.com/reports/abc123…" required
                    />
                    <div className="hint">Die Auswertung kann einige Sekunden dauern — nach dem Absenden bitte kurz warten.</div>
                </div>
                <div className="row-actions">
                    <button className="btn" type="submit" disabled={busy}>{busy ? "Erstelle Auswertung …" : "Auswertung erstellen"}</button>
                </div>
            </form>
            <h2>Auswertungen</h2>
            {reportPage && reportPage.items.length
                ? (
                    <>
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="title" label="Report" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="zone" label="Zone" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="date" label="Erstellt" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="players" label="Spieler" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="issues" label="Probleme" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <th>WCL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportPage.items.map((r) => (
                                    <tr key={r.id}>
                                        <td><a href={`/r/${r.id}`}>{r.title || r.id}</a></td>
                                        <td>{r.zone || ""}</td>
                                        <td className="small">{fmtMs(r.generatedAt)}</td>
                                        <td>{r.playerCount}</td>
                                        <td><span className="pill">{r.issueCount}</span></td>
                                        <td>{r.reportUrl
                                            ? <a className="mlink" href={r.reportUrl} target="_blank" rel="noopener noreferrer">WCL ↗</a>
                                            : <span className="sub">—</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Pager page={reportPage} onPage={onPage} />
                    </>
                )
                : <p className="sub">Noch keine Auswertungen.</p>}
        </>
    );
}

// The "Event" cell of a detected-log row: the existing assignment with a remove
// button, a dropdown of time-matched candidates, or a dash — mirrors logEventCell().
function EventCell({ log, selectedEventId, onSelectChange, onLink, onUnlink }: {
    log: LogRow;
    selectedEventId: string;
    onSelectChange: (eventId: string) => void;
    onLink: () => void;
    onUnlink: () => void;
}) {
    if (log.eventId) {
        const when = log.eventStartTime ? formatEventTime(log.eventStartTime) : "";
        const auto = log.eventLinkSource === "auto" ? " · automatisch zugeordnet" : "";
        const title = `${log.eventLabel || log.eventId}${when ? ` — ${when}` : ""}${auto}`;
        return (
            <div className="row-actions" style={{ flexWrap: "nowrap", gap: 6 }}>
                <span className="pill" title={title}>{log.eventLabel || log.eventId}</span>
                <button className="btn btn-ghost btn-sm" type="button" title="Zuordnung entfernen" onClick={onUnlink}>×</button>
            </div>
        );
    }
    const cands = log.candidates || [];
    if (!cands.length) return <span className="sub" title="Kein Event mit passender Startzeit gefunden">—</span>;
    return (
        <div className="row-actions" style={{ gap: 6, flexWrap: "wrap" }}>
            <select className="sel-sm" value={selectedEventId} onChange={(e) => onSelectChange(e.target.value)}>
                {cands.map((c) => <option key={c.eventId} value={c.eventId}>{matchOptionLabel(c)}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" type="button" onClick={onLink}>Zuordnen</button>
            {log.matchAmbiguous && <div className="hint">mehrere Events passen — bitte prüfen</div>}
        </div>
    );
}

function LogTableRow({ l, evalBusy, selectedEventId, onSelectChange, onEvaluate, onDelete, onLink, onUnlink }: {
    l: LogRow;
    evalBusy: boolean;
    selectedEventId: string;
    onSelectChange: (eventId: string) => void;
    onEvaluate: () => void;
    onDelete: () => void;
    onLink: () => void;
    onUnlink: () => void;
}) {
    const wclUrl = logWclUrl(l);
    const name = l.title || l.reportId || "(unbekannt)";
    return (
        <tr>
            <td>{wclUrl
                ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{name} ↗</a>
                : name}</td>
            <td>{l.categoryName
                ? <span className="cat-badge" title={l.channelName ? `#${l.channelName}` : undefined}>{l.categoryName}</span>
                : <span className="sub">—</span>}</td>
            <td><EventCell log={l} selectedEventId={selectedEventId} onSelectChange={onSelectChange} onLink={onLink} onUnlink={onUnlink} /></td>
            <td>{l.guildId && l.channelId && l.messageId
                ? <a className="mlink" href={`https://discord.com/channels/${l.guildId}/${l.channelId}/${l.messageId}`} target="_blank" rel="noopener noreferrer">Nachricht</a>
                : <span className="sub">—</span>}</td>
            <td>{l.status === "done" ? <span className="pill good">ausgewertet</span> : <span className="pill">offen</span>}</td>
            <td className="small">{fmtMs(l.postedAt)}</td>
            <td className="cell-actions">
                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                    {l.status === "done"
                        ? ((l.reportUrl || l.reportRefId)
                            ? <a className="btn btn-ghost btn-sm" href={l.reportUrl || `/r/${l.reportRefId}`}>Öffnen</a>
                            : null)
                        : <button className="btn btn-sm" type="button" disabled={evalBusy} onClick={onEvaluate}>{evalBusy ? "Läuft …" : "Auswerten"}</button>}
                    <button className="btn btn-danger btn-sm" type="button" onClick={onDelete}>Löschen</button>
                </div>
            </td>
        </tr>
    );
}

function LogsTab({ data, csrfToken, onSort, onPage, onChanged }: {
    data: ClaData;
    csrfToken: string | null;
    onSort: (key: string, dir: Dir) => void;
    onPage: (p: number) => void;
    onChanged: (msg: ReactNode) => void;
}) {
    const [scanning, setScanning] = useState(false);
    const [automatching, setAutomatching] = useState(false);
    const [evalBusyId, setEvalBusyId] = useState<string | null>(null);
    const [selected, setSelected] = useState<Record<string, string>>({});

    if (!data.logChannelsConfigured) {
        return (
            <p className="sub">
                Es sind noch keine Log-Channels konfiguriert. Lege sie in den <a href="/settings">Einstellungen</a> fest,
                damit der Bot automatisch Logs erkennt.
            </p>
        );
    }

    const logPage = data.logPage;

    const scan = async () => {
        setScanning(true);
        try {
            const r = await scanLogs(csrfToken);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setScanning(false);
        }
    };

    const automatch = async () => {
        setAutomatching(true);
        try {
            const r = await autoMatchLogs(csrfToken);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setAutomatching(false);
        }
    };

    const evaluate = async (l: LogRow) => {
        setEvalBusyId(l.id);
        try {
            const r = await evalLog(csrfToken, l.id);
            // Both the fresh-evaluation and the already-evaluated-before response mean
            // "here's the report" — mirrors the legacy inline form, which redirects
            // straight to the report; here we open it in a new tab (so the admin keeps
            // the SPA list open) and refresh the row via onChanged.
            window.open(r.url, "_blank", "noopener");
            onChanged(r.alreadyEvaluated
                ? <>Bereits ausgewertet. <a href={r.url} target="_blank" rel="noopener noreferrer">Report ansehen ↗</a></>
                : <>Auswertung erstellt. <a href={r.url} target="_blank" rel="noopener noreferrer">Report ansehen ↗</a></>);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setEvalBusyId(null);
        }
    };

    const remove = async (l: LogRow) => {
        if (!confirm("Log aus der Liste entfernen?")) return;
        try {
            await deleteLogEntry(csrfToken, l.id);
            onChanged("Gelöscht.");
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    const doLink = async (l: LogRow) => {
        const eventId = selected[l.id] || l.candidates[0]?.eventId;
        if (!eventId) return;
        try {
            const r = await linkLog(csrfToken, l.id, eventId);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    const doUnlink = async (l: LogRow) => {
        if (!confirm("Zuordnung zu diesem Event entfernen?")) return;
        try {
            const r = await unlinkLog(csrfToken, l.id);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    // Closest client-side equivalent of the legacy `unlinkedCount && matchEvents.length`
    // condition — matchEvents themselves aren't part of this API contract, only
    // matchEventsError, so "events loaded without error" stands in for "there's at
    // least a chance of a match".
    const showAutomatch = !data.matchEventsError && data.unlinkedCount > 0;

    return (
        <>
            <h2>Erkannte Logs aus dem Log-Channel</h2>
            <p className="note">Vom Bot automatisch erkannte Warcraft-Logs, neueste zuerst (nach Post-Zeit im Channel). Über den WCL-Link vorab prüfen, dann „Auswerten" — jeder Report nur einmal.</p>
            <p className="note">In der Spalte <strong>Event</strong> wird jedes Log dem Raid zugeordnet, dessen Startzeit zur Post-Zeit passt (Vorschlag vorausgewählt, Zuordnung jederzeit über „×" wieder entfernbar).</p>
            <div className="row-actions" style={{ margin: "0 0 14px" }}>
                <button className="btn btn-ghost" type="button" disabled={scanning} onClick={scan}>
                    {scanning ? "Suche läuft …" : "Log-Channels nach neuen Logs durchsuchen"}
                </button>
                {showAutomatch && (
                    <button
                        className="btn btn-ghost" type="button" disabled={automatching}
                        title="Ordnet jedes offene Log dem Event zu, dessen Startzeit eindeutig passt" onClick={automatch}
                    >
                        {automatching ? "Ordne zu …" : "Logs automatisch Events zuordnen"}
                    </button>
                )}
            </div>
            {data.matchEventsError && <p className="hint">Events für die Zuordnung konnten nicht geladen werden: {data.matchEventsError}</p>}
            {logPage && logPage.items.length
                ? (
                    <>
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="title" label="Log" page={logPage} defaults={LOG_SORT_DEFAULTS} onSort={onSort} />
                                    <th>Kategorie</th>
                                    <th>Event</th>
                                    <th>Quelle</th>
                                    <SortTh sortKey="status" label="Status" page={logPage} defaults={LOG_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="date" label="Gepostet" page={logPage} defaults={LOG_SORT_DEFAULTS} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {logPage.items.map((l) => (
                                    <LogTableRow
                                        key={l.id}
                                        l={l}
                                        evalBusy={evalBusyId === l.id}
                                        selectedEventId={selected[l.id] ?? l.candidates[0]?.eventId ?? ""}
                                        onSelectChange={(v) => setSelected((s) => ({ ...s, [l.id]: v }))}
                                        onEvaluate={() => evaluate(l)}
                                        onDelete={() => remove(l)}
                                        onLink={() => doLink(l)}
                                        onUnlink={() => doUnlink(l)}
                                    />
                                ))}
                            </tbody>
                        </table>
                        <Pager page={logPage} onPage={onPage} />
                    </>
                )
                : <p className="sub">Noch keine Logs erkannt. Sobald im Log-Channel ein Warcraft-Logs-Link gepostet wird, taucht er hier auf.</p>}
        </>
    );
}

export default function ClaPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams, setSearchParams] = useSearchParams();
    const view = (searchParams.get("view") as View) || "reports";
    const sort = searchParams.get("sort") || "date";
    const dir: Dir = searchParams.get("dir") === "asc" ? "asc" : "desc";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const [data, setData] = useState<ClaData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);

    const load = () => {
        getClaData(view, sort, dir, page).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [view, sort, dir, page]);

    const afterChange = (msg: ReactNode) => {
        setFlash({ type: "ok", text: msg });
        load();
    };

    // Mirrors the legacy <a href="/admin/cla?view=id">: switching tabs does NOT
    // carry over the other tab's sort/dir/page.
    const switchView = (v: View) => setSearchParams(v === "reports" ? {} : { view: v });

    const sortBy = (key: string, nextDir: Dir) => {
        const next = new URLSearchParams(searchParams);
        next.set("view", view);
        next.set("sort", key);
        next.set("dir", nextDir);
        next.set("page", "1");
        setSearchParams(next);
    };

    const goToPage = (p: number) => {
        const next = new URLSearchParams(searchParams);
        next.set("page", String(p));
        setSearchParams(next);
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <h1 className="page-title">CLA / Logcheck</h1>
            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}
            <div className="subnav" role="tablist">
                <button type="button" className={`subnav-item${view === "reports" ? " active" : ""}`} onClick={() => switchView("reports")}>
                    Auswertungen
                    {!!data.counts.reports && <span className="subnav-count">{data.counts.reports}</span>}
                </button>
                <button type="button" className={`subnav-item${view === "logs" ? " active" : ""}`} onClick={() => switchView("logs")}>
                    Erkannte Logs
                    {!!data.counts.logs && <span className="subnav-count">{data.counts.logs}</span>}
                </button>
            </div>
            {view === "reports"
                ? <ReportsTab reportPage={data.reportPage} csrfToken={csrfToken} onSort={sortBy} onPage={goToPage} onChanged={afterChange} />
                : <LogsTab data={data} csrfToken={csrfToken} onSort={sortBy} onPage={goToPage} onChanged={afterChange} />}
        </>
    );
}
