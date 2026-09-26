const defaults = require("../../src/config/defaults");
const constants = require("../../src/config/constants");
const { isSnowflake } = require("../../src/utils/ids");

describe("config/defaults", () => {
    it("holds Discord snowflakes for every bootstrap id", () => {
        for (const id of [defaults.adminUserId, defaults.guildId, defaults.highestBidsChannelId, defaults.highestBidsMessageId, ...defaults.categoryIds]) {
            expect(isSnowflake(id)).toBe(true);
        }
    });

    it("keeps the {char} placeholder in the url templates", () => {
        expect(defaults.applyArmoryUrlTemplate).toContain("{char}");
        expect(defaults.applyWclUrlTemplate).toContain("{char}");
    });

    it("never reads the environment", () => {
        const source = require("fs").readFileSync(require.resolve("../../src/config/defaults"), "utf8");
        expect(source).not.toMatch(/process\.env/);
    });
});

describe("config/constants", () => {
    it("names the Raid-Helper bot by its snowflake", () => {
        expect(isSnowflake(constants.RAIDHELPER_BOT_ID)).toBe(true);
    });

    it("keeps the timings the code relies on", () => {
        expect(constants.REPLY_DELETE_AFTER_MS).toBe(60000);
        expect(constants.APPLICATION_STALE_AFTER_MS).toBe(30 * 60 * 1000);
        expect(constants.APPLICATION_SWEEP_INTERVAL_MS).toBe(5 * 60 * 1000);
        expect(constants.RAIDHELPER_REQUEST_TIMEOUT_MS).toBe(20000);
        expect(constants.APPLICATION_SWEEP_INTERVAL_MS).toBeLessThan(constants.APPLICATION_STALE_AFTER_MS);
    });

    it("never reads the environment", () => {
        const source = require("fs").readFileSync(require.resolve("../../src/config/constants"), "utf8");
        expect(source).not.toMatch(/process\.env/);
    });
});

describe("config/variables (facade)", () => {
    it("re-exports the specific modules' values under the old names", () => {
        const variables = require("../../src/config/variables");
        const env = require("../../src/config/env");
        expect(variables.raidhelperBotId).toBe(constants.RAIDHELPER_BOT_ID);
        expect(variables.embedAccentColor).toBe(constants.EMBED_ACCENT_COLOR);
        expect(variables.defaultTimeout).toBe(constants.REPLY_DELETE_AFTER_MS);
        expect(variables.categoryIds).toBe(defaults.categoryIds);
        expect(variables.webPort).toBe(env.webPort);
        expect(variables.logcheckAdminIds).toBe(env.logcheckAdminIds);
    });
});
