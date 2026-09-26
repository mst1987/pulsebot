// Test environment for the suite (#432): plain Node, plus the lifecycle hooks
// the console buffer (test/setup/consoleBuffer.js) needs. Jest tells the
// environment about every test event; a setup file on its own cannot see
// whether a test failed.
const { TestEnvironment } = require("jest-environment-node");

const CONTROLLER = Symbol.for("eventhelper.consoleBuffer");

/** The full name of a jest-circus test ("describe > it"). */
function fullName(test) {
    const parts = [];
    for (let t = test; t && t.name && t.name !== "ROOT_DESCRIBE_BLOCK"; t = t.parent) parts.unshift(t.name);
    return parts.join(" > ");
}

class EventHelperEnvironment extends TestEnvironment {
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
