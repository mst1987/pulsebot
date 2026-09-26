import { get, send, pollJob } from "./client";
import type { JobPollStatus } from "./client";
import type { LogSection } from "./raidDetail";

// ===== CLA / Logcheck =====
// A generic sorted+paged slice from the backend — mirrors renderAdmin.js's
// claSortHeader()/claPager() query-string contract (view/sort/dir/page).
export type ClaPage<T> = {
    items: T[];
    sort: string;
    dir: "asc" | "desc";
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
};

// A candidate raid event a detected log could belong to, ranked by how close
// its start time is to the log's post time (web/logEventMatch.js).
export type MatchCandidate = {
    eventId: string;
    title: string;
    startTime: number;
    categoryName: string;
    diffMs: number;
    sameCategory: boolean;
    /** The raid the event title names ("hyjal"), for its boss icon; "" when none. */
    contentId?: string;
};

// One raid a log covers and how far it got — raidProgress.raidSummary().
export type ClaRaid = {
    contentId: string;
    /** Short raid name, "Hyjal". */
    label: string;
    killed: number;
    total: number;
    finalKilled: boolean;
    finalBoss: string;
    /** Encounters still standing, in raid order. */
    missing: string[];
    /** Every encounter with its state; empty for a report stored before the grid existed. */
    bosses: { name: string; killed: boolean }[];
};

// A row of the Log-Auswertung list (web/reportList.js prepareClaList): a tracked
// log, or a report built from a pasted link that has no log ("report").
export type ClaRow = {
    kind: "log" | "report";
    id: string;
    logId: string;
    title: string;
    zone: string;
    reportId: string;
    wclUrl: string;
    /** Post time in the log channel (a link report: its build time), epoch ms. */
    postedAt: number;
    source: "channel" | "link";
    guildId: string;
    channelId: string;
    messageId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    /** Which analyses already ran ("cla" / "rpb"). */
    sections: LogSection[];
    report: { id: string; url: string; generatedAt: number; playerCount: number; issueCount: number } | null;
    raids: ClaRaid[];
    eventId: string;
    eventLabel: string;
    eventStartTime: number;
    eventLinkSource: "manual" | "auto" | "";
    /** Time-matched events; absent on linked logs and link reports. */
    candidates?: MatchCandidate[];
    matchAmbiguous?: boolean;
};

export type ClaFilter = "all" | "open" | "unlinked" | "done";

export type ClaData = {
    filter: ClaFilter;
    page: ClaPage<ClaRow>;
    counts: Record<ClaFilter, number>;
    /** How many open logs "Automatisch zuordnen" would assign right now. */
    autoMatchCount: number;
    matchEventsError: string | null;
    logChannelsConfigured: boolean;
    activeGuildId: string;
};

export function getClaData(filter: ClaFilter, sort?: string, dir?: string, page?: number): Promise<ClaData> {
    const qs = new URLSearchParams();
    qs.set("filter", filter);
    if (sort) qs.set("sort", sort);
    if (dir) qs.set("dir", dir);
    if (page) qs.set("page", String(page));
    return get<ClaData>(`/api/cla?${qs.toString()}`);
}

/**
 * Build a report from a pasted Warcraft-Logs link, to completion.
 *
 * Same shape as evalLog(): the POST only queues the build (it is the full CLA
 * analysis and takes far longer than a proxy holds a connection open), the
 * outcome is collected by polling. Callers run this through useJobs().run(),
 * so it keeps going while the admin browses elsewhere.
 */
export async function createReport(
    csrfToken: string | null,
    link: string,
    opts: { force?: boolean; sections?: LogSection[] } = {},
): Promise<{ id: string; url: string }> {
    const started = await send<{ jobId: string }>("POST", "/api/cla", csrfToken, { link, force: !!opts.force, sections: opts.sections });
    const state = await pollJob(
        () => get<JobPollStatus>(`/api/cla/report-status?jobId=${encodeURIComponent(started.jobId)}`),
        "Die Auswertung konnte nicht erstellt werden.",
    );
    return { id: state.id || "", url: state.url || "" };
}

