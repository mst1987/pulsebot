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
                    mana: 7,
                    total: 10,
                    byType: { destruction: 1, haste: 2, superMana: 5, darkRune: 2 },
                },
            ],
            types: [
                { key: "destruction", group: "destruction", label: "Zerstörungstrank", icon: "inv_potion_107", itemId: 22839, spellId: null },
                { key: "superMana", group: "mana", label: "Super-Manatrank", icon: "inv_potion_137", itemId: 22832, spellId: null },
                { key: "darkRune", group: "mana", label: "Dunkle Rune", icon: "inv_misc_rune_04", itemId: 20520, spellId: null },
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

/** A report carrying a populated RPB section on top of the CLA sections. */
function reportWithRpb() {
    return {
        ...sampleReport(),
        rpb: {
            roles: { Alice: "Caster", Bob: "Tank" },
            byRole: { Tank: [{ name: "Bob", type: "Warrior", trinkets: [] }], Healer: [], Caster: [], Physical: [] },
            raidSeconds: 300,
            bossSeconds: 200,
            damage: {
                heading: "Vermeidbarer erhaltener Schaden",
                abilities: [{
                    label: "Feuerregen", name: "Rain of Fire", sources: ["Boss"], total: 5000,
                    icon: "spell_shadow_rainoffire.jpg", spellId: 42223,
                }],
                players: [
                    { name: "Alice", type: "Mage", perAbility: { 0: 1200 }, avoidableTotal: 1200, reflected: 30, hostile: 0, deaths: 1 },
                    { name: "Bob", type: "Warrior", perAbility: { 0: 800 }, avoidableTotal: 800, reflected: 0, hostile: 12, deaths: 0 },
                ],
            },
            activity: {
                raidSeconds: 300,
                headings: {},
                players: [
                    {
                        name: "Alice", type: "Mage", gearSpellHaste: 60, hasteSecondsSubtracted: 18,
                        hasteBuffsUsed: {}, secondsActive: 240, secondsActiveST: 200, secondsActiveAoe: 40,
                        relativeST: 66, relativeAoe: 13, relativeTotal: 80,
                        singleTargetCasts: [
                            {
                                label: "Feuerball", name: "Fireball", amount: 42,
                                icon: "spell_fire_flamebolt.jpg", spellId: 38692,
                                lowerRankCasts: 30, lowerRankPercent: 71, mostlyLowerRank: true,
                            },
                            { label: "Frostblitz", name: "Frostbolt", amount: 10, icon: "spell_frost_frostbolt02.jpg", spellId: 27072 },
                        ],
                        aoeCasts: [
                            { label: "Blizzard", name: "Blizzard", amount: 5, icon: "spell_frost_icestorm.jpg", spellId: 27085 },
                        ],
                    },
                ],
            },
            interrupts: {
                heading: "Unterbrochene Zauber",
                players: [{
                    name: "Bob", type: "Warrior", count: 4,
                    spells: [{ name: "Heilung", count: 4, icon: "spell_holy_heal.jpg", spellId: 25314 }],
                    kicks: [{ name: "Schildhieb", count: 4 }],
                }],
            },
            validation: {
                zones: ["SSC"],
                bossesKilled: 3,
                bossesTotal: 4,
                requirements: [
                    { zone: "SSC", label: "Tiefensumpfkoloss", name: "Underbog Colossus", minimum: 6, killed: 6, ok: true },
                    { zone: "SSC", label: "Tiefenhexe", name: "Coilfang Fathom-Witch", minimum: 6, killed: 2, ok: false },
                ],
                valid: false,
            },
            usage: [
                {
                    name: "Alice", type: "Mage",
                    classCooldowns: [{
                        label: "Eisige Adern", name: "Icy Veins", total: 3, trash: 1, bosses: 2,
                        cooldown: 180, possibleUses: 4, icon: "spell_frost_coldhearted.jpg", spellId: 12472,
                    }],
                    trinketsAndRacials: [{
                        label: "Schädel", name: "Skull", total: 2, trash: 0, bosses: 2,
                        icon: "inv_misc_bone_elfskull_01.jpg", spellId: 40396,
                    }],
                    consumables: [], engineering: [], absorbs: [],
                },
            ],
            headings: {},
        },
    };
}

describe("web/render", () => {
    describe("renderReportPage", () => {
        it("produces a full HTML document with the report title", () => {
            const html = renderReportPage(sampleReport());
            expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
            expect(html).toContain("<title>Log-Check: Test Raid</title>");
            expect(html).toContain("<h1 class=\"page-title\">Test Raid</h1>");
        });

        it("renders the sub line with zone, date and the WCL link", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("Zone: Karazhan");
            expect(html).toContain("2026-07-24");
            expect(html).toContain("https://www.warcraftlogs.com/reports/xyz");
            expect(html).toContain("→ Warcraft Logs");
        });

        it("shows headline tiles for raiders, gear issues, bosses and consumables", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("class=\"tiles\"");
            expect(html).toContain("Raider");
            expect(html).toContain("Gear-Probleme");
            expect(html).toContain("Boss-Kämpfe");
            expect(html).toContain("1 Kill(s) · 1 Wipe(s)"); // 2 rows, one of them a wipe
            expect(html).toContain("Ø Flask/Elixiere");
        });

        it("labels every tab with a count badge", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("<span class=\"tab-count\">2</span>"); // 2 raiders
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

        it("breaks the mana total down into one column per source", () => {
            const html = renderReportPage(sampleReport());
            // the aggregate stays, the sources are spelled out behind it
            expect(html).toContain("inv_potion_137.jpg");   // Super Mana Potion
            expect(html).toContain("inv_misc_rune_04.jpg"); // Dark Rune
            expect(html).toContain("Super-Manatrank");
            expect(html).toContain("Dunkle Rune");
            expect(html).toContain("https://www.wowhead.com/tbc/item=22832");
        });

        it("only shows mana columns, not the destruction/haste types, in the breakdown", () => {
            const html = renderReportPage(sampleReport());
            const legend = html.slice(html.indexOf("class=\"legend\""), html.indexOf("</table>"));
            expect(legend).not.toContain("Zerstörungstrank");
        });

        it("marks the first tab active", () => {
            const html = renderReportPage(sampleReport());
            // roster is the first defined tab and should carry the active class
            expect(html).toContain("class=\"tab-btn active\" data-tab=\"roster\"");
        });

        it("hides every RPB tab when the report has no RPB section", () => {
            const html = renderReportPage(sampleReport());
            expect(html).not.toContain("data-tab=\"rpbdamage\"");
            expect(html).not.toContain("data-tab=\"rpbactivity\"");
            expect(html).not.toContain("data-tab=\"rpbvalidate\"");
        });

        it("shows the RPB tabs when the section is populated", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("data-tab=\"rpbdamage\"");
            expect(html).toContain("data-tab=\"rpbactivity\"");
            expect(html).toContain("data-tab=\"rpbusage\"");
            expect(html).toContain("data-tab=\"rpbinterrupts\"");
            expect(html).toContain("data-tab=\"rpbvalidate\"");
        });

        it("splits the damage table into one tab per role", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("data-tab=\"rpbdmg-tank\"");
            expect(html).toContain("data-tab=\"rpbdmg-caster\"");
            expect(html).toContain("Feuerregen");
            // thousands separator for the German locale
            expect(html).toContain("1.200");
        });

        it("offers both table orientations, players first", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("data-view=\"p\" class=\"active\"");
            expect(html).toContain("data-view=\"a\"");
            expect(html).toContain("Spieler als Zeilen");
            expect(html).toContain("Fähigkeiten als Zeilen");
            // the transposed view puts every raider in a column head
            expect(html).toContain("class=\"rcol\"");
        });

        it("shows the avoidable ability's own WoW icon in the table head", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("spell_shadow_rainoffire.jpg");
        });

        it("names the sources of an avoidable ability in the column title", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("title=\"Boss\"");
        });

        it("warns that melee activity is inaccurate", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("Für Nahkämpfer ungenau");
        });

        it("renders the interrupted spells as icons, plus what they were kicked with", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("spell_holy_heal.jpg");
            expect(html).toContain("Heilung ×4");
            expect(html).toContain("https://www.wowhead.com/tbc/spell=25314");
            expect(html).toContain("Schildhieb ×4");
        });

        it("flags a log that misses its trash requirements", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("Bosse gelegt");
            expect(html).toContain("zu wenig");
            expect(html).toContain("nicht");
        });

        it("shows cooldown usage as an icon with its count and the possible uses", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("spell_frost_coldhearted.jpg");
            expect(html).toContain("Eisige Adern ×3 — 3 von ~4 möglichen");
            expect(html).toContain("https://www.wowhead.com/tbc/spell=12472");
        });

        it("marks a cooldown used less than half as often as possible", () => {
            const report = reportWithRpb();
            report.rpb.usage[0].classCooldowns[0].total = 1;   // 1 of 4 possible
            const html = renderReportPage(report);
            expect(html).toContain("class=\"itile warn\"");
        });

        it("renders trinkets as icons instead of a text list", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("inv_misc_bone_elfskull_01.jpg");
            expect(html).toContain("Schädel ×2");
        });

        it("shows a spell tab listing each raider's tracked casts", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("data-tab=\"rpbspells\"");
            expect(html).toContain("spell_fire_flamebolt.jpg");
            expect(html).toContain("spell_frost_icestorm.jpg");
            expect(html).toContain("Frostblitz ×10");
        });

        it("flags a spell that was mostly cast at a lower rank", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("Feuerball ×42 — 71% niedriger Rang (30×)");
            expect(html).toContain("class=\"itile warn\"");
        });

        it("counts the downrank warnings in the spell tab's badge", () => {
            const html = renderReportPage(reportWithRpb());
            // exactly one flagged spell in the fixture
            expect(html).toContain("data-tab=\"rpbspells\"><img class=\"hicon\"");
            expect(html).toMatch(/data-tab="rpbspells">[\s\S]*?<span class="tab-count">1<\/span>/);
        });

        it("hides the spell tab when no tracked casts were recorded", () => {
            const report = reportWithRpb();
            report.rpb.activity.players[0].singleTargetCasts = [];
            report.rpb.activity.players[0].aoeCasts = [];
            const html = renderReportPage(report);
            expect(html).not.toContain("data-tab=\"rpbspells\"");
            expect(html).toContain("data-tab=\"rpbactivity\"");   // activity itself stays
        });

        it("labels the main tabs with WoW icons rather than emoji", () => {
            const html = renderReportPage(reportWithRpb());
            expect(html).toContain("data-tab=\"roster\"><img class=\"hicon\"");
            expect(html).toContain("inv_misc_grouplooking.jpg");
            expect(html).not.toContain("👥");
            expect(html).not.toContain("🛡️");
            expect(html).not.toContain("💥");
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
            expect(html).toContain("<h1 class=\"page-title\">Log-Check</h1>");
            // gear tab is always shown; empty-gear message appears
            expect(html).toContain("Keine Gear-Probleme gefunden");
            // optional sections absent
            expect(html).not.toContain("data-tab=\"potions\"");
            expect(html).not.toContain("data-tab=\"sunder\"");
        });

        it("wraps the report in the admin menu chrome for a logged-in admin", () => {
            const html = renderReportPage(sampleReport(), { name: "Admin", isAdmin: true });
            expect(html).toContain("class=\"app\"");
            expect(html).toContain("id=\"sideNav\"");
            // full admin navigation, with the CLA section highlighted
            expect(html).toContain("href=\"/admin/cla\"");
            expect(html).toContain("href=\"/admin/raids\"");
            expect(html).toContain("href=\"/admin/settings\"");
            expect(html).toContain("nav-item area-cla active");
            // breadcrumbs down to the report + the user footer
            expect(html).toContain("CLA / Logcheck");
            expect(html).toContain("<b>Test Raid</b>");
            expect(html).toContain("<div class=\"u-name\">Admin</div>");
            expect(html).toContain("href=\"/auth/logout\"");
            // no public login bar in the admin view
            expect(html).not.toContain("Mit Discord einloggen");
        });

        it("shows a Discord login button for an anonymous visitor, no admin chrome", () => {
            const html = renderReportPage(sampleReport());
            expect(html).toContain("Mit Discord einloggen");
            expect(html).toContain("class=\"pubbar\"");
            expect(html).not.toContain("id=\"sideNav\"");
        });

        it("shows no admin chrome for a logged-in non-admin", () => {
            const html = renderReportPage(sampleReport(), { name: "Bob", isAdmin: false });
            expect(html).toContain("Eingeloggt als");
            expect(html).not.toContain("id=\"sideNav\"");
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

        it("wraps the detail page in the admin menu chrome for a logged-in admin", () => {
            const html = renderPlayerPage(sampleReport(), 0, { name: "Admin", isAdmin: true });
            expect(html).toContain("id=\"sideNav\"");
            expect(html).toContain("nav-item area-cla active");
            // breadcrumb links back to the report, player name as the leaf
            expect(html).toContain("href=\"/r/abc123def456\"");
            expect(html).toContain("<b>Alice</b>");
        });

        it("shows no admin chrome for an anonymous visitor", () => {
            const html = renderPlayerPage(sampleReport(), 0);
            expect(html).toContain("Mit Discord einloggen");
            expect(html).not.toContain("id=\"sideNav\"");
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
            expect(html).toContain(">Kaputt</h1>");
            expect(html).toContain("Details &lt;b&gt;hier&lt;/b&gt;");
        });
    });
});
