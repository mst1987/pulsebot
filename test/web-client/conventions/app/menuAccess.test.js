// The shared menu (src/config/menu.json) and where the client is served from
// (#435: the structural half of the former test/web-client/menuAccess.test.js).
// What the sidebar draws and which account may open what is tested by
// rendering: src/web-client/src/__tests__/App.test.tsx, components/shell/__tests__/Shell.test.tsx and
// pages/history/__tests__/HistoryPage.access.test.tsx.
const fs = require("fs");
const path = require("path");
const { CLIENT, read } = require("../../clientSource");
const { MENU } = require("../../../../src/config/menu");
const { isUiIcon } = require("../../../../src/config/uiIconSvg");

const appSrc = read("App.tsx");

// The routes App.tsx serves at the top level of the shell — every one of them
// needs its menu entry (sub-routes like "raids/new" hang off their parent's).
function topLevelRoutes() {
    const paths = [...appSrc.matchAll(/<Route path="([^"*]+)"/g)].map((m) => `/${m[1].split("/")[0]}`);
    return [...new Set(["/", ...paths])];
}

/** The top-level entry a sub entry lies under. */
function parentOf(entry) {
    return MENU.find((o) => !o.sub && o.href !== "/" && entry.href.startsWith(`${o.href}/`)) || {};
}

