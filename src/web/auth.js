const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
    discordClientId, discordClientSecret, publicBaseUrl, logcheckAdminIds,
    adminRoleIds: envAdminRoleIds, guildId: envGuildId, devAutoLogin,
} = require("../config/variables");
const { getConfig } = require("./settingsStore");

// Sessions are persisted to disk so a bot/PM2 restart does not log everyone out.
// sid -> { id, name, isAdmin, csrf, createdAt }
const SESSIONS_FILE = path.join(__dirname, "..", "..", "data", "sessions.json");
const SESSION_TTL = 604800000; // 7 days, matches the cookie Max-Age
const sessions = new Map();
const REDIRECT_URI = `${publicBaseUrl}/auth/callback`;

// The Discord bot client, injected from server startup, used to read guild roles.
let botClient = null;
function setClient(client) {
    botClient = client;
}

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
    if (s && (Date.now() - (s.createdAt || 0)) < SESSION_TTL) return s;
    if (s) { sessions.delete(sid); saveSessions(); }
    return devSession();
}

/** Resolve the logged-in user (or null) from the request. */
function getUser(req) {
    return sessionFor(req) || null;
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

/**
 * Whether the given Discord user id has admin access. True if the id is in the
 * static admin list, or (via the bot) the guild member has one of the admin roles.
 * Falls back to the static list if the guild/member can't be read.
 */
async function resolveIsAdmin(userId) {
    // ADMIN_USER_ID (+ optional LOGCHECK_ADMIN_IDS) is the bootstrap admin from .env.
    if (logcheckAdminIds.includes(String(userId))) return true;
    // Role IDs are configured in the admin menu (data/settings/config.json),
    // with any .env ADMIN_ROLE_IDS merged in as an optional fallback.
    const roleIds = [...new Set([...(getConfig().adminRoleIds || []), ...(envAdminRoleIds || [])])];
    // guildId is likewise admin-editable (data/settings/config.json), .env is only the bootstrap fallback.
    const guildId = getConfig().guildId || envGuildId;
    if (!roleIds.length || !botClient || !guildId) return false;
    try {
        const guild = botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return roleIds.some((rid) => member.roles.cache.has(rid));
    } catch (e) {
        console.warn(`Role lookup failed for ${userId}:`, e.message);
        return false;
    }
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
    const user = {
        id: me.data.id,
        name: me.data.global_name || me.data.username,
        isAdmin: await resolveIsAdmin(me.data.id),
        csrf: crypto.randomBytes(18).toString("hex"),
        createdAt: Date.now(),
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
    configured, parseCookies, getUser, loginUrl, completeLogin, destroy,
    setClient, csrfToken, checkCsrf, getActiveGuild, setActiveGuild,
};
