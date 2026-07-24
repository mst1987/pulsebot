const http = require("http");
const crypto = require("crypto");
const { webPort } = require("../config/variables");
const { getReport, deleteReport, listReports } = require("./reportStore");
const { renderReportPage, renderPlayerPage, renderIndexPage, renderNotFound, renderError } = require("./render");
const { renderAdminHome, renderAdminDenied, renderRecruitment, renderCla, renderRaids, renderSettings } = require("./renderAdmin");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    getConfig, saveConfig,
} = require("./settingsStore");
const { buildReport, ReportError } = require("../utils/logcheck/report");
const Raidhelper = require("../classes/raidhelper");
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
    if (pathname === "/admin" && req.method === "GET") {
        const user = requireAdmin(req, res);
        if (!user) return;
        return send(res, 200, renderAdminHome(user, { msg: flashFromQuery(url), nav: navFor(req) }));
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
        const template = { title: form.title || "", body: form.body || "", buttonLabel: form.buttonLabel || "" };
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
            return send(res, 200, renderCla(user, {
                reports: listReports(),
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

    // raid events: form + create via Raid-Helper API
    if (pathname === "/admin/raids") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            return send(res, 200, renderRaids(user, {
                defaults: getConfig().raidDefaults,
                leaderId: user.id,
                channels: discord.listTextChannels(activeGuildFor(req)),
                csrf: auth.csrfToken(req),
                msg: flashFromQuery(url),
                nav: navFor(req),
            }));
        }
        if (req.method === "POST") {
            const user = requireAdmin(req, res);
            if (!user) return;
            const form = await readFormBody(req);
            if (!auth.checkCsrf(req, form._csrf)) return redirect(res, "/admin/raids?msg=csrf");
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
                    return redirect(res, `/admin/raids?err=${encodeURIComponent(msg)}`);
                }
                return redirect(res, "/admin/raids?msg=saved");
            } catch (e) {
                console.error("raid create failed:", e.message);
                return redirect(res, `/admin/raids?err=${encodeURIComponent(e.message || "Event konnte nicht angelegt werden.")}`);
            }
        }
    }

    // settings: admin roles + raid defaults (stored in the settings DB, not .env)
    if (pathname === "/admin/settings") {
        if (req.method === "GET") {
            const user = requireAdmin(req, res);
            if (!user) return;
            return send(res, 200, renderSettings(user, {
                config: getConfig(),
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
            const adminRoleIds = String(form.adminRoleIds || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            saveConfig({
                adminRoleIds,
                raidDefaults: {
                    templateId: (form.raidTemplateId || "").trim(),
                    channelId: (form.raidChannelId || "").trim(),
                },
            });
            return redirect(res, "/admin/settings?msg=saved");
        }
    }

    if (req.method !== "GET") return send(res, 405, renderNotFound());

    if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("ok");
    }
    if (pathname === "/" || pathname === "") {
        return send(res, 200, renderIndexPage(listReports(), { user: auth.getUser(req) }));
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
