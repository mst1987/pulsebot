// Subscription tokens for the raider calendar feed (#312).
//
// `GET /r/cal/user/<token>.ics` is the one route in the app a calendar program
// can reach — Outlook, Google and Apple subscribe with a bare URL and send no
// cookie, no header and no Discord session. The token in that URL is therefore
// the whole authentication, which is why this store follows the loot-sync
// tokens (ingestTokenStore.js) to the letter:
//
//   - stored hashed (sha256), never in plaintext — a leaked settings file or a
//     backup cannot be replayed into somebody's raid calendar,
//   - shown exactly once, at creation, and never retrievable again,
//   - kept in their own file, not in config.json, which GET /api/settings hands
//     to every admin wholesale,
//   - revocable immediately: the feed re-checks the store on every miss, and a
//     revoked token answers 404 like one that never existed.
//
// The one difference to the loot-sync tokens: a calendar token belongs to
// **exactly one Discord account** and is minted and revoked by that account
// itself in its own profile. `revokeToken` therefore takes the owner and
// refuses a foreign id rather than trusting the caller to have checked.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const DEFAULT_FILE = path.join(SETTINGS_DIR, "calendar-tokens.json");

// Recognisable prefix, so a token found in a log or a pasted URL is obviously
// an EventHelper calendar link and can be revoked without guesswork.
const TOKEN_PREFIX = "ehc_";
const TOKEN_BYTES = 24;
// More than a handful per raider is not a feature, it is a leak waiting to be
// forgotten: one for the phone, one for the desktop calendar is the real case.
const MAX_PER_USER = 5;
const MAX_NAME = 40;

let tokensFile = DEFAULT_FILE;

/** Tests point the store at a file of their own. */
function useFile(file) {
    tokensFile = file || DEFAULT_FILE;
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(tokensFile, "utf8"));
        return Array.isArray(data.tokens) ? data.tokens : [];
    } catch {
        return [];
    }
}

function writeAll(tokens) {
    fs.mkdirSync(path.dirname(tokensFile), { recursive: true });
    fs.writeFileSync(tokensFile, JSON.stringify({ tokens }, null, 2));
}

function hashToken(raw) {
    return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

/** Public shape: everything except the hash, which never leaves this module. */
function publicView(t) {
    return {
        id: t.id,
        userId: t.userId || "",
        name: t.name || "",
        hint: t.hint || "",
        createdAt: t.createdAt || 0,
        lastUsedAt: t.lastUsedAt || 0,
        uses: t.uses || 0,
    };
}

/** One raider's own tokens, newest first. Never the hash, never the secret. */
function listTokensFor(userId) {
    const uid = String(userId || "");
    if (!uid) return [];
    return readAll()
        .filter((t) => t && t.userId === uid)
        .map(publicView)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Mint a token for one account. The plaintext is returned once and only once —
 * it is not stored, so it cannot be shown again later.
 * @returns {{ token?: string, record?: object, error?: string, code?: string }}
 */
function createToken(userId, name = "") {
    const uid = String(userId || "").trim();
    if (!uid) return { error: "Kein Konto angegeben.", code: "no_user" };
    const tokens = readAll();
    if (tokens.filter((t) => t && t.userId === uid).length >= MAX_PER_USER) {
        return { error: `Mehr als ${MAX_PER_USER} Kalender-Links gehen nicht. Widerrufe erst einen alten.`, code: "too_many" };
    }
    const raw = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const record = {
        id: crypto.randomBytes(6).toString("hex"),
        userId: uid,
        name: String(name || "").trim().slice(0, MAX_NAME) || "Kalender",
        hash: hashToken(raw),
        // Last 4 chars, so a raider can tell two of their links apart without
        // the value being reconstructible from it.
        hint: raw.slice(-4),
        createdAt: Date.now(),
        lastUsedAt: 0,
        uses: 0,
    };
    tokens.push(record);
    writeAll(tokens);
    return { token: raw, record: publicView(record) };
}

/**
 * Revoke one of *this* account's tokens. A token of another account is left
 * alone and reported as not found — the owner check lives here, not in the
 * route, so no caller can forget it.
 */
function revokeToken(id, userId) {
    const key = String(id || "");
    const uid = String(userId || "");
    const tokens = readAll();
    const next = tokens.filter((t) => !(t && t.id === key && t.userId === uid));
    if (next.length === tokens.length) return false;
    writeAll(next);
    return true;
}

/** Drop every token of an account (it asked for all of them to go). */
function revokeAllFor(userId) {
    const uid = String(userId || "");
    if (!uid) return 0;
    const tokens = readAll();
    const next = tokens.filter((t) => !(t && t.userId === uid));
    if (next.length === tokens.length) return 0;
    writeAll(next);
    return tokens.length - next.length;
}

/**
 * Look up the token behind a feed URL. Compares hashes in constant time so a
 * wrong token cannot be narrowed down by timing the response.
 * @returns {object|null} the public record (with its `userId`), or null
 */
function verifyToken(raw) {
    const value = String(raw || "").trim();
    if (!value.startsWith(TOKEN_PREFIX)) return null;
    const digest = Buffer.from(hashToken(value), "hex");
    for (const t of readAll()) {
        let stored;
        try {
            stored = Buffer.from(String(t.hash || ""), "hex");
        } catch {
            continue;
        }
        if (stored.length !== digest.length) continue;
        if (crypto.timingSafeEqual(stored, digest)) return publicView(t);
    }
    return null;
}

/** Record a use, so the profile can show a link nothing ever fetched as such. */
function touchToken(id) {
    const tokens = readAll();
    const match = tokens.find((t) => t.id === String(id || ""));
    if (!match) return false;
    match.lastUsedAt = Date.now();
    match.uses = (match.uses || 0) + 1;
    writeAll(tokens);
    return true;
}

module.exports = {
    listTokensFor, createToken, revokeToken, revokeAllFor, verifyToken, touchToken, useFile,
    TOKEN_PREFIX, MAX_PER_USER, MAX_NAME, DEFAULT_FILE,
};
