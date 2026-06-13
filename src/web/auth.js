const crypto = require("crypto");
const axios = require("axios");
const {
    discordClientId, discordClientSecret, publicBaseUrl, logcheckAdminIds,
} = require("../config/variables");

// in-memory sessions (cleared on restart) — sid -> { id, name, isAdmin }
const sessions = new Map();
const REDIRECT_URI = `${publicBaseUrl}/auth/callback`;

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

/** Resolve the logged-in user (or null) from the request's session cookie. */
function getUser(req) {
    const sid = parseCookies(req).sid;
    return (sid && sessions.get(sid)) || null;
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
    const user = {
        id: me.data.id,
        name: me.data.global_name || me.data.username,
        isAdmin: logcheckAdminIds.includes(String(me.data.id)),
    };
    const sid = crypto.randomBytes(18).toString("hex");
    sessions.set(sid, user);
    return sid;
}

function destroy(sid) {
    if (sid) sessions.delete(sid);
}

module.exports = { configured, parseCookies, getUser, loginUrl, completeLogin, destroy };
