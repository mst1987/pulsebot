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
const { MENU } = require("../../src/config/menu");

// The routes App.tsx serves at the top level of the shell — every one of them
// needs its menu entry (sub-routes like "raids/new" hang off their parent's).
function topLevelRoutes() {
    const paths = [...appSrc.matchAll(/<Route path="([^"*]+)"/g)].map((m) => `/${m[1].split("/")[0]}`);
    return [...new Set(["/", ...paths])];
}

describe("one menu for both front ends", () => {
    it("has an entry for every top-level route and a route for every entry", () => {
        // sub entries (the raid plan's templates and catalog under Raid-Events) are routes below a top-level route
        const hrefs = MENU.filter((e) => !e.sub).map((e) => e.href).sort();
        expect(hrefs).toEqual(topLevelRoutes().sort());
    });

    it("gives every entry an id, a label, a group, its areas and a WoW icon", () => {
        for (const entry of MENU) {
            expect(entry).toEqual({
                ...(entry.sub ? { area: "raids", sub: true } : {}),
                id: expect.stringMatching(/^[a-zA-Z]+$/),
                label: expect.any(String),
                href: expect.stringMatching(/^\//),
                group: expect.stringMatching(/^(Start|Raids|Loot|Gilde|System)$/),
                areas: expect.arrayContaining([expect.any(String)]),
                wowIcon: expect.stringMatching(/^[a-z0-9_'-]+$/),
            });
        }
        expect(new Set(MENU.map((e) => e.id)).size).toBe(MENU.length);
    });

    it("groups the menu by what the entries are about, never more than three under one heading", () => {
        // one heading with eight entries under it ("Verwaltung") was the raid lead's complaint
        const groups = [];
        for (const entry of MENU.filter((e) => !e.sub)) {
            const last = groups[groups.length - 1];
            if (last && last.name === entry.group) last.ids.push(entry.id);
            else groups.push({ name: entry.group, ids: [entry.id] });
        }
        expect(groups).toEqual([
            { name: "Start", ids: ["home", "signups", "profile"] },
            { name: "Raids", ids: ["raids", "roster", "cla"] },
            { name: "Loot", ids: ["history", "lootcouncil"] },
            { name: "Gilde", ids: ["recruitment", "channels"] },
            { name: "System", ids: ["settings"] },
        ]);
        // a group is one contiguous block, so its heading is printed once
        expect(new Set(groups.map((g) => g.name)).size).toBe(groups.length);
        for (const g of groups) expect(g.ids.length).toBeLessThanOrEqual(3);
    });

    it("uses the icons of the approved design", () => {
        const icons = Object.fromEntries(MENU.filter((e) => !e.sub).map((e) => [e.id, e.wowIcon]));
        expect(Object.fromEntries(MENU.filter((e) => e.sub).map((e) => [e.id, e.wowIcon]))).toEqual({ planTemplates: "inv_misc_map02", planCatalog: "inv_misc_book_11" });
        expect(icons).toEqual({
            home: "inv_misc_map_01",
            profile: "achievement_character_human_male",
            signups: "inv_misc_book_09",
            recruitment: "inv_misc_grouplooking",
            cla: "inv_misc_pocketwatch_01",
            raids: "inv_misc_note_02",
            roster: "achievement_guildperk_everybodysfriend",
            history: "inv_misc_bag_10",
            lootcouncil: "inv_misc_coin_02",
            channels: "inv_letter_15",
            settings: "trade_engineering",
        });
    });

    it("is rendered by the React shell from the shared file, with WoW icons", () => {
        expect(read("lib", "menu.ts")).toContain("import MENU_JSON from \"../../../config/menu.json\";");
        expect(shellSrc).toContain("import { MENU, firstAllowedTab, type MenuEntry } from \"../lib/menu\";");
        expect(shellSrc).toContain("<WowIcon name={tab.wowIcon} size={24} />");
    });

    it("has an accent colour for every entry, in the dark and in both light blocks", () => {
        const css = read("index.css");
        for (const entry of MENU) {
            const id = entry.area || entry.id;
            const defs = css.match(new RegExp(`--area-${id}: #[0-9a-f]{6}; --area-${id}-soft: rgba\\(`, "g")) || [];
            expect({ id, defs: defs.length }).toEqual({ id, defs: 3 });
            expect(css).toContain(`.area-${id} { --area: var(--area-${id}); --area-soft: var(--area-${id}-soft); }`);
        }
    });
});

// The menu is served from the site root, not from /admin — see server.js and
// staticClient.js. A basename or an /admin link left behind in the client would
// either break routing outright or take a needless redirect hop.
describe("served from the root", () => {
    it("mounts the router without a basename", () => {
        const mainSrc = read("main.tsx");
        expect(mainSrc).toContain("<BrowserRouter>");
        expect(mainSrc).not.toMatch(/basename\s*=/);
    });

    it("has no /admin link left anywhere in the client", () => {
        for (const dir of ["pages", "components"]) {
            const dirPath = path.join(CLIENT, dir);
            for (const file of fs.readdirSync(dirPath)) {
                if (!file.endsWith(".tsx")) continue;
                expect(`${dir}/${file}: ${read(dir, file).includes("\"/admin") ? "links to /admin" : "ok"}`)
                    .toBe(`${dir}/${file}: ok`);
            }
        }
        expect(appSrc).not.toContain("\"/admin");
    });

    it("catches an unknown path in the client instead of leaving it blank", () => {
        // Every unknown GET reaches the SPA now (staticClient.js serves index.html),
        // so a path no route claims has to render something.
        expect(appSrc).toContain("<Route path=\"*\" element={<NotFound />} />");
        expect(appSrc).toMatch(/function NotFound\(\)/);
    });
});

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
        // An icon button with its tooltip — but still a plain link to the server.
        expect(shellSrc).toMatch(/<a className="ibtn sm u-logout" href="\/auth\/logout" aria-label=\{t\("shell.logout"\)\} data-tip=\{t\("shell.logout"\)\}/);
        const foot = shellSrc.slice(shellSrc.indexOf("className=\"side-foot\""));
        expect(foot).not.toMatch(/canAccess\w*\(/);
    });

    it("says something in the menu when no tab is allowed", () => {
        expect(shellSrc).toContain("if (!allowed.length)");
        expect(shellSrc).toContain("t(\"shell.noArea.label\")");
        expect(require("./i18nHelper").makeT("de")("shell.noArea.label")).toBe("Kein Bereich freigegeben");
    });

    it("checks tabs and routes against a list of areas", () => {
        // One area per tab could not express "the loot views open the history
        // tab too" — every tab and guard takes the union of its areas.
        expect(read("lib", "menu.ts")).toMatch(/export type MenuEntry = \{[\s\S]*?areas: string\[\];/);
        expect(shellSrc).toContain("type Tab = MenuEntry;");
        expect(read("lib", "menu.ts")).toContain("MENU.find((t) => canAccessAny(user, t.areas))");
        expect(shellSrc).toContain("canAccessAny(user, tab.areas)");
        expect(appSrc).toContain("canAccessAny(user, areas, level)");
        expect(appSrc).not.toMatch(/<Guard user=\{user\} area="/);
    });

    it("gives the history tab both of its areas, everywhere it is routed", () => {
        const historyRoutes = [...appSrc.matchAll(/<Route path="(history[^"]*)" element=\{<Guard user=\{user\} areas=\{(\[[^\]]*\])\}/g)]
            .map((m) => ({ path: m[1], areas: m[2] }));
        // /history, /history/inbox, /history/event, /history/char
        expect(historyRoutes).toHaveLength(4);
        for (const { path: route, areas } of historyRoutes) {
            // The addon inbox is not a loot *view*: the read-only "loot" area
            // cannot accept or dismiss sessions, and the API refuses it the list.
            expect({ route, areas }).toEqual({ route, areas: route === "history/inbox" ? "[\"history\"]" : "[\"history\", \"loot\"]" });
        }
        expect(MENU.find((e) => e.id === "history").areas).toEqual(["history", "loot"]);
    });

    it("hides the history page's write actions without write access", () => {
        // The API refuses them anyway; a button that only ever earns a 403 is
        // worse than no button.
        expect(historySrc).toContain("canEdit={canAccess(user, \"history\", \"write\")}");
        for (const file of ["HistoryEventPage.tsx", "HistoryCharPage.tsx"]) {
            expect(read("pages", file)).toContain("const canEdit = canAccess(user, \"history\", \"write\");");
        }
    });
});
