// Live bot or test instance (#611): NODE_ENV alone cannot tell, the server has
// run without it — the env file bot.js loaded is the second sign.
const { isLiveInstance, runMode } = require("../../src/config/runMode");

describe("config/runMode", () => {
    it("is live with NODE_ENV=production, whatever the file", () => {
        expect(isLiveInstance({ NODE_ENV: "production", EVENTHELPER_ENV_FILE: ".env.dev" })).toBe(true);
        expect(runMode({ NODE_ENV: "production" })).toBe("production");
    });

    it("is live without NODE_ENV when bot.js ran on .env (the server)", () => {
        expect(isLiveInstance({ EVENTHELPER_ENV_FILE: ".env" })).toBe(true);
    });

    it("is a test instance on .env.dev without NODE_ENV (a worktree's npm start)", () => {
        expect(isLiveInstance({ EVENTHELPER_ENV_FILE: ".env.dev" })).toBe(false);
        expect(runMode({ EVENTHELPER_ENV_FILE: ".env.dev" })).toBe("development");
    });

    it("is never live with another NODE_ENV, or with nothing set (Jest, scripts)", () => {
        expect(isLiveInstance({ NODE_ENV: "development", EVENTHELPER_ENV_FILE: ".env" })).toBe(false);
        expect(isLiveInstance({ NODE_ENV: "test", EVENTHELPER_ENV_FILE: ".env" })).toBe(false);
        expect(isLiveInstance({})).toBe(false);
        expect(isLiveInstance(null)).toBe(false);
    });

    it("reads process.env by default", () => {
        expect(runMode()).toBe("development"); // Jest runs with NODE_ENV=test
    });
});
