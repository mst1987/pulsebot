const http = require("http");
const crypto = require("crypto");
const { webPort } = require("../config/variables");
const { getReport, deleteReport, listReports } = require("./reportStore");
const { renderReportPage, renderPlayerPage, renderNotFound, renderError } = require("./render");
const {
    renderDashboard, renderAdminDenied, renderRecruitment, renderCla,
    renderRaids, renderRaidCreate, renderEventDetail, renderNotifyTemplates,
    renderChannels, renderSettings,
} = require("./renderAdmin");
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
const { evaluateLog, scanLogChannels } = require("./logChannel");
const Raidhelper = require("../classes/raidhelper");
const SheetsClient = require("../classes/sheets");
const { fillSetupSheet } = require("../utils/fillSetup");
const { matchRaidsheet } = require("../utils/raidsheets");
const { buildSetupView } = require("../utils/setupView");
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
                signupCount: (ev.signUps || []).filter((s) => s.specName !== "Absence").length,
            });
        }
        const groups = [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        return { groups, error: null };
    } catch (e) {
        return { groups: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
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
            return send(res, 200, renderRecruitment(user, {
                templates: listRecruitment(),
                editing: editId ? getRecruitment(editId) : null,
                editingPost: editPostId ? getRecruitmentPost(editPostId) : null,
                posts: guildId ? listRecruitmentPosts().filter((p) => p.guildId === guildId) : listRecruitmentPosts(),
                channels: discord.listTextChannels(guildId),
                emojis: discord.listEmojis(guildId),
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
            return send(res, 200, renderCla(user, {
                reports: listReports(),
                logs,
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
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?msg=csrf");
        const res2 = await evaluateLog((form.logId || "").trim());
        if (res2.ok) return redirect(res, `/r/${res2.id}`);
        if (res2.already && res2.url) return redirect(res, res2.url);
        return redirect(res, `/admin/cla?err=${encodeURIComponent(res2.error || "Auswertung fehlgeschlagen.")}`);
    }
    // scan the configured log channels for logs posted while the bot was offline
    if (pathname === "/admin/cla/scan" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?msg=csrf");
        try {
            const found = await scanLogChannels(activeGuildFor(req));
            return redirect(res, `/admin/cla?ok=${encodeURIComponent(`${found} neue(r) Log(s) gefunden.`)}`);
        } catch (e) {
            console.error("log scan failed:", e.message);
            return redirect(res, `/admin/cla?err=${encodeURIComponent(e.message || "Scan fehlgeschlagen.")}`);
        }
    }
    // remove a tracked log from the list (does not touch Discord / the report)
    if (pathname === "/admin/cla/log-delete" && req.method === "POST") {
        const user = requireAdmin(req, res);
        if (!user) return;
        const form = await readFormBody(req);
        if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/cla?msg=csrf");
        deleteLog((form.logId || "").trim());
        return redirect(res, "/admin/cla?msg=deleted");
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
            return send(res, 200, renderRaidCreate(user, {
                defaults: getConfig().raidDefaults,
                leaderId: user.id,
                channels: discord.listTextChannels(activeGuildFor(req)),
                templates: listRaidTemplates(),
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
            try {
                const rh = new Raidhelper();
                const result = await rh.createEvent({
                    channelId: (form.channelId || "").trim(),
                    leaderId: (form.leaderId || "").trim(),
                    templateId: (form.templateId || "").trim(),
                    date: (form.date || "").trim(),
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
        try {
            const rh = new Raidhelper();
            const result = await rh.getSetup(eventId);
            setup = buildSetupView(result && result.setup ? result.setup : []);
        } catch (e) {
            console.error("event setup load failed:", e.message);
            setupError = e.message || "Setup konnte nicht geladen werden.";
        }
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

    // fill a raidsheet from the event's Raid-Helper setup
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
            const client = new SheetsClient({ spreadsheetId: sheet.spreadsheetId, sheetName: sheet.sheetName, gid: sheet.gid });
            const summary = await fillSetupSheet(client, result.setup, { tab: sheet.sheetName || "Setup", tank3: (form.tank3 || "").trim() });
            return redirect(res, `${back}&ok=${encodeURIComponent(`Raidsheet gefüllt: ${summary.playerCount} Spieler.`)}`);
        } catch (e) {
            console.error("raidsheet fill failed:", e.message);
            return redirect(res, `${back}&err=${encodeURIComponent(e.message || "Füllen fehlgeschlagen.")}`);
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
            return send(res, 200, renderSettings(user, {
                config: getConfig(),
                raidsheets: listRaidsheets(),
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
            saveConfig({
                adminRoleIds: list("adminRoleIds"),
                officerRoleId: trim("officerRoleId"),
                applicationChannelId: trim("applicationChannelId"),
                highestBidsChannelId: trim("highestBidsChannelId"),
                highestBidsMessageId: trim("highestBidsMessageId"),
                categoryIds: list("categoryIds"),
                logChannelIds: list("logChannelIds"),
                raidDefaults: {
                    templateId: trim("raidTemplateId"),
                    channelId: trim("raidChannelId"),
                },
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
        return send(res, 200, renderDashboard(user, {
            stats,
            recentReports: reports.slice(0, 8),
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
    return server;
}

module.exports = { startWebServer };
