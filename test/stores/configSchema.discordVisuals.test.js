// The switches of the drawn pictures in bot messages (configSchema.normalizeDiscordVisuals, a test of Oct 2026).
const { normalizeDiscordVisuals, normalizeConfig, DISCORD_VISUALS_DEFAULT } = require("../../src/stores/configSchema");

describe("stores/configSchema normalizeDiscordVisuals", () => {
    it("turns every picture on unless it is stored as false", () => {
        expect(normalizeDiscordVisuals(undefined)).toEqual({ overviewWeekStrip: true, setupImage: true, eventCover: true });
        expect(normalizeDiscordVisuals([])).toEqual(DISCORD_VISUALS_DEFAULT);
        expect(normalizeDiscordVisuals({ setupImage: false, eventCover: 0, extra: false })).toEqual({ overviewWeekStrip: true, setupImage: false, eventCover: true });
    });

    it("is part of every normalised config", () => {
        expect(normalizeConfig({}).discordVisuals).toEqual(DISCORD_VISUALS_DEFAULT);
        expect(normalizeConfig({ discordVisuals: { overviewWeekStrip: false } }).discordVisuals.overviewWeekStrip).toBe(false);
    });
});
