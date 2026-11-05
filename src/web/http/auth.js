const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { dataPath } = require("../../config/paths");
const {
    discordClientId, discordClientSecret, publicBaseUrl, logcheckAdminIds,
    adminRoleIds: envAdminRoleIds, devAutoLogin,
} = require("../../config/variables");
const { getConfig } = require("../../stores/settings/settingsStore");
const { fullAccess, emptyAccess, mergeAccess } = require("../../config/permissions");
// What an account may do (its roles on the configured servers, the base access) is
// the bot's question too — the guild bank's orga buttons check the same rights
// as the menu — so it lives in services/, which commands/ may require.
const {
    computeAccess, resolveAccess, computeGuildAccess, resolveGuildAccess, accessForGuild, withoutServerAdminRank, withoutDelistedRank, sharedDataAccess,
} = require("../../services/discord/members/userAccess");
const { configForGuild } = require("../../services/discord/servers/serverAccess");
const { pickActiveGuild } = require("./guildChoice");
const { effectiveUser, viewAsActive, normalizeRoleIds } = require("./viewAs");
const { SESSION_TTL, SESSION_RENEW_MS, sessionCookie } = require("./sessionCookie");

// Sessions are persisted to disk so a bot/PM2 restart does not log everyone out.
// sid -> { id, name, isAdmin, guildAccess, membershipChecked?, csrf, createdAt, renewedAt?, adminCheckedAt, activeGuildId? }
// `guildAccess` is userAccess.computeGuildAccess(): `{ isAdmin, guilds: { [guildId]:
// { access, isOrga?, isMember?, membershipUnknown?, isServerAdmin?, roleAccess?, roleIsOrga? } } }` — the rights per Discord server (#925). The session
// never carries one "global" access map: getUser() hands out the rights of the
// request's active server (activeGuildOf) only. `membershipChecked` tells a session asked
// since #1074 from an older one, whose missing `isMember` says nothing (membershipPending).
const SESSIONS_FILE = dataPath("sessions.json");
// How long a session's isAdmin flag and area access are trusted before they are
// re-checked against the current role config — so admin roles and role
// permissions changed in the settings take effect for already-logged-in users
// without a re-login.
const ADMIN_REFRESH_MS = 300000; // 5 minutes
// A stored server-admin rank (#1072) is not answered from an older re-check. The
// re-check runs in the background, so a session waking up (or one whose lookup hangs)
// would otherwise get a rank Discord may have taken back long ago. ensureAccess waits
// for the re-check of such a session, so its first request knows the answer.
const RANK_MAX_AGE_MS = 2 * ADMIN_REFRESH_MS;
// How long one re-check may take. Past it the lookup counts as failed: a hanging call
// holds neither a waiting request nor the next re-check of the session.
const RECHECK_TIMEOUT_MS = 5000;
// How often a session in use asks again while its memberships are open (#1074, membershipPending).
const MEMBERSHIP_RETRY_MS = 30000;
const sessions = new Map();
const REDIRECT_URI = `${publicBaseUrl}/auth/callback`;

/** A session counts from its last renewal (from its login until the first one). */
function isLive(s, now = Date.now()) {
    return now - (s.renewedAt || s.createdAt || 0) < SESSION_TTL;
}

