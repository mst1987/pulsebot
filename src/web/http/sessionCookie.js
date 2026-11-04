// How long a web login lasts and the cookie that carries it. A session lives until it
// has not been used for SESSION_TTL: rights are re-checked every few minutes anyway
// (auth.js), so a long-lived login never keeps old rights.
const { publicBaseUrl } = require("../../config/variables");

const SESSION_TTL = 2592000000; // 30 days
const SESSION_RENEW_MS = 86400000; // the expiry moves on at most once a day

// without https (local test instances) a Secure cookie would not come back
const SECURE = publicBaseUrl.startsWith("https://") ? "; Secure" : "";

/** The Set-Cookie value of a session. */
function sessionCookie(sid) {
    return `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${SECURE}`;
}

/** The Set-Cookie value that ends a session in the browser. */
function clearedSessionCookie() {
    return `sid=; HttpOnly; Path=/; Max-Age=0${SECURE}`;
}

module.exports = { SESSION_TTL, SESSION_RENEW_MS, sessionCookie, clearedSessionCookie };
