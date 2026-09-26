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
import { tParts, useT } from "../../i18n";
import { ANALYSES, EVAL_SECONDS, filterMeta, FILTERS } from "./shared";
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
    const t = useT();
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
            label: t("cla.jobs.evalLabel", { label }),
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated ? t("cla.jobs.already", { label }) : t("cla.jobs.created", { label }),
                link: r.url ? { href: r.url, label: t("cla.jobs.viewReport"), external: true } : undefined,
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
            label: t("cla.jobs.evalLabel", { label: "CLA + RPB" }),
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb,
            describe: (r) => ({
                message: t("cla.jobs.bothDone"),
                link: r.url ? { href: r.url, label: t("cla.jobs.viewReport"), external: true } : undefined,
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
        if (!(await ask({ title: t("cla.confirm.resetTitle", { label }), text: t("cla.confirm.resetText", { label, title: row.title }), action: t("common.discard") }))) return;
        await quick(() => resetEval(row.logId, section));
    };

    const removeLog = async (row: ClaRow) => {
        if (!(await ask({ title: t("cla.confirm.deleteLogTitle"), text: t("cla.confirm.deleteLogText", { title: row.title }), action: t("common.delete") }))) return;
        await quick(async () => {
            await deleteLogEntry(row.logId);
            return { message: t("cla.confirm.deleted") };
        });
    };

    const removeReport = async (row: ClaRow) => {
        if (!row.report) return;
        const reportId = row.report.id;
        if (!(await ask({ title: t("cla.confirm.deleteReportTitle"), text: t("cla.confirm.deleteReportText", { title: row.title }), action: t("common.delete") }))) return;
        await quick(() => deleteReport(reportId));
    };

    const assign = async (row: ClaRow, eventId: string) => {
        setAssignRow(null);
        await quick(() => linkLog(row.logId, eventId));
    };

    const unlink = async (row: ClaRow) => {
        setAssignRow(null);
        if (!(await ask({ title: t("cla.confirm.unlinkTitle"), text: t("cla.confirm.unlinkText", { title: row.title, event: row.eventLabel || row.eventId }), action: t("common.remove") }))) return;
        await quick(() => unlinkLog(row.logId));
    };

    const head = (
        <PageHead
            icon="inv_misc_pocketwatch_01"
            tone="cla"
            kicker="Warcraft Logs · CLA & RPB"
            title={t("cla.page.title")}
            action={<Button icon="inv_misc_spyglass_02" onClick={() => setNewOpen(true)}>{t("cla.page.newEvaluation")}</Button>}
        />
    );

    if (cla.error && !data) return <>{head}<div className="empty">{tParts("cla.page.loadError", { message: cla.error.message })}</div></>;
    if (!data) return <>{head}<RaidLoader text={t("cla.page.loading")} /></>;

    const list = data.page;
    const columns: { key?: string; label: string; tip: string; sub: string }[] = [
        { key: "date", label: t("cla.columns.log"), tip: t("cla.columns.log"), sub: t("cla.columns.logSub") },
        { key: "content", label: t("cla.columns.content"), tip: t("cla.columns.content"), sub: t("cla.columns.contentSub") },
        { key: "status", label: t("cla.columns.evaluation"), tip: t("cla.columns.evaluation"), sub: t("cla.columns.evaluationSub") },
        { key: "event", label: t("cla.columns.event"), tip: t("cla.columns.event"), sub: t("cla.columns.eventSub") },
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
                            data-tip={t("cla.toolbar.autoMatch")} data-tip-sub={t("cla.toolbar.autoMatchSub")}
                        >
                            {t("cla.toolbar.autoMatch")} <Badge count tone="mid">{data.autoMatchCount}</Badge>
                        </Button>
                    )}
                    {data.logChannelsConfigured
                        ? (
                            <IconButton
                                icon={scanning ? <span className="btn-spin" aria-hidden="true" /> : "inv_misc_spyglass_03"}
                                tip={scanning ? t("cla.toolbar.scanning") : t("cla.toolbar.scan")}
                                tipSub={t("cla.toolbar.scanSub")}
                                disabled={scanning} onClick={scan}
                            />
                        )
                        : (
                            <a
                                className={buttonClass("ghost", "sm", true)} href="/settings?section=logs"
                                data-tip={t("cla.toolbar.noChannels")} data-tip-sub={t("cla.toolbar.noChannelsSub")}
                            ><WowIcon name="inv_letter_15" size={18} />{t("cla.toolbar.setupChannels")}</a>
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
                : <div className="empty">{filterMeta(data.filter).empty}</div>}
            <NewEvaluationDialog open={newOpen} onClose={() => setNewOpen(false)} onChanged={cla.reload} />
            <AssignDialog row={assignRow} onClose={() => setAssignRow(null)} onAssign={assign} onUnlink={unlink} />
        </>
    );
}
