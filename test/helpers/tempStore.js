// A scratch file for a store that a suite points at with `useFile()` (#315).
//
// It used to be `os.tmpdir()/<name>-<process.pid>.json`, which is two
// assumptions at once: that the pid is unique (it is only while the process
// lives - Windows hands them out again, and jest.config.js force-exits its
// workers, so an afterAll can be skipped) and that every suite remembers to
// delete its file. It did not: %TEMP% held 96 stale eh-profiles-route-*.json
// when this was written, because that suite's afterAll only reset the path.
//
// mkdtemp is unique by construction, and `removeTempStores` - registered here,
// so a suite cannot forget it - takes the whole directory with it.
const fs = require("fs");
const os = require("os");
const path = require("path");

const dirs = [];

/** An absolute path to `name` in a scratch directory of this suite's own. */
function tempStoreFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-store-"));
    dirs.push(dir);
    return path.join(dir, name);
}

/** Removes every directory handed out so far. */
function removeTempStores() {
    for (const dir of dirs.splice(0)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
            // a virus scanner still holding the file: %TEMP% survives it
        }
    }
}

// Registered while the suite is collected (a hook cannot be added later), so
// requiring this helper is enough - there is nothing for a suite to forget.
if (typeof afterAll === "function") afterAll(removeTempStores);

module.exports = { tempStoreFile, removeTempStores };
