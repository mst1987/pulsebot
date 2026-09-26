// src/logger.js: a minimal leveled logger on top of console.*. LOG_LEVEL
// gates what gets through; logger.child() prefixes lines per module (#430).

describe("logger", () => {
    const OLD_LEVEL = process.env.LOG_LEVEL;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        console.log.mockRestore();
        console.warn.mockRestore();
        console.error.mockRestore();
        if (OLD_LEVEL === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = OLD_LEVEL;
    });

    it("defaults to info level: debug is suppressed, info/warn/error go through", () => {
        delete process.env.LOG_LEVEL;
        const logger = require("../src/logger.js");
        logger.debug("hidden");
        logger.info("shown");
        logger.warn("also shown");
        logger.error("error shown");
        expect(console.log).not.toHaveBeenCalledWith(expect.anything(), "hidden");
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[info]"), "shown");
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[warn]"), "also shown");
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[error]"), "error shown");
    });

    it("LOG_LEVEL=debug lets debug through", () => {
        process.env.LOG_LEVEL = "debug";
        const logger = require("../src/logger.js");
        logger.debug("now visible");
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[debug]"), "now visible");
    });

    it("LOG_LEVEL=error suppresses debug/info/warn", () => {
        process.env.LOG_LEVEL = "error";
        const logger = require("../src/logger.js");
        logger.debug("d");
        logger.info("i");
        logger.warn("w");
        logger.error("e");
        expect(console.log).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[error]"), "e");
    });

    it("an unknown LOG_LEVEL falls back to info", () => {
        process.env.LOG_LEVEL = "verbose-nonsense";
        const logger = require("../src/logger.js");
        logger.debug("hidden");
        logger.info("shown");
        expect(console.log).toHaveBeenCalledTimes(1);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[info]"), "shown");
    });

    it("child() prefixes the module name and nests on further child() calls", () => {
        delete process.env.LOG_LEVEL;
        const logger = require("../src/logger.js");
        const botLogger = logger.child("bot");
        botLogger.info("hello");
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[bot]"), "hello");

        const nested = botLogger.child("sub");
        nested.warn("nested hello");
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[bot:sub]"), "nested hello");
    });

    it("passes extra arguments through to console.*", () => {
        delete process.env.LOG_LEVEL;
        const logger = require("../src/logger.js");
        const err = new Error("boom");
        logger.child("x").error("failed:", err.message, { extra: true });
        expect(console.error).toHaveBeenCalledWith(expect.any(String), "failed:", "boom", { extra: true });
    });
});
