// The bot's own invites to its servers (#905, PuG server).
//
// `data/settings/discord-invites.json` = {
//   links:    { ["from:to"]: { code, channelId, createdAt, error } } — one
//             invite per link, on the link's source server: a member who
//             joins through it came from that partner;
//   general:  { [guildId]: { code, channelId, createdAt, error } } — one
//             general invite per server (the web hands it to non-members);
//   channels: { [guildId]: channelId } — the channel the invites of a server
//             point at ("" = the bot picks one, see services/discord/pugInvites.js).
// }
// Kept out of the settings config on purpose (like talkOverviewStore): the bot
// writes it on its own, and a PATCH of the settings page must never race it.
// A record whose link is gone stays until its invite is replaced; it is
// harmless (nobody reads it) and keeps the origin of old members readable.

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const EMPTY = { code: "", channelId: "", createdAt: 0, error: "" };

function cleanRecord(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        code: typeof r.code === "string" ? r.code : "",
        channelId: typeof r.channelId === "string" ? r.channelId : "",
        createdAt: Number.isFinite(r.createdAt) ? r.createdAt : 0,
        error: typeof r.error === "string" ? r.error : "",
    };
}

function cleanMap(raw, clean) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw)) out[key] = clean(value);
    return out;
}

function normalize(data) {
    const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    return {
        links: cleanMap(d.links, cleanRecord),
        general: cleanMap(d.general, cleanRecord),
        channels: cleanMap(d.channels, (v) => (typeof v === "string" ? v : "")),
    };
}

const store = createJsonStore({
    file: settingsPath("discord-invites.json"),
    defaults: () => ({ links: {}, general: {}, channels: {} }),
    normalize,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function read() {
    return normalize(store.read());
}

/** The stored invite of one link ("from:to"); every field present, empty when there is none. */
function getLinkInvite(key) {
    return { ...EMPTY, ...(read().links[String(key || "")] || {}) };
}

/** The stored general invite of one server; empty fields when there is none. */
function getGeneralInvite(guildId) {
    return { ...EMPTY, ...(read().general[String(guildId || "")] || {}) };
}

function patchSection(section, id, patch) {
    const data = read();
    const key = String(id || "");
    if (!key) return { ...EMPTY };
    data[section] = { ...data[section], [key]: cleanRecord({ ...EMPTY, ...(data[section][key] || {}), ...(patch || {}) }) };
    store.write(data);
    return data[section][key];
}

/** Merge `patch` into one link's invite record and return the result. */
function setLinkInvite(key, patch) {
    return patchSection("links", key, patch);
}

/** Merge `patch` into one server's general invite record and return the result. */
function setGeneralInvite(guildId, patch) {
    return patchSection("general", guildId, patch);
}

/** The channel set for the invites of a server ("" = none set). */
function getInviteChannel(guildId) {
    return read().channels[String(guildId || "")] || "";
}

/** Set (or with "" clear) the channel the invites of a server point at. */
function setInviteChannel(guildId, channelId) {
    const id = String(guildId || "");
    if (!id) return "";
    const data = read();
    const channels = { ...data.channels };
    if (channelId) channels[id] = String(channelId);
    else delete channels[id];
    store.write({ ...data, channels });
    return channels[id] || "";
}

/** Every stored invite code with what it stands for: `[{ code, guildId, linkKey }]` (linkKey "" = general). */
function knownCodes() {
    const data = read();
    const out = [];
    for (const [key, r] of Object.entries(data.links)) {
        if (r.code) out.push({ code: r.code, guildId: key.split(":")[0], linkKey: key });
    }
    for (const [guildId, r] of Object.entries(data.general)) {
        if (r.code) out.push({ code: r.code, guildId, linkKey: "" });
    }
    return out;
}

module.exports = {
    getLinkInvite, setLinkInvite, getGeneralInvite, setGeneralInvite,
    getInviteChannel, setInviteChannel, knownCodes, useFile,
};
