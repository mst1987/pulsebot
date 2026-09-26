// Where the bot keeps its state on disk (#419).
//
// Every store used to build `path.join(__dirname, "..", "..", "data", ...)`
// itself - 32 copies of the same guess. This is the one place that knows it:
//
//   DATA_DIR       <repo>/data, or EVENTHELPER_DATA_DIR when that is set
//                  (a Docker volume, a scratch directory, a second instance
//                  that must not share the first one's settings). A relative
//                  value is taken from the repository root, like the default.
//   SETTINGS_DIR   DATA_DIR/settings - the editable JSON files of the stores.
//
// Read once when the module loads. bot.js loads dotenv before it requires
// anything that stores data, so a value in .env / .env.dev counts.
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");

/** The data directory for an environment - pure, so tests need no re-require. */
function resolveDataDir(env = process.env) {
    const override = String((env && env.EVENTHELPER_DATA_DIR) || "").trim();
    return override ? path.resolve(REPO_ROOT, override) : path.join(REPO_ROOT, "data");
}

const DATA_DIR = resolveDataDir();
const SETTINGS_DIR = path.join(DATA_DIR, "settings");

/** A path below DATA_DIR: dataPath("sim", "results.json"). */
function dataPath(...segments) {
    return path.join(DATA_DIR, ...segments);
}

/** A file in DATA_DIR/settings: settingsPath("events.json"). */
function settingsPath(name) {
    return path.join(SETTINGS_DIR, name);
}

module.exports = { REPO_ROOT, DATA_DIR, SETTINGS_DIR, resolveDataDir, dataPath, settingsPath };
