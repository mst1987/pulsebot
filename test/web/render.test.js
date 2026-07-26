const {
    renderReportPage,
    renderPlayerPage,
    renderNotFound,
    renderError,
} = require("../../src/web/render.js");

function sampleReport() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Karazhan",
        date: "2026-07-24",
        reportUrl: "https://www.warcraftlogs.com/reports/xyz",
        players: [
            {
                name: "Alice",
                type: "Mage",
                issues: [
                    {
                        itemName: "Broken Ring",
                        itemId: 1234,
                        icon: "inv_ring.jpg",
                        severity: "high",
                        label: "kaputt",
                    },
                ],
            },
            { name: "Bob", type: "Warrior", issues: [] },
        ],
        roster: [
            {
                name: "Alice",
                type: "Mage",
                issues: [
                    {
                        itemName: "Broken Ring",
                        itemId: 1234,
                        icon: "inv_ring.jpg",
                        severity: "high",
                        label: "kaputt",
                    },
                ],
                potions: { destruction: 1, haste: 2, mana: 0 },
                armory: [
                    {
                        slot: 0,
                        itemId: 9001,
                        itemName: "Fancy Helm",
                        icon: "inv_helm.jpg",
                        quality: 4,
                        itemLevel: 120,
                        enchant: { status: "ok" },
                        gems: [{ id: 7, icon: "gem.jpg", bad: false }],
                        emptySockets: 1,
                    },
                    {
                        slot: 5,
                        itemId: 9002,
                        itemName: "Plain Chest",
                        icon: "inv_chest.jpg",
                        quality: 2,
                        itemLevel: 100,
                        enchant: { status: "missing" },
                        gems: [],
                        emptySockets: 0,
                    },
                    {
                        slot: 9,
                        itemId: 9003,
                        itemName: "Bad Boots",
                        icon: "inv_boots.jpg",
                        quality: 3,
                        itemLevel: 110,
                        enchant: { status: "bad", reason: "falsche Verzauberung" },
                        gems: [{ id: 8, icon: "gem2.jpg", bad: true }],
                        emptySockets: 0,
                    },
                ],
            },
            { name: "Bob", type: "Warrior", issues: [], potions: {}, armory: [] },
        ],
        icons: {
            destruction: "spell_destruction",
            haste: "spell_haste",
            mana: "spell_mana",
            flask: "flask_icon",
            battle: "battle_icon",
            food: "food_icon",
        },
        consumables: {
            players: [
                {
                    name: "Alice",
                    type: "Mage",
                    flask: 100,
                    elixir: 0,
                    buffed: 50,
                    food: 100,
                    weaponOiled: true,
                },
            ],
            icons: { flask: "flask_icon", battle: "battle_icon", food: "food_icon" },
        },
        potions: {
            players: [
                {
                    name: "Alice",
                    type: "Mage",
                    destruction: 1,
                    haste: 2,
                    mana: 0,
                    total: 3,
                },
            ],
            icons: {
                destruction: "spell_destruction",
                haste: "spell_haste",
                mana: "spell_mana",
            },
        },
        drums: {
            players: [
                {
                    name: "Bob",
                    type: "Warrior",
                    total: 5,
                    byType: { Battle: 3, Restoration: 2 },
                },
            ],
            icon: "drum_icon",
        },
        sunder: [{ name: "Bob", type: "Warrior", total: 20, below5: 2 }],
        bossUptimes: {
            metrics: [{ key: "sunder", label: "Sunder" }],
            rows: [
                { boss: "Attumen", kill: true, sunder: 98 },
                { boss: "Nightbane", kill: false, sunder: 40 },
            ],
        },
        shadowResi: {
            note: "SR note text",
            players: [
                {
                    name: "Alice",
                    type: "Mage",
                    sr: 60,
                    items: [{ itemId: 55, itemName: "Shadow Cloak", sr: 20 }],
                },
            ],
        },
    };
}

