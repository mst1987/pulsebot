import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
    getClaData, createReport, evalLog, resetEval, scanLogs, deleteLogEntry, linkLog, unlinkLog, autoMatchLogs,
    deleteReport, unlinkReport,
    type ApiError, type ClaData, type ClaPage, type ReportSummary, type LogRow, type MatchCandidate,
    type LogSection,
} from "../api";
import { formatEventTime, fmtMs } from "../lib/format";
import type { ShellContext } from "../components/Shell";
import { useJobs } from "../components/Jobs";
import { RunIcon, SearchIcon, LinkIcon, TrashIcon, ExternalIcon } from "../components/icons";

type View = "reports" | "logs";
type Dir = "asc" | "desc";

// Rough runtimes, used only to give the progress toast a bar to fill. RPB walks
// the whole fight timeline and is the slow half; a report built from a pasted
// link is a full CLA run.
const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };
const REPORT_SECONDS = 30;

// Default sort direction per column — mirrors renderAdmin.js's REPORT_DIR/LOG_DIR
// maps used by claSortHeader().
const REPORT_SORT_DEFAULTS: Record<string, Dir> = { title: "asc", zone: "asc", event: "asc", date: "desc", players: "desc", issues: "desc" };
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

// The "Raid" cell of a report row: the raid its log is assigned to, with a
// button to remove that assignment. A report is never linked to a raid directly
// — the link lives on the log it was generated from, so unassigning here means
// unassigning that log. Reports without a log (or without an assignment) show a
// dash; assigning is done in the logs tab / on the raid page.
function ReportEventCell({ r, busy, onUnlink }: { r: ReportSummary; busy: boolean; onUnlink: () => void }) {
    if (!r.eventId) {
        return <span className="sub" title={r.logId ? "Das zugehörige Log ist keinem Raid zugeordnet" : "Zu dieser Auswertung gibt es kein erkanntes Log"}>—</span>;
    }
    const when = r.eventStartTime ? formatEventTime(r.eventStartTime) : "";
    return (
        <div className="row-actions" style={{ flexWrap: "nowrap", gap: 6 }}>
            <span className="pill" title={`${r.eventLabel || r.eventId}${when ? ` — ${when}` : ""}`}>{r.eventLabel || r.eventId}</span>
            <button className="btn btn-ghost btn-sm" type="button" title="Zuordnung entfernen" disabled={busy} onClick={onUnlink}>×</button>
        </div>
    );
}

