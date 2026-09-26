// The console buffer from test/setup/consoleBuffer.js and the environment that
// drives it (test/setup/environment.js). Tested on a fake console, so nothing
// here depends on - or disturbs - the buffer wrapping this suite's console.
const { createConsoleBuffer, CONTROLLER, METHODS } = require("./consoleBuffer");
const EventHelperEnvironment = require("./environment");
const { fullName } = require("./environment");

function fakeConsole() {
    const out = [];
    const target = {};
    for (const m of METHODS) target[m] = (...args) => out.push([m, ...args]);
    return { target, out };
}

describe("test/setup/consoleBuffer", () => {
    it("is installed for this suite", () => {
        expect(globalThis[CONTROLLER]).toBeDefined();
        expect(typeof globalThis[CONTROLLER].testDone).toBe("function");
    });

    it("drops the output of a passing test", () => {
        const { target, out } = fakeConsole();
        const buffer = createConsoleBuffer(target);
        buffer.testStart();
        target.log("noise");
        target.error("expected error");
        buffer.testDone("passes", false);
        expect(out).toEqual([]);
    });

    it("writes the output of a failing test, in order, with a header", () => {
        const { target, out } = fakeConsole();
        const buffer = createConsoleBuffer(target);
        buffer.testStart();
        target.warn("first", 1);
        target.error("second");
        buffer.testDone("suite > fails", true);
        expect(out).toEqual([
            ["log", expect.stringContaining("suite > fails")],
            ["warn", "first", 1],
            ["error", "second"],
        ]);
    });

    it("shows output from outside a test once, with the first failure", () => {
        const { target, out } = fakeConsole();
        const buffer = createConsoleBuffer(target);
        target.log("loaded module");
        buffer.testStart();
        buffer.testDone("a", true);
        buffer.testStart();
        target.log("b says");
        buffer.testDone("b", true);
        const texts = out.map((row) => row[1]);
        expect(texts.filter((t) => t === "loaded module")).toHaveLength(1);
        expect(texts).toContain("b says");
    });

    it("flushes the file-level output when a beforeAll/afterAll fails", () => {
        const { target, out } = fakeConsole();
        const buffer = createConsoleBuffer(target);
        target.error("connect failed");
        buffer.hookFailed();
        expect(out).toEqual([["error", "connect failed"]]);
    });

    it("restores the original methods", () => {
        const { target } = fakeConsole();
        const original = target.log;
        const buffer = createConsoleBuffer(target);
        expect(target.log).not.toBe(original);
        buffer.restore();
        expect(target.log).toBe(original);
    });
});

describe("test/setup/environment", () => {
    function envWith(controller) {
        const env = Object.create(EventHelperEnvironment.prototype);
        env.global = { [CONTROLLER]: controller };
        return env;
    }

    it("builds the full test name from the describe chain", () => {
        const root = { name: "ROOT_DESCRIBE_BLOCK", parent: null };
        const block = { name: "outer", parent: root };
        expect(fullName({ name: "inner", parent: block })).toBe("outer > inner");
    });

    it("forwards test start, test end (with the failure state) and hook failures", () => {
        const controller = { testStart: jest.fn(), testDone: jest.fn(), hookFailed: jest.fn() };
        const env = envWith(controller);
        const test = { name: "t", parent: null, errors: [] };
        env.handleTestEvent({ name: "test_start", test });
        env.handleTestEvent({ name: "test_done", test });
        env.handleTestEvent({ name: "test_done", test: { ...test, errors: [new Error("x")] } });
        env.handleTestEvent({ name: "hook_failure", hook: { type: "beforeEach" } });
        env.handleTestEvent({ name: "hook_failure", hook: { type: "afterAll" } });
        expect(controller.testStart).toHaveBeenCalledTimes(1);
        expect(controller.testDone.mock.calls).toEqual([["t", false], ["t", true]]);
        expect(controller.hookFailed).toHaveBeenCalledTimes(1);
    });

    it("does nothing without a console buffer", () => {
        expect(() => envWith(undefined).handleTestEvent({ name: "test_start" })).not.toThrow();
    });
});
