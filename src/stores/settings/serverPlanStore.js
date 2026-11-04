// Which plan each Discord server is on: `{ [guildId]: { plan, until, note } }`
// (docs/server-plans.md). A file of its own rather than a field in config.json: a
// settings PATCH must never run against it, only the full admins' own route writes it.
// Asked on every planned route and command, hence the cache.
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const text = (value) => (typeof value === "string" ? value : "");

const store = createJsonStore({
    file: settingsPath("server-plans.json"),
    defaults: () => ({}),
    cache: true,
    normalize: (data) => Object.fromEntries(Object.entries(data && typeof data === "object" ? data : {})
        .filter(([, entry]) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map(([guildId, entry]) => [guildId, { plan: text(entry.plan), until: text(entry.until), note: text(entry.note) }])),
});

/** Every entry, a copy. */
function readAll() {
    return store.read();
}

/** The entry of a server, null without one. */
function getEntry(guildId) {
    const all = store.peek();
    return Object.hasOwn(all, guildId) ? all[guildId] : null;
}

/** Set the entry of a server; `null` removes it. */
function setEntry(guildId, entry) {
    store.update((all) => {
        const rest = Object.fromEntries(Object.entries(all).filter(([id]) => id !== guildId));
        return entry ? { ...rest, [guildId]: entry } : rest;
    });
}

module.exports = { readAll, getEntry, setEntry, useFile: (file) => store.useFile(file) };
