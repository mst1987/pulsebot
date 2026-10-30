const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { dataPath } = require("../../config/paths");
const {
    discordClientId, discordClientSecret, publicBaseUrl, logcheckAdminIds,
    adminRoleIds: envAdminRoleIds, devAutoLogin,
} = require("../../config/variables");
const { getConfig } = require("../../stores/settingsStore");
const { fullAccess, emptyAccess, mergeAccess } = require("../../config/permissions");
// What an account may do (its roles on the configured servers, the base access) is
// the bot's question too — the guild bank's orga buttons check the same rights
// as the menu — so it lives in services/, which commands/ may require.
const {
    computeAccess, resolveAccess, computeGuildAccess, resolveGuildAccess, accessForGuild,
} = require("../../services/discord/userAccess");
const { configForGuild } = require("../../services/discord/serverAccess");
const { pickActiveGuild } = require("./guildChoice");
const { effectiveUser, viewAsActive, normalizeRoleIds } = require("./viewAs");

// Sessions are persisted to disk so a bot/PM2 restart does not log everyone out.
// sid -> { id, name, isAdmin, guildAccess, csrf, createdAt, adminCheckedAt, activeGuildId? }
// `guildAccess` is userAccess.computeGuildAccess(): `{ isAdmin, guilds: { [guildId]:
// { access, isOrga? } } }` — the rights per Discord server (#925). The session
// never carries one "global" access map: getUser() hands out the rights of the
// request's active server (activeGuildOf) only.
const SESSIONS_FILE = dataPath("sessions.json");
const SESSION_TTL = 604800000; // 7 days, matches the cookie Max-Age
// How long a session's isAdmin flag and area access are trusted before they are
// re-checked against the current role config — so admin roles and role
// permissions changed in the settings take effect for already-logged-in users
// without a re-login.
const ADMIN_REFRESH_MS = 300000; // 5 minutes
const sessions = new Map();
const REDIRECT_URI = `${publicBaseUrl}/auth/callback`;

function loadSessions() {
    try {
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
        const now = Date.now();
        for (const [sid, s] of Object.entries(raw)) {
            if (s && (now - (s.createdAt || 0)) < SESSION_TTL) sessions.set(sid, s);
        }
    } catch {
        // no file yet or unreadable — start empty
    }
}
loadSessions();

function saveSessions() {
    try {
        fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
    } catch (e) {
        console.error("Failed to persist sessions:", e.message);
    }
}

function configured() {
    return !!(discordClientId && discordClientSecret);
}

function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of raw.split(";")) {
        const i = part.indexOf("=");
        if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

// Local dev auto-login: a single in-memory admin session used whenever there is
// no real cookie session. Lets the web menu work on any port without OAuth /
// callback-URL setup. Never active in production (see config/variables.js).
const DEV_SID = "__dev__";
function devSession() {
    if (!devAutoLogin) return null;
    let s = sessions.get(DEV_SID);
    if (!s) {
        s = {
            id: logcheckAdminIds[0] || "dev",
            name: "Dev (lokal)",
            isAdmin: true,
            guildAccess: { isAdmin: true, guilds: {} },
            csrf: crypto.randomBytes(18).toString("hex"),
            createdAt: Date.now(),
        };
        sessions.set(DEV_SID, s);
    }
    return s;
}

/** The active session for a request: a valid cookie session, else the dev session (dev only). */
function sessionFor(req) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (s && (Date.now() - (s.createdAt || 0)) < SESSION_TTL) {
        maybeRefreshAdmin(sid, s);
        return s;
    }
    if (s) { sessions.delete(sid); saveSessions(); }
    return devSession();
}

// Sids with a role re-check currently in flight (kept out of the session
// objects so the flag is never persisted to disk).
const refreshingSids = new Set();

/** Store a computeGuildAccess() result on a session; the old global fields go. */
function applyGuildAccess(s, guildAccess) {
    s.guildAccess = guildAccess;
    s.isAdmin = !!guildAccess.isAdmin;
    delete s.access;
    delete s.isOrga;
}