function loadSessions() {
    try {
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
        const now = Date.now();
        for (const [sid, s] of Object.entries(raw)) {
            if (s && isLive(s, now)) sessions.set(sid, s);
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
    if (s && isLive(s)) {
        maybeRefreshAdmin(sid, s);
        return s;
    }
    if (s) { sessions.delete(sid); saveSessions(); }
    return devSession();
}

// Sid -> the promise of the role re-check in flight (kept out of the session
// objects so it is never persisted to disk).
const refreshingSids = new Map();
// session -> number of its latest re-check: an answer after the time limit must not undo a newer one
const recheckRounds = new WeakMap();
// session -> when Discord was last asked for it, for MEMBERSHIP_RETRY_MS (not persisted either)
const membershipTries = new WeakMap();

/** Store a computeGuildAccess() result on a session; the old global fields go. */
function applyGuildAccess(s, guildAccess) {
    s.guildAccess = guildAccess;
    s.isAdmin = !!guildAccess.isAdmin;
    delete s.access;
    delete s.isOrga;
    delete s.isServerAdmin;
}

/**
 * The server the request works on - the same rule as activeGuild.activeGuildFor
 * (guildChoice.js). The rights of a request are those of this server (#925).
 */
function activeGuildOf(req) {
    const s = sessionFor(req);
    return pickActiveGuild((s && s.activeGuildId) || null, viewerOfSession(s));
}

/** What guildChoice.js decides by: the account's own rights, whatever "Ansicht als Rolle" shows. */
function viewerOfSession(s) {
    return s ? { id: s.id, guildAccess: s.guildAccess || { isAdmin: !!s.isAdmin, guilds: {} } } : null;
}

/** The request's person for guildChoice.js (which servers they may enter, #1074), null without a login. */
function guildViewerOf(req) {
    return viewerOfSession(sessionFor(req));
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
 * The rights of a session that count right now. On a route over data of every server (`rankFree`,
 * the route mark `sharedData`) the rank goes and roles count on a trusted server only (#1073).
 * Otherwise the rank goes after too long without a re-check and on a server no longer entered; the
 * roles keep their rights.
 */
function currentGuildAccess(s, { rankFree = false } = {}) {
    const ga = s.guildAccess || { isAdmin: !!s.isAdmin, guilds: {} };
    const checkedAt = s.adminCheckedAt || s.createdAt || 0;
    if (rankFree) return sharedDataAccess(ga, s.id);
    if (Date.now() - checkedAt > RANK_MAX_AGE_MS) return withoutServerAdminRank(ga, s.id);
    return withoutDelistedRank(ga, s.id);
}

/** Whether the request is on a route marked `sharedData`; apiRouter.js sets this before anyone reads the user. */
const rankFreeRequest = (req) => req.sharedDataRoute === true;

/**
 * The user object a reader sees: a copy of the session carrying the rights of
 * the active server — `access`, `isOrga`, `isServerAdmin` — plus `allAccess` (the
 * union over every server) and `guildId`. A session without per-server rights yet (one
 * from before #925, until ensureAccess or the next re-check filled it) gets only
 * the base access of the server: fail closed, never the old global map.
 */
function userView(s, guildId, { rankFree = false } = {}) {
    const copy = { ...s };
    delete copy.guildAccess;
    delete copy.access;
    delete copy.isOrga;
    delete copy.isServerAdmin;
    const ga = currentGuildAccess(s, { rankFree });
    const { isAdmin, access, isOrga, isServerAdmin } = accessForGuild(ga, s.id, guildId);
    return {
        ...copy,
        isAdmin,
        access,
        ...(isOrga ? { isOrga: true } : {}),
        ...(isServerAdmin ? { isServerAdmin: true } : {}),
        allAccess: isAdmin ? fullAccess() : mergeAccess(allServersAccessOf(ga), access),
        guildId: guildId || "",
    };
}

/** Whether a session holds a server-admin rank too old to answer from (see RANK_MAX_AGE_MS). */
function rankIsStale(s) {
    const holdsRank = Object.values((s.guildAccess && s.guildAccess.guilds) || {}).some((g) => g && g.isServerAdmin);
    return holdsRank && Date.now() - (s.adminCheckedAt || s.createdAt || 0) > RANK_MAX_AGE_MS;
}

/**
 * Whether a session still has to learn which servers it is a member of (#1074) and may ask
 * again: it was never asked (logged in before the servers were limited), or Discord gave no
 * answer. Until then it enters only the servers it has a grant of its own on - no foreign
 * server, but not for good either: a lookup at most every MEMBERSHIP_RETRY_MS while in use.
 */
function membershipPending(s) {
    if (s.guildAccess.isAdmin) return false;
    const unknown = !s.membershipChecked || Object.values(s.guildAccess.guilds || {}).some((g) => g && g.membershipUnknown);
    return unknown && Date.now() - (membershipTries.get(s) || 0) >= MEMBERSHIP_RETRY_MS;
}

/**
 * A new answer that could not ask Discord about a server says nothing about that server: a
 * membership known from before stays. Its rights do not, those stay what the answer says.
 */
function keepKnownMembership(guildAccess, previous) {
    const known = (previous && previous.guilds) || {};
    const guilds = {};
    for (const [gid, entry] of Object.entries(guildAccess.guilds || {})) {
        guilds[gid] = entry.membershipUnknown && known[gid] && known[gid].isMember ? { ...entry, isMember: true } : entry;
    }
    return { ...guildAccess, guilds };
}

/**
 * Settle what the request's session is missing before the request goes on. A session
 * without per-server rights yet (logged in before #925) gets them computed, so its first
 * request after the update is answered with the right rights instead of the base access.
 * A session with a stale server-admin rank waits for its re-check (at most
 * RECHECK_TIMEOUT_MS): the first request after a pause answers with the rank Discord
 * confirms now, a lookup without an answer leaves the rank away. So does a session whose
 * memberships are open (membershipPending). A no-op for every other request.
 */
async function ensureAccess(req) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (!s || sid === DEV_SID) return;
    if (!isLive(s)) return;
    if (s.guildAccess) {
        if (rankIsStale(s) || membershipPending(s)) await refreshAdmin(sid, s);
        return;
    }
    membershipTries.set(s, Date.now());
    applyGuildAccess(s, await resolveGuildAccess(s.id));
    s.membershipChecked = true;
    s.adminCheckedAt = Date.now();
    saveSessions();
}

/** Waits for `lookup` at most RECHECK_TIMEOUT_MS; only the waiting ends, the lookup itself goes on. */
function waitForLookup(lookup) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${RECHECK_TIMEOUT_MS} ms`)), RECHECK_TIMEOUT_MS);
        if (timer.unref) timer.unref();
    });
    return Promise.race([lookup, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Re-check a session's rights now, or join the re-check in flight. Never rejects and always
 * ends within RECHECK_TIMEOUT_MS. A failed lookup (bot offline, Discord unreachable, no answer
 * in time) keeps the last known status instead of demoting a working session - except a
 * server-admin rank (#1072), which never outlives an unanswered lookup. Discord's answer still
 * counts when it comes after the limit, unless a newer re-check has started since.
 */
function refreshAdmin(sid, s) {
    if (refreshingSids.has(sid)) return refreshingSids.get(sid);
    const round = (recheckRounds.get(s) || 0) + 1;
    recheckRounds.set(s, round);
    membershipTries.set(s, Date.now());
    let waiting = true;
    const lookup = computeGuildAccess(s.id).then((guildAccess) => {
        if (recheckRounds.get(s) !== round) return;
        applyGuildAccess(s, keepKnownMembership(guildAccess, s.guildAccess));
        s.membershipChecked = true;
        if (waiting) return;
        s.adminCheckedAt = Date.now();
        saveSessions();
    });
    const running = waitForLookup(lookup)
        .catch((e) => {
            console.warn(`Admin re-check failed for ${s.id}:`, e.message);
            if (s.guildAccess) applyGuildAccess(s, withoutServerAdminRank(s.guildAccess, s.id));
        })
        .finally(() => {
            waiting = false;
            s.adminCheckedAt = Date.now();
            refreshingSids.delete(sid);
            saveSessions();
        });
    refreshingSids.set(sid, running);
    return running;
}

/**
 * Keep a login alive while it is used: at most once a day the expiry moves on, on
 * the server and in the browser cookie. A session past its expiry stays over.
 */
function renewSession(req, res) {
    const sid = parseCookies(req).sid;
    const s = sid && sessions.get(sid);
    if (!s || sid === DEV_SID || !isLive(s)) return;
    const now = Date.now();
    if (now - (s.renewedAt || s.createdAt || 0) < SESSION_RENEW_MS) return;
    s.renewedAt = now;
    saveSessions();
    res.setHeader("Set-Cookie", sessionCookie(sid));
}

/**
 * Re-check a session's admin status and area access against the current role
 * config once its cached value is older than ADMIN_REFRESH_MS. Runs in the
 * background — the current request keeps the cached status, the next one sees
 * the result (refreshAdmin).
 */
function maybeRefreshAdmin(sid, s) {
    if (sid === DEV_SID) return; // dev auto-login session is always admin
    const checkedAt = s.adminCheckedAt || s.createdAt || 0;
    if (Date.now() - checkedAt < ADMIN_REFRESH_MS || refreshingSids.has(sid)) return;
    refreshAdmin(sid, s);
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
    const rankFree = rankFreeRequest(req);
    const own = userView(s, guildId, { rankFree });
    if (!s.viewAs) return own;
    if (!viewAsActive(s.viewAs)) {
        // A view that ran out ends by itself.
        delete s.viewAs;
        saveSessions();
        return userView(s, guildId, { rankFree });
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
    return currentGuildAccess(s, { rankFree: rankFreeRequest(req) });
}

/**
 * The logged-in user with their own rights, ignoring an active "Ansicht als
 * Rolle" — only for starting and stopping that view.
 */
function getRealUser(req) {
    const s = sessionFor(req);
    return s ? userView(s, activeGuildOf(req), { rankFree: rankFreeRequest(req) }) : null;
}

/**
 * The logged-in user as they count on data of every server, whatever the route: without the
 * server-admin rank, and with roles only on a trusted server (#1073). For a handler that lets
 * the rank through except on such data, where a route mark (`sharedData`) cannot say that.
 */
function getUserWithoutRank(req) {
    const s = sessionFor(req);
    return s ? userView(s, activeGuildOf(req), { rankFree: true }) : null;
}

/**
 * The logged-in user with their own rights on one given server, whatever server is active
 * and whatever role is being looked at: only for a handler bound to one object of that
 * server (the signup link of one raid, apiRoutes/events/signups.js), never to serve the
 * server's data. Choosing a server stays activeGuild.js' job.
 */
function userForGuild(req, guildId) {
    const s = sessionFor(req);
    return s ? userView(s, guildId) : null;
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
        membershipChecked: true,
        csrf: crypto.randomBytes(18).toString("hex"),
        createdAt: Date.now(),
        adminCheckedAt: Date.now(),
    };
    membershipTries.set(user, Date.now());
    const sid = crypto.randomBytes(18).toString("hex");
    sessions.set(sid, user);
    saveSessions();
    return sid;
}

function destroy(sid) {
    if (sid && sessions.delete(sid)) saveSessions();
}

module.exports = {
    configured, parseCookies, getUser, getRealUser, getUserWithoutRank, userForGuild, RECHECK_TIMEOUT_MS, setViewAs, loginUrl, completeLogin, destroy,
    csrfToken, checkCsrf, getActiveGuild, setActiveGuild, activeGuildOf, guildViewerOf, ensureAccess, renewSession, sessionGuildAccess, MEMBERSHIP_RETRY_MS,
    // services/discord/members/userAccess.js, passed on for the web side
    computeAccess, resolveAccess,
};