describe("one menu for both front ends", () => {
    it("has an entry for every top-level route and a route for every entry", () => {
        // sub entries (the raid plan's templates and catalog under Raid-Events) are routes below a top-level route
        // Alle Server › Einstellungen (#957) is the route settings/all, beside System › Einstellungen
        const hrefs = [...new Set(MENU.filter((e) => !e.sub).map((e) => `/${e.href.split("/")[1]}`))].sort();
        expect(hrefs).toEqual(topLevelRoutes().sort());
        expect(appSrc).toContain("<Route path=\"settings/all\"");
    });

    it("gives every entry an id, a label, a group, its areas and an icon of the set", () => {
        for (const entry of MENU) {
            expect(entry).toEqual({
                // a sub entry keeps its parent's colour (the raid plan pages under Raid-Events,
                // Dungeon-Bestzeiten under Roster)
                ...(entry.sub ? { area: parentOf(entry).id, sub: true } : {}),
                // the download page (Addons, #818, where the sync tool page was) wears the System colour
                ...(entry.id === "addon" ? { area: "system" } : {}),
                // Alle Server › Einstellungen (#957) wears the colour of System › Einstellungen
                ...(entry.id === "settingsAll" ? { area: "settings" } : {}),
                // an adminOnly entry (Systemstatus) belongs to no area: full admins only
                ...(entry.adminOnly ? { adminOnly: true } : {}),
                // a version-neutral page keeps the brand colour whichever version is shown (#742)
                ...(entry.neutral ? { neutral: true } : {}),
                // the menu line may lead to a landing page of its family (Discord → its overview)
                ...(entry.landing ? { landing: expect.stringMatching(/^\//) } : {}),
                // a page without a server stands under "Alle Server" (#918)
                ...(entry.scope ? { scope: "all" } : {}),
                id: expect.stringMatching(/^[a-zA-Z]+$/),
                label: expect.any(String),
                href: expect.stringMatching(/^\//),
                group: expect.stringMatching(/^(Start|Raids|Loot|Gilde|System)$/),
                areas: entry.adminOnly ? [] : expect.arrayContaining([expect.any(String)]),
                // a key of the app's own icon set (#951), never a zamimg name
                icon: expect.any(String),
            });
            expect({ id: entry.id, icon: entry.icon, known: isUiIcon(entry.icon) }).toEqual({ id: entry.id, icon: entry.icon, known: true });
        }
        expect(new Set(MENU.map((e) => e.id)).size).toBe(MENU.length);
    });

    it("groups the menu by what the entries are about, never more than three under one heading (Start four)", () => {
        // one heading with eight entries under it ("Verwaltung") was the raid lead's complaint
        // the entries of the block "Alle Server" stand under that heading, not under their group's
        const groups = [];
        for (const entry of MENU.filter((e) => !e.sub && e.scope !== "all")) {
            const last = groups[groups.length - 1];
            if (last && last.name === entry.group) last.ids.push(entry.id);
            else groups.push({ name: entry.group, ids: [entry.id] });
        }
        expect(groups).toEqual([
            // Abwesenheiten sits in Start on purpose (Oct 2026): raiders follow their own attendance there
            { name: "Start", ids: ["home", "signups", "absences"] },
            // Oct 2026: loot pages moved under Raids (no own Loot group), Roster + Gildenbank under Gilde, Kanäle under System
            { name: "Raids", ids: ["raids", "cla", "history", "lootcouncil"] },
            // Vermerke (#980) beside Roster and Kaderplaner, as the user wanted (Oct 2026). Gilde may hold
            // five: Kaderplaner and Vermerke are orga-only, a raider sees three at most there.
            { name: "Gilde", ids: ["roster", "kader", "vermerke", "recruitment", "bank"] },
            { name: "System", ids: ["channels", "settings"] },
        ]);
        // a group is one contiguous block, so its heading is printed once
        expect(new Set(groups.map((g) => g.name)).size).toBe(groups.length);
        for (const g of groups) expect(g.ids.length).toBeLessThanOrEqual(g.name === "Gilde" ? 5 : 4);
    });

    it("marks exactly the pages without a server as \"Alle Server\" (#918)", () => {
        // the own profile, the addon downloads and the bot's system status belong to no Discord server
        // Einstellungen (#957): what the whole bot shares - full admins only, like Systemstatus
        expect(MENU.filter((e) => e.scope === "all").map((e) => e.id)).toEqual(["profile", "addon", "settingsAll", "system"]);
        expect(MENU.filter((e) => e.scope === "all" && e.adminOnly).map((e) => e.id)).toEqual(["settingsAll", "system"]);
    });

    it("uses the icons of the approved set (#951)", () => {
        const icons = Object.fromEntries(MENU.filter((e) => !e.sub).map((e) => [e.id, e.icon]));
        // Discord's own pages wear plain line icons, as in Discord's own interface
        expect(Object.fromEntries(MENU.filter((e) => e.sub).map((e) => [e.id, e.icon]))).toEqual({
            planTemplates: "raidplan", planCatalog: "catalog", dungeons: "bestTimes",
            roleMessages: "message",
            members: "members",
            serverRoles: "roles",
            discordOverview: "overview",
        });
        expect(icons).toEqual({
            home: "home",
            profile: "profile",
            signups: "signups",
            absences: "absences",
            recruitment: "recruitment",
            cla: "logs",
            raids: "raids",
            roster: "roster",
            history: "loot",
            lootcouncil: "lootcouncil",
            bank: "guildbank",
            kader: "kader",
            vermerke: "vermerke",
            // the Discord line itself: Discord's mark in its Blurple
            channels: "discord",
            addon: "addons",
            settings: "settings",
            settingsAll: "settings",
            system: "system",
        });
    });

    it("names every entry's section colour once, as the one accent (no hue per section)", () => {
        const css = read("index.css");
        for (const entry of MENU) {
            const id = entry.area || entry.id;
            const defs = css.match(new RegExp(`--area-${id}: var\\(--accent\\); --area-${id}-soft: var\\(--accent-soft\\);`, "g")) || [];
            expect({ id, defs: defs.length }).toEqual({ id, defs: 1 });
            expect({ id, hex: new RegExp(`--area-${id}: #`).test(css) }).toEqual({ id, hex: false });
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
            for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
                if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
                expect(`${dir}/${file}: ${read(`${dir}/${file}`).includes("\"/admin") ? "links to /admin" : "ok"}`)
                    .toBe(`${dir}/${file}: ok`);
            }
        }
        expect(appSrc).not.toContain("\"/admin");
    });
});
