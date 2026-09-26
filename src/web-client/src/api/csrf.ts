// The session's CSRF token, kept once for the whole client (#437). GET
// /api/session hands it out (session.ts stores it here), send() in client.ts
// puts it on every mutating request — no page passes it around any more.
// A guild switch or "Ansicht als" reloads the page, so the session is asked
// again and the token set again; the server keeps one token per session
// (src/web/auth.js), so nothing in between changes it.

let csrfToken: string | null = null;

/** Remembers the token of the session just loaded (null = not logged in). */
export function setCsrfToken(token: string | null): void {
    csrfToken = token;
}

export function getCsrfToken(): string | null {
    return csrfToken;
}

/**
 * The headers of a mutating request: the body's type and, when the session has
 * one, the X-CSRF-Token header src/web/apiHandler.js checks. Pure, so the rule
 * is testable without a fetch.
 */
export function mutatingHeaders(contentType: string, token: string | null): Record<string, string> {
    return token ? { "Content-Type": contentType, "X-CSRF-Token": token } : { "Content-Type": contentType };
}
