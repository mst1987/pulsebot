const http = require("http");
const crypto = require("crypto");
const { webPort, applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../config/variables");
const { getReport, deleteReport, listReports } = require("./reportStore");
const { prepareReportList, prepareLogList, annotateLogCategories } = require("./reportList");
const { renderReportPage, renderPlayerPage, renderNotFound, renderError } = require("./render");
const {
    renderDashboard, renderAdminDenied, renderRecruitment, renderCla,
    renderRaids, renderRaidCreate, renderEventDetail, renderNotifyTemplates,
    renderChannels, renderSettings,
    renderHistory, renderHistoryEvent, renderHistoryChar, fillCharTemplate,
} = require("./renderAdmin");
const {
    addImport: addLootImport, listByEvent: listLootByEvent,
    listByCharacter: listLootByCharacter, eventsWithLoot, characters: lootCharacters,
    clearEvent: clearLootEvent,
} = require("./lootStore");
const { parseLoot, LootParseError } = require("../utils/lootImport");
const Blizzard = require("../classes/blizzard");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    listRaidTemplates, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig,
} = require("./settingsStore");
const { buildReport, ReportError } = require("../utils/logcheck/report");
const { listLogs, deleteLog } = require("./logStore");
const { evaluateLog, scanLogChannels, backfillLogTitles } = require("./logChannel");
const { getEventSheet, markEventSheetFilled } = require("./eventSheetStore");
const { getEventSoftres, saveEventSoftres } = require("./eventSoftresStore");
const softres = require("../utils/softres");
const wowhead = require("../utils/wowhead");
const Raidhelper = require("../classes/raidhelper");
const SheetsClient = require("../classes/sheets");
const Drive = require("../classes/drive");
const { fillSetupSheet } = require("../utils/fillSetup");
const { matchRaidsheet } = require("../utils/raidsheets");
const { buildSetupView, tankCandidates } = require("../utils/setupView");
const { computeAttendance } = require("../utils/attendance");
const { toRaidHelperDate, formatTimestampToDateString } = require("../utils/date");
const { startSheetCleanup } = require("../utils/sheetCleanup");
const discord = require("./discord");
const auth = require("./auth");

// Map a ?msg= query flag (set on post-redirect-get) to a flash object for the UI.
const FLASH = {
    saved: { type: "ok", text: "Gespeichert." },
    deleted: { type: "ok", text: "Gelöscht." },
    csrf: { type: "err", text: "Sicherheits-Token ungültig oder abgelaufen. Bitte erneut versuchen." },
};
function flashFromQuery(url) {
    if (url.searchParams.has("err")) return { type: "err", text: url.searchParams.get("err") };
    if (url.searchParams.has("ok")) return { type: "ok", text: url.searchParams.get("ok") };
    return FLASH[url.searchParams.get("msg")] || null;
}

// The server the admin is managing: explicit selection, else the bot's only guild.
function activeGuildFor(req) {
    const selected = auth.getActiveGuild(req);
    if (selected) return selected;
    const guilds = discord.listGuilds();
    return guilds.length === 1 ? guilds[0].id : "";
}

