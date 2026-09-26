// The one fetch layer under every /api/* call (src/web/apiRouter.js): JSON in
// and out, one error shape (ApiError), the CSRF header on every mutating
// request and the poll loop for server-side jobs. No React Query — the app is
// small enough that useApi (hooks/useApi.ts) over these functions covers it.
// Each area of the API has its own file next to this one; index.ts re-exports
// them all, so pages keep importing from "../api".

import type { ClaRaid } from "./cla";
import { t } from "../i18n";

export type ApiError = { code: string; message: string };

/** What a non-JSON answer says in words (a proxy in front of the server: 413 body too large, 502 / 503 / 504 gateway errors); translated by the language of the menu. */
export function nonJsonMessage(status: number, ok: boolean): string {
    if (ok) return t("common.errors.badResponse");
    if (status === 413) return t("common.errors.tooLarge");
    if (status === 502 || status === 503 || status === 504) return t("common.errors.gateway", { status });
    return t("common.errors.server", { status });
}

/**
 * Read a response body as JSON without letting a non-JSON body escape as a bare
 * "Unexpected token". Anything that is not JSON — a gateway timeout page from a
 * reverse proxy in front of a slow route, an HTML error page — is turned into a
 * readable ApiError that names the status instead of the parser's complaint.
 */
async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        // the HTML of a proxy's error page goes to the console only; the person gets a sentence in his language
        console.error(`API answer that is no JSON (HTTP ${res.status}):`, text.trim().slice(0, 600));
        throw { code: res.ok ? "bad_response" : `http_${res.status}`, message: nonJsonMessage(res.status, res.ok) } as ApiError;
    }
}

function errorFrom(body: Record<string, unknown> | null, res: Response): ApiError {
    const err = body && (body.error as ApiError | undefined);
    return err || { code: "unknown", message: `HTTP ${res.status}` };
}

export async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: "include" });
    const body = await parseJson(res);
    if (!res.ok) throw errorFrom(body, res);
    return (body?.data ?? null) as T;
}

// Mutating requests carry the CSRF token from GET /api/session as a header
// (the SSR forms use a hidden _csrf field instead — see src/web/auth.js).
export async function send<T>(method: string, path: string, csrfToken: string | null, jsonBody?: unknown): Promise<T> {
    const res = await fetch(path, {
        method,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(jsonBody ?? {}),
    });
    const body = await parseJson(res);
    if (!res.ok) throw errorFrom(body, res);
    return (body?.data ?? null) as T;
}

/**
 * A mutating request whose body is not JSON — the raidplan map upload sends the
 * file itself. Same CSRF header and error handling as send().
 */
export async function sendRaw<T>(method: string, path: string, csrfToken: string | null, body: BodyInit, contentType: string): Promise<T> {
    const res = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": contentType, ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
        body,
    });
    const parsed = await parseJson(res);
    if (!res.ok) throw errorFrom(parsed, res);
    return (parsed?.data ?? null) as T;
}

export type JobPollStatus = {
    status: "running" | "done" | "error" | "unknown";
    url?: string;
    id?: string;
    error?: string;
    /** The job stopped because the raid's final boss is not down yet. */
    incomplete?: boolean;
    /** With `incomplete`: the raids of the log and which bosses still stand. */
    raids?: ClaRaid[];
};

/** A refused evaluation over a raid that is still running (code RAID_INCOMPLETE). */
export type IncompleteRaidError = ApiError & { raids?: ClaRaid[] };

/**
 * The error code a refused evaluation carries — the raid was still running.
 * Not a failure: the caller asks whether to run it anyway and retries with
 * force (see lib/confirmIncomplete.ts).
 */
export const RAID_INCOMPLETE = "raid_incomplete";

/**
 * Poll a server-side job until it reports done/error. Shared by the report
 * build and the log evaluations — both answer with the same status shape.
 */
export async function pollJob(
    read: () => Promise<JobPollStatus>,
    failMessage: string,
): Promise<JobPollStatus> {
    const startedAt = Date.now();
    const POLL_MS = 2000;
    // Generous ceiling: well past a slow RPB run, but not infinite.
    const TIMEOUT_MS = 10 * 60 * 1000;

    for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const state = await read();
        if (state.status === "done") return state;
        if (state.status === "error") {
            // A raid that is still running is a question, not a failure — the
            // caller offers "evaluate anyway" on this code.
            const code = state.incomplete ? RAID_INCOMPLETE : "job_failed";
            throw { code, message: state.error || failMessage, raids: state.raids } as IncompleteRaidError;
        }
        if (state.status === "unknown") {
            // the job vanished without leaving a result (server restart mid-run)
            throw { code: "job_lost", message: "Der Vorgang wurde unterbrochen. Bitte erneut starten." } as ApiError;
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
            throw {
                code: "job_timeout",
                message: "Der Vorgang dauert ungewöhnlich lange. Er läuft im Hintergrund weiter — lade die Seite später neu.",
            } as ApiError;
        }
    }
}
