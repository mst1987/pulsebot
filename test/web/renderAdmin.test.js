const {
    renderDashboard, renderAdminDenied,
    renderRecruitment, renderCla, renderRaids, renderRaidCreate,
    renderEventDetail, renderNotifyTemplates, renderChannels, renderSettings,
} = require("../../src/web/renderAdmin.js");

const user = { id: "42", name: "Marcstz", isAdmin: true };
const nav = () => ({ guilds: [{ id: "g1", name: "Meine Gilde" }], activeGuildId: "g1", csrf: "tok" });

describe("web/renderAdmin", () => {
    describe("adminLayout shell (via renderDashboard)", () => {
        it("produces a full HTML document with the sidebar app shell", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
            expect(html).toContain("class=\"app\"");
            expect(html).toContain("class=\"side\"");
            expect(html).toContain("<nav class=\"menu\">");
            expect(html).toContain("class=\"topbar\"");
            expect(html).toContain("EventHelper");
            expect(html).toContain("Gilden-Admin");
        });

        it("includes the theme toggle button in the shell", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html).toContain("id=\"themeBtn\"");
        });

        it("shows the logged-in user's name and initial in the sidebar footer", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html).toContain("class=\"avatar\">M<");
            expect(html).toContain("Marcstz");
            expect(html).toContain("/auth/logout");
        });

        it("renders the page title for the active section", () => {
            expect(renderDashboard(user, { nav: nav() })).toContain("class=\"page-title\">Übersicht<");
            expect(renderCla(user, { nav: nav() })).toContain("class=\"page-title\">CLA / Logcheck<");
        });

        it("marks the active nav item", () => {
            const html = renderRecruitment(user, { nav: nav() });
            expect(html).toContain("class=\"nav-item active\" href=\"/admin/recruitment\"");
            // a non-active item stays plain
            expect(html).toContain("class=\"nav-item\" href=\"/admin/cla\"");
        });

        it("renders a flash message when provided", () => {
            const ok = renderDashboard(user, { nav: nav(), msg: { type: "ok", text: "Gespeichert." } });
            expect(ok).toContain("flash-ok");
            expect(ok).toContain("Gespeichert.");
            const err = renderDashboard(user, { nav: nav(), msg: { type: "err", text: "Kaputt." } });
            expect(err).toContain("flash-err");
        });
    });

    describe("server bar", () => {
        it("renders the guild selector with the guild name", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html).toContain("Meine Gilde");
            expect(html).toContain("action=\"/admin/server\"");
        });

        it("warns to pick a server when none is active", () => {
            const html = renderDashboard(user, { nav: { guilds: [{ id: "g1", name: "G" }], activeGuildId: "", csrf: "t" } });
            expect(html).toContain("bitte zuerst einen Server wählen");
        });
    });

    describe("renderDashboard", () => {
        it("renders quick-access links to every area", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html).toContain("href=\"/admin/recruitment\"");
            expect(html).toContain("href=\"/admin/cla\"");
            expect(html).toContain("href=\"/admin/raids\"");
            expect(html).toContain("href=\"/admin/settings\"");
            expect(html).not.toContain("📢");
        });

        it("shows the key figures from stats", () => {
            const html = renderDashboard(user, {
                nav: nav(),
                stats: { reportsTotal: 12, reportsWithIssues: 3, templates: 2, posts: 5, categories: 4, adminRoles: 1 },
            });
            expect(html).toContain("Log-Check-Auswertungen");
            expect(html).toContain(">12<");
            expect(html).toContain("3 mit Problemen");
            expect(html).toContain("Event-Kategorien");
        });

        it("lists recent reports linking to the public report pages", () => {
            const html = renderDashboard(user, {
                nav: nav(),
                recentReports: [{ id: "r1", title: "Kara", zone: "Karazhan", generatedAt: 1000, issueCount: 3 }],
            });
            expect(html).toContain("/r/r1");
            expect(html).toContain("Kara");
        });

        it("shows an empty state when there are no reports", () => {
            const html = renderDashboard(user, { nav: nav(), recentReports: [] });
            expect(html).toContain("Noch keine Auswertungen");
        });
    });

    describe("renderRecruitment", () => {
        it("lists templates and escapes their names", () => {
            const html = renderRecruitment(user, {
                templates: [{ id: "t1", name: "<img src=x>", title: "T" }],
                channels: [{ id: "c1", name: "general" }],
                activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("&lt;img src=x&gt;");
            expect(html).not.toContain("<img src=x>");
            expect(html).toContain("Recruitment-Vorlagen");
        });

        it("prompts to pick a server before posting when none is active", () => {
            const html = renderRecruitment(user, { templates: [], activeGuildId: "", csrf: "x", nav: nav() });
            expect(html).toContain("Wähle oben einen Server");
        });
    });

    describe("renderCla", () => {
        it("renders the report form and lists recent reports", () => {
            const html = renderCla(user, {
                reports: [{ id: "r1", title: "Kara", zone: "Karazhan", generatedAt: 1000, playerCount: 25, issueCount: 3 }],
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("action=\"/admin/cla\"");
            expect(html).toContain("/r/r1");
            expect(html).toContain("Kara");
        });
    });

    describe("renderRaids (events overview)", () => {
        it("groups events by category with links and a details button", () => {
            const html = renderRaids(user, {
                guildId: "g1", activeGuildId: "g1", csrf: "x", nav: nav(),
                groups: [{
                    categoryId: "cat1", categoryName: "Raids Tier 4/5",
                    events: [{ id: "e1", title: "GDKP Kara", startTime: 1721851200, channelId: "c1", channelName: "kara", signupCount: 12 }],
                }],
            });
            expect(html).toContain("Raids Tier 4/5");
            expect(html).toContain("GDKP Kara");
            expect(html).toContain("/admin/raids/detail?event=e1");
            expect(html).toContain("raid-helper.xyz/raidplan/e1");
            expect(html).toContain("href=\"/admin/raids/new\"");
        });

        it("prompts to pick a server when none is active", () => {
            const html = renderRaids(user, { activeGuildId: "", csrf: "x", nav: nav() });
            expect(html).toContain("Wähle oben einen Server");
        });

        it("shows an error when event loading failed", () => {
            const html = renderRaids(user, { activeGuildId: "g1", error: "API down", csrf: "x", nav: nav() });
            expect(html).toContain("API down");
        });
    });

    describe("renderRaidCreate", () => {
        it("prefills the default template id and the leader id and posts to /new", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "TPL-9", channelId: "" },
                leaderId: "42", channels: [{ id: "c1", name: "raids" }], csrf: "x", nav: nav(),
            });
            expect(html).toContain("value=\"TPL-9\"");
            expect(html).toContain("value=\"42\"");
            expect(html).toContain("action=\"/admin/raids/new\"");
        });

        it("renders saved templates as datalist options and escapes their names", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" },
                templates: [{ id: "3", name: "<b>Kara</b>" }],
                leaderId: "42", channels: [], csrf: "x", nav: nav(),
            });
            expect(html).toContain("<datalist id=\"raidTemplateList\">");
            expect(html).toContain("value=\"3\"");
            expect(html).toContain("&lt;b&gt;Kara&lt;/b&gt;");
            expect(html).not.toContain("<b>Kara</b>");
        });

        it("offers the import and add-template actions on the dedicated routes", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" }, templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
            });
            expect(html).toContain("action=\"/admin/raid-templates/import\"");
            expect(html).toContain("action=\"/admin/raid-templates\"");
            expect(html).toContain("Aus Raid-Helper laden");
        });
    });

    describe("renderEventDetail", () => {
        const base = {
            event: { id: "e1", title: "GDKP Kara", startTime: 1721851200, channelId: "c1", channelName: "kara" },
            channelName: "kara", categoryName: "Raids", guildId: "g1", csrf: "x", nav: nav(),
        };

        it("renders links and both per-event functions", () => {
            const html = renderEventDetail(user, {
                ...base,
                notifyTemplates: [{ id: "t1", name: "Kara-Reminder" }],
                roles: [{ id: "r1", name: "Raider" }, { id: "r2", name: "Trial" }],
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
                matchedSheetId: "t45",
            });
            expect(html).toContain("action=\"/admin/raids/notify\"");
            expect(html).toContain("action=\"/admin/raids/fill\"");
            expect(html).toContain("name=\"role_r1\"");
            expect(html).toContain("Raider");
            // matched raidsheet preselected
            expect(html).toContain("value=\"t45\" selected");
            expect(html).toContain("discord.com/channels/g1/c1/e1");
        });

        it("guides the user when there are no templates or sheets", () => {
            const html = renderEventDetail(user, { ...base, notifyTemplates: [], roles: [], raidsheets: [] });
            expect(html).toContain("Noch keine Aufruf-Vorlagen");
            expect(html).toContain("Keine Raidsheets konfiguriert");
        });

        it("renders the setup grouped by role with class icons, colours and counts", () => {
            const setup = {
                total: 2,
                counts: { tank: 1, healer: 1 },
                groups: [
                    { role: "tank", label: "Tanks", players: [{ name: "Tankadin", specName: "Protection Pala", className: "Paladin", classColor: "#F58CBA", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/classicon_paladin.jpg", role: "tank" }] },
                    { role: "healer", label: "Heiler", players: [{ name: "Healy", specName: "Holy Priest", className: "Priest", classColor: "#FFFFFF", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/classicon_priest.jpg", role: "healer" }] },
                ],
            };
            const html = renderEventDetail(user, { ...base, notifyTemplates: [], roles: [], raidsheets: [], setup });
            expect(html).toContain("<h2>Setup</h2>");
            expect(html).toContain("Tankadin");
            expect(html).toContain("Protection Pala");
            expect(html).toContain("classicon_paladin.jpg");
            expect(html).toContain("border-left-color:#F58CBA");
            // role headers + summary counts
            expect(html).toContain("Tanks · 1");
            expect(html).toContain("Heiler");
            expect(html).toContain(">2</b> gesamt");
        });

        it("escapes player names in the setup", () => {
            const setup = {
                total: 1, counts: { dps: 1 },
                groups: [{ role: "dps", label: "DPS", players: [{ name: "<b>x</b>", specName: "Fire Mage", className: "Mage", classColor: "#69CCF0", iconUrl: "", role: "dps" }] }],
            };
            const html = renderEventDetail(user, { ...base, setup });
            expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
            expect(html).not.toContain("<b>x</b>");
        });

        it("shows an empty state when the event has no setup", () => {
            const html = renderEventDetail(user, { ...base, setup: { total: 0, counts: {}, groups: [] } });
            expect(html).toContain("noch kein Setup");
        });

        it("shows an error when the setup could not be loaded", () => {
            const html = renderEventDetail(user, { ...base, setup: null, setupError: "Raid-Helper down" });
            expect(html).toContain("Setup konnte nicht geladen werden");
            expect(html).toContain("Raid-Helper down");
        });
    });

    describe("renderNotifyTemplates", () => {
        it("lists templates and escapes their names", () => {
            const html = renderNotifyTemplates(user, {
                templates: [{ id: "t1", name: "<b>Kara</b>", title: "T" }], csrf: "x", nav: nav(),
            });
            expect(html).toContain("&lt;b&gt;Kara&lt;/b&gt;");
            expect(html).toContain("action=\"/admin/raids/templates\"");
        });
    });

    describe("renderChannels", () => {
        it("prompts to pick a server when none is active", () => {
            const html = renderChannels(user, { activeGuildId: "", csrf: "x", nav: nav() });
            expect(html).toContain("Wähle oben einen Server");
        });

        it("renders the create form with categories and the duplicate form with channels", () => {
            const html = renderChannels(user, {
                activeGuildId: "g1",
                categories: [{ id: "cat", name: "Raids" }],
                channels: [{ id: "t1", name: "kara-signup", typeLabel: "Text", category: "Raids" }],
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("action=\"/admin/channels/create\"");
            expect(html).toContain("action=\"/admin/channels/duplicate\"");
            expect(html).toContain("Raids");
            expect(html).toContain("kara-signup");
            // duplicate source carries the name so the JS can prefill the rename field
            expect(html).toContain("data-name=\"kara-signup\"");
        });

        it("shows an empty state for duplication when there are no channels", () => {
            const html = renderChannels(user, {
                activeGuildId: "g1", categories: [], channels: [], csrf: "x", nav: nav(),
            });
            expect(html).toContain("Keine Kanäle zum Duplizieren");
        });

        it("marks the channels nav item active", () => {
            const html = renderChannels(user, { activeGuildId: "g1", categories: [], channels: [], csrf: "x", nav: nav() });
            expect(html).toContain("class=\"nav-item active\" href=\"/admin/channels\"");
        });
    });

    describe("renderSettings", () => {
        it("prefills admin role ids and raid defaults", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: ["111", "222"], raidDefaults: { templateId: "t", channelId: "c" } },
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("value=\"111, 222\"");
            expect(html).toContain("value=\"t\"");
            expect(html).toContain("value=\"c\"");
        });

        it("renders configured raidsheets and a new-sheet form", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {} },
                raidsheets: [{ id: "t45", name: "Tier 4/5", spreadsheetId: "sid", sheetName: "Setup", gid: 0, keywords: ["kara", "gruul"] }],
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("Raidsheets");
            expect(html).toContain("value=\"Tier 4/5\"");
            expect(html).toContain("value=\"kara, gruul\"");
            expect(html).toContain("action=\"/admin/settings/raidsheets\"");
            expect(html).toContain("formaction=\"/admin/settings/raidsheets/delete\"");
        });
    });

    describe("renderAdminDenied", () => {
        it("shows the Discord login for anonymous visitors", () => {
            const html = renderAdminDenied(null);
            expect(html).toContain("Mit Discord einloggen");
            expect(html).toContain("Bitte melde dich mit Discord an");
        });

        it("shows an access-denied message for a logged-in non-admin", () => {
            const html = renderAdminDenied({ id: "9", name: "Bob", isAdmin: false });
            expect(html).toContain("keinen Admin-Zugang");
        });
    });
});