/**
 * The server the request works on - the same rule as activeGuild.activeGuildFor
 * (guildChoice.js). The rights of a request are those of this server (#925).
 */
function activeGuildOf(req) {
    const s = sessionFor(req);
    return pickActiveGuild((s && s.activeGuildId) || null);
}

/**
 * The union of a session's rights over every server — what the pages under
 * "Alle Server" (Mein Profil, Addons) and the question "may this account open
 * the menu at all" go by. Never used for a route of one server.
 */
function allServersAccessOf(guildAccess) {
    if (guildAccess.isAdmin) return fullAccess();
    let all = emptyAccess();
    for (const entry of Object.values(guildAccess.guilds || {})) all = mergeAccess(all, entry.access);
    return all;
}

/**
 * The user object a reader sees: a copy of the session carrying the rights of
 * the active server — `access`, `isOrga` — plus `allAccess` (the union over
 * every server) and `guildId`. A session without per-server rights yet (one
 * from before #925, until ensureAccess or the next re-check filled it) gets only
 * the base access of the server: fail closed, never the old global map.
 */
function userView(s, guildId) {
    const copy = { ...s };
    delete copy.guildAccess;
    delete copy.access;
    delete copy.isOrga;
    const ga = s.guildAccess || { isAdmin: !!s.isAdmin, guilds: {} };
    const { isAdmin, access, isOrga } = accessForGuild(ga, s.id, guildId);
    return {
        ...copy,
        isAdmin,
        access,
        ...(isOrga ? { isOrga: true } : {}),
        allAccess: isAdmin ? fullAccess() : mergeAccess(allServersAccessOf(ga), access),
        guildId: guildId || "",
    };
}

/**
 * Compute the per-server rights of a session that has none yet (logged in
 * before #925) before the request goes on, so its first request after the
 * update is answered with the right rights instead of the base access. A no-op
 * for every other request.
 */
async function ensureAccess(req) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (!s || s.guildAccess || sid === DEV_SID) return;
    if ((Date.now() - (s.createdAt || 0)) >= SESSION_TTL) return;
    applyGuildAccess(s, await resolveGuildAccess(s.id));
    s.adminCheckedAt = Date.now();
    saveSessions();
}

/**
 * Re-check a session's admin status and area access against the current role
 * config once its cached value is older than ADMIN_REFRESH_MS. Runs in the
 * background — the current request keeps the cached status, the next one sees
 * the result. A failed lookup (bot offline, Discord unreachable) keeps the last
 * known status instead of demoting a working session.
 */
function maybeRefreshAdmin(sid, s) {
    if (sid === DEV_SID) return; // dev auto-login session is always admin
    const checkedAt = s.adminCheckedAt || s.createdAt || 0;
    if (Date.now() - checkedAt < ADMIN_REFRESH_MS || refreshingSids.has(sid)) return;
    refreshingSids.add(sid);
    computeGuildAccess(s.id)
        .then((guildAccess) => applyGuildAccess(s, guildAccess))
        .catch((e) => console.warn(`Admin re-check failed for ${s.id}:`, e.message))
        .finally(() => {
            s.adminCheckedAt = Date.now();
            refreshingSids.delete(sid);
            saveSessions();
        });
}

/**
 * Resolve the logged-in user (or null) from the request — as every reader
 * should see them: while a full admin looks at the menu as a role (viewAs.js),
 * with that role's rights instead of their own.
 */
function getUser(req) {
    const s = sessionFor(req);
    if (!s) return null;
    const guildId = activeGuildOf(req);
    const own = userView(s, guildId);
    if (!s.viewAs) return own;
    if (!viewAsActive(s.viewAs)) {
        // A view that ran out ends by itself.
        delete s.viewAs;
        saveSessions();
        return userView(s, guildId);
    }
    // the roles are looked at with the rights settings of the active server
    return effectiveUser(own, configForGuild(getConfig(), guildId), envAdminRoleIds || []);
}