// Fetch all upcoming Raid-Helper events for a guild and group them by the
// Discord category their channel lives in. Returns { groups, error }.
async function loadEventGroups(guildId) {
    if (!guildId) return { groups: [], error: null };
    try {
        const rh = new Raidhelper();
        const events = await rh.getAllEvents();
        const catMap = discord.getChannelCategoryMap(guildId);
        const byCat = new Map();
        for (const ev of events) {
            const meta = catMap[ev.channelId];
            if (!meta) continue; // event channel not in this guild
            const key = meta.categoryId || "__none__";
            if (!byCat.has(key)) {
                byCat.set(key, { categoryId: meta.categoryId || "", categoryName: meta.categoryName || "Ohne Kategorie", events: [] });
            }
            byCat.get(key).events.push({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                leaderId: ev.leaderId,
                channelId: ev.channelId,
                channelName: meta.name,
                categoryId: meta.categoryId || "",
                templateId: (ev.templateId !== null && ev.templateId !== undefined) ? String(ev.templateId) : "",
                description: ev.description || "",
                signupCount: (ev.signUps || []).filter((s) => s.specName !== "Absence").length,
                signUps: (ev.signUps || []).map((s) => ({ userId: s.userId, specName: s.specName })),
            });
        }
        const groups = [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        return { groups, error: null };
    } catch (e) {
        return { groups: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

// Find the next few upcoming events that already have a Raid-Helper setup
// (raidplan) built, annotated with whether their sheet was filled via the admin
// tool. Events without a setup are skipped. `getSetup` is one HTTP call per
// event, so `maxChecks` caps how deep we probe to keep the dashboard snappy.
async function loadUpcomingSetups(guildId, limit = 3, maxChecks = 8) {
    if (!guildId) return { events: [], error: null };
    try {
        const rh = new Raidhelper();
        const events = await rh.getAllEvents(); // sorted ascending by startTime
        const catMap = discord.getChannelCategoryMap(guildId);
        const inGuild = events.filter((ev) => catMap[ev.channelId]);
        const out = [];
        let checked = 0;
        for (const ev of inGuild) {
            if (out.length >= limit || checked >= maxChecks) break;
            checked += 1;
            const result = await rh.getSetup(ev.id);
            if (!result || !result.setup || !result.setup.length) continue;
            const meta = catMap[ev.channelId] || {};
            out.push({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                channelId: ev.channelId,
                channelName: meta.name || "",
                signupCount: (ev.signUps || []).filter((s) => s.specName !== "Absence").length,
                playerCount: result.setup.filter((s) => s && s.name).length,
                sheet: getEventSheet(ev.id),
            });
        }
        return { events: out, error: null };
    } catch (e) {
        return { events: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

// Context for the server selector shown on every admin page.
function navFor(req) {
    return {
        guilds: discord.listGuilds(),
        activeGuildId: activeGuildFor(req),
        csrf: auth.csrfToken(req),
    };
}

function send(res, status, html, headers = {}) {
    res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...headers,
    });
    res.end(html);
}

function redirect(res, location, headers = {}) {
    res.writeHead(302, { Location: location, ...headers });
    res.end();
}

// Read and parse an application/x-www-form-urlencoded request body (capped).
function readFormBody(req) {
    return new Promise((resolve) => {
        let data = "";
        let tooBig = false;
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1e6) { tooBig = true; req.destroy(); }
        });
        req.on("end", () => {
            if (tooBig) return resolve({});
            try {
                resolve(Object.fromEntries(new URLSearchParams(data)));
            } catch {
                resolve({});
            }
        });
        req.on("error", () => resolve({}));
    });
}

// Resolve the admin user for a request, or send the denied page and return null.
function requireAdmin(req, res) {
    const user = auth.getUser(req);
    if (!user || !user.isAdmin) {
        send(res, user ? 403 : 401, renderAdminDenied(user));
        return null;
    }
    return user;
}

// pending OAuth states (csrf) -> expiry
const states = new Map();

async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    let pathname = "/";
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/"; }

    // --- auth routes ---
    if (pathname === "/auth/login" && req.method === "GET") {
        if (!auth.configured()) return send(res, 503, renderNotFound());
        const state = crypto.randomBytes(12).toString("hex");
        states.set(state, Date.now() + 600000);
        return redirect(res, auth.loginUrl(state));
    }
    if (pathname === "/auth/callback" && req.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        if (err) return send(res, 400, renderError("Login abgebrochen", `Discord meldete: ${err}`));
        if (!code) return send(res, 400, renderError("Login fehlgeschlagen", "Kein Autorisierungscode von Discord erhalten."));
        // state is CSRF protection; if it's unknown (e.g. the bot restarted) just warn and proceed
        if (state && !states.has(state)) console.warn("OAuth state not found (process restart?) — proceeding anyway");
        if (state) states.delete(state);
        try {
            const sid = await auth.completeLogin(code);
            return redirect(res, "/", { "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
        } catch (e) {
            const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
            console.error("OAuth callback failed:", detail);
            return send(res, 500, renderError("Login fehlgeschlagen", `Token-Austausch mit Discord fehlgeschlagen: ${detail}`));
        }
    }
    if (pathname === "/auth/logout" && req.method === "GET") {
        auth.destroy(auth.parseCookies(req).sid);
        return redirect(res, "/", { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
    }

    // --- delete (admins only) ---
    const dm = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/?$/);
    if (dm && req.method === "DELETE") {
        const user = auth.getUser(req);
        if (!user || !user.isAdmin) { res.writeHead(403); return res.end("forbidden"); }
        const ok = deleteReport(dm[1]);
        res.writeHead(ok ? 200 : 404);
        return res.end(ok ? "ok" : "not found");
    }

    // --- admin menu ---
    // /admin is an alias of the dashboard, which lives at the site root.
    if (pathname === "/admin" && req.method === "GET") {
        return redirect(res, "/");
    }

    // switch the active server (from the server selector); returns to the referring page
    if (pathname === "/admin/server" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin?msg=csrf");
        auth.setActiveGuild(req, (form.guildId || "").trim());
        const back = req.headers.referer && req.headers.referer.includes("/admin") ? req.headers.referer : "/admin";
        return redirect(res, back);
    }

    // recruitment: templates + posting + managing posted messages
    if (pathname === "/admin/recruitment") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const guildId = activeGuildFor(req);
            const editId = url.searchParams.get("edit");
            const editPostId = url.searchParams.get("editpost");
            const view = url.searchParams.get("view") || "";
            const { applicationChannelId } = getConfig();
            // Applications live as Discord threads — only fetch them when their tab
            // is open (the fetch hits Discord and shouldn't run on every page view).
            let applications;
            let applicationsError = null;
            if (view === "applications" && !editId && !editPostId) {
                const res2 = await discord.listApplications(applicationChannelId);
                applications = res2.applications;
                applicationsError = res2.error;
            }
            return send(res, 200, renderRecruitment(user, {
                view,
                templates: listRecruitment(),
                editing: editId ? getRecruitment(editId) : null,
                editingPost: editPostId ? getRecruitmentPost(editPostId) : null,
                posts: guildId ? listRecruitmentPosts().filter((p) => p.guildId === guildId) : listRecruitmentPosts(),
                channels: discord.listTextChannels(guildId),
                emojis: discord.listEmojis(guildId),
                applications,
                applicationsError,
                applicationChannelId,
                activeGuildId: guildId,
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
            saveRecruitment(form);
            return redirect(res, "/admin/recruitment?msg=saved");
        }
    }
    if (pathname === "/admin/recruitment/delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
        deleteRecruitment(form.id);
        return redirect(res, "/admin/recruitment?msg=deleted");
    }
    // post a template into a channel and track the message
    if (pathname === "/admin/recruitment/post" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
        const template = getRecruitment((form.templateId || "").trim());
        const channelId = (form.channelId || "").trim();
        if (!template || !channelId) return redirect(res, "/admin/recruitment?err=" + encodeURIComponent("Vorlage oder Channel fehlt."));
        try {
            const posted = await discord.postRecruitment(channelId, template);
            const channel = discord.getClient() ? await discord.getClient().channels.fetch(channelId) : null;
            saveRecruitmentPost({
                guildId: posted.guildId,
                channelId: posted.channelId,
                messageId: posted.messageId,
                channelName: channel ? channel.name : "",
                title: template.title,
                body: template.body,
                buttonLabel: template.buttonLabel,
                source: "web",
            });
            return redirect(res, "/admin/recruitment?ok=" + encodeURIComponent("Nachricht gepostet."));
        } catch (e) {
            console.error("recruitment post failed:", e.message);
            return redirect(res, "/admin/recruitment?err=" + encodeURIComponent(e.message || "Posten fehlgeschlagen."));
        }
    }
    // update an already-posted message (edit its embed in Discord)
    if (pathname === "/admin/recruitment/post-update" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
        const post = getRecruitmentPost((form.id || "").trim());
        if (!post) return redirect(res, "/admin/recruitment?err=" + encodeURIComponent("Nachricht nicht gefunden."));
        const template = {
            content: form.content || "",
            title: form.title || "",
            body: form.body || "",
            buttonLabel: form.buttonLabel || "",
        };
        try {
            await discord.editRecruitment(post.channelId, post.messageId, template);
            saveRecruitmentPost({ id: post.id, ...template });
            return redirect(res, "/admin/recruitment?ok=" + encodeURIComponent("Nachricht aktualisiert."));
        } catch (e) {
            console.error("recruitment update failed:", e.message);
            return redirect(res, "/admin/recruitment?err=" + encodeURIComponent(e.message || "Aktualisieren fehlgeschlagen."));
        }
    }
    // stop tracking a posted message (Discord message stays)
    if (pathname === "/admin/recruitment/post-delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
        deleteRecruitmentPost((form.id || "").trim());
        return redirect(res, "/admin/recruitment?msg=deleted");
    }
    // scan the active server's channels for bot recruitment messages and import them
    if (pathname === "/admin/recruitment/scan" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/recruitment?msg=csrf");
        const guildId = activeGuildFor(req);
        if (!guildId) return redirect(res, "/admin/recruitment?err=" + encodeURIComponent("Kein Server gewählt."));
        try {
            const found = await discord.scanRecruitment(guildId);
            for (const f of found) saveRecruitmentPost({ ...f, source: "scan" });
            return redirect(res, "/admin/recruitment?ok=" + encodeURIComponent(`${found.length} Nachricht(en) gefunden/aktualisiert.`));
        } catch (e) {
            console.error("recruitment scan failed:", e.message);
            return redirect(res, "/admin/recruitment?err=" + encodeURIComponent(e.message || "Scan fehlgeschlagen."));
        }
    }

    // CLA / logcheck: form + run a report
    if (pathname === "/admin/cla") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const guildId = activeGuildFor(req);
            const logs = guildId ? listLogs().filter((l) => !l.guildId || l.guildId === guildId) : listLogs();
            const reports = listReports();
            const view = url.searchParams.get("view") === "logs" ? "logs" : "reports";
            const sortQuery = {
                sort: url.searchParams.get("sort"),
                dir: url.searchParams.get("dir"),
                page: url.searchParams.get("page"),
            };
            // Only the active view is paginated; the other tab is just a link.
            const reportPage = view === "reports" ? prepareReportList(reports, sortQuery) : null;
            const logPage = view === "logs" ? prepareLogList(logs, sortQuery) : null;
            // Lazily fill in the real Warcraft-Logs names for the logs shown on
            // this page (best-effort; safe no-op without an API key), and tag each
            // with its Discord category so the list can show a category badge.
            if (logPage) {
                await backfillLogTitles(logPage.items);
                annotateLogCategories(logPage.items, discord.getChannelCategoryMap(guildId));
            }
            return send(res, 200, renderCla(user, {
                view,
                reportPage,
                logPage,
                counts: { reports: reports.length, logs: logs.length },
                logChannelIds: getConfig().logChannelIds || [],
                activeGuildId: guildId,
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?msg=csrf");
            try {
                const result = await buildReport(form.link || "");
                return redirect(res, `/r/${result.id}`);
            } catch (e) {
                const text = e instanceof ReportError ? e.message : "Unerwarteter Fehler beim Erstellen der Auswertung.";
                if (!(e instanceof ReportError)) console.error("CLA web build failed:", e);
                return redirect(res, `/admin/cla?err=${encodeURIComponent(text)}`);
            }
        }
    }
    // evaluate a tracked log from the admin list (once)
    if (pathname === "/admin/cla/eval" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?view=logs&msg=csrf");
        const res2 = await evaluateLog((form.logId || "").trim());
        if (res2.ok) return redirect(res, `/r/${res2.id}`);
        if (res2.already && res2.url) return redirect(res, res2.url);
        return redirect(res, `/admin/cla?view=logs&err=${encodeURIComponent(res2.error || "Auswertung fehlgeschlagen.")}`);
    }
    // scan the configured log channels for logs posted while the bot was offline
    if (pathname === "/admin/cla/scan" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?view=logs&msg=csrf");
        try {
            const found = await scanLogChannels(activeGuildFor(req));
            return redirect(res, `/admin/cla?view=logs&ok=${encodeURIComponent(`${found} neue(r) Log(s) gefunden.`)}`);
        } catch (e) {
            console.error("log scan failed:", e.message);
            return redirect(res, `/admin/cla?view=logs&err=${encodeURIComponent(e.message || "Scan fehlgeschlagen.")}`);
        }
    }
    // remove a tracked log from the list (does not touch Discord / the report)
    if (pathname === "/admin/cla/log-delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?view=logs&msg=csrf");
        deleteLog((form.logId || "").trim());
        return redirect(res, "/admin/cla?view=logs&msg=deleted");
    }

    // raid events overview: all server events grouped by Discord category
    if (pathname === "/admin/raids" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const guildId = activeGuildFor(req);
        const { groups, error } = await loadEventGroups(guildId);
        return send(res, 200, renderRaids(user, {
            groups,
            error,
            guildId,
            activeGuildId: guildId,
            csrf: auth.csrfToken(req),
            msg: flashFromQuery(url),
            nav: navFor(req),
        }));
    }

    // raid event creation: form + create via Raid-Helper API
    if (pathname === "/admin/raids/new") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const guildId = activeGuildFor(req);
            // Existing events feed the "reuse an event for a new date" picker.
            // Best-effort: an API error just leaves the picker empty.
            const { groups } = await loadEventGroups(guildId);
            const reusableEvents = groups.flatMap((g) => g.events).map((ev) => ({
                id: ev.id, title: ev.title, templateId: ev.templateId,
                description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
            }));
            // ?source=<eventId> pre-selects that event in the reuse picker so a
            // category's "＋ Event" button keeps the same naming/format.
            const sourceEventId = url.searchParams.get("source") || "";
            return send(res, 200, renderRaidCreate(user, {
                defaults: { ...getConfig().raidDefaults, sourceEventId },
                leaderId: user.id,
                channels: discord.listTextChannels(guildId),
                templates: listRaidTemplates(),
                reusableEvents,
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/new?msg=csrf");
            const date = toRaidHelperDate(form.date);
            if (!date) return redirect(res, `/admin/raids/new?err=${encodeURIComponent("Ungültiges Datum.")}`);
            try {
                const rh = new Raidhelper();
                let channelId = (form.channelId || "").trim();
                const sourceEventId = (form.sourceEventId || "").trim();
                // Reuse an existing event for a new date: clone its channel (name
                // taken over and edited by the admin), then post the new event there.
                if (sourceEventId) {
                    const { groups } = await loadEventGroups(activeGuildFor(req));
                    const source = groups.flatMap((g) => g.events).find((ev) => ev.id === sourceEventId);
                    if (!source) return redirect(res, `/admin/raids/new?err=${encodeURIComponent("Quell-Event nicht gefunden.")}`);
                    const cloned = await discord.duplicateChannel(source.channelId, (form.channelName || "").trim());
                    channelId = cloned.id;
                }
                const result = await rh.createEvent({
                    channelId,
                    leaderId: (form.leaderId || "").trim(),
                    templateId: (form.templateId || "").trim(),
                    date,
                    time: (form.time || "").trim(),
                    title: (form.title || "").trim(),
                    description: form.description || "",
                });
                if (result && result.status === "failed") {
                    const msg = result.message || "Raid-Helper hat die Erstellung abgelehnt.";
                    return redirect(res, `/admin/raids/new?err=${encodeURIComponent(msg)}`);
                }
                return redirect(res, "/admin/raids?ok=" + encodeURIComponent("Event angelegt."));
            } catch (e) {
                console.error("raid create failed:", e.message);
                return redirect(res, `/admin/raids/new?err=${encodeURIComponent(e.message || "Event konnte nicht angelegt werden.")}`);
            }
        }
    }

    // raid templates: add one by hand (feeds the create-form dropdown)
    if (pathname === "/admin/raid-templates" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/new?msg=csrf");
        const saved = saveRaidTemplate({ id: (form.id || "").trim(), name: (form.name || "").trim() });
        if (!saved) return redirect(res, "/admin/raids/new?err=" + encodeURIComponent("Template-ID fehlt."));
        return redirect(res, "/admin/raids/new?msg=saved");
    }
    // raid templates: remove one
    if (pathname === "/admin/raid-templates/delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/new?msg=csrf");
        deleteRaidTemplate((form.id || "").trim());
        return redirect(res, "/admin/raids/new?msg=deleted");
    }
    // raid templates: import the distinct templates used by the server's events
    if (pathname === "/admin/raid-templates/import" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/new?msg=csrf");
        try {
            const rh = new Raidhelper();
            const templates = await rh.getTemplates();
            if (!templates.length) {
                return redirect(res, "/admin/raids/new?err=" + encodeURIComponent("Keine Templates in den aktuellen Events gefunden."));
            }
            const { added, updated } = saveRaidTemplates(templates);
            return redirect(res, "/admin/raids/new?ok=" + encodeURIComponent(`${added} neu, ${updated} aktualisiert.`));
        } catch (e) {
            console.error("raid template import failed:", e.message);
            return redirect(res, "/admin/raids/new?err=" + encodeURIComponent(e.message || "Laden fehlgeschlagen."));
        }
    }

    // channels: create a new channel or duplicate an existing one
    if (pathname === "/admin/channels" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const guildId = activeGuildFor(req);
        return send(res, 200, renderChannels(user, {
            categories: discord.listCategories(guildId),
            channels: discord.listAllChannels(guildId),
            activeGuildId: guildId,
            csrf: auth.csrfToken(req),
            msg: flashFromQuery(url),
            nav: navFor(req),
        }));
    }
    if (pathname === "/admin/channels/create" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/channels?msg=csrf");
        const guildId = activeGuildFor(req);
        if (!guildId) return redirect(res, "/admin/channels?err=" + encodeURIComponent("Kein Server gewählt."));
        try {
            const created = await discord.createChannel(guildId, {
                name: (form.name || "").trim(),
                type: (form.type || "text").trim(),
                parentId: (form.parentId || "").trim(),
            });
            return redirect(res, "/admin/channels?ok=" + encodeURIComponent(`Kanal #${created.name} erstellt.`));
        } catch (e) {
            console.error("channel create failed:", e.message);
            return redirect(res, "/admin/channels?err=" + encodeURIComponent(e.message || "Kanal konnte nicht erstellt werden."));
        }
    }
    if (pathname === "/admin/channels/duplicate" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/channels?msg=csrf");
        const channelId = (form.channelId || "").trim();
        if (!channelId) return redirect(res, "/admin/channels?err=" + encodeURIComponent("Kein Kanal gewählt."));
        try {
            const created = await discord.duplicateChannel(channelId, (form.name || "").trim());
            return redirect(res, "/admin/channels?ok=" + encodeURIComponent(`Kanal #${created.name} dupliziert.`));
        } catch (e) {
            console.error("channel duplicate failed:", e.message);
            return redirect(res, "/admin/channels?err=" + encodeURIComponent(e.message || "Kanal konnte nicht dupliziert werden."));
        }
    }

    // per-event detail: links + Anmelde-Aufruf + Raidsheet füllen
    if (pathname === "/admin/raids/detail" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const guildId = activeGuildFor(req);
        const eventId = (url.searchParams.get("event") || "").trim();
        const { groups, error } = await loadEventGroups(guildId);
        if (error) return redirect(res, `/admin/raids?err=${encodeURIComponent(error)}`);
        const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
        if (!found) return redirect(res, `/admin/raids?err=${encodeURIComponent("Event nicht gefunden.")}`);
        const raidsheets = listRaidsheets();
        const matched = matchRaidsheet(raidsheets, found.e.title);
        // Pull the Raid-Helper raidplan setup so it can be shown inline (best-effort).
        let setup = null;
        let setupError = null;
        let tankCands = [];
        try {
            const rh = new Raidhelper();
            const result = await rh.getSetup(eventId);
            const slots = result && result.setup ? result.setup : [];
            setup = buildSetupView(slots);
            tankCands = tankCandidates(slots);
        } catch (e) {
            console.error("event setup load failed:", e.message);
            setupError = e.message || "Setup konnte nicht geladen werden.";
        }
        // Attendance: who (holding a role assigned to this event's category) has not
        // reacted to the signup yet. Empty roleIds → feature simply stays inactive.
        const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
        let attendance = { responded: [], missing: [] };
        let membersError = null;
        if (categoryRoleIds.length) {
            const res2 = await discord.listMembersWithRoles(guildId, categoryRoleIds);
            membersError = res2.error;
            attendance = computeAttendance(res2.members, found.e.signUps || []);
        }
        // Softres: pre-select the instances the event title implies, plus the full
        // catalogue for the chosen edition so the admin can tweak the selection.
        const suggestedInstances = softres.parseInstancesFromTitle(found.e.title);
        const softresEdition = suggestedInstances.length ? suggestedInstances[0].edition : "tbc";
        return send(res, 200, renderEventDetail(user, {
            event: found.e,
            channelName: found.e.channelName,
            categoryName: found.g.categoryName,
            guildId,
            notifyTemplates: listNotify(),
            roles: discord.listRoles(guildId),
            raidsheets,
            matchedSheetId: matched ? matched.id : "",
            setup,
            setupError,
            tankCandidates: tankCands,
            eventSheet: getEventSheet(eventId),
            eventSoftres: getEventSoftres(eventId),
            softresCatalogue: softres.catalogue(),
            softresEdition,
            softresSuggested: suggestedInstances.map((i) => i.code),
            attendance,
            attendanceRoleIds: categoryRoleIds,
            membersError,
            csrf: auth.csrfToken(req),
            msg: flashFromQuery(url),
            nav: navFor(req),
        }));
    }

    // post an Anmelde-Aufruf into the event channel, pinging the chosen roles
    if (pathname === "/admin/raids/notify" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        const eventId = (form.event || "").trim();
        const back = `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, `${back}&msg=csrf`);
        const template = getNotify((form.templateId || "").trim());
        const channelId = (form.channelId || "").trim();
        const roleIds = Object.keys(form).filter((k) => k.startsWith("role_")).map((k) => k.slice(5));
        if (!template || !channelId) return redirect(res, `${back}&err=${encodeURIComponent("Vorlage oder Channel fehlt.")}`);
        try {
            await discord.postAnnouncement(channelId, template, roleIds);
            return redirect(res, `${back}&ok=${encodeURIComponent("Anmelde-Aufruf gepostet.")}`);
        } catch (e) {
            console.error("notify post failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Posten fehlgeschlagen.")}`);
        }
    }

    // ping the raiders who have a role assigned to this event's category but have
    // not reacted to the signup yet, asking them to sign up or off
    if (pathname === "/admin/raids/ping-missing" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        const eventId = (form.event || "").trim();
        const back = `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, `${back}&msg=csrf`);
        const guildId = activeGuildFor(req);
        const { groups, error } = await loadEventGroups(guildId);
        if (error) return redirect(res, `${back}&err=${encodeURIComponent(error)}`);
        const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
        if (!found) return redirect(res, `${back}&err=${encodeURIComponent("Event nicht gefunden.")}`);
        // Re-resolve missing server-side; never trust ids posted by the client.
        const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
        if (!categoryRoleIds.length) {
            return redirect(res, `${back}&err=${encodeURIComponent("Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Events).")}`);
        }
        const { members, error: membersError } = await discord.listMembersWithRoles(guildId, categoryRoleIds);
        if (membersError) return redirect(res, `${back}&err=${encodeURIComponent(membersError)}`);
        const { missing } = computeAttendance(members, found.e.signUps || []);
        if (!missing.length) {
            return redirect(res, `${back}&ok=${encodeURIComponent("Niemand fehlt — es haben schon alle reagiert.")}`);
        }
        try {
            await discord.postMissingPing(found.e.channelId, missing.map((m) => m.id), form.text);
            return redirect(res, `${back}&ok=${encodeURIComponent(`${missing.length} fehlende Raider gepingt.`)}`);
        } catch (e) {
            console.error("ping-missing failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Posten fehlgeschlagen.")}`);
        }
    }

    // fill a raidsheet from the event's Raid-Helper setup. Each raid gets its
    // OWN copy of the source raidsheet: copy it, share it by link, fill the
    // copy, link it on the event page, and schedule its deletion 3 days after
    // the raid. The source raidsheet is never written to or deleted.
    if (pathname === "/admin/raids/fill" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        const eventId = (form.event || "").trim();
        const back = `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, `${back}&msg=csrf`);
        const sheet = getRaidsheet((form.sheetId || "").trim());
        if (!sheet) return redirect(res, `${back}&err=${encodeURIComponent("Raidsheet nicht gefunden.")}`);
        if (!sheet.spreadsheetId) return redirect(res, `${back}&err=${encodeURIComponent("Raidsheet hat keine Spreadsheet-ID (in den Einstellungen ergänzen).")}`);
        try {
            const rh = new Raidhelper();
            const result = await rh.getSetup(eventId);
            if (!result || !result.setup || !result.setup.length) {
                return redirect(res, `${back}&err=${encodeURIComponent("Setup nicht gefunden oder leer.")}`);
            }
            // Event meta (title + start) for the copy name and the deletion schedule.
            const { groups: evGroups } = await loadEventGroups(activeGuildFor(req));
            const ev = evGroups.flatMap((g) => g.events).find((e) => e.id === eventId) || {};
            const startMs = (Number(ev.startTime) || 0) * 1000;
            const raidDate = startMs ? formatTimestampToDateString(startMs).split(" - ")[0].trim() : "";
            const copyName = `${ev.title || sheet.name || "Raidsheet"}${raidDate ? ` — ${raidDate}` : ""}`;
            // Delete 3 days after the raid (fallback: 3 days from now if start unknown).
            const deleteAfter = (startMs || Date.now()) + 3 * 24 * 60 * 60 * 1000;

            const drive = new Drive();
            // Re-filling replaces the previous copy: delete its Drive file first.
            const prev = getEventSheet(eventId);
            if (prev && prev.spreadsheetId) {
                try { await drive.deleteFile(prev.spreadsheetId); }
                catch (e) { console.error("previous copy delete failed:", e.message); }
            }
            // Copy the source raidsheet and record it immediately, so even a later
            // failure leaves a tracked copy the cleanup sweeper can remove.
            const copy = await drive.copyFile(sheet.spreadsheetId, copyName);
            markEventSheetFilled(eventId, {
                spreadsheetId: copy.id, url: copy.url,
                sourceSheetId: sheet.spreadsheetId, deleteAfter,
            });
            await drive.shareAnyoneWriter(copy.id);
            const client = new SheetsClient({ spreadsheetId: copy.id, sheetName: sheet.sheetName, gid: sheet.gid });
            const summary = await fillSetupSheet(client, result.setup, { tab: sheet.sheetName || "Setup", tank3: (form.tank3 || "").trim() });
            markEventSheetFilled(eventId, { sheetId: sheet.id, sheetName: sheet.name, playerCount: summary.playerCount });
            const delDate = formatTimestampToDateString(deleteAfter).split(" - ")[0].trim();
            return redirect(res, `${back}&ok=${encodeURIComponent(`Neues Sheet erstellt & gefüllt: ${summary.playerCount} Spieler. Wird am ${delDate} automatisch gelöscht.`)}`);
        } catch (e) {
            console.error("raidsheet fill failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Füllen fehlgeschlagen.")}`);
        }
    }

    // post the filled raidsheet link into the event channel, with an optional message
    if (pathname === "/admin/raids/post-sheet" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        const eventId = (form.event || "").trim();
        const back = `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, `${back}&msg=csrf`);
        const es = getEventSheet(eventId);
        if (!es || !es.url) return redirect(res, `${back}&err=${encodeURIComponent("Für dieses Event gibt es noch kein gefülltes Sheet.")}`);
        // Resolve the event's channel + title server-side; never trust posted ids.
        const { groups, error } = await loadEventGroups(activeGuildFor(req));
        if (error) return redirect(res, `${back}&err=${encodeURIComponent(error)}`);
        const found = groups.flatMap((g) => g.events).find((e) => e.id === eventId);
        if (!found) return redirect(res, `${back}&err=${encodeURIComponent("Event nicht gefunden.")}`);
        try {
            await discord.postLink(found.channelId, {
                url: es.url,
                title: found.title ? `Raidsheet – ${found.title}` : "Raidsheet",
                message: form.message,
                label: "Raidsheet öffnen",
                emoji: "📄",
            });
            return redirect(res, `${back}&ok=${encodeURIComponent("Raidsheet in den Channel gepostet.")}`);
        } catch (e) {
            console.error("post-sheet failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Posten fehlgeschlagen.")}`);
        }
    }

    // Wowhead item search for the softres hard-reserve picker (returns JSON).
    if (pathname === "/admin/raids/softres/item-search" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const q = url.searchParams.get("q") || "";
        const edition = url.searchParams.get("edition") || "tbc";
        const items = await wowhead.searchItems(q, { edition });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(JSON.stringify({ items }));
    }

    // create a softres.it soft-reserve list for this event (instances derived from
    // the title, but editable), with the chosen number of reserves and hard reserves
    if (pathname === "/admin/raids/softres" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        const eventId = (form.event || "").trim();
        const back = `/admin/raids/detail?event=${encodeURIComponent(eventId)}`;
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, `${back}&msg=csrf`);
        const codes = Object.keys(form).filter((k) => k.startsWith("inst_")).map((k) => k.slice(5));
        if (!codes.length) return redirect(res, `${back}&err=${encodeURIComponent("Mindestens eine Instanz wählen.")}`);
        // All chosen instances must belong to one edition (a softres list is single-edition).
        const editions = [...new Set(codes.map((c) => softres.editionOf(c)).filter(Boolean))];
        if (editions.length !== 1) {
            return redirect(res, `${back}&err=${encodeURIComponent("Alle gewählten Instanzen müssen zur selben Erweiterung gehören.")}`);
        }
        let hardReserves = [];
        try {
            const parsed = JSON.parse(form.hardReserves || "[]");
            if (Array.isArray(parsed)) hardReserves = parsed;
        } catch { /* ignore malformed HR payload — treat as none */ }
        try {
            const created = await softres.createRaid({
                instances: codes,
                edition: editions[0],
                amount: form.amount,
                faction: (form.faction || "").trim(),
                hardReserves,
                hideReserves: form.hideReserves === "1",
            });
            saveEventSoftres(eventId, {
                raidId: created.raidId,
                token: created.token,
                url: created.url,
                editUrl: created.editUrl,
                edition: editions[0],
                instances: codes,
                amount: Number(form.amount) || 1,
                hardReserveCount: hardReserves.length,
            });
            return redirect(res, `${back}&ok=${encodeURIComponent("Softres-Liste erstellt.")}#softres`);
        } catch (e) {
            console.error("softres create failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Softres-Erstellung fehlgeschlagen.")}`);
        }
    }

    // Anmelde-Aufruf templates (create/edit/delete)
    if (pathname === "/admin/raids/templates") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const editId = url.searchParams.get("edit");
            return send(res, 200, renderNotifyTemplates(user, {
                templates: listNotify(),
                editing: editId ? getNotify(editId) : null,
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/templates?msg=csrf");
            saveNotify(form);
            return redirect(res, "/admin/raids/templates?msg=saved");
        }
    }
    if (pathname === "/admin/raids/templates/delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids/templates?msg=csrf");
        deleteNotify((form.id || "").trim());
        return redirect(res, "/admin/raids/templates?msg=deleted");
    }

    // settings: admin roles + raid defaults (stored in the settings DB, not .env)
    if (pathname === "/admin/settings") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const guildId = activeGuildFor(req);
            return send(res, 200, renderSettings(user, {
                config: getConfig(),
                raidsheets: listRaidsheets(),
                roles: discord.listRoles(guildId),
                categories: discord.listCategories(guildId),
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/settings?msg=csrf");
            const trim = (k) => String(form[k] || "").trim();
            const list = (k) => String(form[k] || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            // Battle.net secret: empty field keeps the stored secret (never echoed
            // back to the page); a single "-" clears it; anything else replaces it.
            const blizzard = {
                clientId: trim("blizzardClientId"),
                region: trim("blizzardRegion") || "eu",
                realmSlug: trim("blizzardRealmSlug").toLowerCase() || "thunderstrike",
                namespace: trim("blizzardNamespace").toLowerCase(),
            };
            const secretInput = trim("blizzardClientSecret");
            if (secretInput === "-") blizzard.clientSecret = "";
            else if (secretInput) blizzard.clientSecret = secretInput;
            // Event categories are chosen by name via "cat:<categoryId>" checkboxes.
            const categoryIds = Object.keys(form)
                .filter((k) => k.startsWith("cat:"))
                .map((k) => k.slice(4))
                .filter(Boolean);
            // Per-category roles arrive as checkbox fields "catrole:<categoryId>:<roleId>".
            // Only keep assignments for categories that are actually selected.
            const categoryRoles = {};
            for (const k of Object.keys(form)) {
                if (!k.startsWith("catrole:")) continue;
                const [, catId, roleId] = k.split(":");
                if (!catId || !roleId || !categoryIds.includes(catId)) continue;
                (categoryRoles[catId] = categoryRoles[catId] || []).push(roleId);
            }
            saveConfig({
                adminRoleIds: list("adminRoleIds"),
                officerRoleId: trim("officerRoleId"),
                applicationChannelId: trim("applicationChannelId"),
                highestBidsChannelId: trim("highestBidsChannelId"),
                highestBidsMessageId: trim("highestBidsMessageId"),
                categoryIds,
                categoryRoles,
                logChannelIds: list("logChannelIds"),
                raidDefaults: {
                    templateId: trim("raidTemplateId"),
                    channelId: trim("raidChannelId"),
                },
                blizzard,
            });
            return redirect(res, "/admin/settings?msg=saved");
        }
    }

    // raidsheets: create/update one (Google-Sheets target keyed by content)
    if (pathname === "/admin/settings/raidsheets" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/settings?msg=csrf");
        saveRaidsheet(form);
        return redirect(res, "/admin/settings?msg=saved");
    }
    if (pathname === "/admin/settings/raidsheets/delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/settings?msg=csrf");
        deleteRaidsheet((form.id || "").trim());
        return redirect(res, "/admin/settings?msg=deleted");
    }

    // ===== Event history & loot =====
    if (pathname === "/admin/history" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const guildId = activeGuildFor(req);
        const { groups } = await loadEventGroups(guildId);
        const events = groups.flatMap((g) => g.events.map((ev) => ({
            id: ev.id, title: ev.title, startTime: ev.startTime, categoryId: g.categoryId,
        })));
        const cfg = getConfig();
        return send(res, 200, renderHistory(user, {
            events,
            lootEvents: eventsWithLoot(),
            logs: listLogs(),
            categories: guildId ? discord.listCategories(guildId) : [],
            categoryLootTool: cfg.categoryLootTool || {},
            chars: lootCharacters(),
            guildId,
            activeGuildId: guildId,
            csrf: auth.csrfToken(req),
            msg: flashFromQuery(url),
            nav: navFor(req),
        }));
    }

    // Import a loot export (RCLootcouncil JSON / Gargul CSV) for one event.
    if (pathname === "/admin/history/import" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/history?msg=csrf");
        const data = String(form.data || "").trim();
        if (!data) return redirect(res, "/admin/history?err=" + encodeURIComponent("Kein Loot-Text eingefügt."));
        const tool = (form.tool || "auto").trim();
        let eventId = (form.event || "").trim();
        let eventLabel = "";
        let categoryId = "";
        if (eventId === "__manual__" || !eventId) {
            const label = String(form.manualLabel || "").trim();
            if (!label) return redirect(res, "/admin/history?err=" + encodeURIComponent("Bitte ein Event wählen oder eine Bezeichnung eingeben."));
            eventLabel = label;
            eventId = "manual-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        } else {
            const { groups } = await loadEventGroups(activeGuildFor(req));
            const found = groups.flatMap((g) => g.events.map((ev) => ({ ev, g }))).find((x) => x.ev.id === eventId);
            eventLabel = found ? (found.ev.title || eventId) : eventId;
            categoryId = found ? (found.g.categoryId || "") : "";
        }
        let items;
        try {
            items = parseLoot(data, tool);
        } catch (e) {
            const msg = e instanceof LootParseError ? e.message : "Import fehlgeschlagen.";
            return redirect(res, "/admin/history?err=" + encodeURIComponent(msg));
        }
        if (!items.length) return redirect(res, "/admin/history?err=" + encodeURIComponent("Keine Loot-Einträge im Export gefunden."));
        const { added, skipped } = addLootImport(eventId, items, { categoryId, eventLabel });
        if (categoryId && (tool === "gargul" || tool === "rclc")) {
            saveConfig({ categoryLootTool: { [categoryId]: tool } });
        }
        return redirect(res, "/admin/history?ok=" + encodeURIComponent(`${added} Item(s) importiert${skipped ? `, ${skipped} Duplikat(e) übersprungen` : ""}.`));
    }

    // Mark which loot addon a Discord category uses.
    if (pathname === "/admin/history/category-tool" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/history?msg=csrf");
        const categoryId = (form.categoryId || "").trim();
        const tool = (form.tool || "").trim();
        if (categoryId) saveConfig({ categoryLootTool: { [categoryId]: (tool === "gargul" || tool === "rclc") ? tool : "" } });
        return redirect(res, "/admin/history?msg=saved");
    }

    // Delete all loot stored for one event.
    if (pathname === "/admin/history/clear" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/history?msg=csrf");
        const removed = clearLootEvent((form.event || "").trim());
        return redirect(res, "/admin/history?ok=" + encodeURIComponent(`${removed} Loot-Eintrag/-Einträge gelöscht.`));
    }

    if (pathname === "/admin/history/event" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const eventId = url.searchParams.get("event") || "";
        const items = listLootByEvent(eventId);
        const label = (items[0] && items[0].eventLabel) || eventId;
        return send(res, 200, renderHistoryEvent(user, {
            eventId, label, items, csrf: auth.csrfToken(req), msg: flashFromQuery(url), nav: navFor(req),
        }));
    }

    if (pathname === "/admin/history/char" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const name = url.searchParams.get("name") || "";
        const items = listLootByCharacter(name);
        const cfg = getConfig();
        const bzCfg = cfg.blizzard || {};
        const realm = (items[0] && items[0].realm) || bzCfg.realmSlug || "";
        const armoryUrl = fillCharTemplate(applyArmoryUrlTemplate, name);
        const wclUrl = fillCharTemplate(applyWclUrlTemplate, name);
        const client = new Blizzard(bzCfg);
        const gearConfigured = client.isConfigured();
        const gearNamespace = client._resolve().namespace;
        let gear = null;
        let gearError = "";
        let charSummary = null;
        if (gearConfigured && name) {
            // Summary first — its level/last-login reveal whether the profile is
            // the right character (a level 60/80 hit on a level-70 TBC char means
            // a wrong-namespace match → wrong-era gear).
            charSummary = await client.getCharacterSummary(name);
            gear = await client.getEquipment(name);
            if (gear === null) {
                const e = client.lastError || {};
                if (e.status === 404) gearError = `Charakter „${name}" nicht in der Blizzard-API gefunden (404, Namespace ${gearNamespace}). Realm-Slug „${bzCfg.realmSlug || "thunderstrike"}"/Schreibweise prüfen oder den Namespace in den Einstellungen ändern (z.B. profile-classicann-${bzCfg.region || "eu"}).`;
                else if (e.status === 403) gearError = "Zugriff verweigert (403) — die Profile-API ist für diesen Realm evtl. nicht freigegeben.";
                else if (e.status === 401) gearError = "Authentifizierung fehlgeschlagen (401) — Battle.net Client-ID/Secret prüfen.";
                else if (e.status) gearError = `Blizzard-API-Fehler (${e.status}).`;
                else gearError = `Blizzard-API nicht erreichbar (${e.message || "Netzwerkfehler"}).`;
            }
        }
        return send(res, 200, renderHistoryChar(user, {
            character: name, realm, items, armoryUrl, wclUrl, gear, gearConfigured, gearError,
            charSummary, gearNamespace,
            csrf: auth.csrfToken(req), msg: flashFromQuery(url), nav: navFor(req),
        }));
    }

    if (req.method !== "GET") return send(res, 405, renderNotFound());

    if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("ok");
    }
    // Start page = admin dashboard. Anonymous/non-admin visitors get the login/denied
    // page; the public report pages below (/r/...) stay reachable without login.
    if (pathname === "/" || pathname === "") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const reports = listReports();
        const cfg = getConfig();
        const stats = {
            reportsTotal: reports.length,
            reportsWithIssues: reports.filter((r) => (r.issueCount || 0) > 0).length,
            templates: listRecruitment().length,
            posts: listRecruitmentPosts().length,
            categories: (cfg.categoryIds || []).length,
            adminRoles: (cfg.adminRoleIds || []).length,
        };
        const upcoming = await loadUpcomingSetups(activeGuildFor(req), 3);
        return send(res, 200, renderDashboard(user, {
            stats,
            recentReports: reports.slice(0, 8),
            upcoming,
            msg: flashFromQuery(url),
            nav: navFor(req),
        }));
    }
    // per-raider detail page: /r/<id>/p/<idx>
    const pm = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/p\/(\d+)\/?$/);
    if (pm) {
        const report = getReport(pm[1]);
        if (report) return send(res, 200, renderPlayerPage(report, Number(pm[2])));
        return send(res, 404, renderNotFound());
    }
    const m = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/?$/);
    if (m) {
        const report = getReport(m[1]);
        if (report) return send(res, 200, renderReportPage(report));
        return send(res, 404, renderNotFound());
    }
    return send(res, 404, renderNotFound());
}

let server = null;

/** Start the report web server (idempotent). Pass the bot client for role lookups. */
function startWebServer(client) {
    if (client) { auth.setClient(client); discord.setClient(client); }
    if (server) return server;
    server = http.createServer((req, res) => {
        Promise.resolve(handle(req, res)).catch((err) => {
            console.error("Logcheck web server handler error:", err.message);
            try { res.writeHead(500); res.end("error"); } catch { /* already sent */ }
        });
    });
    server.on("error", (err) => {
        console.error("Logcheck web server error:", err.message);
    });
    server.listen(webPort, () => {
        console.log(`Logcheck web server listening on port ${webPort}`);
    });
    // Sweep due raid-sheet copies (deleted a few days after each raid).
    startSheetCleanup();
    return server;
}

module.exports = { startWebServer };
