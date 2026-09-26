// The CSRF token lives in the client (api/csrf.ts, #437): GET /api/session
// stores it once, send() puts it on every mutating request. The source scans
// (no page or api function hands the token around) stay in
// test/web-client/csrf.test.js.
import { describe, expect, it } from "vitest";
import * as csrf from "./csrf";

describe("api/csrf.ts", () => {
    it("remembers the token of the session and forgets it on logout", () => {
        expect(csrf.getCsrfToken()).toBeNull();
        csrf.setCsrfToken("abc123");
        expect(csrf.getCsrfToken()).toBe("abc123");
        csrf.setCsrfToken(null);
        expect(csrf.getCsrfToken()).toBeNull();
    });

    it("sets the X-CSRF-Token header on a mutating request exactly when there is a token", () => {
        expect(csrf.mutatingHeaders("application/json", "tok")).toEqual({ "Content-Type": "application/json", "X-CSRF-Token": "tok" });
        expect(csrf.mutatingHeaders("image/png", "tok")).toEqual({ "Content-Type": "image/png", "X-CSRF-Token": "tok" });
        expect(csrf.mutatingHeaders("application/json", null)).toEqual({ "Content-Type": "application/json" });
        expect(csrf.mutatingHeaders("application/json", "")).toEqual({ "Content-Type": "application/json" });
    });
});
