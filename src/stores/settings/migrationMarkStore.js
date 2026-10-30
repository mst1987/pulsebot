// Which one-off start-up migrations have finished for good (#920): `{ done: { [key]: at } }`.
//
// Most upgrades in settingsMigration.js look at a small file and see from the data
// that there is nothing left to do. A few would have to open many large files to
// find that out on every start (the reports: megabytes each); those run once, write
// their mark here and are skipped from then on. Deleting the file runs them again -
// they are idempotent, it only costs the start-up time once more.
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const store = createJsonStore({
    file: settingsPath("migrations.json"),
    defaults: () => ({ done: {} }),
    normalize: (data) => {
        const done = {};
        const src = data && typeof data === "object" && data.done && typeof data.done === "object" ? data.done : {};
        for (const [key, at] of Object.entries(src)) {
            if (key && Number.isFinite(Number(at))) done[key] = Number(at);
        }
        return { done };
    },
});

/** Has the migration `key` finished? */
function isDone(key) {
    return Object.prototype.hasOwnProperty.call(store.read().done, String(key));
}

/** Mark the migration `key` as finished (keeps the first time it finished). */
function markDone(key, at = Date.now()) {
    store.update((data) => {
        if (!Object.prototype.hasOwnProperty.call(data.done, String(key))) data.done[String(key)] = Number(at);
        return data;
    });
}

module.exports = { isDone, markDone, useFile: (file) => store.useFile(file) };
