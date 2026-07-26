const {
    renderDashboard, renderAdminDenied,
    renderRecruitment, renderRecruitmentFragment, renderCla, renderRaids, renderRaidCreate,
    renderEventDetail, renderNotifyTemplates, renderChannels, renderSettings,
    renderHistory, renderHistoryEvent, renderHistoryChar, fillCharTemplate,
    formatEventTime, fmtMs, formatMatchOffset,
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

        it("includes the full-page loading overlay and its trigger script", () => {
            const html = renderDashboard(user, { nav: nav() });
            expect(html).toContain("id=\"pageLoader\"");
            expect(html).toContain("pl-rune");
            expect(html).toContain("@keyframes pl-spin");
            // forms/links opt in via data-loader; the shell wires the submit/click handlers
            expect(html).toContain("data-loader");
            expect(html).toContain("prefers-reduced-motion");
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

        it("renders an ok/err message as a toast when provided", () => {
            const ok = renderDashboard(user, { nav: nav(), msg: { type: "ok", text: "Gespeichert." } });
            expect(ok).toContain("toast-ok");
            expect(ok).toContain("toast-msg");
            expect(ok).toContain("Gespeichert.");
            const err = renderDashboard(user, { nav: nav(), msg: { type: "err", text: "Kaputt." } });
            expect(err).toContain("toast-err");
            expect(err).toContain("Kaputt.");
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

        it("renders the Upcoming Events card, linking the event to its admin detail page", () => {
            const html = renderDashboard(user, {
                nav: nav(),
                upcoming: { events: [{ id: "evt1", title: "Gruul & Maggi", channelName: "gruul-run", startTime: 1893456000, sheet: null }], error: null },
            });
            expect(html).toContain("Upcoming Events");
            expect(html).toContain("Gruul &amp; Maggi");
            expect(html).toContain("href=\"/admin/raids/detail?event=evt1\"");
            // the event name no longer leaves the tool for raid-helper.xyz
            expect(html).not.toContain("raid-helper.xyz/raidplan/evt1");
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

    describe("renderDashboard — Latest Events", () => {
        const pastEvent = (over = {}) => ({
            id: "e1", title: "Kara", channelId: "c1", channelName: "kara-run",
            startTime: 1700000000, logs: [], lootCount: 0, softres: null, ...over,
        });
        const latest = (events, error = null) =>
            renderDashboard(user, { nav: nav(), recentEvents: { events, error } });

        it("renders the card with a link to the history page", () => {
            const html = latest([pastEvent()]);
            expect(html).toContain("Latest Events");
            expect(html).toContain("Historie &amp; Loot →");
            expect(html).toContain("href=\"/admin/history\"");
        });

        it("lists the event with its channel, Discord post and raidplan links", () => {
            const html = latest([pastEvent()]);
            expect(html).toContain("Kara");
            expect(html).toContain("#kara-run");
            expect(html).toContain("https://discord.com/channels/g1/c1/e1");
            expect(html).toContain("raid-helper.xyz/raidplan/e1");
        });

        it("links the event name to its admin detail page", () => {
            const html = latest([pastEvent()]);
            expect(html).toContain("href=\"/admin/raids/detail?event=e1\"");
        });

        it("url-encodes the event id in the detail link", () => {
            const html = latest([pastEvent({ id: "a b&c" })]);
            expect(html).toContain("href=\"/admin/raids/detail?event=a%20b%26c\"");
        });

        it("links every matched Warcraft-Log", () => {
            const html = latest([pastEvent({
                logs: [
                    { id: "l1", reportId: "abc123", title: "Kara 12.07.", link: "https://classic.warcraftlogs.com/reports/abc123", status: "open" },
                    { id: "l2", reportId: "def456", title: "", status: "open" },
                ],
            })]);
            expect(html).toContain("https://classic.warcraftlogs.com/reports/abc123");
            expect(html).toContain("Kara 12.07.");
            // no stored link -> derived from the report id, and the id is the label
            expect(html).toContain("https://classic.warcraftlogs.com/reports/def456");
            expect(html).toContain("def456");
        });

        it("links the CLA evaluation of an evaluated log", () => {
            const html = latest([pastEvent({
                logs: [{ id: "l1", reportId: "abc", title: "Kara", status: "done", reportRefId: "rep9" }],
            })]);
            expect(html).toContain("href=\"/r/rep9\"");
            expect(html).toContain("Auswertung");
        });

        it("does not offer an evaluation link for an unevaluated log", () => {
            // (plain "Auswertung" also appears in the reports card, so match the link)
            const html = latest([pastEvent({ logs: [{ id: "l1", reportId: "abc", status: "open", reportRefId: "rep9" }] })]);
            expect(html).not.toContain("href=\"/r/rep9\"");
        });

        it("shows a dash when no log could be matched", () => {
            expect(latest([pastEvent({ logs: [] })])).toContain(">—<");
        });

        it("links imported loot, or offers the import when there is none", () => {
            const withLoot = latest([pastEvent({ lootCount: 14 })]);
            expect(withLoot).toContain("/admin/history/event?event=e1");
            expect(withLoot).toContain("14 Items");

            const without = latest([pastEvent({ lootCount: 0 })]);
            expect(without).toContain("importieren");
            expect(without).not.toContain("/admin/history/event?event=e1");
        });

        it("links the soft-reserve list when one was created", () => {
            const html = latest([pastEvent({ softres: { url: "https://softres.it/raid/r1" } })]);
            expect(html).toContain("https://softres.it/raid/r1");
            expect(html).toContain("Softres");
            expect(latest([pastEvent()])).not.toContain("Softres");
        });

        it("shows an empty state and surfaces load errors", () => {
            expect(latest([])).toContain("Keine vergangenen Events gefunden");
            expect(latest([], "Raid-Helper kaputt")).toContain("Raid-Helper kaputt");
        });

        it("escapes event titles and log names", () => {
            const html = latest([pastEvent({
                title: "<img src=x>",
                logs: [{ id: "l1", reportId: "a", title: "<b>boom</b>", status: "open" }],
            })]);
            expect(html).toContain("&lt;img src=x&gt;");
            expect(html).toContain("&lt;b&gt;boom&lt;/b&gt;");
            expect(html).not.toContain("<img src=x>");
        });

        it("renders the card even without any recentEvents data", () => {
            expect(renderDashboard(user, { nav: nav() })).toContain("Latest Events");
        });
    });

    describe("renderRecruitment", () => {
        it("lists templates and escapes their names", () => {
            const html = renderRecruitment(user, {
                view: "templates",
                templates: [{ id: "t1", name: "<img src=x>", title: "T" }],
                channels: [{ id: "c1", name: "general" }],
                activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("&lt;img src=x&gt;");
            expect(html).not.toContain("<img src=x>");
            expect(html).toContain("Recruitment-Vorlagen");
        });

        it("prompts to pick a server before posting when none is active (posts tab)", () => {
            const html = renderRecruitment(user, { view: "posts", templates: [], activeGuildId: "", csrf: "x", nav: nav() });
            expect(html).toContain("Wähle oben einen Server");
        });

        it("renders sub-view tabs (Vorlagen / Nachrichten / Bewerbungen)", () => {
            const html = renderRecruitment(user, { templates: [], posts: [], activeGuildId: "g1", csrf: "x", nav: nav() });
            expect(html).toContain("class=\"subnav\"");
            expect(html).toContain("href=\"/admin/recruitment?view=templates\"");
            expect(html).toContain("href=\"/admin/recruitment?view=posts\"");
            expect(html).toContain("href=\"/admin/recruitment?view=applications\"");
            expect(html).toContain("Bewerbungen");
        });

        it("marks the requested sub-view active", () => {
            const html = renderRecruitment(user, { view: "posts", templates: [], posts: [], activeGuildId: "g1", csrf: "x", nav: nav() });
            expect(html).toContain("class=\"subnav-item active\" href=\"/admin/recruitment?view=posts\"");
        });

        it("editing a template forces the templates view regardless of ?view=", () => {
            const html = renderRecruitment(user, {
                view: "applications",
                editing: { id: "t1", name: "Heiler", title: "T", body: "", buttonLabel: "" },
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("Vorlage bearbeiten: Heiler");
            expect(html).toContain("Recruitment-Vorlagen");
        });

        it("hints to configure a channel on the applications tab when none is set", () => {
            const html = renderRecruitment(user, { view: "applications", templates: [], activeGuildId: "g1", csrf: "x", nav: nav() });
            expect(html).toContain("kein Bewerbungs-Channel konfiguriert");
            expect(html).toContain("/admin/settings");
        });

        it("shows an empty state when the channel is set but has no applications", () => {
            const html = renderRecruitment(user, {
                view: "applications", applicationChannelId: "app1", applications: [],
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("Noch keine Bewerbungen");
        });

        it("surfaces a fetch error on the applications tab", () => {
            const html = renderRecruitment(user, {
                view: "applications", applicationChannelId: "app1",
                applicationsError: "Bewerbungs-Channel nicht gefunden (ID prüfen).",
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("flash-err");
            expect(html).toContain("nicht gefunden");
        });

        it("lists applications with all details and escapes free text", () => {
            const html = renderRecruitment(user, {
                view: "applications", applicationChannelId: "app1",
                applications: [{
                    threadId: "111", name: "Feuer - Xyz", url: "https://discord.com/channels/g1/111",
                    createdAt: 2000, archived: false,
                    applicantId: "42", displayName: "Marcstz", character: "Xyz",
                    classSpec: "Magier – Feuer", armory: "https://armory/x",
                    wcl: "https://logs/x", description: "Hallo <script>", date: "25.07.2026",
                }],
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("class=\"app-name\">Xyz<");
            expect(html).toContain("Magier – Feuer");
            expect(html).toContain("https://discord.com/channels/g1/111");
            expect(html).toContain("href=\"https://armory/x\"");
            expect(html).toContain("href=\"https://logs/x\"");
            expect(html).toContain("Hallo &lt;script&gt;");
            expect(html).not.toContain("Hallo <script>");
            expect(html).toContain("25.07.2026");
        });

        it("marks archived applications with a badge", () => {
            const html = renderRecruitment(user, {
                view: "applications", applicationChannelId: "app1",
                applications: [{ threadId: "1", name: "Alt", url: "u", archived: true }],
                templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
            });
            expect(html).toContain("archiviert");
        });

        it("renders an emoji picker with the server's custom emojis in the template form", () => {
            const html = renderRecruitment(user, {
                view: "templates", templates: [], activeGuildId: "g1", csrf: "x", nav: nav(),
                emojis: [{ id: "1", name: "pepe", animated: false, code: "<:pepe:1>", url: "https://cdn/pepe.png" }],
            });
            expect(html).toContain("Emoji einfügen");
            expect(html).toContain("data-code=\"&lt;:pepe:1&gt;\"");
            expect(html).toContain("https://cdn/pepe.png");
        });

        it("omits the emoji picker when the server has no custom emojis", () => {
            const html = renderRecruitment(user, {
                view: "templates", templates: [], activeGuildId: "g1", csrf: "x", nav: nav(), emojis: [],
            });
            expect(html).not.toContain("Emoji einfügen");
        });

        it("defaults to the posts (\"Nachrichten\") view when no ?view= is given", () => {
            const html = renderRecruitment(user, { templates: [], posts: [], activeGuildId: "g1", csrf: "x", nav: nav() });
            expect(html).toContain("class=\"subnav-item active\" href=\"/admin/recruitment?view=posts\"");
            expect(html).toContain("Nachricht posten");
            expect(html).not.toContain("Recruitment-Vorlagen");
        });

        describe("renderRecruitmentFragment (AJAX save/navigation)", () => {
            it("renders the same content region as the full page, wrapped for the AJAX swap", () => {
                const opts = { view: "templates", templates: [{ id: "t1", name: "Heiler" }], csrf: "x" };
                const fragment = renderRecruitmentFragment(opts);
                expect(fragment).toContain("<div id=\"recruitment-view\">");
                expect(fragment).toContain("Recruitment-Vorlagen");
                expect(fragment).toContain("Heiler");
                // it's swapped into the surrounding admin shell, not a full document
                expect(fragment).not.toContain("<html");
                expect(fragment).not.toContain("class=\"side\"");
            });

            it("renders the post-edit form when editingPost is set", () => {
                const fragment = renderRecruitmentFragment({
                    editingPost: { id: "p1", channelName: "gen", content: "Hi", buttonLabel: "" }, csrf: "x",
                });
                expect(fragment).toContain("Gepostete Nachricht bearbeiten");
                expect(fragment).toContain("action=\"/admin/recruitment/post-update\"");
            });

            it("includes the fetch()-based submit handler so forms don't trigger a full page reload", () => {
                const fragment = renderRecruitmentFragment({ view: "posts", templates: [], posts: [] });
                expect(fragment).toContain("addEventListener(\"submit\"");
                expect(fragment).toContain("X-Requested-With");
            });
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

            describe("event assignment", () => {
                const withCandidates = (over = {}) => logPage({
                    items: [{
                        ...logPage().items[0],
                        candidates: [
                            { eventId: "e1", title: "SSC/TK", startTime: 1785088800, diffMs: 30 * 60 * 1000, categoryName: "Raids" },
                            { eventId: "e2", title: "Kara", startTime: 1785099600, diffMs: -2.5 * 3600 * 1000, categoryName: "Raids" },
                        ],
                        matchAmbiguous: false,
                        ...over,
                    }],
                });

                it("offers the matching events as a dropdown with the best guess preselected", () => {
                    const html = renderCla(user, { view: "logs", logPage: withCandidates(), logChannelIds: ["c1"], csrf: "x", nav: nav() });
                    expect(html).toContain("<th>Event</th>");
                    expect(html).toContain("action=\"/admin/cla/log-link\"");
                    expect(html).toContain("<option value=\"e1\" selected>");
                    expect(html).toContain("<option value=\"e2\">");
                    expect(html).toContain("30 min nach Start");
                    expect(html).toContain("2 h 30 min vor Start");
                    expect(html).toContain("Zuordnen");
                });

                it("warns when several events fit the log's post time", () => {
                    const html = renderCla(user, {
                        view: "logs", logPage: withCandidates({ matchAmbiguous: true }),
                        logChannelIds: ["c1"], csrf: "x", nav: nav(),
                    });
                    expect(html).toContain("mehrere Events passen");
                });

                it("shows an existing assignment with a remove button instead of the dropdown", () => {
                    const html = renderCla(user, {
                        view: "logs",
                        logPage: logPage({ items: [{ ...logPage().items[0], eventId: "e1", eventLabel: "SSC/TK", eventStartTime: 1785088800, eventLinkSource: "auto" }] }),
                        logChannelIds: ["c1"], csrf: "x", nav: nav(),
                    });
                    expect(html).toContain("action=\"/admin/cla/log-unlink\"");
                    expect(html).toContain("SSC/TK");
                    expect(html).toContain("automatisch zugeordnet");
                    expect(html).not.toContain("action=\"/admin/cla/log-link\"");
                });

                it("shows a dash when no event fits the log", () => {
                    const html = renderCla(user, {
                        view: "logs", logPage: logPage({ items: [{ ...logPage().items[0], candidates: [] }] }),
                        logChannelIds: ["c1"], csrf: "x", nav: nav(),
                    });
                    expect(html).toContain("Kein Event mit passender Startzeit");
                    expect(html).not.toContain("action=\"/admin/cla/log-link\"");
                });

                it("offers the bulk auto-assignment only when unassigned logs AND events exist", () => {
                    const opts = { view: "logs", logPage: withCandidates(), logChannelIds: ["c1"], csrf: "x", nav: nav() };
                    const withBoth = renderCla(user, { ...opts, unlinkedCount: 1, matchEvents: [{ id: "e1" }] });
                    expect(withBoth).toContain("action=\"/admin/cla/log-automatch\"");
                    expect(renderCla(user, { ...opts, unlinkedCount: 0, matchEvents: [{ id: "e1" }] }))
                        .not.toContain("action=\"/admin/cla/log-automatch\"");
                    expect(renderCla(user, { ...opts, unlinkedCount: 2, matchEvents: [] }))
                        .not.toContain("action=\"/admin/cla/log-automatch\"");
                });

                it("hints when the events for the assignment could not be loaded", () => {
                    const html = renderCla(user, {
                        view: "logs", logPage: withCandidates(), logChannelIds: ["c1"], csrf: "x", nav: nav(),
                        matchEventsError: "API down",
                    });
                    expect(html).toContain("konnten nicht geladen werden: API down");
                });
            });
        });
    });

    describe("formatMatchOffset", () => {
        it("labels the distance between the log post and the event start", () => {
            expect(formatMatchOffset(0)).toBe("pünktlich zum Start");
            expect(formatMatchOffset(25 * 60 * 1000)).toBe("25 min nach Start");
            expect(formatMatchOffset(-90 * 60 * 1000)).toBe("1 h 30 min vor Start");
            expect(formatMatchOffset(2 * 3600 * 1000)).toBe("2 h nach Start");
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
            // categories are rendered as tabs
            expect(html).toContain("class=\"tabs\"");
            expect(html).toContain("data-tab=\"cat-cat1-0\"");
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

        it("passes the event title and start time as hidden fields on the fill form (avoids a getAllEvents round-trip)", () => {
            const html = renderEventDetail(user, {
                ...base,
                event: { id: "e1", title: "GDKP Kara", startTime: 1721851200, channelId: "c1" },
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
            });
            expect(html).toContain("name=\"eventTitle\" value=\"GDKP Kara\"");
            expect(html).toContain("name=\"eventStartTime\" value=\"1721851200\"");
        });

        it("opts the long-running forms into the page loader", () => {
            const html = renderEventDetail(user, {
                ...base,
                notifyTemplates: [{ id: "t1", name: "Kara-Reminder" }],
                roles: [{ id: "r1", name: "Raider" }],
                raidsheets: [{ id: "t45", name: "Tier 4/5" }],
                softresCatalogue: [{ edition: "tbc", label: "TBC", instances: [{ code: "kara", name: "Karazhan" }] }],
            });
            // softres create + sheet fill carry a data-loader with a label
            expect(html).toMatch(/action="\/admin\/raids\/softres"[^>]*data-loader="Softres wird erstellt"/);
            expect(html).toMatch(/action="\/admin\/raids\/fill"[^>]*data-loader=/);
        });

        it("guides the user when there are no templates or sheets", () => {
            const html = renderEventDetail(user, { ...base, notifyTemplates: [], roles: [], raidsheets: [] });
            expect(html).toContain("Noch keine Aufruf-Vorlagen");
            expect(html).toContain("Keine Raidsheets konfiguriert");
        });

        it("shows an eventsWarning banner when the event data came from a stale/persisted fallback", () => {
            const html = renderEventDetail(user, { ...base, eventsWarning: "Raid-Helper down" });
            expect(html).toContain("<div class=\"flash flash-err\">Raid-Helper down</div>");
        });

        it("shows no banner when there is no eventsWarning", () => {
            const html = renderEventDetail(user, base);
            expect(html).not.toContain("flash-err\">Raid-Helper");
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

        it("shows a class/spec icon and colour for attendance members with a known profile", () => {
            const html = renderEventDetail(user, {
                ...base,
                attendanceRoleIds: ["r1"],
                attendance: {
                    responded: [{ id: "1", displayName: "Alice" }],
                    missing: [{
                        id: "2",
                        displayName: "Bob",
                        profile: { specName: "Fury Warrior", className: "Warrior", classColor: "#C79C6E", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/ability_warrior_innerrage.jpg" },
                    }],
                },
            });
            expect(html).toContain("ability_warrior_innerrage.jpg");
            expect(html).toContain("border-left-color:#C79C6E");
            expect(html).toContain("title=\"Fury Warrior\"");
            // member without a known profile still renders as a plain chip
            expect(html).toContain("<span class=\"rolebox\">Alice</span>");
        });

        it("shows an overview stats row with a signup counter next to the header buttons", () => {
            const html = renderEventDetail(user, {
                ...base,
                event: { ...base.event, signupCount: 18 },
                signupTarget: 25,
                attendanceRoleIds: ["r1"],
                attendance: { responded: [{ id: "1", displayName: "Alice" }], missing: [{ id: "2", displayName: "Bob" }] },
                eventSoftres: { url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/t1", instances: ["ssc", "tempestkeep"] },
                setup: { total: 20, groups: [], roleCounts: {} },
            });
            expect(html).toContain("setup-summary");
            expect(html).toContain(">18 / 25</b> Anmeldungen");
            expect(html).toContain(">20</b> im Setup");
            expect(html).toContain(">1</b> fehlt");
            expect(html).toContain(">2</b> Softres-Instanz(en)");
        });

        it("shows only the signup count (no target) when neither softres nor attendance roles are known", () => {
            const html = renderEventDetail(user, { ...base, event: { ...base.event, signupCount: 4 } });
            expect(html).toContain(">4</b> Anmeldungen");
            expect(html).not.toContain(">4 / ");
            expect(html).not.toContain("im Setup");
            expect(html).not.toContain("Softres-Instanz(en)");
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

        // --- header quick-action buttons (open/post sheet & softres) ---
        const tbcCatalogue = [{ edition: "tbc", label: "The Burning Crusade", instances: [{ code: "kara", name: "Karazhan" }, { code: "gruul", name: "Gruul's Lair" }] }];

        it("shows a 'Softres erstellen' button in the header when no softres exists", () => {
            const html = renderEventDetail(user, { ...base, softresCatalogue: tbcCatalogue, softresSuggested: [] });
            expect(html).toContain("Softres erstellen");
            expect(html).not.toContain("action=\"/admin/raids/post-softres\"");
        });

        it("shows 'Sheet posten', 'Softres öffnen' and 'Softres posten' in the header when both exist", () => {
            const html = renderEventDetail(user, {
                ...base,
                softresCatalogue: tbcCatalogue,
                eventSheet: { eventId: "e1", url: "https://docs.google.com/x" },
                eventSoftres: { url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/t1", amount: 2, instances: ["kara"] },
            });
            expect(html).toContain("action=\"/admin/raids/post-sheet\"");
            expect(html).toContain("📤 Sheet posten");
            expect(html).toContain("Softres öffnen");
            expect(html).toContain("action=\"/admin/raids/post-softres\"");
            expect(html).toContain("📤 Softres posten");
            expect(html).not.toContain("Softres erstellen");
        });

        it("offers a manual-link form to point at a different softres.it list", () => {
            const noneYet = renderEventDetail(user, { ...base, softresCatalogue: tbcCatalogue, softresSuggested: [] });
            expect(noneYet).toContain("Schon eine Liste auf softres.it? Link manuell hinterlegen");
            expect(noneYet).toContain("action=\"/admin/raids/softres/link\"");
            expect(noneYet).toContain("name=\"softresUrl\"");

            const withExisting = renderEventDetail(user, {
                ...base,
                softresCatalogue: tbcCatalogue,
                eventSoftres: { url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/t1", amount: 2, instances: ["kara"] },
            });
            expect(withExisting).toContain("Anderen Softres-Link verwenden");
            expect(withExisting).toContain("value=\"https://softres.it/raid/r1\"");
            expect(withExisting).toContain("value=\"https://softres.it/raid/r1/t1\"");
        });

        it("preselects Horde and offers only TBC instances in the softres form", () => {
            const html = renderEventDetail(user, { ...base, softresCatalogue: tbcCatalogue, softresSuggested: ["kara"] });
            expect(html).toContain("value=\"Horde\" selected");
            expect(html).toContain("name=\"inst_kara\"");
            expect(html).not.toContain("name=\"inst_mc\"");
            // suggested instance pre-checked
            expect(html).toContain("name=\"inst_kara\" value=\"1\" data-edition=\"tbc\" class=\"softres-inst\" checked");
        });

        it("gives the HR item dropdown a solid (defined) background, not the undefined --card var", () => {
            const html = renderEventDetail(user, { ...base, softresCatalogue: tbcCatalogue });
            expect(html).toContain("id=\"hrResults\"");
            expect(html).toContain("background:var(--panel)");
            expect(html).not.toContain("var(--card)");
        });

        it("lists logs already assigned to this raid, with Auswerten/unlink actions", () => {
            const html = renderEventDetail(user, {
                ...base,
                eventLogs: [
                    { id: "l1", title: "Kara Woche 3", reportId: "RPT1", link: "https://classic.warcraftlogs.com/reports/RPT1", status: "open" },
                    { id: "l2", title: "Kara Woche 2", reportId: "RPT2", status: "done", reportUrl: "/r/abc" },
                ],
            });
            expect(html).toContain("Kara Woche 3");
            expect(html).toContain("https://classic.warcraftlogs.com/reports/RPT1");
            expect(html).toContain("action=\"/admin/cla/eval\"");
            expect(html).toContain("name=\"logId\" value=\"l1\"");
            expect(html).toContain("Kara Woche 2");
            expect(html).toContain("href=\"/r/abc\"");
            // both rows offer an unlink form scoped back to this event
            expect(html).toContain("action=\"/admin/cla/log-unlink\"");
            expect(html).toContain("name=\"event\" value=\"e1\"");
            expect(html).toContain("name=\"returnTo\" value=\"event\"");
            expect(html).toContain("data-tab=\"logs\"");
            expect(html).toContain(">Logs<span class=\"tab-count\">2</span>");
        });

        it("shows the empty state and no tab count when no log is assigned yet", () => {
            const html = renderEventDetail(user, { ...base, eventLogs: [] });
            expect(html).toContain("Für dieses Event ist noch kein Log zugeordnet.");
            expect(html).toContain(">Logs</button>");
        });

        it("offers a picker to assign a still-unassigned detected log to this raid", () => {
            const html = renderEventDetail(user, {
                ...base,
                unlinkedLogs: [{ id: "l3", title: "SSC Woche 1", reportId: "RPT3" }],
            });
            expect(html).toContain("action=\"/admin/cla/log-link\"");
            expect(html).toContain("name=\"eventId\" value=\"e1\"");
            expect(html).toContain("<option value=\"l3\">SSC Woche 1</option>");
            expect(html).toContain("Log zuordnen");
        });

        it("shows a hint instead of the picker when there is nothing left to assign", () => {
            const html = renderEventDetail(user, { ...base, unlinkedLogs: [] });
            expect(html).toContain("Keine noch nicht zugeordneten Logs vorhanden.");
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

        describe("Loot tab", () => {
            it("renders a Loot tab with an import form bound to this event", () => {
                const html = renderEventDetail(user, base);
                expect(html).toContain("data-tab=\"loot\"");
                expect(html).toContain("data-panel=\"loot\"");
                expect(html).toContain("action=\"/admin/history/import\"");
                expect(html).toContain("name=\"event\" value=\"e1\"");
                expect(html).toContain("name=\"origin\" value=\"raid\"");
            });

            it("preselects the loot tool from the category setting", () => {
                const html = renderEventDetail(user, { ...base, lootTool: "gargul" });
                expect(html).toMatch(/<option value="gargul" selected>Gargul<\/option>/);
            });

            it("defaults to auto-detection when no category tool is set", () => {
                const html = renderEventDetail(user, base);
                expect(html).toMatch(/<option value="auto" selected>Auto-Erkennung<\/option>/);
            });

            it("shows no existing-loot card and an unbadged tab when nothing was imported yet", () => {
                const html = renderEventDetail(user, { ...base, lootItems: [] });
                expect(html).not.toContain("<h3>Bereits importiert</h3>");
                expect(html).toContain(">Loot</button>");
            });

            it("lists already-imported loot with a count badge and a delete action", () => {
                const html = renderEventDetail(user, {
                    ...base,
                    lootItems: [
                        { id: "i1", itemName: "Band of Sulfuras", character: "Tankadin", response: "Main Spec", boss: "Nightbane", awardedAt: 1721851200000, source: "gargul" },
                    ],
                });
                expect(html).toContain("Bereits importiert");
                expect(html).toContain("Band of Sulfuras");
                expect(html).toContain("Tankadin");
                expect(html).toContain("tab-count\">1<");
                expect(html).toContain("action=\"/admin/history/clear\"");
                // the clear form must also carry the raid-detail origin so it redirects back here
                expect(html).toMatch(/action="\/admin\/history\/clear"[\s\S]*?name="origin" value="raid"/);
            });

            it("escapes item and character names in the existing-loot table", () => {
                const html = renderEventDetail(user, {
                    ...base,
                    lootItems: [{ id: "i1", itemName: "<b>x</b>", character: "<i>y</i>", response: "Main Spec", awardedAt: 1721851200000, source: "gargul" }],
                });
                expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
                expect(html).not.toContain("<b>x</b>");
            });
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

        it("prefills Battle.net client id / region / realm but never echoes the secret", () => {
            const html = renderSettings(user, {
                config: {
                    adminRoleIds: [], raidDefaults: {},
                    blizzard: { clientId: "abc123", clientSecret: "topsecret", region: "eu", realmSlug: "thunderstrike" },
                },
                csrf: "x", nav: nav(),
            });
            expect(html).toContain("Battle.net Client-ID");
            expect(html).toContain("value=\"abc123\"");
            expect(html).toContain("value=\"thunderstrike\"");
            // the secret value must NOT appear anywhere in the HTML
            expect(html).not.toContain("topsecret");
            // the password field signals that a secret is stored
            expect(html).toContain("gespeichert");
        });
    });

    describe("renderHistory", () => {
        const loot = (over = {}) => ({ character: "Foo", characterKey: "foo", itemId: 1, itemName: "X", offspec: false, source: "rclc", awardedAt: 1000, ...over });
        it("renders the import panel, category marking, loot list, logs and characters", () => {
            const html = renderHistory(user, {
                csrf: "x", nav: nav(), activeGuildId: "g1",
                events: [{ id: "e1", title: "SSC", startTime: 1893456000, categoryId: "cat1" }],
                categories: [{ id: "cat1", name: "PUG Raids" }],
                categoryLootTool: { cat1: "rclc" },
                lootEvents: [{ eventId: "e1", label: "SSC", count: 5, sources: ["rclc"], awardedAt: 1000, importedAt: 2000 }],
                logs: [{ reportId: "RPT1", title: "Kara", link: "https://classic.warcraftlogs.com/reports/RPT1" }],
                chars: [{ character: "Foo", count: 3 }],
            });
            expect(html).toContain("action=\"/admin/history/import\"");
            expect(html).toContain("Loot-Tool je Kategorie");
            expect(html).toContain("PUG Raids");
            // category's stored tool preselected
            expect(html).toContain("<option value=\"rclc\" selected>RCLootcouncil</option>");
            expect(html).toContain("/admin/history/event?event=e1");
            expect(html).toContain("classic.warcraftlogs.com/reports/RPT1");
            expect(html).toContain("/admin/history/char?name=Foo");
            // file-into-textarea upload hook
            expect(html).toContain("readAsText");
            // sections are organized as tabs
            expect(html).toContain("data-tab=\"import\"");
            expect(html).toContain("data-panel=\"chars\"");
        });

        it("defaults the event picker to automatic date-matching", () => {
            const html = renderHistory(user, { csrf: "x", nav: nav() });
            expect(html).toContain("<option value=\"__auto__\" data-tool=\"\" selected>— Automatisch anhand des Datums im Export zuordnen —</option>");
            expect(html).toContain("<option value=\"__manual__\" data-tool=\"\">— Anderes / vergangenes Event (manuell benennen) —</option>");
        });

        it("shows empty states when there is no data", () => {
            const html = renderHistory(user, { csrf: "x", nav: nav() });
            expect(html).toContain("Noch kein Loot importiert");
        });

        describe("character list with class/spec", () => {
            const chars = (over = {}) => [{
                key: "gemli", character: "Gemli", count: 6,
                className: "Warrior", spec: "Fury", source: "wcl", ...over,
            }];

            it("shows class and spec as one labelled cell with the spec icon", () => {
                const html = renderHistory(user, { csrf: "x", nav: nav(), chars: chars() });
                expect(html).toContain("<th>Klasse &amp; Spec</th>");
                expect(html).toContain("Fury Warrior");
                // no separate class/spec columns anymore
                expect(html).not.toContain("<th>Spec</th>");
                // fury spec icon from the shared icon table
                expect(html).toContain("ability_warrior_innerrage.jpg");
                expect(html).toContain("<span class=\"lbadge\">Warcraft Log</span>"); // source badge
                // class colour (Warrior) on the name and the class cell
                expect(html).toContain("#C79C6E");
                expect(html).toContain("/admin/history/char?name=Gemli");
            });

            it("falls back to the plain class (with class icon) when the spec is unknown", () => {
                const html = renderHistory(user, { csrf: "x", nav: nav(), chars: chars({ spec: "" }) });
                expect(html).toContain(">Warrior<");
                expect(html).toContain("classicon_warrior.jpg");
                expect(html).not.toContain("ability_warrior_innerrage.jpg");
            });

            it("marks an unknown class/spec instead of inventing one", () => {
                const html = renderHistory(user, {
                    csrf: "x", nav: nav(), chars: chars({ className: "", spec: "", source: "" }),
                });
                expect(html).toContain("Gemli");
                // (the "Warcraft Logs" tab label also contains that text — match the badge)
                expect(html).not.toContain("<span class=\"lbadge\">Warcraft Log</span>");
                expect(html).not.toContain("#C79C6E");
                expect(html).not.toContain("classicon_warrior.jpg");
            });

            it("offers the resolve button with the number of open characters", () => {
                const html = renderHistory(user, {
                    csrf: "x", nav: nav(),
                    chars: [...chars(), { key: "nwek", character: "Nwek", count: 2, className: "", spec: "", source: "" }],
                });
                expect(html).toContain("action=\"/admin/history/characters-resolve\"");
                expect(html).toContain("(1 offen)");
            });

            it("hides the resolve button when there are no characters at all", () => {
                const html = renderHistory(user, { csrf: "x", nav: nav(), chars: [] });
                expect(html).not.toContain("action=\"/admin/history/characters-resolve\"");
                expect(html).toContain("Noch keine Charaktere mit Loot");
            });
        });

        describe("renderHistoryChar header", () => {
            it("shows the known spec and class next to the name", () => {
                const html = renderHistoryChar(user, {
                    csrf: "x", nav: nav(), character: "Keslight", items: [],
                    info: { className: "Paladin", spec: "Holy", source: "wcl" },
                });
                expect(html).toContain("· <img");
                expect(html).toContain("Holy Paladin");
                expect(html).toContain("spell_holy_holybolt.jpg"); // holy paladin spec icon
                expect(html).toContain("#F58CBA"); // paladin colour
            });

            it("falls back to the plain class, and to nothing at all when unknown", () => {
                const classOnly = renderHistoryChar(user, {
                    csrf: "x", nav: nav(), character: "Gemli", items: [], info: { className: "Warrior", spec: "" },
                });
                expect(classOnly).toContain("classicon_warrior.jpg");
                expect(classOnly).toContain(">Warrior</span>");
                const unknown = renderHistoryChar(user, { csrf: "x", nav: nav(), character: "Gemli", items: [] });
                expect(unknown).not.toContain("classicon_warrior.jpg");
                expect(unknown).not.toContain(">Warrior</span>");
            });
        });

        it("shows an 'Alle Raids' tab, active by default, listing upcoming and past raids", () => {
            const html = renderHistory(user, {
                csrf: "x", nav: nav(), activeGuildId: "g1",
                upcomingRaids: {
                    events: [{ id: "e1", title: "SSC/TK", startTime: 1893456000, channelId: "c1", channelName: "ssc-tk", logs: [], lootCount: 0, softres: null }],
                    error: null,
                },
                pastRaids: {
                    events: [{ id: "e0", title: "Kara letzte Woche", startTime: 1700000000, channelId: "c2", channelName: "kara", logs: [], lootCount: 3, softres: null }],
                    error: null,
                },
            });
            // first tab, active by default
            expect(html).toMatch(/<button type="button" class="tab-btn active" data-tab="raids"/);
            expect(html).toContain("data-panel=\"raids\"");
            expect(html).toContain("Kommende Raids");
            expect(html).toContain("Vergangene Raids");
            // Details link (event name -> detail page)
            expect(html).toContain("href=\"/admin/raids/detail?event=e1\"");
            expect(html).toContain("href=\"/admin/raids/detail?event=e0\"");
            // Loot link
            expect(html).toContain("/admin/history/event?event=e0");
            expect(html).toContain("3 Items");
        });

        it("surfaces load errors and empty states separately for upcoming vs. past raids", () => {
            const html = renderHistory(user, {
                csrf: "x", nav: nav(),
                upcomingRaids: { events: [], error: "Raid-Helper kaputt" },
                pastRaids: { events: [], error: null },
            });
            expect(html).toContain("Raid-Helper kaputt");
            expect(html).toContain("Keine vergangenen Raids gefunden.");
        });

        it("escapes a malicious event title in the import picker", () => {
            const html = renderHistory(user, {
                csrf: "x", nav: nav(),
                events: [{ id: "e1", title: "<img src=x>", startTime: 0, categoryId: "" }],
            });
            expect(html).toContain("&lt;img src=x&gt;");
            expect(html).not.toContain("<img src=x>");
        });

        it("renders a loot table with wowhead links and char links (event view)", () => {
            const html = renderHistoryEvent(user, {
                eventId: "e1", label: "SSC", csrf: "x", nav: nav(),
                items: [loot({ itemId: 29920, itemName: "Phoenix-Ring", itemLink: "https://www.wowhead.com/tbc/item=29920", boss: "Vashj" })],
            });
            expect(html).toContain("wowhead.com/tbc/item=29920");
            expect(html).toContain("/admin/history/char?name=Foo");
            expect(html).toContain("Loot löschen");
            // Wowhead icons enabled on item pages
            expect(html).toContain("iconizeLinks:true");
        });
    });

    describe("renderHistoryChar", () => {
        it("shows armory/WCL links and the loot table, hints to configure gear when unavailable", () => {
            const html = renderHistoryChar(user, {
                character: "Foo", realm: "Thunderstrike", csrf: "x", nav: nav(),
                armoryUrl: "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/Foo",
                wclUrl: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/Foo",
                gear: null, gearConfigured: false,
                items: [{ character: "Foo", itemId: 1, itemName: "X", offspec: true, response: "Off Spec", source: "gargul", awardedAt: 1000 }],
            });
            expect(html).toContain("classic-armory.org");
            expect(html).toContain("fresh.warcraftlogs.com");
            expect(html).toContain("Battle.net-Zugang");
            expect(html).toContain("Off Spec");
        });

        it("renders the live gear paperdoll with enchants, gems and empty sockets", () => {
            const html = renderHistoryChar(user, {
                character: "Foo", csrf: "x", nav: nav(), items: [],
                gearConfigured: true,
                gear: [{
                    slot: "HEAD", itemId: 29011, name: "Cursed Vision", quality: "EPIC", level: 120,
                    enchants: ["Enchanted: +150 Mana"], gems: ["Chaotic Skyfire Diamond"], emptySockets: 1,
                }],
            });
            expect(html).toContain("Aktuelles Gear (Paperdoll)");
            expect(html).toContain("Cursed Vision");
            expect(html).toContain("wowhead.com/tbc/item=29011");
            expect(html).toContain("Verzauberung");
            expect(html).toContain("Enchanted: +150 Mana");
            expect(html).toContain("Chaotic Skyfire Diamond");
            expect(html).toContain("1 leer");
        });

        it("organizes gear/loot as tabs and offers a manual paperdoll reload", () => {
            const html = renderHistoryChar(user, {
                character: "Foo", csrf: "x", nav: nav(), items: [],
                gearConfigured: true, gear: null,
            });
            expect(html).toContain("data-tab=\"gear\"");
            expect(html).toContain("data-tab=\"loot\"");
            expect(html).toContain("Paperdoll neu laden");
            expect(html).toContain("/admin/history/char?name=Foo");
        });

        it("surfaces the gear error reason when the Blizzard lookup failed", () => {
            const html = renderHistoryChar(user, {
                character: "Ghost", csrf: "x", nav: nav(), items: [],
                gearConfigured: true, gear: null,
                gearError: "Charakter „Ghost\" nicht in der Blizzard-API gefunden (404).",
            });
            expect(html).toContain("flash-err");
            expect(html).toContain("nicht in der Blizzard-API gefunden (404)");
        });

        it("shows the character summary + queried namespace for diagnostics", () => {
            const html = renderHistoryChar(user, {
                character: "Foo", csrf: "x", nav: nav(), items: [],
                gearConfigured: true, gear: [{ slot: "HEAD", itemId: 1, name: "Hat" }],
                gearNamespace: "profile-classic-eu",
                charSummary: { level: 70, itemLevel: 115, realm: "Thunderstrike", className: "Shaman", lastLogin: 1784574268000 },
            });
            expect(html).toContain("Level 70");
            expect(html).toContain("Thunderstrike");
            expect(html).toContain("profile-classic-eu");
            expect(html).toContain("zuletzt online");
        });

        it("warns when the summary level is not 70 (likely wrong namespace/char)", () => {
            const html = renderHistoryChar(user, {
                character: "Foo", csrf: "x", nav: nav(), items: [],
                gearConfigured: true, gear: null, gearNamespace: "profile-classic-eu",
                charSummary: { level: 80, realm: "Thunderstrike" },
            });
            expect(html).toContain("Level 80");
            expect(html).toContain("wahrscheinlich der falsche Namespace");
        });
    });

    describe("fillCharTemplate", () => {
        it("substitutes and url-encodes the character name", () => {
            expect(fillCharTemplate("https://a/{char}", "Naphfß")).toBe("https://a/Naphf%C3%9F");
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

    // Regression: the container runs in UTC (no TZ in the image), so the time
    // formatters MUST pin Europe/Berlin explicitly or raid times show 2h early
    // in summer. These assertions hold regardless of the host's own timezone.
    describe("time formatting is pinned to Europe/Berlin", () => {
        it("formatEventTime renders a summer (CEST, +2) event in Berlin time", () => {
            const secs = Date.UTC(2024, 6, 1, 18, 0, 0) / 1000; // 2024-07-01 18:00 UTC → 20:00 CEST
            const out = formatEventTime(secs);
            expect(out).toContain("20:00");
            expect(out).toContain("01.07");
        });

        it("formatEventTime renders a winter (CET, +1) event in Berlin time", () => {
            const secs = Date.UTC(2024, 0, 1, 19, 0, 0) / 1000; // 2024-01-01 19:00 UTC → 20:00 CET
            const out = formatEventTime(secs);
            expect(out).toContain("20:00");
            expect(out).toContain("01.01");
        });

        it("formatEventTime returns empty for a falsy timestamp", () => {
            expect(formatEventTime(0)).toBe("");
            expect(formatEventTime(null)).toBe("");
        });

        it("fmtMs renders an epoch-ms timestamp in Berlin time with date", () => {
            const ms = Date.UTC(2024, 6, 1, 18, 0, 0); // → 20:00 CEST, 01.07.2024
            const out = fmtMs(ms);
            expect(out).toContain("20:00");
            expect(out).toContain("01.07.2024");
        });

        it("fmtMs without time renders date only", () => {
            const ms = Date.UTC(2024, 6, 1, 18, 0, 0);
            const out = fmtMs(ms, false);
            expect(out).toContain("01.07.2024");
            expect(out).not.toContain("20:00");
        });
    });
});