/**
 * The per-server rights the session holds (`computeGuildAccess()` from the login or the last
 * re-check), never looked up anew - for what has to know every server of the caller without a
 * Discord round trip on each page view (the sync keys of "Mein Profil", #1000). A session
 * without them yet gives `{ isAdmin, guilds: {} }`: the base access of each server.
 */
function sessionGuildAccess(req) {
    const s = sessionFor(req);
    if (!s) return null;
    return s.guildAccess || { isAdmin: !!s.isAdmin, guilds: {} };
}

/**
 * The logged-in user with their own rights, ignoring an active "Ansicht als
 * Rolle" — only for starting and stopping that view.
 */
function getRealUser(req) {
    const s = sessionFor(req);
    return s ? userView(s, activeGuildOf(req)) : null;
}

/**
 * Start (`roleIds` an array, [] = only the base access) or stop (`null`) the
 * view as a role for the request's session. Only a real full admin may start
 * one; stopping always works. Returns false when nothing was changed.
 */
function setViewAs(req, roleIds) {
    const s = sessionFor(req);
    if (!s) return false;
    if (roleIds === null) {
        if (!s.viewAs) return false;
        delete s.viewAs;
    } else {
        if (!s.isAdmin) return false;
        s.viewAs = { roleIds: normalizeRoleIds(roleIds), at: Date.now() };
    }
    saveSessions();
    return true;
}


/**
 * Get (creating if needed) the CSRF token bound to the request's session.
 * Returns "" when there is no session (unauthenticated requests can't act).
 */
function csrfToken(req) {
    const s = sessionFor(req);
    if (!s) return "";
    if (!s.csrf) {
        s.csrf = crypto.randomBytes(18).toString("hex");
        saveSessions();
    }
    return s.csrf;
}

/** Constant-time check of a submitted CSRF token against the session's token. */
function checkCsrf(req, token) {
    const s = sessionFor(req);
    if (!s || !s.csrf || !token) return false;
    const a = Buffer.from(String(token));
    const b = Buffer.from(s.csrf);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The server (guild) the admin has selected for this session, or null. */
function getActiveGuild(req) {
    const s = sessionFor(req);
    return (s && s.activeGuildId) || null;
}

/** Remember the selected server for this session. */
function setActiveGuild(req, guildId) {
    const s = sessionFor(req);
    if (!s) return;
    s.activeGuildId = guildId || "";
    saveSessions();
}

function loginUrl(state) {
    const params = new URLSearchParams({
        client_id: discordClientId,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify",
        state,
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

/** Exchange an OAuth code for the Discord user, then create a session. Returns sid. */
async function completeLogin(code) {
    const body = new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
    });
    const token = await axios.post("https://discord.com/api/oauth2/token", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const me = await axios.get("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.data.access_token}` },
    });
    const guildAccess = await resolveGuildAccess(me.data.id);
    const user = {
        id: me.data.id,
        name: me.data.global_name || me.data.username,
        // The account's Discord picture for the menu's user circle; none when it has no own picture.
        ...(me.data.avatar ? { avatarUrl: `https://cdn.discordapp.com/avatars/${me.data.id}/${me.data.avatar}.png?size=64` } : {}),
        isAdmin: !!guildAccess.isAdmin,
        guildAccess,
        csrf: crypto.randomBytes(18).toString("hex"),
        createdAt: Date.now(),
        adminCheckedAt: Date.now(),
    };
    const sid = crypto.randomBytes(18).toString("hex");
    sessions.set(sid, user);
    saveSessions();
    return sid;
}

function destroy(sid) {
    if (sid && sessions.delete(sid)) saveSessions();
}

module.exports = {
    configured, parseCookies, getUser, getRealUser, setViewAs, loginUrl, completeLogin, destroy,
    csrfToken, checkCsrf, getActiveGuild, setActiveGuild, activeGuildOf, ensureAccess, sessionGuildAccess,
    // services/discord/userAccess.js, passed on for the web side
    computeAccess, resolveAccess,
};
