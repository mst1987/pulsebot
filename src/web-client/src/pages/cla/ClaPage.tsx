import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getClaData, evalLog, resetEval, scanLogs, deleteLogEntry, linkLog, unlinkLog, autoMatchLogs, deleteReport, type ApiError, type ClaFilter, type ClaRow, type LogSection } from "../../api";
import { useApi } from "../../hooks/useApi";
import { withIncompleteConfirm } from "../../lib/confirmIncomplete";
import { usePersistedState, usePersistedSearchParam } from "../../lib/persistedState";
import { SortLabel, ariaSort } from "../../components/SortTh";
import { useJobs } from "../../components/Jobs";
import Pager from "../../components/Pager";
import { useConfirm } from "../../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import PageHead from "../../components/ui/PageHead";
import WowIcon from "../../components/ui/WowIcon";
import "../../styles/log-auswertung.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { ANALYSES, EVAL_SECONDS, FILTER_META, FILTERS } from "./shared";
import { FilterSegment } from "./FilterSegment";
import { ListRow } from "./ListRow";
import { NewEvaluationDialog } from "./NewEvaluationDialog";
import { AssignDialog } from "./AssignDialog";

// Log-Auswertung (design issue #217): one list, one row per log. What used to be
// two tabs ("Auswertungen" / "Erkannte Logs") showing the same log twice is now
// one list with a filter segment; the link form, the assignment and the
// "raid still running" question are modals; each row has exactly one action
// plus a row menu for everything that is needed rarely.

type Dir = "asc" | "desc";

// Default direction per sortable column.
const SORT_DEFAULTS: Record<string, Dir> = { date: "desc", content: "asc", status: "asc", event: "asc" };

type Sorting = { sort: string; dir: Dir };

const SORTING_DEFAULT: Sorting = { sort: "date", dir: "desc" };

// ---- the page ----

