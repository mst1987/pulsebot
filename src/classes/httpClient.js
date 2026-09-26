const axios = require("axios");
const httpsAgent = require("../utils/httpAgent");

// The one HTTP base every API client in src/classes builds on (#429).
//
// createClient() hands back an axios instance with the shared httpsAgent
// (certificate checks only in production, utils/httpAgent.js), a base URL, a
// hard timeout and one response interceptor that does two things:
//
//   1. Retry — only what is safe to repeat: a 5xx answer, a network error or a
//      timeout, never a 4xx (the request itself is wrong, a second try gets the
//      same answer), and only for idempotent methods (GET/HEAD/OPTIONS/PUT/
//      DELETE) unless the client lists more in `retry.methods` — WCL v2's
//      GraphQL POST is a read, Raid-Helper's "create event" POST is not.
//      Default: 2 retries, backoff 250 ms → 500 ms.
//   2. Translation — everything that still fails leaves as an ApiError
//      { service, status, code, kind, message, cause, data }, so no caller has
//      to know axios' error shape. `kind` is "timeout" | "network" | "http" |
//      "canceled"; `status` is the HTTP status (null without an answer);
//      `code` the underlying code (ECONNRESET, ECONNABORTED, ERR_BAD_REQUEST…);
//      `data` the answer's body for an HTTP error.
//
// What a failure *means* for the caller (throw, `null` + `lastError`, an empty
// list) stays the business of each client — see the header of each module.

const IDEMPOTENT_METHODS = ["get", "head", "options", "put", "delete"];

const DEFAULT_RETRY = Object.freeze({
    retries: 2,
    delayMs: 250,
    methods: IDEMPOTENT_METHODS,
    // Retry a timeout too. A client whose server tends to hang rather than
    // fail (Raid-Helper) switches this off: three 20-s waits are worse than one.
    timeouts: true,
});

class ApiError extends Error {
    constructor({ service, status = null, code = null, kind, message, cause = null, data }) {
        super(message);
        this.name = "ApiError";
        this.service = service;
        this.status = status;
        this.code = code;
        this.kind = kind;
        this.cause = cause;
        this.data = data;
    }

    /**
     * axios' `error.response`, kept for callers that still read
     * `err.response.status` (utils/logcheck/report.js on WCL v1 errors).
     */
    get response() {
        return this.cause && this.cause.response;
    }
}

function retryPolicy(retry) {
    if (retry === false) return { ...DEFAULT_RETRY, retries: 0 };
    const r = retry || {};
    return {
        retries: Number.isInteger(r.retries) ? r.retries : DEFAULT_RETRY.retries,
        delayMs: Number.isFinite(r.delayMs) ? r.delayMs : DEFAULT_RETRY.delayMs,
        methods: (r.methods || DEFAULT_RETRY.methods).map((m) => String(m).toLowerCase()),
        timeouts: r.timeouts !== false,
    };
}

function classify(error) {
    if (axios.isCancel && axios.isCancel(error)) return "canceled";
    if (error && error.code === "ERR_CANCELED") return "canceled";
    if (error && error.response) return "http";
    const code = error && error.code;
    if (code === "ETIMEDOUT" || (code === "ECONNABORTED" && /timeout/i.test(error.message || ""))) return "timeout";
    return "network";
}

function isRetryable(kind, status, method, policy) {
    if (!policy.methods.includes(String(method || "get").toLowerCase())) return false;
    if (kind === "http") return status >= 500;
    if (kind === "timeout") return policy.timeouts;
    return kind === "network";
}

function toApiError(service, error, kind) {
    const config = (error && error.config) || {};
    const response = error && error.response;
    const status = response ? response.status : null;
    let message;
    if (kind === "timeout") {
        const seconds = Math.round((config.timeout || 0) / 100) / 10;
        message = `${service} hat nicht innerhalb von ${seconds}s geantwortet.`;
    } else if (kind === "http") {
        message = `${service} antwortete mit HTTP ${status}`;
    } else {
        message = (error && error.message) || `${service}: Anfrage fehlgeschlagen`;
    }
    return new ApiError({
        service,
        status,
        code: (error && error.code) || null,
        kind,
        message,
        cause: error,
        data: response ? response.data : undefined,
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} opts
 * @param {string} opts.service   human name used in errors ("Raid-Helper")
 * @param {string} [opts.baseURL]
 * @param {number} opts.timeout   ms, hard cap per attempt
 * @param {object} [opts.headers] default headers
 * @param {object|false} [opts.retry] { retries, delayMs, methods, timeouts } or false.
 *        A single request may override it with its own `retry` config key.
 * @returns {import("axios").AxiosInstance}
 */
function createClient({ service, baseURL, timeout, headers, retry } = {}) {
    if (!service) throw new Error("createClient: service is required");
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`createClient(${service}): timeout is required`);
    const instance = axios.create({ baseURL, timeout, headers, httpsAgent });
    const clientPolicy = retryPolicy(retry);

    instance.interceptors.response.use(undefined, async (error) => {
        const config = (error && error.config) || {};
        const kind = classify(error);
        const status = error && error.response ? error.response.status : null;
        const policy = config.retry === undefined ? clientPolicy : retryPolicy(config.retry);
        const attempt = config.__attempt || 0;
        if (kind !== "canceled" && error && error.config && attempt < policy.retries
            && isRetryable(kind, status, config.method, policy)) {
            config.__attempt = attempt + 1;
            await sleep(policy.delayMs * 2 ** attempt);
            return instance.request(config);
        }
        throw toApiError(service, error, kind);
    });

    return instance;
}

module.exports = { createClient, ApiError, DEFAULT_RETRY, IDEMPOTENT_METHODS };
