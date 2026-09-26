const https = require("https");

describe("utils/httpAgent", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.resetModules();
    });

    it("is one shared https.Agent without keep-alive, verifying only in production", () => {
        const agent = require("../../src/utils/httpAgent.js");
        expect(agent).toBeInstanceOf(https.Agent);
        expect(require("../../src/utils/httpAgent.js")).toBe(agent);
        expect(agent.keepAlive).toBe(false);
        // jest runs with NODE_ENV "test": certificates are not verified
        expect(process.env.NODE_ENV).toBe("test");
        expect(agent.options.rejectUnauthorized).toBe(false);
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
