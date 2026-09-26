// One shape for "this failed" between the service modules and the /api layer.
//
// Two forms are in use, and both end up as the same wire format the client
// parses (`{ error: { code, message } }`, apiResponse.js):
//
//   fail(status, code, message)  → `{ error: { status, code, message } }`: a
//       service that decides the HTTP status itself (eventCreate, eventManage,
//       inviteCall, missingPing, raidSearch, setupPing). `sendResult()` answers it.
//   `{ code, error }`            → the short-code form of setupEditor,
//       signupService and the raidplan stores. `sendFailure()` maps the code to a
//       status through HTTP_BY_CODE (one table, no per-route copies).
//
// AppError is the thrown variant for code that would otherwise wrap a call in
// try/catch only to send one fixed status: apiRouter.handle() catches it and
// answers with its status and code instead of a bare 500 "internal_error".
const { ok, error } = require("./apiResponse");

class AppError extends Error {
    constructor(code, status = 400, message = "") {
        super(message || code);
        this.name = "AppError";
        this.code = code;
        this.status = status;
    }
}

/** A failed result for a service that names the HTTP status itself. */
const fail = (status, code, message) => ({ error: { status, code, message } });

/** HTTP status by the short codes the `{ code, error }` results use; anything else is 400. */
const HTTP_BY_CODE = {
    not_found: 404,
    conflict: 409,
    invalid: 400,
    too_large: 413,
    raidhelper: 409,
    no_setup: 400,
    no_approved_setup: 400,
    cancelled: 409,
    no_channel: 400,
    discord: 502,
};

/** Sends a `{ code, error }` failure; the status follows the code (HTTP_BY_CODE, 400 otherwise). */
function sendFailure(res, result, statusByCode = HTTP_BY_CODE) {
    return error(res, statusByCode[result.code] || 400, result.code || "failed", result.error || "Fehlgeschlagen.");
}

/**
 * Sends a `fail()`-shaped result: its error with the status it names, else
 * `ok(res, result.body, result.status)`. For a handler that builds its own
 * success payload, call it only on the error branch (`if (result.error) return sendResult(res, result)`).
 */
function sendResult(res, result) {
    if (result && result.error) return error(res, result.error.status, result.error.code, result.error.message);
    return ok(res, result.body, result.status);
}

module.exports = { AppError, fail, HTTP_BY_CODE, sendFailure, sendResult };
