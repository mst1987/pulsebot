// The Twitch streamers of a server (docs/twitch.md): one list per server in
// `serverSettings[guildId].twitchStreamers`, kept by the settings page.
//
// A stored list is normalised when read (like wclGuilds); what comes from the page
// goes through twitchStreamersFromBody(), which refuses instead of dropping silently.
// `source` says how an entry came: "orga" from the page, "raider" from an approved request
// (twitchRequests.js). No request body can set it, and a stored value survives every save.

const { serverSetting } = require("../discord/servers/serverSettings");

// Vorschlag - Nutzer entscheidet (noted in the report): the limits per server and entry.
const MAX_STREAMERS_PER_SERVER = 25;
const MAX_TEXT_LENGTH = 500;
const MAX_GAME_FILTERS = 5;
const MAX_GAME_NAME_LENGTH = 60;

const LOGIN_RE = /^[a-z0-9_]{2,25}$/;
const DISCORD_ID_RE = /^\d{5,25}$/;
const SOURCES = new Set(["orga", "raider"]);

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

/**
 * The Twitch login out of a name or a full channel link, lowercase; "" when it is
 * neither. A link to anything but a channel (twitch.tv/videos/123) is refused.
 */
function parseLogin(raw) {
    let text = str(raw).toLowerCase();
    if (!text) return "";
    const link = text.match(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#]+)\/?(?:[?#].*)?$/);
    if (link) text = link[1];
    else if (text.includes("/") || text.includes(".")) return "";
    text = text.replace(/^@/, "");
    return LOGIN_RE.test(text) ? text : "";
}

/** The game filter as a clean list: no blanks, no doubles (case-insensitive). */
function normalizeGames(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || "").split(/[,\n]/);
    const out = [];
    const seen = new Set();
    for (const value of list) {
        const name = str(value).slice(0, MAX_GAME_NAME_LENGTH);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= MAX_GAME_FILTERS) break;
    }
    return out;
}

function normalizeEntry(src) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return null;
    const login = parseLogin(src.login);
    const channelId = str(src.channelId);
    if (!login || !DISCORD_ID_RE.test(channelId)) return null;
    const roleId = str(src.roleId);
    return {
        login,
        channelId,
        roleId: DISCORD_ID_RE.test(roleId) ? roleId : "",
        text: str(src.text).slice(0, MAX_TEXT_LENGTH),
        games: normalizeGames(src.games),
        source: SOURCES.has(src.source) ? src.source : "orga",
    };
}

/** A stored list as the code uses it: broken entries and second entries of a login fall out. */
function normalizeTwitchStreamers(raw) {
    const out = [];
    const seen = new Set();
    for (const src of Array.isArray(raw) ? raw : []) {
        const entry = normalizeEntry(src);
        if (!entry || seen.has(entry.login)) continue;
        seen.add(entry.login);
        out.push(entry);
    }
    return out;
}

function twitchStreamersOf(guildId, { config } = {}) {
    return normalizeTwitchStreamers(serverSetting(guildId, "twitchStreamers", { config }));
}

/** Every entry of every server as `{ guildId, ...entry }`. */
function allTwitchStreamers({ config } = {}) {
    const cfg = config || require("../../stores/settings/settingsStore").getConfig();
    const out = [];
    for (const guildId of Object.keys((cfg && cfg.serverSettings) || {})) {
        for (const entry of twitchStreamersOf(guildId, { config: cfg })) out.push({ guildId, ...entry });
    }
    return out;
}

class TwitchSettingsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "TwitchSettingsError";
        this.code = code;
    }
}

/**
 * The list a save sends, checked: only the form's fields, a refusal with a code
 * instead of a silently shortened list. `source` is kept from the stored entry of
 * the same login, never taken from the body. Whether channel and role belong to
 * the server is the route's check (it knows who asks).
 * @throws {TwitchSettingsError}
 */
function twitchStreamersFromBody(raw, { current = [] } = {}) {
    if (!Array.isArray(raw)) throw new TwitchSettingsError("invalid_list", "Die Streamer-Liste ist ungültig.");
    if (raw.length > MAX_STREAMERS_PER_SERVER) {
        throw new TwitchSettingsError("too_many", `Höchstens ${MAX_STREAMERS_PER_SERVER} Streamer je Server.`);
    }
    const stored = new Map(current.map((e) => [e.login, e]));
    const seen = new Set();
    return raw.map((src) => {
        const body = src && typeof src === "object" && !Array.isArray(src) ? src : {};
        const login = parseLogin(body.login);
        if (!login) throw new TwitchSettingsError("invalid_login", `„${str(body.login).slice(0, 80)}“ ist kein Twitch-Name und kein Link zu einem Kanal.`);
        if (seen.has(login)) throw new TwitchSettingsError("duplicate_streamer", `${login} steht schon in der Liste.`);
        seen.add(login);
        const channelId = str(body.channelId);
        if (!DISCORD_ID_RE.test(channelId)) throw new TwitchSettingsError("missing_channel", `Für ${login} fehlt der Kanal.`);
        const roleId = str(body.roleId);
        if (roleId && !DISCORD_ID_RE.test(roleId)) throw new TwitchSettingsError("invalid_role", `Die Rolle für ${login} ist ungültig.`);
        const text = str(body.text);
        if (text.length > MAX_TEXT_LENGTH) throw new TwitchSettingsError("text_too_long", `Der Text für ${login} ist länger als ${MAX_TEXT_LENGTH} Zeichen.`);
        const games = normalizeGames(body.games);
        const rawGames = Array.isArray(body.games) ? body.games.filter((g) => str(g)) : [];
        if (rawGames.length > MAX_GAME_FILTERS) throw new TwitchSettingsError("too_many_games", `Für ${login} höchstens ${MAX_GAME_FILTERS} Spielnamen.`);
        const before = stored.get(login);
        return { login, channelId, roleId, text, games, source: before ? before.source : "orga" };
    });
}

/**
 * Whether a stream's category passes the entry's filter: no filter passes all,
 * otherwise any name contained in the category, case-insensitive (so "World of
 * Warcraft" also hits "World of Warcraft: Classic"). A stream without a category
 * passes only without a filter.
 */
function matchesGameFilter(games, gameName) {
    const filter = Array.isArray(games) ? games : [];
    if (!filter.length) return true;
    const category = str(gameName).toLowerCase();
    if (!category) return false;
    return filter.some((name) => category.includes(str(name).toLowerCase()));
}

module.exports = {
    MAX_STREAMERS_PER_SERVER,
    MAX_TEXT_LENGTH,
    MAX_GAME_FILTERS,
    MAX_GAME_NAME_LENGTH,
    TwitchSettingsError,
    parseLogin,
    normalizeGames,
    normalizeTwitchStreamers,
    twitchStreamersOf,
    allTwitchStreamers,
    twitchStreamersFromBody,
    matchesGameFilter,
};