describe("web/render", () => {
    describe("renderReportPage", () => {
        it("produces a full HTML document with the report title", () => {
            const html = renderReportPage(sampleReport());
            expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
            expect(html).toContain("<title>Log-Check: Test Raid</title>");
            expect(html).toContain("<h1>Test Raid</h1>");
        });

        it("renders the sub line with zone, date and the WCL link", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("Zone: Karazhan");
            expect(html).toContain("2026-07-24");
            expect(html).toContain("https://www.warcraftlogs.com/reports/xyz");
            expect(html).toContain("→ Warcraft Logs");
        });

        it("shows a tab for every populated section", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("data-tab=\"roster\"");
            expect(html).toContain("data-tab=\"gear\"");
            expect(html).toContain("data-tab=\"consumables\"");
            expect(html).toContain("data-tab=\"potions\"");
            expect(html).toContain("data-tab=\"drums\"");
            expect(html).toContain("data-tab=\"sunder\"");
            expect(html).toContain("data-tab=\"bosses\"");
            expect(html).toContain("data-tab=\"shadowresi\"");
        });

        it("marks the first tab active", () => {
            const html = renderReportPage(sampleReport());
            // roster is the first defined tab and should carry the active class
            expect(html).toContain("data-tab=\"roster\" class=\"active\"");
        });

        it("includes player names and issue details", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("Alice");
            expect(html).toContain("Bob");
            expect(html).toContain("Broken Ring");
            expect(html).toContain("kaputt");
            expect(html).toContain("tag tag-high");
        });

        it("links issues with an itemId to wowhead", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("https://www.wowhead.com/tbc/item=1234");
        });

        it("renders the Wipe marker for non-kill boss rows", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("(Wipe)");
        });

        it("escapes HTML in the title", () => {
            const r = sampleReport();
            r.title = "<b>pwn</b>";
            const html = renderReportPage(r);
            expect(html).toContain("&lt;b&gt;pwn&lt;/b&gt;");
            expect(html).not.toContain("<b>pwn</b>");
        });

        it("falls back to a generic title and hides empty sections", () => {
            const html = renderReportPage({ id: "x1", players: [] });
            expect(html).toContain("<title>Log-Check</title>");
            expect(html).toContain("<h1>Log-Check</h1>");
            // gear tab is always shown; empty-gear message appears
            expect(html).toContain("Keine Gear-Probleme gefunden");
            // optional sections absent
            expect(html).not.toContain("data-tab=\"potions\"");
            expect(html).not.toContain("data-tab=\"sunder\"");
        });

        it("shows the admin-menu link for a logged-in admin", () => {
            const html = renderReportPage(sampleReport(), { name: "Admin", isAdmin: true });
            expect(html).toContain("Eingeloggt als");
            expect(html).toContain("<strong>Admin</strong>");
            expect(html).toContain("href=\"/admin\"");
            expect(html).toContain("Admin-Menü");
        });

        it("shows a Discord login button for an anonymous visitor, no admin-menu link", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("Mit Discord einloggen");
            expect(html).not.toContain("Admin-Menü");
        });

        it("shows no admin-menu link for a logged-in non-admin", () => {
            const html = renderReportPage(sampleReport(), { name: "Bob", isAdmin: false });
            expect(html).toContain("Eingeloggt als");
            expect(html).not.toContain("Admin-Menü");
        });
    });

    describe("renderPlayerPage", () => {
        it("renders the detail page for a valid index", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            expect(html).toContain("<title>Alice — Test Raid</title>");
            expect(html).toContain("Alice");
            expect(html).toContain("Fancy Helm");
            expect(html).toContain("Stufe 70 · Mage");
        });

        it("computes the average item level badge", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            // (120 + 100 + 110) / 3 = 110
            expect(html).toContain("<b>110</b><span>⌀ iLvl</span>");
        });

        it("shows enchant states for slots", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            expect(html).toContain("verzaubert");
            expect(html).toContain("keine Verzauberung");
            expect(html).toContain("suboptimale Verzauberung");
            expect(html).toContain("falsche Verzauberung");
        });

        it("renders empty gem sockets", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            expect(html).toContain("gem-empty");
        });

        it("returns the 404 page for an out-of-range index", () => {
            const html = renderPlayerPage(sampleReport(), 99);
            expect(html).toContain("404");
            expect(html).toContain("<title>Nicht gefunden</title>");
        });

        it("shows the admin-menu link for a logged-in admin", () => {
            const html = renderPlayerPage(sampleReport(), 0, { name: "Admin", isAdmin: true });
            expect(html).toContain("Admin-Menü");
        });

        it("shows no admin-menu link for an anonymous visitor", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            expect(html).toContain("Mit Discord einloggen");
            expect(html).not.toContain("Admin-Menü");
        });
    });

    describe("renderNotFound / renderError", () => {
        it("renderNotFound returns a 404 page", () => {
            const html = renderNotFound();
            expect(html).toContain("404");
            expect(html).toContain("<title>Nicht gefunden</title>");
        });

        it("renderError shows the title and message escaped", () => {
            const html = renderError("Kaputt", "Details <b>hier</b>");
            expect(html).toContain("<title>Kaputt</title>");
            expect(html).toContain("<h1>Kaputt</h1>");
            expect(html).toContain("Details &lt;b&gt;hier&lt;/b&gt;");
        });
    });
});
