// The start page "Übersicht" (design issue #220). The client has no React test
// renderer, so these are source scans for what the design settled:
//   * one question per page — the old configuration counters, the quick links,
//     the orbs and the three tables are gone;
//   * the open tasks render only the tasks the server sent, and an empty list
//     is the green "Alles erledigt" state;
//   * the shared building blocks are used, WoW icons instead of line icons, and
//     the tooltip box instead of a native title;
//   * the Latest-Loot list writes boss and date as one line and explains the
//     winner in the tooltip.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

describe("Übersicht (DashboardPage)", () => {
    const page = read("pages", "DashboardPage.tsx");

    it("drops the counters, quick links, orbs and tables of the old page", () => {
        for (const gone of ["QUICK_LINKS", "UpcomingTable", "RecentReportsTable", "function Tile", "OrbsBackground", "RaidTable", "stats.", "className=\"pill"]) {
            expect({ gone, present: page.includes(gone) }).toEqual({ gone, present: false });
        }
        expect(fs.existsSync(path.join(CLIENT, "components", "OrbsBackground.tsx"))).toBe(false);
        expect(read("index.css")).not.toMatch(/\.fx-orbs|\.dash-hero|\n\.quick |\.dash-top/);
    });

    it("is built from next raid, tasks, area tiles, loot and last raids", () => {
        const order = ["<NextRaidCard", "<TaskList", "<AreaTiles", "<LootCard", "<RecentRaidList"].map((s) => page.indexOf(s));
        expect(order.every((i) => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(page).toContain("<RaidDetailsModal");
    });

    it("renders only the tasks it got, and 'Alles erledigt' when there are none", () => {
        const list = page.slice(page.indexOf("export function TaskList"), page.indexOf("function AreaTile("));
        expect(list).toContain("tasks.length === 0");
        expect(list).toContain("Alles erledigt");
        expect(list).toMatch(/tasks\.map\(\(t\) =>/);
        // no hard-coded task rows
        expect(list).not.toMatch(/Sheet füllen|Logs zuordnen|Addon-Inbox|Empfehlungen prüfen/);
        // the count badge only when there is a count
        expect(list).toContain("t.count > 0 &&");
        // every row explains itself in the tooltip box
        expect(list).toContain("tip={t.tip} tipSub={t.tipSub}");
    });

    it("uses the shared blocks and WoW icons, never a native title", () => {
        for (const block of ["PageHead", "PartHead", "Badge", "IconTile", "WowIcon", "Button"]) {
            expect(page).toContain(`<${block}`);
        }
        for (const src of [page, read("components", "RaidDetailsModal.tsx"), read("components", "OverviewParts.tsx"), read("components", "TopLootList.tsx")]) {
            // on an HTML element — `title` on PartHead/Modal is the heading prop
            expect(src).not.toMatch(/<[a-z]+\b[^>]*\stitle=["{]/);
        }
        expect(page).not.toMatch(/ClaIcon|ClockIcon|BoltIcon|RecruitmentIcon/);
        expect(page).toContain('"Raid-Event anlegen"'.slice(1, -1));
        expect(page).toContain('icon="inv_misc_note_02"');
    });

    it("keeps its styles in its own file", () => {
        expect(page).toContain('import "../styles/uebersicht.css";');
        const css = read("styles", "uebersicht.css");
        expect(css).toMatch(/\.ov-grid-top \{/);
        expect(css).not.toMatch(/gold|#ffd700|goldenrod/i);
    });
});

describe("Raid-Details modal", () => {
    const modal = read("components", "RaidDetailsModal.tsx");

    it("is the shared Modal and loads its data when it opens", () => {
        expect(modal).toContain("<Modal");
        expect(modal).toContain("getNextRaidDetails(eventId)");
        expect(modal).toMatch(/if \(!eventId\) return;/);
        expect(read("api.ts")).toContain("/api/dashboard/next-raid?event=");
    });

    it("shows signups, preparation and who has not signed up, with a way to the raid", () => {
        for (const text of ["Anmeldungen", "Vorbereitung", "Noch nicht angemeldet", "Stand Raid-Helper", "Schließen", "Sheet füllen"]) {
            expect(modal).toContain(text);
        }
    });
});

describe("Latest-Loot list", () => {
    const list = read("components", "TopLootList.tsx");

    it("writes boss and date as one grey line instead of two chips", () => {
        expect(list).not.toContain("toploot-badge");
        expect(list).toContain('[it.boss, awardDate(it.awardedAt)].filter(Boolean).join(" · ")');
    });

    it("explains the winner with spec, class and the raw addon answer in the tooltip", () => {
        expect(list).toContain("data-tip={tip.head} data-tip-sub={tip.sub}");
        expect(list).toContain("Rückmeldung im Addon");
    });
});
