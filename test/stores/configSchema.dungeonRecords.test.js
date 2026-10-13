// "Neue Gildenrekorde posten" (configSchema.normalizeDungeonRecords): off unless switched on.
const { normalizeDungeonRecords, normalizeConfig } = require("../../src/stores/configSchema");

describe("stores/configSchema normalizeDungeonRecords", () => {
    it("posts only on a literal true and keeps only a snowflake channel", () => {
        expect(normalizeDungeonRecords(undefined)).toEqual({ post: false, channelId: "" });
        expect(normalizeDungeonRecords({ post: "true", channelId: "abc" })).toEqual({ post: false, channelId: "" });
        expect(normalizeDungeonRecords({ post: true, channelId: " 123456789012345678 ", extra: 1 })).toEqual({ post: true, channelId: "123456789012345678" });
    });

    it("is part of every normalised config, off by default", () => {
        expect(normalizeConfig({}).dungeonRecords).toEqual({ post: false, channelId: "" });
        expect(normalizeConfig({ dungeonRecords: { post: true } }).dungeonRecords.post).toBe(true);
    });
});
