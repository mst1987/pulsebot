import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Background jobs + their toasts.
//
// Long admin actions (a CLA/RPB evaluation, a report build, a log-channel scan,
// filling a raidsheet) used to hold their page hostage: the button spun, the
// list was stale until it came back, and leaving the page threw the result
// away. They live here instead — the provider sits above the router, so a job
// started on the CLA page keeps running (and keeps reporting) while the admin
// works somewhere else. The only UI a running job occupies is its toast.
//
// The server already runs the slow analyses detached (src/web/evalJobs.js) and
// is polled; this is the client-side half that owns the pending promise.

export type JobState = "running" | "done" | "error";

export type BackgroundJob = {
    id: number;
    /** Short action name, e.g. "RPB-Auswertung". */
    label: string;
    /** What it runs on, e.g. the log title. Shown under the label. */
    detail: string;
    state: JobState;
    /** Seconds since it started, ticked by the provider. */
    seconds: number;
    /** Rough duration for the progress bar; omitted → indeterminate. */
    expectedSeconds?: number;
    /** Result / error text, once finished. */
    message: string;
    link?: { href: string; label: string; external?: boolean };
};

/** How a finished job describes itself in its toast. */
export type JobOutcome = { message: string; link?: BackgroundJob["link"] };

export type JobSpec<T> = {
    label: string;
    detail?: string;
    expectedSeconds?: number;
    /** Defaults to "<label> fertig." */
    describe?: (result: T) => JobOutcome;
};

type JobsApi = {
    /**
     * Run `runner` as a tracked background job. Resolves with its result (or
     * null when it failed — the toast already reported the error), so a caller
     * that is still mounted can refresh its list afterwards.
     */
    run: <T>(spec: JobSpec<T>, runner: () => Promise<T>) => Promise<T | null>;
    /** One-off feedback without a job behind it (saved, deleted, …). */
    notify: (message: string, type?: "ok" | "err") => void;
};

const JobsContext = createContext<JobsApi | null>(null);

/** How long a finished toast stays before it fades out. */
const KEEP_FINISHED_MS = 7000;

export function useJobs(): JobsApi {
    const api = useContext(JobsContext);
    if (!api) throw new Error("useJobs must be used inside <JobsProvider>");
    return api;
}

export function JobsProvider({ children }: { children: ReactNode }) {
    const [jobs, setJobs] = useState<BackgroundJob[]>([]);
    const nextId = useRef(1);

    const patch = useCallback((id: number, fields: Partial<BackgroundJob>) => {
        setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...fields } : j)));
    }, []);

    const dismiss = useCallback((id: number) => {
        setJobs((list) => list.filter((j) => j.id !== id));
    }, []);

    // One timer for all running jobs — an interval per job would be the same
    // clock N times over.
    const hasRunning = jobs.some((j) => j.state === "running");
    useEffect(() => {
        if (!hasRunning) return undefined;
        const t = setInterval(() => {
            setJobs((list) => list.map((j) => (j.state === "running" ? { ...j, seconds: j.seconds + 1 } : j)));
        }, 1000);
        return () => clearInterval(t);
    }, [hasRunning]);

    const run = useCallback(async <T,>(spec: JobSpec<T>, runner: () => Promise<T>): Promise<T | null> => {
        const id = nextId.current++;
        setJobs((list) => [...list, {
            id,
            label: spec.label,
            detail: spec.detail || "",
            state: "running",
            seconds: 0,
            expectedSeconds: spec.expectedSeconds,
            message: "",
        }]);
        try {
            const result = await runner();
            const outcome = spec.describe ? spec.describe(result) : { message: `${spec.label} fertig.` };
            patch(id, { state: "done", message: outcome.message, link: outcome.link });
            return result;
        } catch (err) {
            const message = (err as { message?: string })?.message || `${spec.label} fehlgeschlagen.`;
            patch(id, { state: "error", message });
            return null;
        }
    }, [patch]);

    const notify = useCallback((message: string, type: "ok" | "err" = "ok") => {
        const id = nextId.current++;
        setJobs((list) => [...list, {
            id, label: "", detail: "", state: type === "err" ? "error" : "done", seconds: 0, message,
        }]);
    }, []);

    const api = useMemo<JobsApi>(() => ({ run, notify }), [run, notify]);

    return (
        <JobsContext.Provider value={api}>
            {children}
            <JobToasts jobs={jobs} onDismiss={dismiss} />
        </JobsContext.Provider>
    );
}

/** mm:ss for anything past a minute, plain seconds below. */
function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
}

function JobToasts({ jobs, onDismiss }: { jobs: BackgroundJob[]; onDismiss: (id: number) => void }) {
    if (!jobs.length) return null;
    return (
        <div className="toast-wrap">
            {jobs.map((job) => <JobToast key={job.id} job={job} onDismiss={onDismiss} />)}
        </div>
    );
}

// onDismiss is the provider's stable callback and the job id is passed to it
// here, rather than closing over it in the parent's map: a fresh closure per
// render would restart the removal timeout on every tick of a *different*
// running job, and this toast would never actually leave the stack.
function JobToast({ job, onDismiss }: { job: BackgroundJob; onDismiss: (id: number) => void }) {
    const [hiding, setHiding] = useState(false);
    const running = job.state === "running";

    // A running job's toast is permanent — it IS the progress display. Only the
    // finished one times out.
    useEffect(() => {
        if (running) return undefined;
        const t = setTimeout(() => setHiding(true), KEEP_FINISHED_MS);
        return () => clearTimeout(t);
    }, [running]);

    useEffect(() => {
        if (!hiding) return undefined;
        const t = setTimeout(() => onDismiss(job.id), 220);
        return () => clearTimeout(t);
    }, [hiding, job.id, onDismiss]);

    const tone = running ? "toast-run" : job.state === "error" ? "toast-err" : "toast-ok";
    // Estimated, never a lie about being finished: it creeps to 95% and waits
    // there until the job actually reports back.
    const pct = job.expectedSeconds
        ? Math.min(95, Math.round((job.seconds / job.expectedSeconds) * 100))
        : 0;

    return (
        <div className={`toast ${tone}${hiding ? " hide" : ""}`} role="status" aria-live="polite">
            <span className="toast-ico" aria-hidden="true">
                {running ? <span className="toast-spin" /> : job.state === "error" ? "!" : "✓"}
            </span>
            <div className="toast-body">
                {running
                    ? (
                        <>
                            <div className="toast-title">
                                {job.label}
                                <span className="toast-elapsed">{formatElapsed(job.seconds)}</span>
                            </div>
                            {job.detail && <div className="toast-detail">{job.detail}</div>}
                            <div className={`toast-bar${job.expectedSeconds ? "" : " is-indeterminate"}`}>
                                <i style={job.expectedSeconds ? { width: `${pct}%` } : undefined} />
                            </div>
                        </>
                    )
                    : (
                        <>
                            <div className="toast-msg">{job.message}</div>
                            {job.link && (
                                <a
                                    className="toast-link" href={job.link.href}
                                    {...(job.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                >
                                    {job.link.label}
                                </a>
                            )}
                        </>
                    )}
            </div>
            <button className="toast-x" type="button" aria-label="Schließen" onClick={() => setHiding(true)}>&times;</button>
        </div>
    );
}