export default function ClaPage() {
    const ask = useConfirm();
    const jobs = useJobs();
    const [searchParams, setSearchParams] = useSearchParams();
    const [filter, setFilter] = usePersistedSearchParam<ClaFilter>("cla-filter", "filter", "all", FILTERS);
    const [sorting, setSorting] = usePersistedState<Sorting>("cla-sort", SORTING_DEFAULT);
    const [newOpen, setNewOpen] = useState(false);
    const [assignRow, setAssignRow] = useState<ClaRow | null>(null);
    const [scanning, setScanning] = useState(false);
    const [automatching, setAutomatching] = useState(false);
    // "<logId>:<section>" for every analysis started here that is still going.
    // Purely cosmetic and page-local — the job itself lives in JobsProvider.
    const [running, setRunning] = useState<string[]>([]);

    // Old links (?view=logs / ?view=reports from the two-tab page) open the full list.
    useEffect(() => {
        if (!searchParams.has("view")) return;
        const next = new URLSearchParams(searchParams);
        next.delete("view");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    // An explicit ?sort/?dir wins; without one the remembered sort applies. Both are
    // checked against the columns that exist, so a value stored by the old two-tab
    // page (a different shape) cannot ask the API to sort by nothing.
    const remembered = sorting && typeof sorting.sort === "string" && SORT_DEFAULTS[sorting.sort] ? sorting : SORTING_DEFAULT;
    const sortParam = searchParams.get("sort") || "";
    const sort = SORT_DEFAULTS[sortParam] ? sortParam : remembered.sort;
    const dirParam = searchParams.get("dir");
    const dir: Dir = dirParam ? (dirParam === "asc" ? "asc" : "desc") : (remembered.dir === "asc" ? "asc" : "desc");
    // The page number is deliberately not remembered: the list grows at the top.
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const cla = useApi(() => getClaData(filter, sort, dir, page), [filter, sort, dir, page]);
    const { data } = cla;

    const switchFilter = (f: ClaFilter) => setFilter(f, (p) => { p.delete("page"); });

    const sortBy = (key: string) => {
        const nextDir: Dir = sort === key ? (dir === "asc" ? "desc" : "asc") : (SORT_DEFAULTS[key] || "desc");
        setSorting({ sort: key, dir: nextDir });
        setFilter(filter, (p) => { p.set("sort", key); p.set("dir", nextDir); p.set("page", "1"); });
    };

    const goToPage = (p: number) => {
        const next = new URLSearchParams(searchParams);
        next.set("page", String(p));
        setSearchParams(next);
    };

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
            cla.reload();
        }
    };

    const scan = () => quick(() => scanLogs(), setScanning);
    const automatch = () => quick(() => autoMatchLogs(), setAutomatching);

    // Hands the evaluation to JobsProvider: it runs server-side either way, but
    // owning the promise up there is what lets the admin leave this page while
    // the toast keeps reporting.
    const evaluate = (row: ClaRow, section: LogSection | "both") => {
        if (section === "both") return evaluateBoth(row);
        const label = section.toUpperCase();
        const key = `${row.logId}:${section}`;
        setRunning((keys) => [...keys, key]);
        jobs.run({
            label: `${label}-Auswertung`,
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated ? `${label}-Auswertung lag bereits vor.` : `${label}-Auswertung erstellt.`,
                link: r.url ? { href: r.url, label: "Report ansehen", external: true } : undefined,
            }),
        }, () => withIncompleteConfirm(ask, (force) => evalLog(row.logId, section, { force }))).then(() => {
            setRunning((keys) => keys.filter((k) => k !== key));
            cla.reload();
        });
    };

    // Both halves as one job: CLA first (it creates the page), then RPB into it.
    // The "raid still running?" question is asked once and its answer reused.
    const evaluateBoth = (row: ClaRow) => {
        const keys = (["cla", "rpb"] as LogSection[]).map((s) => `${row.logId}:${s}`);
        setRunning((r) => [...r, ...keys]);
        jobs.run({
            label: "CLA + RPB-Auswertung",
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb,
            describe: (r) => ({
                message: "CLA + RPB ausgewertet.",
                link: r.url ? { href: r.url, label: "Report ansehen", external: true } : undefined,
            }),
        }, async () => {
            let force = false;
            await withIncompleteConfirm(ask, (f) => { force = f; return evalLog(row.logId, "cla", { force: f }); });
            return evalLog(row.logId, "rpb", { force });
        }).then(() => {
            setRunning((r) => r.filter((k) => !keys.includes(k)));
            cla.reload();
        });
    };

    const reset = async (row: ClaRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!(await ask({ title: `${label}-Auswertung verwerfen?`, text: `Die ${label}-Auswertung von „${row.title}“ wird verworfen und kann danach neu gestartet werden.`, action: "Verwerfen" }))) return;
        await quick(() => resetEval(row.logId, section));
    };

    const removeLog = async (row: ClaRow) => {
        if (!(await ask({ title: "Log aus der Liste löschen?", text: `„${row.title}“ wird aus der Liste entfernt. Eine vorhandene Auswertung bleibt als Report erhalten.`, action: "Löschen" }))) return;
        await quick(async () => {
            await deleteLogEntry(row.logId);
            return { message: "Gelöscht." };
        });
    };

    const removeReport = async (row: ClaRow) => {
        if (!row.report) return;
        const reportId = row.report.id;
        if (!(await ask({ title: "Auswertung löschen?", text: `„${row.title}“ wird gelöscht.`, action: "Löschen" }))) return;
        await quick(() => deleteReport(reportId));
    };

    const assign = async (row: ClaRow, eventId: string) => {
        setAssignRow(null);
        await quick(() => linkLog(row.logId, eventId));
    };

    const unlink = async (row: ClaRow) => {
        setAssignRow(null);
        if (!(await ask({ title: "Zuordnung entfernen?", text: `Die Zuordnung von „${row.title}“ zu „${row.eventLabel || row.eventId}“ wird entfernt. Die Auswertung selbst bleibt bestehen.`, action: "Entfernen" }))) return;
        await quick(() => unlinkLog(row.logId));
    };

    const head = (
        <PageHead
            icon="inv_misc_pocketwatch_01"
            tone="cla"
            kicker="Warcraft Logs · CLA & RPB"
            title="Log-Auswertung"
            action={<Button icon="inv_misc_spyglass_02" onClick={() => setNewOpen(true)}>Neue Auswertung</Button>}
        />
    );

    if (cla.error && !data) return <>{head}<div className="empty">Fehler beim Laden: {cla.error.message}</div></>;
    if (!data) return <>{head}<RaidLoader text="Logs werden geladen" /></>;

    const list = data.page;
    const columns: { key?: string; label: string; tip: string; sub: string }[] = [
        { key: "date", label: "Log", tip: "Log", sub: "Titel aus Warcraft Logs, Post-Zeit und Kanal. Sortiert nach der Post-Zeit im Channel." },
        { key: "content", label: "Inhalt", tip: "Inhalt", sub: "Welche Raids das Log enthält und wie viele Bosse liegen. Gelb: der Endboss fehlt, der Raid läuft vielleicht noch." },
        { key: "status", label: "Auswertung", tip: "Auswertung", sub: "CLA (Gear, Consumables, Kampfverlauf) und RPB (Schaden, Tode, Aktivität). Zeit, Spieler und Probleme im Tooltip des Badges." },
        { key: "event", label: "Raid-Event", tip: "Raid-Event", sub: "Das Raid-Helper-Event, zu dem das Log gehört – das Event, dessen Startzeit zur Post-Zeit passt." },
    ];

    return (
        <>
            {head}
            <div className="part-head la-filter">
                <FilterSegment value={data.filter} counts={data.counts} onChange={switchFilter} />
                <div className="ph-act">
                    {data.autoMatchCount > 0 && (
                        <Button
                            variant="ghost" size="sm" icon="spell_holy_borrowedtime" running={automatching} onClick={automatch}
                            data-tip="Automatisch zuordnen" data-tip-sub="Ordnet jedes offene Log dem Raid-Event zu, dessen Startzeit eindeutig passt. Mehrdeutige bleiben für den Zuordnen-Dialog."
                        >
                            Automatisch zuordnen <Badge count tone="mid">{data.autoMatchCount}</Badge>
                        </Button>
                    )}
                    {data.logChannelsConfigured
                        ? (
                            <IconButton
                                icon={scanning ? <span className="btn-spin" aria-hidden="true" /> : "inv_misc_spyglass_03"}
                                tip={scanning ? "Suche läuft …" : "Log-Channels durchsuchen"}
                                tipSub="Sucht in den Log-Channels nach Warcraft-Logs-Links, die der Bot verpasst hat."
                                disabled={scanning} onClick={scan}
                            />
                        )
                        : (
                            <a
                                className={buttonClass("ghost", "sm", true)} href="/settings?section=logs"
                                data-tip="Keine Log-Channels" data-tip-sub="Ohne Log-Channel erkennt der Bot keine Logs von selbst. In den Einstellungen festlegen."
                            ><WowIcon name="inv_letter_15" size={18} />Log-Channels einrichten</a>
                        )}
                </div>
            </div>
            {list.items.length
                ? (
                    <>
                        <div className="la-list" role="table" aria-label="Logs">
                            <div className="la-cols" role="row">
                                <span aria-hidden="true" />
                                {columns.map((c) => (
                                    <span key={c.label} role="columnheader" aria-sort={c.key ? ariaSort(c.key, list.sort, list.dir) : undefined}>
                                        {c.key
                                            ? <SortLabel sortKey={c.key} label={c.label} sort={list.sort} dir={list.dir} onSort={sortBy} tip={c.tip} tipSub={c.sub} />
                                            : c.label}
                                    </span>
                                ))}
                                <span aria-hidden="true" />
                            </div>
                            {list.items.map((row) => (
                                <ListRow
                                    key={row.id}
                                    row={row}
                                    running={ANALYSES.map((a) => a.key).filter((s) => running.includes(`${row.logId}:${s}`))}
                                    eventsError={data.matchEventsError}
                                    onEvaluate={(section) => evaluate(row, section)}
                                    onAssign={() => setAssignRow(row)}
                                    onReset={(section) => reset(row, section)}
                                    onDeleteLog={() => removeLog(row)}
                                    onDeleteReport={() => removeReport(row)}
                                />
                            ))}
                        </div>
                        <Pager page={list} onPage={goToPage} />
                    </>
                )
                : <div className="empty">{FILTER_META[data.filter].empty}</div>}
            <NewEvaluationDialog open={newOpen} onClose={() => setNewOpen(false)} onChanged={cla.reload} />
            <AssignDialog row={assignRow} onClose={() => setAssignRow(null)} onAssign={assign} onUnlink={unlink} />
        </>
    );
}
