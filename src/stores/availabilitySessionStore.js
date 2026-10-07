// The open raid pickers of absences and attendances (utils/signup/availabilityDialog.js):
// what a raider entered in the period modal and picked since, under a short
// token, until "Speichern" or the TTL. On disk rather than in memory, so a
// restart of the bot (a deploy) between the modal and "Speichern" does not end
// the picker with "Die Auswahl ist abgelaufen". Stored under
// data/settings/availability-sessions.json; nothing in it outlives a few hours.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const store = createJsonStore({
    file: settingsPath("availability-sessions.json"),
    defaults: () => ({}),
    normalize: (data) => (data && data.sessions && typeof data.sessions === "object" && !Array.isArray(data.sessions) ? data.sessions : {}),
    cache: true,
});

/** Tests point the store at a file of their own. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(sessions) {
    store.write({ sessions });
}

/** One session (a copy), or null. */
function get(token) {
    const hit = readAll()[String(token || "")];
    return hit ? { ...hit } : null;
}

function has(token) {
    return !!readAll()[String(token || "")];
}

/** Store a session under its token, dropping every one older than `ttl` on the way. */
function put(token, session, { ttl, now = Date.now() } = {}) {
    const all = readAll();
    if (ttl) for (const [key, s] of Object.entries(all)) if (!s || now - (Number(s.at) || 0) > ttl) delete all[key];
    all[String(token)] = { ...session };
    writeAll(all);
}

function remove(token) {
    const all = readAll();
    if (!all[String(token || "")]) return false;
    delete all[String(token)];
    writeAll(all);
    return true;
}

module.exports = { useFile, get, has, put, remove };
