// Console buffer (#432): replaces the old `silent: true`. The bot logs a lot
// (errors it catches on purpose, "posted message ..." lines), which buries the
// test report - but when a test FAILS those lines are exactly what you want.
//
// So console.log/info/warn/error/debug are held back per test and only written
// out (through Jest's own console, so they land in the normal report) when the
// test failed. Output outside a test - module load, beforeAll/afterAll - is
// kept per file and shown along with the first failure, or when a hook fails.
//
// This file is a `setupFilesAfterEnv` entry (it wraps the console Jest already
// installed). The test lifecycle comes from test/setup/environment.js, which
// sees Jest's test events and calls the controller published on the global.
const METHODS = ["log", "info", "warn", "error", "debug"];
const CONTROLLER = Symbol.for("eventhelper.consoleBuffer");

function createConsoleBuffer(target) {
    const originals = {};
    for (const m of METHODS) originals[m] = target[m];

    let fileLines = [];
    let testLines = null; // null = outside a test
    let fileFlushed = false;

    function write(lines) {
        for (const { method, args } of lines) originals[method].apply(target, args);
    }

    for (const method of METHODS) {
        target[method] = function (...args) {
            (testLines || fileLines).push({ method, args });
        };
    }

    return {
        /** A test starts: its lines go to a fresh buffer. */
        testStart() {
            testLines = [];
        },
        /** A test ends: write its lines out only if it failed. */
        testDone(testName, failed) {
            const lines = testLines || [];
            testLines = null;
            if (!failed) return;
            if (!fileFlushed && fileLines.length) {
                originals.log.call(target, "--- Konsole außerhalb der Tests (Laden, beforeAll) ---");
                write(fileLines);
                fileLines = [];
                fileFlushed = true;
            }
            if (lines.length) {
                originals.log.call(target, `--- Konsole von fehlgeschlagenem Test: ${testName} ---`);
                write(lines);
            }
        },
        /** A beforeAll/afterAll failed: the file-level lines explain it. */
        hookFailed() {
            if (fileLines.length) write(fileLines.splice(0));
        },
        /** Puts the original methods back (used by the tests of this file). */
        restore() {
            for (const m of METHODS) target[m] = originals[m];
        },
    };
}

if (typeof globalThis.console === "object" && !globalThis[CONTROLLER]) {
    globalThis[CONTROLLER] = createConsoleBuffer(globalThis.console);
}

module.exports = { createConsoleBuffer, CONTROLLER, METHODS };
