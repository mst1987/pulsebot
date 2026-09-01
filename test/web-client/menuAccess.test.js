// Guards for "the menu is always there" (src/web-client/src/App.tsx and
// components/Shell.tsx).
//
// A member whose account opens no area at all used to get a bare sentence on an
// empty page — no navigation, and no way to log out again. The shell is now
// rendered for everyone who is logged in; what they may open is decided per tab
// and per route. There is no React test renderer here, so what is checked are
// the invariants that would fail silently:
//   * App only skips the shell when nobody is logged in,
//   * the sidebar renders the logout regardless of what is granted,
//   * an empty menu says so instead of showing an empty column,
//   * tabs and route guards ask for a *list* of areas, so the loot views can
//     share the history tab (src/config/permissions.js).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const appSrc = read("App.tsx");
const shellSrc = read("components", "Shell.tsx");
const historySrc = read("pages", "HistoryPage.tsx");

describe("menu access", () => {
    it("keeps the shell for a logged-in account with nothing granted", () => {
        // The only early return before the router is the anonymous one.
        const earlyReturns = [...appSrc.matchAll(/if \((![\w.!]+|[^)]*hasMenuAccess[^)]*)\) \{\s*\n\s*return \(/g)]
            .map((m) => m[1].trim());
        expect(earlyReturns).toEqual(["!user"]);
        expect(appSrc).not.toContain("hasMenuAccess");
    });

    it("sends an account with no area to a notice rather than the dashboard", () => {
        // Rendering DashboardPage would fire /api/dashboard and show its 403.
        expect(appSrc).toContain("<NoAreaNotice />");
        expect(appSrc).toMatch(/function NoAreaNotice\(\)/);
    });

    it("puts the logout in the sidebar unconditionally", () => {
        // It sits in the shell's footer, outside anything permission-dependent:
        // being locked out of every area is exactly when logging out matters.
        expect(shellSrc).toContain('<a className="u-logout" href="/auth/logout">Logout</a>');
        const foot = shellSrc.slice(shellSrc.indexOf('className="side-foot"'));
        expect(foot).not.toMatch(/canAccess\w*\(/);
    });

    it("says something in the menu when no tab is allowed", () => {
        expect(shellSrc).toContain("if (!allowed.length)");
        expect(shellSrc).toContain("Kein Bereich freigegeben");
    });

    it("checks tabs and routes against a list of areas", () => {
        // One area per tab could not express "the loot views open the history
        // tab too" — every tab and guard takes the union of its areas.
        expect(shellSrc).toMatch(/type Tab = \{ id: string; areas: string\[\];/);
        expect(shellSrc).toContain("canAccessAny(user, t.areas)");
        expect(shellSrc).toContain("canAccessAny(user, tab.areas)");
        expect(appSrc).toContain("canAccessAny(user, areas, level)");
        expect(appSrc).not.toMatch(/<Guard user=\{user\} area="/);
    });

    it("gives the history tab both of its areas, everywhere it is routed", () => {
        const historyRoutes = [...appSrc.matchAll(/<Route path="history[^"]*" element=\{<Guard user=\{user\} areas=\{(\[[^\]]*\])\}/g)]
            .map((m) => m[1]);
        expect(historyRoutes).toHaveLength(3); // /history, /history/event, /history/char
        for (const areas of historyRoutes) expect(areas).toBe('["history", "loot"]');
        expect(shellSrc).toContain('areas: ["history", "loot"]');
    });

    it("hides the history page's write actions without write access", () => {
        // The API refuses them anyway; a button that only ever earns a 403 is
        // worse than no button.
        expect(historySrc).toContain('canEdit={canAccess(user, "history", "write")}');
        for (const file of ["HistoryEventPage.tsx", "HistoryCharPage.tsx"]) {
            expect(read("pages", file)).toContain('const canEdit = canAccess(user, "history", "write");');
        }
    });
});
