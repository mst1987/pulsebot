const https = require("https");

describe("utils/httpAgent", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.resetModules();
    });

    it("is an https.Agent", () => {
        const agent = require("../../src/utils/httpAgent.js");
        expect(agent).toBeInstanceOf(https.Agent);
    });

    it("verifies certificates in production", () => {
        process.env.NODE_ENV = "production";
        jest.resetModules();
        const agent = require("../../src/utils/httpAgent.js");
        expect(agent.options.rejectUnauthorized).toBe(true);
    });

    it("does not verify certificates outside production", () => {
        process.env.NODE_ENV = "development";
        jest.resetModules();
        const agent = require("../../src/utils/httpAgent.js");
        expect(agent.options.rejectUnauthorized).toBe(false);
    });
});
