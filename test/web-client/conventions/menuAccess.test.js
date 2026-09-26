// The shared menu (src/config/menu.json) and where the client is served from
// (#435: the structural half of the former test/web-client/menuAccess.test.js).
// What the sidebar draws and which account may open what is tested by
// rendering: src/web-client/src/App.test.tsx, components/Shell.test.tsx and
// pages/HistoryPage.access.test.tsx.
const fs = require("fs");
const path = require("path");
const { CLIENT, read } = require("../clientSource");
const { MENU } = require("../../../src/config/menu");

const appSrc = read("App.tsx");

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
            for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
                if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
                expect(`${dir}/${file}: ${read(`${dir}/${file}`).includes("\"/admin") ? "links to /admin" : "ok"}`)
                    .toBe(`${dir}/${file}: ok`);
            }
        }
        expect(appSrc).not.toContain("\"/admin");
    });
});