function ReportsTab({ reportPage, csrfToken, onSort, onPage, onChanged }: {
    reportPage: ClaPage<ReportSummary> | null;
    csrfToken: string | null;
    onSort: (key: string, dir: Dir) => void;
    onPage: (p: number) => void;
    onChanged: () => void;
}) {
    const jobs = useJobs();
    const [link, setLink] = useState("");
    const [rowBusyId, setRowBusyId] = useState<string | null>(null);

    // The build runs as a background job: the form clears immediately and the
    // toast reports progress and the finished report, so the admin can carry on
    // (even on another page) while it runs.
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const target = link.trim();
        if (!target) return;
        setLink("");
        jobs.run({
            label: "Auswertung erstellen",
            detail: target,
            expectedSeconds: REPORT_SECONDS,
            describe: (r) => ({
                message: "Auswertung erstellt.",
                link: { href: r.url, label: "Report ansehen ↗", external: true },
            }),
        }, () => createReport(csrfToken, target)).then(onChanged);
    };

    // Deleting a report also resets its log back to "offen", so it can be
    // evaluated again — say so, the admin doesn't see the logs tab from here.
    const remove = async (r: ReportSummary) => {
        if (!confirm(`Auswertung „${r.title || r.id}“ löschen? Das zugehörige Log bleibt erhalten und kann neu ausgewertet werden.`)) return;
        setRowBusyId(r.id);
        try {
            const res = await deleteReport(csrfToken, r.id);
            jobs.notify(res.message);
        } catch (err) {
            jobs.notify((err as ApiError).message, "err");
        } finally {
            setRowBusyId(null);
            onChanged();
        }
    };

    const unlink = async (r: ReportSummary) => {
        if (!confirm(`Zuordnung zum Raid „${r.eventLabel || r.eventId}“ entfernen? Die Auswertung selbst bleibt bestehen.`)) return;
        setRowBusyId(r.id);
        try {
            const res = await unlinkReport(csrfToken, r.id);
            jobs.notify(res.message);
        } catch (err) {
            jobs.notify((err as ApiError).message, "err");
        } finally {
            setRowBusyId(null);
            onChanged();
        }
    };

    return (
        <>
            <h2>Neue Auswertung</h2>
            <form className="card-form" onSubmit={submit}>
                <div className="field">
                    <label>Warcraft-Logs-Report-Link oder Report-ID</label>
                    <input
                        type="text" value={link} onChange={(e) => setLink(e.target.value)}
                        placeholder="https://classic.warcraftlogs.com/reports/abc123…" required
                    />
                    <div className="hint">Läuft im Hintergrund — der Fortschritt steht im Hinweis oben rechts, die Seite bleibt nutzbar.</div>
                </div>
                <div className="row-actions">
                    <button className="btn" type="submit"><RunIcon />Auswertung erstellen</button>
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
                                    <SortTh sortKey="event" label="Raid" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="date" label="Erstellt" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="players" label="Spieler" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <SortTh sortKey="issues" label="Probleme" page={reportPage} defaults={REPORT_SORT_DEFAULTS} onSort={onSort} />
                                    <th>WCL</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {reportPage.items.map((r) => (
                                    <tr key={r.id}>
                                        <td><a href={`/r/${r.id}`}>{r.title || r.id}</a></td>
                                        <td>{r.zone || ""}</td>
                                        <td><ReportEventCell r={r} busy={rowBusyId === r.id} onUnlink={() => unlink(r)} /></td>
                                        <td className="small">{fmtMs(r.generatedAt)}</td>
                                        <td>{r.playerCount}</td>
                                        <td><span className="pill">{r.issueCount}</span></td>
                                        <td>{r.reportUrl
                                            ? <a className="mlink" href={r.reportUrl} target="_blank" rel="noopener noreferrer">WCL ↗</a>
                                            : <span className="sub">—</span>}</td>
                                        <td className="cell-actions">
                                            <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                                                <button
                                                    className="btn btn-danger btn-sm" type="button"
                                                    disabled={rowBusyId === r.id} onClick={() => remove(r)}
                                                ><TrashIcon />Löschen</button>
                                            </div>
                                        </td>
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

// The two analyses a log can be run through, each on its own button. Both write
// into the same report page, so a log can be completed in two steps.
const LOG_ANALYSES: { key: LogSection; label: string; title: string }[] = [
    { key: "cla", label: "CLA", title: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi" },
    { key: "rpb", label: "RPB", title: "Vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts & Log-Prüfung" },
];

function LogTableRow({ l, runningSections, selectedEventId, onSelectChange, onEvaluate, onReset, onDelete, onLink, onUnlink }: {
    l: LogRow;
    /** Analyses of this log started from this page and not finished yet. */
    runningSections: LogSection[];
    selectedEventId: string;
    onSelectChange: (eventId: string) => void;
    onEvaluate: (section: LogSection) => void;
    onReset: (section: LogSection) => void;
    onDelete: () => void;
    onLink: () => void;
    onUnlink: () => void;
}) {
    const wclUrl = logWclUrl(l);
    const name = l.title || l.reportId || "(unbekannt)";
    const done = l.sections || [];
    const reportHref = l.reportUrl || (l.reportRefId ? `/r/${l.reportRefId}` : "");
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
            <td>{done.length
                ? LOG_ANALYSES.filter((a) => done.includes(a.key)).map((a) => (
                    // the ✕ discards just this half, so an incomplete run can be repeated
                    <span key={a.key} className="pill good" style={{ marginRight: 4 }}>
                        {a.label}
                        <button
                            type="button"
                            className="pill-x"
                            title={`${a.label}-Auswertung verwerfen (kann danach neu gestartet werden)`}
                            aria-label={`${a.label}-Auswertung verwerfen`}
                            onClick={() => onReset(a.key)}
                        >×</button>
                    </span>
                ))
                : <span className="pill">offen</span>}</td>
            <td className="small">{fmtMs(l.postedAt)}</td>
            <td className="cell-actions">
                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                    {LOG_ANALYSES.filter((a) => !done.includes(a.key)).map((a) => {
                        const running = runningSections.includes(a.key);
                        return (
                            <button
                                key={a.key}
                                className={`btn btn-run btn-sm${running ? " is-running" : ""}`}
                                type="button"
                                title={running ? `${a.label}-Auswertung läuft im Hintergrund` : a.title}
                                disabled={running}
                                onClick={() => onEvaluate(a.key)}
                            >
                                {running ? <span className="btn-spin" /> : <RunIcon />}
                                {a.label}
                            </button>
                        );
                    })}
                    {reportHref ? <a className="btn btn-ghost btn-sm" href={reportHref}><ExternalIcon />Öffnen</a> : null}
                    <button className="btn btn-danger btn-sm" type="button" onClick={onDelete}><TrashIcon />Löschen</button>
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
    onChanged: () => void;
}) {
    const jobs = useJobs();
    const [scanning, setScanning] = useState(false);
    const [automatching, setAutomatching] = useState(false);
    // "<logId>:<section>" for every analysis started here that is still going, so
    // the row can show it. Purely cosmetic and page-local — the job itself lives
    // in JobsProvider and keeps running if this page goes away.
    const [running, setRunning] = useState<string[]>([]);
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

    /** Run a short action, report its outcome as a toast, then refresh the list. */
    const quick = async (fn: () => Promise<{ message: string }>, setBusy?: (b: boolean) => void) => {
        if (setBusy) setBusy(true);
        try {
            const r = await fn();
            jobs.notify(r.message);
        } catch (err) {
            jobs.notify((err as ApiError).message, "err");
        } finally {
            if (setBusy) setBusy(false);
            onChanged();
        }
    };

    const scan = () => quick(() => scanLogs(csrfToken), setScanning);
    const automatch = () => quick(() => autoMatchLogs(csrfToken), setAutomatching);

    // Hands the evaluation to JobsProvider: it runs server-side either way, but
    // owning the promise up there is what lets the admin leave this page (or this
    // tab of it) while the toast keeps reporting.
    const evaluate = (l: LogRow, section: LogSection) => {
        const label = section.toUpperCase();
        const key = `${l.id}:${section}`;
        setRunning((keys) => [...keys, key]);
        jobs.run({
            label: `${label}-Auswertung`,
            detail: l.title || l.reportId || "",
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated
                    ? `${label}-Auswertung lag bereits vor.`
                    : `${label}-Auswertung erstellt.`,
                link: r.url ? { href: r.url, label: "Report ansehen ↗", external: true } : undefined,
            }),
        }, () => evalLog(csrfToken, l.id, section)).then(() => {
            setRunning((keys) => keys.filter((k) => k !== key));
            onChanged();
        });
    };

    const reset = async (l: LogRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!confirm(`${label}-Auswertung dieses Logs verwerfen? Sie kann danach neu gestartet werden.`)) return;
        await quick(() => resetEval(csrfToken, l.id, section));
    };

    const remove = async (l: LogRow) => {
        if (!confirm("Log aus der Liste entfernen?")) return;
        await quick(async () => {
            await deleteLogEntry(csrfToken, l.id);
            return { message: "Gelöscht." };
        });
    };

    const doLink = async (l: LogRow) => {
        // Logs that are already linked carry no candidates (annotateMatches skips
        // them), so this has to stay optional.
        const eventId = selected[l.id] || l.candidates?.[0]?.eventId;
        if (!eventId) return;
        await quick(() => linkLog(csrfToken, l.id, eventId));
    };

    const doUnlink = async (l: LogRow) => {
        if (!confirm("Zuordnung zu diesem Event entfernen?")) return;
        await quick(() => unlinkLog(csrfToken, l.id));
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
                <button className={`btn btn-ghost${scanning ? " is-running" : ""}`} type="button" disabled={scanning} onClick={scan}>
                    {scanning ? <span className="btn-spin" /> : <SearchIcon />}
                    {scanning ? "Suche läuft …" : "Log-Channels nach neuen Logs durchsuchen"}
                </button>
                {showAutomatch && (
                    <button
                        className={`btn btn-ghost${automatching ? " is-running" : ""}`} type="button" disabled={automatching}
                        title="Ordnet jedes offene Log dem Event zu, dessen Startzeit eindeutig passt" onClick={automatch}
                    >
                        {automatching ? <span className="btn-spin" /> : <LinkIcon />}
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
                                        runningSections={LOG_ANALYSES
                                            .map((a) => a.key)
                                            .filter((s) => running.includes(`${l.id}:${s}`))}
                                        selectedEventId={selected[l.id] ?? l.candidates?.[0]?.eventId ?? ""}
                                        onSelectChange={(v) => setSelected((s) => ({ ...s, [l.id]: v }))}
                                        onEvaluate={(section) => evaluate(l, section)}
                                        onReset={(section) => reset(l, section)}
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

    const load = () => {
        getClaData(view, sort, dir, page).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [view, sort, dir, page]);

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
                ? <ReportsTab reportPage={data.reportPage} csrfToken={csrfToken} onSort={sortBy} onPage={goToPage} onChanged={load} />
                : <LogsTab data={data} csrfToken={csrfToken} onSort={sortBy} onPage={goToPage} onChanged={load} />}
        </>
    );
}
