const fs = require("fs");
const path = require("path");
const { checkAccess, AREA_BY_PATH, UNGATED, ANY_AREA, TOKEN_AUTH } = require("../../src/web/apiAccess");
const { emptyAccess, AREA_IDS } = require("../../src/config/permissions");

const admin = { id: "1", name: "Admin", isAdmin: true };
const limited = (grants) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...grants } });

describe("web/apiAccess", () => {
    describe("checkAccess", () => {
        it("lets anyone reach /api/session so the client can bootstrap", () => {
            expect(checkAccess("/api/session", "GET", null)).toBeNull();
        });

        it("answers 401 for an anonymous caller on every other endpoint", () => {
            expect(checkAccess("/api/raids", "GET", null)).toMatchObject({ status: 401, code: "unauthorized" });
        });

        it("answers 403 for a logged-in user without any area", () => {
            expect(checkAccess("/api/raids", "GET", limited({}))).toMatchObject({ status: 403, code: "forbidden" });
        });

        it("lets a full admin through everywhere", () => {
            for (const pathname of Object.keys(AREA_BY_PATH)) {
                expect(checkAccess(pathname, "GET", admin)).toBeNull();
                expect(checkAccess(pathname, "POST", admin)).toBeNull();
            }
        });

        it("allows GET but refuses POST for a read-only area", () => {
            const user = limited({ raids: { read: true, write: false } });
            expect(checkAccess("/api/raids", "GET", user)).toBeNull();
            const denied = checkAccess("/api/raids/notify", "POST", user);
            expect(denied).toMatchObject({ status: 403, code: "forbidden" });
            expect(denied.message).toContain("Schreibrechte");
        });

        it("allows both for a write area", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/raids", "GET", user)).toBeNull();
            expect(checkAccess("/api/raids/notify", "POST", user)).toBeNull();
        });

        it("keeps areas apart — access to one grants nothing in another", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/cla", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/history", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/settings", "GET", user)).toMatchObject({ status: 403 });
        });

        // "Loot-Ansichten" is the read-only slice of the history tab that every
        // member can be given (config/permissions.js).
        describe("the loot area", () => {
            const looter = limited({ loot: { read: true, write: false } });

            it("opens the loot endpoints for reading", () => {
                for (const p of ["/api/history", "/api/history/loot-stats", "/api/history/loot-awards", "/api/history/event", "/api/history/char"]) {
                    expect(checkAccess(p, "GET", looter)).toBeNull();
                }
            });

            it("refuses to write anywhere in the history", () => {
                expect(checkAccess("/api/history/import", "POST", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/history/loot-delete", "POST", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/history/loot-category", "POST", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/history/clear", "POST", looter)).toMatchObject({ status: 403 });
            });

            it("does not open the rest of the history tab", () => {
                expect(checkAccess("/api/history/inbox", "GET", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/history/log-delete", "POST", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/cla", "GET", looter)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/roster", "GET", looter)).toMatchObject({ status: 403 });
            });

            // The wider area must keep opening everything it did before.
            it("leaves a history reader unaffected", () => {
                const reader = limited({ history: { read: true, write: false } });
                expect(checkAccess("/api/history", "GET", reader)).toBeNull();
                expect(checkAccess("/api/history/inbox", "GET", reader)).toBeNull();
                expect(checkAccess("/api/history/event", "GET", reader)).toBeNull();
                expect(checkAccess("/api/history/import", "POST", reader)).toMatchObject({ status: 403 });
            });
        });

        // "Mein Profil" (#255): the member's own profile hangs on "signup", which
        // is meant for the base access; another raider's profile is the orga's.
        describe("the signup area", () => {
            const member = limited({ signup: { read: true, write: true } });

            it("opens the own-profile endpoints", () => {
                expect(checkAccess("/api/profile", "GET", member)).toBeNull();
                expect(checkAccess("/api/profile", "PUT", member)).toBeNull();
                expect(checkAccess("/api/profile/log-characters", "GET", member)).toBeNull();
                expect(checkAccess("/api/profile/characters", "POST", member)).toBeNull();
                expect(checkAccess("/api/profile/raiders", "GET", member)).toBeNull();
                // Kalender-Abo (#312) — minting and revoking one's own link
                expect(checkAccess("/api/profile/calendar", "GET", member)).toBeNull();
                expect(checkAccess("/api/profile/calendar", "POST", member)).toBeNull();
            });

            it("keeps the calendar link behind the signup area — and the feed is no api path", () => {
                const nobody = limited({});
                expect(checkAccess("/api/profile/calendar", "GET", nobody)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/profile/calendar", "POST", nobody)).toMatchObject({ status: 403 });
                // The subscription itself authenticates with its token, not a
                // session, so it is no /api path and never reaches this table —
                // and it is not in TOKEN_AUTH either, which is only the loot
                // uploader's bypass of the session gate.
                expect(Object.keys(AREA_BY_PATH).some((p) => p.includes("/r/cal"))).toBe(false);
                expect([...TOKEN_AUTH].some((p) => p.includes("cal"))).toBe(false);
            });

            it("does not open other profiles or the claims list", () => {
                expect(checkAccess("/api/profile/user", "GET", member)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/roster/character-claims", "GET", member)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/roster", "GET", member)).toMatchObject({ status: 403 });
            });

            it("needs write to save, so a read-only grant only looks", () => {
                const reader = limited({ signup: { read: true, write: false } });
                expect(checkAccess("/api/profile", "PUT", reader)).toMatchObject({ status: 403 });
            });

            it("gives the orga other profiles and the claims through the roster", () => {
                const orga = limited({ roster: { read: true, write: false } });
                expect(checkAccess("/api/profile/user", "GET", orga)).toBeNull();
                expect(checkAccess("/api/roster/character-claims", "GET", orga)).toBeNull();
            });
        });

        // Issue #259: editing, archiving and deleting channels need "channels" at write.
        it("gates every channel change behind channels write", () => {
            const reader = limited({ channels: { read: true, write: false } });
            const writer = limited({ channels: { read: true, write: true } });
            expect(checkAccess("/api/channels", "GET", reader)).toBeNull();
            expect(checkAccess("/api/channels", "PATCH", reader)).toMatchObject({ status: 403 });
            for (const p of ["/api/channels/archive", "/api/channels/delete", "/api/channels/rename-preview", "/api/channels/batch", "/api/channels/config"]) {
                expect(checkAccess(p, "POST", reader)).toMatchObject({ status: 403 });
                expect(checkAccess(p, "POST", writer)).toBeNull();
                expect(checkAccess(p, "POST", limited({ settings: { read: true, write: true } }))).toMatchObject({ status: 403 });
            }
            expect(checkAccess("/api/channels", "PATCH", writer)).toBeNull();
        });

        it("opens the game version rule sets to raid readers only", () => {
            expect(checkAccess("/api/game-versions", "GET", limited({ raids: { read: true, write: false } }))).toBeNull();
            expect(checkAccess("/api/game-versions", "GET", limited({ loot: { read: true, write: false } }))).toMatchObject({ status: 403 });
            expect(checkAccess("/api/game-versions", "GET", null)).toMatchObject({ status: 401 });
        });

        // #314: the commit itself is public on /health, but the comparison with
        // main is an operational detail — and a member's page load should not
        // trigger a GitHub call.
        it("keeps the deploy version with the settings readers", () => {
            expect(checkAccess("/api/version", "GET", limited({ settings: { read: true, write: false } }))).toBeNull();
            expect(checkAccess("/api/version", "GET", limited({ raids: { read: true, write: true } }))).toMatchObject({ status: 403 });
            expect(checkAccess("/api/version", "GET", null)).toMatchObject({ status: 401 });
        });

        it("lets any menu user switch the active guild", () => {
            expect(checkAccess("/api/session/guild", "POST", limited({ raids: { read: true, write: false } }))).toBeNull();
            expect(checkAccess("/api/session/guild", "POST", limited({}))).toMatchObject({ status: 403 });
            // the own menu language: any menu user, whatever area
            expect(checkAccess("/api/session/lang", "POST", limited({ signup: { read: true, write: false } }))).toBeNull();
            expect(checkAccess("/api/session/lang", "POST", null)).toMatchObject({ status: 401 });
        });

        // The loot-sync uploader has no Discord session at all, so the session
        // gate has to let it past — apiRoutes/ingest.js checks the bearer token
        // itself before doing anything.
        it("lets the token-authenticated ingest endpoints past the session gate", () => {
            expect(checkAccess("/api/ingest/loot", "POST", null)).toBeNull();
            expect(checkAccess("/api/ingest/raids", "POST", null)).toBeNull();
        });

        // That exemption must stay this deliberate, tiny set, not a hole a
        // future route slips into by accident.
        it("exempts nothing but the loot-sync ingest endpoints from the session gate", () => {
            expect([...TOKEN_AUTH]).toEqual(["/api/ingest/loot", "/api/ingest/raids"]);
        });

        // Anmeldungen (#256): a member with "signup" reads and writes their own
        // signup; the whole roster of an event with comments is the orga's.
        describe("the signups", () => {
            const member = limited({ signup: { read: true, write: true } });

            it("opens the own list and the own signup to the signup area", () => {
                expect(checkAccess("/api/signups", "GET", member)).toBeNull();
                expect(checkAccess("/api/signups", "PUT", member)).toBeNull();
            });

            it("keeps every signup of an event with the raids area", () => {
                expect(checkAccess("/api/signups/event", "GET", member)).toMatchObject({ status: 403 });
                expect(checkAccess("/api/signups/event", "GET", limited({ raids: { read: true, write: false } }))).toBeNull();
            });

            it("refuses signing up with read access only", () => {
                expect(checkAccess("/api/signups", "PUT", limited({ signup: { read: true, write: false } }))).toMatchObject({ status: 403 });
            });
        });

        // Fail-closed: a route added without a table entry must not become
        // reachable for a limited role just because it holds some other area.
        it("falls back to admin-only for endpoints missing from the table", () => {
            const user = limited({ raids: { read: true, write: true } });
            expect(checkAccess("/api/brand-new-thing", "GET", user)).toMatchObject({ status: 403 });
            expect(checkAccess("/api/brand-new-thing", "GET", admin)).toBeNull();
        });
    });

    describe("AREA_BY_PATH", () => {
        it("only maps to known areas", () => {
            // A value is one area or a list of them — any of which opens the path.
            for (const entry of Object.values(AREA_BY_PATH)) {
                for (const area of Array.isArray(entry) ? entry : [entry]) expect(AREA_IDS).toContain(area);
            }
        });

        it("maps nothing that the router doesn't serve", () => {
            for (const pathname of Object.keys(AREA_BY_PATH)) expect(routerPaths()).toContain(pathname);
        });

        // The gate is fail-closed, so forgetting an entry silently locks the
        // endpoint to full admins instead of erroring — this catches that.
        it("covers every endpoint the router serves", () => {
            const covered = new Set([...Object.keys(AREA_BY_PATH), ...UNGATED, ...ANY_AREA, ...TOKEN_AUTH]);
            const uncovered = routerPaths().filter((p) => !covered.has(p));
            expect(uncovered).toEqual([]);
        });
    });
});

/** Every `pathname === "/api/…"` the route table in apiRouter.js dispatches on. */
function routerPaths() {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "apiRouter.js"), "utf8");
    return [...new Set([...source.matchAll(/pathname === "(\/api\/[^"]*)"/g)].map((m) => m[1]))];
}
