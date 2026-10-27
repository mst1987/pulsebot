// Through which invite a member joined a server (#905, PuG server): the bot
// records it on guildMemberAdd (services/discord/pugInvites.js), the settings
// page counts per link how many joined and how many of them signed up.
//
// `data/settings/member-origins.json` =
//   { origins: [{ guildId, userId, inviteCode, linkKey, joinedAt }] }
//
// One record per server and member: the first known origin wins — a member
// who leaves and comes back through another invite keeps the partner that
// brought them first. Only known origins are stored: a join whose invite is
// unknown (none or several counters rose) leaves no record at all (data
// economy), and neither is a join through the server's general invite: it is
// shown nowhere, so every record has its link (`linkKey` "from:to"). The
// origins of a link that is gone are dropped by the invite check
// (removeOriginsExcept). Records stay when a member leaves, so
// "joined" does not shrink (docs/data-storage.md). Beyond MAX_ENTRIES the
// oldest drop out.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const MAX_ENTRIES = 20000;
const SNOWFLAKE = /^\d{5,25}$/;
const CODE = /^[A-Za-z0-9-]{1,40}$/;
const LINK_KEY = /^\d{5,25}:\d{5,25}$/;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const snowflake = (v) => (SNOWFLAKE.test(str(v)) ? str(v) : "");

function normalizeOrigin(raw) {
    if (!raw || typeof raw !== "object") return null;
    const guildId = snowflake(raw.guildId);
    const userId = snowflake(raw.userId);
    const joinedAt = Number(raw.joinedAt);
    if (!guildId || !userId || !Number.isFinite(joinedAt) || joinedAt <= 0) return null;
    const inviteCode = CODE.test(str(raw.inviteCode)) ? str(raw.inviteCode) : "";
    if (!inviteCode) return null;
    const linkKey = LINK_KEY.test(str(raw.linkKey)) ? str(raw.linkKey) : "";
    if (!linkKey) return null;
    return { guildId, userId, inviteCode, linkKey, joinedAt };
}

const store = createJsonStore({
    file: settingsPath("member-origins.json"),
    defaults: () => ({ origins: [] }),
    normalize: (data) => {
        const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
        return { origins: Array.isArray(d.origins) ? d.origins.map(normalizeOrigin).filter(Boolean) : [] };
    },
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/**
 * Record a member's origin. A member already known on that server keeps the
 * first origin. Returns the stored record, or null for one that is not valid
 * (an unknown invite included: it is never stored).
 */
function recordOrigin(origin = {}, { now = Date.now() } = {}) {
    const entry = normalizeOrigin({ joinedAt: now, ...origin });
    if (!entry) return null;
    const { origins } = store.read();
    const index = origins.findIndex((o) => o.guildId === entry.guildId && o.userId === entry.userId);
    if (index >= 0) return origins[index];
    origins.push(entry);
    store.write({ origins: origins.slice(Math.max(0, origins.length - MAX_ENTRIES)) });
    return entry;
}

/** The stored origin of one member on one server, null when none is known. */
function originOf(guildId, userId) {
    return store.read().origins.find((o) => o.guildId === str(guildId) && o.userId === str(userId)) || null;
}

/** Every member who joined through the invite of `linkKey` ("from:to"). */
function originsOfLink(linkKey) {
    const key = str(linkKey);
    return key ? store.read().origins.filter((o) => o.linkKey === key) : [];
}

/**
 * Drop every origin whose link is not in `linkKeys` (a Set or array of
 * "from:to"): its link was removed. Returns how many were dropped.
 */
function removeOriginsExcept(linkKeys) {
    const keep = new Set([...(linkKeys || [])].map(str));
    const { origins } = store.read();
    const left = origins.filter((o) => keep.has(o.linkKey));
    if (left.length === origins.length) return 0;
    store.write({ origins: left });
    return origins.length - left.length;
}

/** Every stored origin (for a test or a full count). */
function listOrigins() {
    return store.read().origins;
}

module.exports = { recordOrigin, originOf, originsOfLink, removeOriginsExcept, listOrigins, normalizeOrigin, MAX_ENTRIES, useFile };
