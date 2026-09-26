// Test environment for the suite (#432): plain Node, plus the lifecycle hooks
// the console buffer (test/setup/consoleBuffer.js) needs. Jest tells the
// environment about every test event; a setup file on its own cannot see
// whether a test failed.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { TestEnvironment } = require("jest-environment-node");

const CONTROLLER = Symbol.for("eventhelper.consoleBuffer");

/** The full name of a jest-circus test ("describe > it"). */
function fullName(test) {
    const parts = [];
    for (let t = test; t && t.name && t.name !== "ROOT_DESCRIBE_BLOCK"; t = t.parent) parts.unshift(t.name);
    return parts.join(" > ");
}

class EventHelperEnvironment extends TestEnvironment {
    // Every suite gets a data directory of its own (#433): src/config/paths.js
    // reads EVENTHELPER_DATA_DIR when it loads, so a store or auth.js's session
    // file that a suite does not point elsewhere lands here instead of the
    // checkout's data/ (auth.test.js wrote data/sessions.json until then).
    // The directory is only created by whoever writes into it; teardown takes
    // it away. A suite that sets the variable itself keeps its own value.
    async setup() {
        await super.setup();
        const env = this.global.process.env;
        if (!env.EVENTHELPER_DATA_DIR) {
            this.dataDir = path.join(os.tmpdir(), `eh-test-data-${crypto.randomUUID()}`);
            env.EVENTHELPER_DATA_DIR = this.dataDir;
        }
    }

    async teardown() {
        if (this.dataDir) {
            try {
                fs.rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 3 });
            } catch {
                // a virus scanner still holding a file: %TEMP% survives it
            }
        }
        await super.teardown();
    }

    handleTestEvent(event) {
        const buffer = this.global[CONTROLLER];
        if (!buffer) return;
        if (event.name === "test_start") buffer.testStart();
        else if (event.name === "test_done") buffer.testDone(fullName(event.test), event.test.errors.length > 0);
        else if (event.name === "hook_failure" && (event.hook.type === "beforeAll" || event.hook.type === "afterAll")) buffer.hookFailed();
    }
}

module.exports = EventHelperEnvironment;
module.exports.fullName = fullName;