export function deleteReport(
    csrfToken: string | null,
    reportId: string,
): Promise<{ reportId: string; logId: string; message: string }> {
    return send("POST", "/api/cla/report-delete", csrfToken, { reportId });
}

/**
 * Run one half of a log's analysis — "cla" (gear/consumables) or "rpb"
 * (performance). Each half runs at most once; both write into the same report
 * page, so the returned url is stable across the two calls.
 */
export type EvalStart = {
    status?: "running" | "done";
    section?: LogSection;
    logId?: string;
    alreadyRunning?: boolean;
    alreadyEvaluated?: boolean;
    url?: string;
};

export type EvalStatus = {
    status: "running" | "done" | "error" | "unknown";
    url?: string;
    id?: string;
    error?: string;
    incomplete?: boolean;
    raids?: ClaRaid[];
    section?: LogSection;
    runningMs?: number;
};

/** Kick off one half of a log's analysis. Returns as soon as the job is queued. */
export function startEval(
    csrfToken: string | null,
    logId: string,
    section: LogSection = "cla",
    opts: { force?: boolean } = {},
): Promise<EvalStart> {
    return send("POST", "/api/cla/eval", csrfToken, { logId, section, force: !!opts.force });
}

/** Current state of a started evaluation. */
export function getEvalStatus(logId: string, section: LogSection): Promise<EvalStatus> {
    const qs = new URLSearchParams({ logId, section });
    return get<EvalStatus>(`/api/cla/eval-status?${qs.toString()}`);
}

/**
 * Discard one half of a log's evaluation so it can be run again — for a run that
 * came out incomplete, say. The other half stays; if this was the last one, the
 * report page goes away and the log falls back to "offen".
 */
export function resetEval(
    csrfToken: string | null,
    logId: string,
    section: LogSection,
): Promise<{ logId: string; section: LogSection; remaining: string[]; message: string }> {
    return send("POST", "/api/cla/eval-reset", csrfToken, { logId, section });
}

/**
 * Run one half of a log's analysis to completion.
 *
 * The request only starts the job — an RPB evaluation runs ~50s, far past the
 * point where a reverse proxy would drop a held-open connection — so the result
 * is collected by polling. Resolves with the finished report's url.
 *
 * Callers run this through useJobs().run(), which owns the pending promise —
 * so the evaluation (and its progress toast) survives leaving the CLA page.
 */
export async function evalLog(
    csrfToken: string | null,
    logId: string,
    section: LogSection = "cla",
    opts: { force?: boolean } = {},
): Promise<{ url: string; id?: string; alreadyEvaluated?: boolean; section?: LogSection }> {
    const started = await startEval(csrfToken, logId, section, opts);
    if (started.alreadyEvaluated) {
        return { url: started.url || "", alreadyEvaluated: true, section };
    }
    const state = await pollJob(() => getEvalStatus(logId, section), "Auswertung fehlgeschlagen.");
    return { url: state.url || "", id: state.id, section };
}

export function scanLogs(csrfToken: string | null): Promise<{ found: number; message: string }> {
    return send("POST", "/api/cla/scan", csrfToken, {});
}

export function deleteLogEntry(csrfToken: string | null, logId: string): Promise<{ logId: string }> {
    return send("POST", "/api/cla/log-delete", csrfToken, { logId });
}

export function linkLog(
    csrfToken: string | null,
    logId: string,
    eventId: string,
): Promise<{ logId: string; eventId: string; eventLabel: string; message: string }> {
    return send("POST", "/api/cla/log-link", csrfToken, { logId, eventId });
}

export function linkLogUrl(
    csrfToken: string | null,
    link: string,
    eventId: string,
): Promise<{ logId: string; eventId: string; eventLabel: string; message: string }> {
    return send("POST", "/api/cla/log-link-url", csrfToken, { link, eventId });
}

export function unlinkLog(csrfToken: string | null, logId: string): Promise<{ logId: string; message: string }> {
    return send("POST", "/api/cla/log-unlink", csrfToken, { logId });
}

export function autoMatchLogs(csrfToken: string | null): Promise<{ matched: number; remaining: number; message: string }> {
    return send("POST", "/api/cla/log-automatch", csrfToken, {});
}
