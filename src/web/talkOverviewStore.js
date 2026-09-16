// Where the raid overview on the talk server sits and what it showed last (#257).
//
// `data/settings/talk-overview.json` = { channelId, messageId, hash, postedAt,
// editedAt, checkedAt, error } — one message, so one record. Kept out of the
// settings config on purpose: it changes on every sync, and a PATCH of the
// settings page must never race it (or bring an old message id back).

const fs = require("fs");
const path = require("path");

let file = path.join(__dirname, "..", "..", "data", "settings", "talk-overview.json");

const EMPTY = { channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "" };

/** The stored state; every field present, empty when nothing was posted yet. */
function getOverviewState() {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return data && typeof data === "object" && !Array.isArray(data) ? { ...EMPTY, ...data } : { ...EMPTY };
    } catch {
        return { ...EMPTY };
    }
}

/** Merge `patch` into the stored state and return the result. */
function setOverviewState(patch) {
    const next = { ...getOverviewState(), ...(patch || {}) };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
    return next;
}

/** Test-only: point the store at another file. */
function _setFileForTests(next) {
    file = next;
}

module.exports = { getOverviewState, setOverviewState, _setFileForTests };
