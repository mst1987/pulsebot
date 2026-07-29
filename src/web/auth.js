const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
    discordClientId, discordClientSecret, publicBaseUrl, logcheckAdminIds,
    adminRoleIds: envAdminRoleIds, guildId: envGuildId, devAutoLogin,
} = require("../config/variables");
const { getConfig } = require("./settingsStore");
const { fullAccess, emptyAccess, accessForRoles } = require("../config/permissions");

// Sessions are persisted to disk so a bot/PM2 restart does not log everyone out.
// sid -> { id, name, isAdmin, access, csrf, createdAt, adminCheckedAt }
// `access` is the per-area read/write map from config/permissions.js; full
// admins carry fullAccess().
const SESSIONS_FILE = path.join(__dirname, "..", "..", "data", "sessions.json");
const SESSION_TTL = 604800000; // 7 days, matches the cookie Max-Age
// How long a session's isAdmin flag and area access are trusted before they are
// re-checked against the current role config — so admin roles and role
// permissions changed in the settings take effect for already-logged-in users
// without a re-login.
const ADMIN_REFRESH_MS = 300000; // 5 minutes
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
            access: fullAccess(),
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
        return withAccess(s);
    }
    if (s) { sessions.delete(sid); saveSessions(); }
    return devSession();
}

// Sids with a role re-check currently in flight (kept out of the session
// objects so the flag is never persisted to disk).
const refreshingSids = new Set();

/**
 * Fill in a session's `access` map when it predates the permission model (a
 * session persisted before this feature, or restored from an older file): full
 * admins get everything, anyone else nothing until the next re-check.
 */
function withAccess(s) {
    if (!s.access) s.access = s.isAdmin ? fullAccess() : emptyAccess();
    return s;
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
    computeAccess(s.id)
        .then(({ isAdmin, access }) => { s.isAdmin = isAdmin; s.access = access; })
        .catch((e) => console.warn(`Admin re-check failed for ${s.id}:`, e.message))
        .finally(() => {
            s.adminCheckedAt = Date.now();
            refreshingSids.delete(sid);
            saveSessions();
        });
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

// Discord API error codes that mean "this user is definitively not a guild
// member" (as opposed to a transient lookup failure).
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

const NO_ACCESS = () => ({ isAdmin: false, access: emptyAccess() });
const ALL_ACCESS = () => ({ isAdmin: true, access: fullAccess() });

/**
 * What the given Discord user id may currently do: `{ isAdmin, access }`.
 * Full admin if the id is in the static admin list or the guild member holds
 * one of the admin roles — full admins get every area at write level. Otherwise
 * the union of the role permissions of the roles they hold (see
 * config/permissions.js). Throws when the lookup itself fails (bot not logged
 * in, Discord unreachable), so callers can distinguish "no access" from "unknown".
 */
async function computeAccess(userId) {
    // ADMIN_USER_ID (+ optional LOGCHECK_ADMIN_IDS) is the bootstrap admin from .env.
    if (logcheckAdminIds.includes(String(userId))) return ALL_ACCESS();
    const config = getConfig();
    // Role IDs are configured in the admin menu (data/settings/config.json),
    // with any .env ADMIN_ROLE_IDS merged in as an optional fallback.
    const adminRoleIds = [...new Set([...(config.adminRoleIds || []), ...(envAdminRoleIds || [])])];
    const rolePermissions = config.rolePermissions || {};
    // Nothing is configured at all — no need to hit Discord.
    if (!adminRoleIds.length && !Object.keys(rolePermissions).length) return NO_ACCESS();
    // guildId is likewise admin-editable (data/settings/config.json), .env is only the bootstrap fallback.
    const guildId = config.guildId || envGuildId;
    if (!botClient || !guildId) throw new Error("bot client or guild id not available");
    const guild = botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId);
    let member;
    try {
        member = await guild.members.fetch(userId);
    } catch (e) {
        if (e && (e.code === UNKNOWN_MEMBER || e.code === UNKNOWN_USER)) return NO_ACCESS();
        throw e;
    }
    if (adminRoleIds.some((rid) => member.roles.cache.has(rid))) return ALL_ACCESS();
    return { isAdmin: false, access: accessForRoles(rolePermissions, memberRoleIds(member)) };
}

/** The role ids of a guild member, tolerating an unexpected member shape. */
function memberRoleIds(member) {
    const cache = member && member.roles && member.roles.cache;
    if (!cache || typeof cache.keys !== "function") return [];
    return [...cache.keys()];
}

/** computeAccess(), treating a failed lookup as "no access" (login-time default). */
async function resolveAccess(userId) {
    try {
        return await computeAccess(userId);
    } catch (e) {
        console.warn(`Role lookup failed for ${userId}:`, e.message);
        return NO_ACCESS();
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
    const { isAdmin, access } = await resolveAccess(me.data.id);
    const user = {
        id: me.data.id,
        name: me.data.global_name || me.data.username,
        isAdmin,
        access,
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
    configured, parseCookies, getUser, loginUrl, completeLogin, destroy,
    setClient, csrfToken, checkCsrf, getActiveGuild, setActiveGuild,
};
