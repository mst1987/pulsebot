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

        it("renders the Upcoming Events card with a link to the raidplan", () => {
            const html = renderDashboard(user, {
                nav: nav(),
                upcoming: { events: [{ id: "evt1", title: "Gruul & Maggi", channelName: "gruul-run", startTime: 1893456000, sheet: null }], error: null },
            });
            expect(html).toContain("Upcoming Events");
            expect(html).toContain("Gruul &amp; Maggi");
            expect(html).toContain("raid-helper.xyz/raidplan/evt1");
            expect(html).toContain("gruul-run");
        });

        it("marks the sheet as done when a fill record exists, missing otherwise", () => {
            const filled = renderDashboard(user, {
                nav: nav(),
                upcoming: { events: [{ id: "e1", title: "A", startTime: 1893456000, sheet: { filledAt: 1700000000000, playerCount: 25 } }], error: null },
            });
            expect(filled).toContain("Sheet ✓");
            expect(filled).toContain("25 Spieler");

            const missing = renderDashboard(user, {
                nav: nav(),
                upcoming: { events: [{ id: "e1", title: "A", startTime: 1893456000, sheet: null }], error: null },
            });
            expect(missing).toContain("Sheet fehlt");
            expect(missing).not.toContain("Sheet ✓");
        });

        it("shows an empty state when no upcoming event has a setup", () => {
            const html = renderDashboard(user, { nav: nav(), upcoming: { events: [], error: null } });
            expect(html).toContain("Keine anstehenden Events mit fertigem Setup");
        });

        it("surfaces an error loading upcoming events", () => {
            const html = renderDashboard(user, { nav: nav(), upcoming: { events: [], error: "Raid-Helper API down" } });
            expect(html).toContain("Raid-Helper API down");
        });

        it("escapes event titles in the Upcoming Events card", () => {
            const html = renderDashboard(user, {
                nav: nav(),
                upcoming: { events: [{ id: "e1", title: "<img src=x>", startTime: 1893456000, sheet: null }], error: null },
            });
            expect(html).toContain("&lt;img src=x&gt;");
            expect(html).not.toContain("<img src=x>");
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

        it("renders an emoji picker with the server's custom emojis in the template form", () => {
            const html = renderRecruitment(user, {
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
                emojis: [{ id: "1", name: "pepe", animated: false, code: "<:pepe:1>", url: "https://cdn/pepe.png" }],
            });
            expect(html).toContain("Emoji einfügen");
            expect(html).toContain("data-code=\"&lt;:pepe:1&gt;\"");
            expect(html).toContain("https://cdn/pepe.png");
        });

        it("omits the emoji picker when the server has no custom emojis", () => {
            const html = renderRecruitment(user, {
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(), emojis: [],
            });
            expect(html).not.toContain("Emoji einfügen");
        });

        it("renders the emoji picker on the post-edit form too", () => {
            const html = renderRecruitment(user, {
                editingPost: { id: "p1", channelName: "gen", content: "hi", title: "", body: "", buttonLabel: "" },
                csrf: "x", nav: nav(),
                emojis: [{ id: "1", name: "pepe", animated: false, code: "<:pepe:1>", url: "https://cdn/pepe.png" }],
            });
            expect(html).toContain("Emoji einfügen");
            expect(html).toContain("data-code=\"&lt;:pepe:1&gt;\"");
        });
    });

    describe("renderCla", () => {
        const reportPage = (over = {}) => ({
            items: [{ id: "r1", title: "Kara", zone: "Karazhan", generatedAt: 1000, playerCount: 25, issueCount: 3, reportUrl: "https://classic.warcraftlogs.com/reports/abc" }],
            sort: "date", dir: "desc", page: 1, totalPages: 1, total: 1, ...over,
        });
        const logPage = (over = {}) => ({
            items: [{ id: "l1", reportId: "xyz", link: "https://classic.warcraftlogs.com/reports/xyz", title: "Kara Log", status: "open", postedAt: 5000, detectedAt: 1, guildId: "g1", channelId: "c1", messageId: "m1" }],
            sort: "date", dir: "desc", page: 1, totalPages: 1, total: 1, ...over,
        });

        it("shows a submenu separating Auswertungen and Erkannte Logs with counts", () => {
            const html = renderCla(user, { view: "reports", reportPage: reportPage(), counts: { reports: 4, logs: 2 }, csrf: "x", nav: nav() });
            expect(html).toContain("class=\"subnav\"");
            expect(html).toContain("href=\"/admin/cla?view=reports\"");
            expect(html).toContain("href=\"/admin/cla?view=logs\"");
            expect(html).toContain("Auswertungen");
            expect(html).toContain("Erkannte Logs");
            // active tab = reports
            expect(html).toContain("class=\"subnav-item active\" href=\"/admin/cla?view=reports\"");
        });

        describe("reports view", () => {
            it("renders the new-report form, the table and the WCL link", () => {
                const html = renderCla(user, { view: "reports", reportPage: reportPage(), csrf: "x", nav: nav() });
                expect(html).toContain("action=\"/admin/cla\"");
                expect(html).toContain("/r/r1");
                expect(html).toContain("https://classic.warcraftlogs.com/reports/abc");
            });

            it("has sortable headers that keep the view and show the active arrow", () => {
                const html = renderCla(user, { view: "reports", reportPage: reportPage(), csrf: "x", nav: nav() });
                expect(html).toContain("class=\"sort-link active\" href=\"/admin/cla?view=reports&sort=date&dir=asc&page=1\"");
                expect(html).toContain("Erstellt ▼");
                expect(html).toContain("/admin/cla?view=reports&sort=title&dir=asc&page=1");
            });

            it("pages with prev disabled on page 1", () => {
                const html = renderCla(user, { view: "reports", reportPage: reportPage({ page: 1, totalPages: 3, total: 40 }), csrf: "x", nav: nav() });
                expect(html).toContain("Seite 1 / 3 · 40 gesamt");
                expect(html).toContain("pager-btn disabled");
                expect(html).toContain("/admin/cla?view=reports&sort=date&dir=desc&page=2");
            });

            it("shows an empty state when there are no reports", () => {
                const html = renderCla(user, { view: "reports", reportPage: reportPage({ items: [], total: 0 }), csrf: "x", nav: nav() });
                expect(html).toContain("Noch keine Auswertungen");
            });
        });

        describe("logs view", () => {
            it("renders the detected-logs table with a Gepostet column and the evaluate button", () => {
                const html = renderCla(user, { view: "logs", logPage: logPage(), counts: { reports: 0, logs: 1 }, logChannelIds: ["c1"], csrf: "x", nav: nav() });
                expect(html).toContain("class=\"subnav-item active\" href=\"/admin/cla?view=logs\"");
                expect(html).toContain("Gepostet");
                expect(html).toContain("action=\"/admin/cla/eval\""); // evaluate button
            });

            it("makes the log NAME the WCL link (no separate WCL column)", () => {
                const html = renderCla(user, { view: "logs", logPage: logPage(), logChannelIds: ["c1"], csrf: "x", nav: nav() });
                // the name is the link text, pointing at the WCL report
                expect(html).toContain("href=\"https://classic.warcraftlogs.com/reports/xyz\" target=\"_blank\" rel=\"noopener\">Kara Log ↗</a>");
                // no dedicated "WCL" header column anymore
                expect(html).not.toContain("<th>WCL</th>");
            });

            it("has sortable headers scoped to the logs view", () => {
                const html = renderCla(user, { view: "logs", logPage: logPage(), logChannelIds: ["c1"], csrf: "x", nav: nav() });
                expect(html).toContain("/admin/cla?view=logs&sort=date&dir=asc&page=1"); // active date toggles
                expect(html).toContain("/admin/cla?view=logs&sort=title&dir=asc&page=1");
            });

            it("shows a category badge (with the channel name as tooltip) when known", () => {
                const html = renderCla(user, {
                    view: "logs",
                    logPage: logPage({ items: [{ ...logPage().items[0], categoryName: "Karazhan", channelName: "kara-logs" }] }),
                    logChannelIds: ["c1"], csrf: "x", nav: nav(),
                });
                expect(html).toContain("<th>Kategorie</th>");
                expect(html).toContain("class=\"cat-badge\" title=\"#kara-logs\">Karazhan</span>");
            });

            it("shows a dash in the category column when the category is unknown", () => {
                const html = renderCla(user, { view: "logs", logPage: logPage(), logChannelIds: ["c1"], csrf: "x", nav: nav() });
                expect(html).toContain("<th>Kategorie</th>");
                // no badge element is rendered (the CSS rule doesn't count)
                expect(html).not.toContain("class=\"cat-badge\"");
            });

            it("prompts to configure log channels when none are set", () => {
                const html = renderCla(user, { view: "logs", logPage: logPage({ items: [] }), logChannelIds: [], csrf: "x", nav: nav() });
                expect(html).toContain("noch keine Log-Channels konfiguriert");
            });
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

        it("offers a per-category create button that reuses the category's latest event as format", () => {
            const html = renderRaids(user, {
                guildId: "g1", activeGuildId: "g1", csrf: "x", nav: nav(),
                groups: [{
                    categoryId: "cat1", categoryName: "PUG Raids",
                    events: [
                        { id: "old", title: "SSC alt", startTime: 1000, channelId: "c1", channelName: "ssc-alt", signupCount: 5 },
                        { id: "new", title: "SSC neu", startTime: 5000, channelId: "c2", channelName: "ssc-neu", signupCount: 5 },
                    ],
                }],
            });
            // ＋ Event links to the create form pre-seeded with the newest event + category
            expect(html).toContain("/admin/raids/new?source=new&category=cat1");
            // action cell no longer uses display:flex on the td (divider alignment fix)
            expect(html).toContain("td.cell-actions");
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

        it("uses a native datepicker for the date field", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" }, templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
            });
            expect(html).toContain("<input type=\"date\" name=\"date\"");
            expect(html).toContain("<input type=\"time\" name=\"time\"");
        });

        it("renders the reuse-event picker with prefill data and a channel-name field", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" }, templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
                reusableEvents: [
                    { id: "ev1", title: "GDKP Kara", templateId: "3", description: "hi", channelId: "c1", channelName: "gdkp-kara" },
                ],
            });
            expect(html).toContain("name=\"sourceEventId\"");
            expect(html).toContain("data-channel=\"gdkp-kara\"");
            expect(html).toContain("data-template=\"3\"");
            expect(html).toContain("name=\"channelName\"");
        });

        it("pre-selects the reuse source when defaults.sourceEventId is given", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "", sourceEventId: "ev1" },
                templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
                reusableEvents: [
                    { id: "ev1", title: "GDKP Kara", templateId: "3", description: "", channelId: "c1", channelName: "gdkp-kara" },
                ],
            });
            expect(html).toContain("<option value=\"ev1\" selected");
        });

        it("omits the reuse picker when there are no existing events", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" }, templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
                reusableEvents: [],
            });
            expect(html).not.toContain("name=\"sourceEventId\"");
        });

        it("escapes malicious event titles in the picker options", () => {
            const html = renderRaidCreate(user, {
                defaults: { templateId: "", channelId: "" }, templates: [], leaderId: "1", channels: [], csrf: "x", nav: nav(),
                reusableEvents: [
                    { id: "ev1", title: "<b>x</b>", templateId: "", description: "", channelId: "c1", channelName: "chan" },
                ],
            });
            expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
            expect(html).not.toContain("data-title=\"<b>x</b>\"");
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

        it("renders an attendance tab with missing raiders and a ping button", () => {
            const html = renderEventDetail(user, {
                ...base,
                attendanceRoleIds: ["r1"],
                attendance: {
                    responded: [{ id: "1", displayName: "Alice" }],
                    missing: [{ id: "2", displayName: "Bob" }],
                },
            });
            expect(html).toContain("data-tab=\"attendance\"");
            expect(html).toContain("data-panel=\"attendance\"");
            expect(html).toContain("action=\"/admin/raids/ping-missing\"");
            expect(html).toContain("Fehlende Raider pingen");
            expect(html).toContain("Bob");
            expect(html).toContain("Alice");
            expect(html).toContain(">1</b> reagiert");
            expect(html).toContain(">1</b> fehlt");
        });

        it("hints to assign roles when the category has none", () => {
            const html = renderEventDetail(user, { ...base, attendanceRoleIds: [] });
            expect(html).toContain("data-panel=\"attendance\"");
            expect(html).toContain("keine Raider-Rollen zugeordnet");
            expect(html).not.toContain("action=\"/admin/raids/ping-missing\"");
        });

        it("shows the Server-Members-Intent hint when members cannot be loaded", () => {
            const html = renderEventDetail(user, {
                ...base,
                attendanceRoleIds: ["r1"],
                membersError: "Used disallowed intents",
            });
            expect(html).toContain("Server Members Intent");
            expect(html).not.toContain("action=\"/admin/raids/ping-missing\"");
        });

        it("celebrates when everyone has reacted (no ping form)", () => {
            const html = renderEventDetail(user, {
                ...base,
                attendanceRoleIds: ["r1"],
                attendance: { responded: [{ id: "1", displayName: "Alice" }], missing: [] },
            });
            expect(html).not.toContain("action=\"/admin/raids/ping-missing\"");
            expect(html).toContain("alle erwarteten Raider reagiert");
        });

        it("renders the setup grouped into raid groups with class icons and colours", () => {
            const setup = {
                total: 2,
                roleCounts: { tank: 1, healer: 1 },
                groups: [
                    { group: 1, label: "Gruppe 1", players: [{ name: "Tankadin", specName: "Protection Pala", className: "Paladin", classColor: "#F58CBA", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/classicon_paladin.jpg", role: "tank" }] },
                    { group: 2, label: "Gruppe 2", players: [{ name: "Healy", specName: "Holy Priest", className: "Priest", classColor: "#FFFFFF", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/classicon_priest.jpg", role: "healer" }] },
                ],
            };
            const html = renderEventDetail(user, { ...base, notifyTemplates: [], roles: [], raidsheets: [], setup });
            // Setup lives in its own tab now
            expect(html).toContain("data-tab=\"setup\"");
            expect(html).toContain("data-panel=\"setup\"");
            expect(html).toContain("Tankadin");
            expect(html).toContain("classicon_paladin.jpg");
            expect(html).toContain("border-left-color:#F58CBA");
            // spec no longer shown as text, but kept as a hover title
            expect(html).toContain("title=\"Protection Pala\"");
            // raid-group headers + summary counts
            expect(html).toContain("Gruppe 1");
            expect(html).toContain("Gruppe 2");
            expect(html).toContain(">2</b> Raider");
            expect(html).toContain(">2</b> Gruppen");
        });

        it("offers tank-capable raiders as a Tank-3 dropdown on the fill form", () => {
            const html = renderEventDetail(user, {
                ...base,
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
                tankCandidates: [
                    { name: "Warri", specName: "Fury Warrior", className: "Warrior" },
                    { name: "Beary", specName: "Feral Tank", className: "Druid" },
                ],
            });
            expect(html).toContain("name=\"tank3\"");
            expect(html).toContain("<select name=\"tank3\">");
            expect(html).toContain("Warri — Fury Warrior");
            expect(html).toContain("Beary — Feral Tank");
        });

        it("links the created event-sheet copy with its deletion date", () => {
            const html = renderEventDetail(user, {
                ...base,
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
                eventSheet: {
                    eventId: "e1", eventTitle: "GDKP Kara",
                    url: "https://docs.google.com/spreadsheets/d/copy-1/edit",
                    deleteAfter: 1753559200000,
                },
            });
            expect(html).toContain("https://docs.google.com/spreadsheets/d/copy-1/edit");
            expect(html).toContain("Gefülltes Sheet");
            expect(html).toContain("automatisch gelöscht");
            // button reflects the copy behaviour
            expect(html).toContain("Neues Sheet erstellen");
            // prominent "open sheet" button in the meta card
            expect(html).toContain("class=\"btn sheet-btn\"");
            expect(html).toContain("Sheet öffnen");
        });

        it("omits the prominent sheet button when no sheet exists yet", () => {
            const html = renderEventDetail(user, { ...base, raidsheets: [{ id: "t45", name: "Tier 4/5" }] });
            expect(html).not.toContain("Sheet öffnen");
            expect(html).not.toContain("class=\"btn sheet-btn\"");
        });

        it("falls back to a free-text Tank-3 field when no candidates exist", () => {
            const html = renderEventDetail(user, {
                ...base,
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
                tankCandidates: [],
            });
            expect(html).toContain("name=\"tank3\"");
            expect(html).toContain("placeholder=\"Name des 3. Tanks\"");
        });

        it("escapes player names in the setup", () => {
            const setup = {
                total: 1, roleCounts: { dps: 1 },
                groups: [{ group: 1, label: "Gruppe 1", players: [{ name: "<b>x</b>", specName: "Fire Mage", className: "Mage", classColor: "#69CCF0", iconUrl: "", role: "dps" }] }],
            };
            const html = renderEventDetail(user, { ...base, setup });
            expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
            expect(html).not.toContain("<b>x</b>");
        });

        it("shows an empty state when the event has no setup", () => {
            const html = renderEventDetail(user, { ...base, setup: { total: 0, roleCounts: {}, groups: [] } });
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

        it("splits the categories into tabs with a raidsheets tab", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {} },
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("data-tab=\"zugang\"");
            expect(html).toContain("data-tab=\"recruitment\"");
            expect(html).toContain("data-tab=\"auktionen\"");
            expect(html).toContain("data-tab=\"events\"");
            expect(html).toContain("data-tab=\"logs\"");
            expect(html).toContain("data-tab=\"raidsheets\"");
            expect(html).toContain("data-panel=\"zugang\"");
            expect(html).toContain("data-panel=\"raidsheets\"");
        });

        it("picks categories by name and offers only raid-related roles, prechecked from categoryRoles", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {}, categoryIds: ["cat1"], categoryRoles: { cat1: ["r2"] } },
                roles: [{ id: "r1", name: "Raider" }, { id: "r2", name: "Raid Lead" }, { id: "r3", name: "Trial" }],
                categories: [{ id: "cat1", name: "Kara" }, { id: "cat2", name: "Voice" }],
                csrf: "x", nav: nav(),
            });
            // category chosen by name via a checkbox; the configured one is checked
            expect(html).toContain("name=\"cat:cat1\" value=\"1\" checked");
            expect(html).toContain("name=\"cat:cat2\" value=\"1\">"); // not configured -> unchecked
            expect(html).toContain("Kara");
            // only raid/raider roles are offered
            expect(html).toContain("name=\"catrole:cat1:r1\" value=\"1\"> @Raider");
            expect(html).toContain("name=\"catrole:cat1:r2\" value=\"1\" checked"); // prechecked
            expect(html).not.toContain("catrole:cat1:r3"); // "Trial" is filtered out
        });

        it("preserves an unknown configured category id so it is not silently dropped", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {}, categoryIds: ["stale99"], categoryRoles: {} },
                roles: [{ id: "r1", name: "Raider" }],
                categories: [{ id: "cat1", name: "Kara" }],
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("name=\"cat:stale99\" value=\"1\" checked");
            expect(html).toContain("unbekannte ID");
        });

        it("hints when no categories are loaded (bot offline)", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {}, categoryIds: [], categoryRoles: {} },
                roles: [{ id: "r1", name: "Raider" }],
                categories: [],
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("Keine Kategorien geladen");
            expect(html).not.toContain("name=\"catrole:");
        });

        it("keeps all config fields in one form so hidden tabs still submit", () => {
            const html = renderSettings(user, {
                config: { adminRoleIds: [], raidDefaults: {} },
                csrf: "x", nav: nav(),
            });
            // one main config form, all inputs live inside it
            const formCount = (html.match(/action="\/admin\/settings"/g) || []).length;
            expect(formCount).toBe(1);
            expect(html).toContain("name=\"adminRoleIds\"");
            expect(html).toContain("name=\"logChannelIds\"");
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
