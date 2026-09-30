// The one implementation behind every machine credential of the app: a bearer
// token that stands in for a Discord login where no browser session exists
// (the loot-sync uploader, ingestTokenStore.js; the local Kaderbau app,
// kaderTokenStore.js).
//
// Each capability gets a store of its own — its own file, its own prefix — so
// a token can only ever do the one thing it was minted for: a loot token is
// unknown to the Kaderbau store and the other way round, even though both
// verify the same way. The rules every such store follows:
//
//   - stored hashed (sha256), never in plaintext — a leaked settings file cannot
//     be replayed against the API,
//   - shown exactly once, at creation, and never retrievable again,
//   - kept in their own file rather than config.json, which GET /api/settings
//     hands to every admin wholesale,
//   - compared in constant time, so a wrong token cannot be narrowed down by
//     timing the response,
//   - revoked immediately: every request re-checks the store.
const { createJsonStore } = require("./jsonStore");
const crypto = require("crypto");

const TOKEN_BYTES = 24;

function hashToken(raw) {
    return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

/** Public shape: everything except the hash, which never leaves the store. */
function publicView(t) {
    return {
        id: t.id,
        name: t.name || "",
        hint: t.hint || "",
        createdAt: t.createdAt || 0,
        createdBy: t.createdBy || "",
        lastUsedAt: t.lastUsedAt || 0,
        uses: t.uses || 0,
    };
}

/** The bearer value of an incoming request, or "" when there is none. */
function bearerFrom(req) {
    const header = String((req && req.headers && req.headers.authorization) || "");
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : "";
}

/**
 * A token store for one capability.
 * @param {{ file: string, prefix: string, defaultName: string }} opts
 *   `prefix` makes a token found in a log or a pasted config recognisable (and
 *   is checked before any hashing); `defaultName` names a token minted without one.
 */
function createBearerTokenStore({ file, prefix, defaultName }) {
    if (!file || !prefix) throw new Error("createBearerTokenStore needs a file and a prefix");
    const store = createJsonStore({
        file,
        defaults: () => [],
        normalize: (data) => (Array.isArray(data.tokens) ? data.tokens : []),
    });
    const readAll = () => store.read();
    const writeAll = (tokens) => store.write({ tokens });

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
    function createToken(name, createdBy = "") {
        const raw = prefix + crypto.randomBytes(TOKEN_BYTES).toString("hex");
        const record = {
            id: crypto.randomBytes(6).toString("hex"),
            name: String(name || "").trim() || defaultName || "Token",
            hash: hashToken(raw),
            // Last 4 chars, so an admin can tell which of several tokens a row is
            // without the value being reconstructible from it.
            hint: raw.slice(-4),
            createdAt: Date.now(),
            createdBy: String(createdBy || ""),
            lastUsedAt: 0,
            uses: 0,
        };
        const tokens = readAll();
        tokens.push(record);
        writeAll(tokens);
        return { token: raw, record: publicView(record) };
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
     * Look up the token behind an `Authorization: Bearer …` value, comparing
     * hashes in constant time. Returns the public record, or null.
     */
    function verifyToken(raw) {
        const value = String(raw || "").trim();
        if (!value.startsWith(prefix)) return null;
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

    return {
        listTokens, createToken, revokeToken, verifyToken, touchToken, bearerFrom,
        TOKEN_PREFIX: prefix, useFile: store.useFile,
    };
}

module.exports = { createBearerTokenStore, bearerFrom, hashToken };
