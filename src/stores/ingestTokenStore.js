// API tokens for the loot-sync companion tool (see the EventHelper addon repo).
//
// The uploader runs on a raidleader's PC and has no Discord session, so it
// authenticates with a bearer token instead. These tokens are the one credential
// in the app that is not tied to a person's Discord login, which is why they are:
//
//   - stored hashed (sha256), never in plaintext — a leaked settings file cannot
//     be replayed against the API,
//   - shown exactly once, at creation, and never retrievable again,
//   - kept in their own file rather than config.json, which GET /api/settings
//     hands to every admin wholesale,
//   - scoped to a single capability: uploading loot into the inbox. A token can
//     never read or change anything else (see apiAccess.js's TOKEN_AUTH).
//
// Revoking is immediate: every upload re-checks the store.
//
// Each token belongs to one Discord server (`guildId`, #994): every
// /api/ingest/* route then works only on that server. A token minted before
// #994 has none and keeps the old behaviour (first server / every server)
// until a full admin assigns it one.
//
// A personal key (#1000, epic #999) belongs to a person instead (`ownerId`, the
// Discord id): it holds no server of its own - it counts for every server its
// owner is orga of right now (services/discord/ingestServers.js), asked anew on
// every request. One person may hold several, one per device (`name`).
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const crypto = require("crypto");

const TOKENS_FILE = settingsPath("ingest-tokens.json");

// Recognisable prefix so a token found in a log or a pasted config is obviously
// an EventHelper loot-sync credential and can be revoked without guesswork.
const TOKEN_PREFIX = "ehl_";
const TOKEN_BYTES = 24;

const store = createJsonStore({
    file: TOKENS_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.tokens) ? data.tokens : []),
});

function readAll() {
    return store.read();
}

function writeAll(tokens) {
    store.write({ tokens });
}

function hashToken(raw) {
    return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

/** Public shape: everything except the hash, which never leaves this module. */
function publicView(t) {
    return {
        id: t.id,
        name: t.name || "",
        hint: t.hint || "",
        createdAt: t.createdAt || 0,
        createdBy: t.createdBy || "",
        lastUsedAt: t.lastUsedAt || 0,
        uses: t.uses || 0,
        guildId: t.guildId || "",
        ownerId: t.ownerId || "",
    };
}

/** All tokens, newest first. Never includes the hash or the secret itself. */
function listTokens() {
    return readAll()
        .map(publicView)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Mint a new token. The plaintext is returned once and only once — it is not
 * stored, so it cannot be shown again later.
 * @returns {{ token: string, record: object }}
 */
function createToken(name, createdBy = "", guildId = "", ownerId = "") {
    const raw = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const record = {
        id: crypto.randomBytes(6).toString("hex"),
        name: String(name || "").trim() || "Loot-Sync",
        hash: hashToken(raw),
        // Last 4 chars, so an admin can tell which of several tokens a row is
        // without the value being reconstructible from it.
        hint: raw.slice(-4),
        createdAt: Date.now(),
        createdBy: String(createdBy || ""),
        lastUsedAt: 0,
        uses: 0,
        guildId: String(guildId || "").trim(),
        ownerId: String(ownerId || "").trim(),
    };
    const tokens = readAll();
    tokens.push(record);
    writeAll(tokens);
    return { token: raw, record: publicView(record) };
}

/**
 * Mint a personal key (#1000): it belongs to `ownerId` and to no server. The
 * plaintext is returned once, like createToken.
 */
function createPersonToken(name, ownerId, createdBy = "") {
    const owner = String(ownerId || "").trim();
    if (!owner) throw new Error("ownerId required");
    return createToken(name, createdBy || owner, "", owner);
}

/** The personal keys of one person, newest first. */
function listTokensOfOwner(ownerId) {
    const owner = String(ownerId || "").trim();
    if (!owner) return [];
    return listTokens().filter((t) => t.ownerId === owner);
}

/** One token's public record by id, or null. */
function getToken(id) {
    const match = readAll().find((t) => t.id === String(id || ""));
    return match ? publicView(match) : null;
}

/**
 * Assign a token to a Discord server (#994: for tokens minted without one).
 * The caller checks that the server is configured. Returns the public record,
 * or null for an unknown id or a personal key (it follows its owner instead).
 */
function assignTokenGuild(id, guildId) {
    const tokens = readAll();
    const match = tokens.find((t) => t.id === String(id || ""));
    if (!match || match.ownerId) return null;
    match.guildId = String(guildId || "").trim();
    writeAll(tokens);
    return publicView(match);
}

/** Delete a token by id. Returns true if one was removed. */
function revokeToken(id) {
    const tokens = readAll();
    const next = tokens.filter((t) => t.id !== String(id || ""));
    if (next.length === tokens.length) return false;
    writeAll(next);
    return true;
}

/**
 * Look up the token behind an `Authorization: Bearer …` value.
 * Compares hashes in constant time so a wrong token cannot be narrowed down by
 * timing the response. Returns the public record, or null.
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

/** Record a successful use, so the settings list can show a dead token as such. */
function touchToken(id) {
    const tokens = readAll();
    const match = tokens.find((t) => t.id === String(id || ""));
    if (!match) return false;
    match.lastUsedAt = Date.now();
    match.uses = (match.uses || 0) + 1;
    writeAll(tokens);
    return true;
}

/** The bearer value of an incoming request, or "" when there is none. */
function bearerFrom(req) {
    const header = String((req && req.headers && req.headers.authorization) || "");
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : "";
}

module.exports = {
    listTokens, listTokensOfOwner, getToken, createToken, createPersonToken, assignTokenGuild, revokeToken, verifyToken, touchToken, bearerFrom,
    TOKEN_PREFIX, useFile: store.useFile,
};
