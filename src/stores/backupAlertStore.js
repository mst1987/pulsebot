// What the backup monitoring (#696) has already told the admin by Discord DM: per part (snapshot, offsite,
// restoreTest) the state it was told about and when. It is the throttle - the same state is not announced again
// within 24 hours, a changed state at once. A part that is no longer red has no entry.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const store = createJsonStore({
    file: settingsPath("backup-alerts.json"),
    defaults: () => ({}),
    normalize: (data) => {
        const out = {};
        if (!data || typeof data !== "object" || Array.isArray(data)) return out;
        for (const [part, entry] of Object.entries(data)) {
            if (entry && typeof entry === "object" && typeof entry.state === "string" && Number.isFinite(Number(entry.at))) {
                out[part] = { state: entry.state, at: Number(entry.at) };
            }
        }
        return out;
    },
});

module.exports = { readAll: () => store.read(), writeAll: (data) => store.write(data), useFile: (file) => store.useFile(file) };
