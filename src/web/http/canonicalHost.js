// The web menu answers under one address. nginx also serves the same app under the
// bare domain and old subdomains, but the login cookie only ever lands on the host of
// PUBLIC_BASE_URL (OAuth always returns there) and browsers keep it per host: every
// visit through another name looks logged out and forces a new Discord login.
const { publicBaseUrl } = require("../../config/variables");

// Addon uploads, the sync app and health checks call these directly and need no login cookie.
const KEEP_HOST = /^\/(api\/|health(\/|$))/;

/** Hostname of a Host header, without port, lower case; "" when it is missing. */
function hostnameOf(hostHeader) {
    return String(hostHeader || "").split(":")[0].trim().toLowerCase();
}

/**
 * Where a request has to go instead, or null when it may stay. Only GET and HEAD of
 * another name of the public domain move; a host outside that domain (localhost, the
 * tailnet name) stays, so test instances and direct access keep working. The target
 * is built from the configuration, never from the Host header.
 */
function canonicalRedirect(req, baseUrl = publicBaseUrl) {
    if (req.method !== "GET" && req.method !== "HEAD") return null;
    if (KEEP_HOST.test(req.url || "")) return null;
    const { origin, hostname: canonical } = new URL(baseUrl);
    const host = hostnameOf(req.headers && req.headers.host);
    if (!host || host === canonical) return null;
    const domain = canonical.replace(/^www\./, "");
    if (host !== domain && !host.endsWith(`.${domain}`)) return null;
    return `${origin}${req.url}`;
}

module.exports = { canonicalRedirect };
