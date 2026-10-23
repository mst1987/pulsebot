// Who joined or left a configured Discord server (event or talk server), for the
// Discord overview of the web admin (docs/discord-servers.md "Discord-Übersicht").
// The bot records it from guildMemberAdd / guildMemberRemove (services/discord/memberActivity.js).
//
// `data/settings/member-activity.json` =
//   { entries: [{ guildId, userId, name, at, kind: "join"|"leave", roles: [{ id, name }] }] }
//
// `roles` is only filled on a leave: the roles the member had, with their names
// at that moment (a role deleted later still reads). Oldest first; an entry older
// than KEEP_DAYS and everything beyond MAX_ENTRIES (the oldest go) drop out on
// every write, so the file stays small even on a busy server.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
const MAX_ROLES = 50;
const KINDS = ["join", "leave"];
const SNOWFLAKE = /^\d{5,25}$/;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const snowflake = (v) => (SNOWFLAKE.test(str(v)) ? str(v) : "");

function normalizeRoles(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
        const id = snowflake(r && r.id);
        if (!id || out.some((x) => x.id === id)) continue;
        out.push({ id, name: str(r.name).slice(0, 100) });
        if (out.length >= MAX_ROLES) break;
    }
    return out;
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const guildId = snowflake(raw.guildId);
    const userId = snowflake(raw.userId);
    const at = Number(raw.at);
    const kind = KINDS.includes(raw.kind) ? raw.kind : "";
    if (!guildId || !userId || !kind || !Number.isFinite(at) || at <= 0) return null;
    return {
        guildId,
        userId,
        name: str(raw.name).slice(0, 100),
        at,
        kind,
        roles: kind === "leave" ? normalizeRoles(raw.roles) : [],
    };
}

/** Valid entries, oldest first, without those past KEEP_DAYS and beyond MAX_ENTRIES. */
function prune(entries, now = Date.now()) {
    const cutoff = now - KEEP_DAYS * DAY_MS;
    const kept = entries
        .map(normalizeEntry)
        .filter((e) => e && e.at >= cutoff)
        .sort((a, b) => a.at - b.at);
    return kept.slice(Math.max(0, kept.length - MAX_ENTRIES));
}

const store = createJsonStore({
    file: settingsPath("member-activity.json"),
    defaults: () => ({ entries: [] }),
    normalize: (data) => {
        const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
        return { entries: Array.isArray(d.entries) ? d.entries.map(normalizeEntry).filter(Boolean) : [] };
    },
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/**
 * Record one join or leave. Returns the stored entry, or null for one that is
 * not valid (no guild/user id, unknown kind).
 */
function record(entry = {}, { now = Date.now() } = {}) {
    const clean = normalizeEntry({ ...entry, at: entry.at || now });
    if (!clean) return null;
    const d = store.read();
    d.entries = prune([...d.entries, clean], now);
    store.write(d);
    return { ...clean, roles: clean.roles.map((r) => ({ ...r })) };
}

/**
 * The entries of one server since `since` (ms), newest first. `guildId` ""
 * = every server.
 */
function listEntries({ guildId = "", since = 0 } = {}) {
    const gid = str(guildId);
    return store.read().entries
        .filter((e) => (!gid || e.guildId === gid) && e.at >= since)
        .sort((a, b) => b.at - a.at);
}

module.exports = { useFile, record, listEntries, prune, KEEP_DAYS, MAX_ENTRIES };
