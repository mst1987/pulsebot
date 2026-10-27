const {
    normalizeLogChannels, logChannelsOf, allLogChannels, logChannelEntry, logChannelsFromBody,
} = require("../../../src/services/logcheck/logChannelSettings");

const CONFIG = {
    mainVersion: "tbc",
    categoryVersion: { catF: "forever" },
    serverSettings: {
        g1: { logChannels: [{ channelId: "c1", versionId: "forever" }, { channelId: "c2", versionId: "" }] },
        g2: { logChannels: [{ channelId: "c3", versionId: "classic" }] },
        g3: {},
    },
};

describe("services/logcheck/logChannelSettings normalizeLogChannels (#921)", () => {
    it("trims ids, keeps the first entry of a channel and clears unknown versions", () => {
        expect(normalizeLogChannels([
            { channelId: " c1 ", versionId: "tbc" },
            { channelId: "c1", versionId: "forever" },
            "c2",
            { channelId: "c3", versionId: "wotlk-nope" },
            { channelId: "" },
            null,
            { channelId: null },
        ])).toEqual([
            { channelId: "c1", versionId: "tbc" },
            { channelId: "c2", versionId: "" },
            { channelId: "c3", versionId: "" },
        ]);
    });

    it("reads anything but a list as none", () => {
        expect(normalizeLogChannels(undefined)).toEqual([]);
        expect(normalizeLogChannels({ c1: "tbc" })).toEqual([]);
    });
});

describe("services/logcheck/logChannelSettings readers", () => {
    it("logChannelsOf gives one server's list, [] for a server without one", () => {
        expect(logChannelsOf("g2", { config: CONFIG })).toEqual([{ channelId: "c3", versionId: "classic" }]);
        expect(logChannelsOf("g3", { config: CONFIG })).toEqual([]);
        expect(logChannelsOf("nope", { config: CONFIG })).toEqual([]);
    });

    it("allLogChannels names every channel with its server", () => {
        expect(allLogChannels({ config: CONFIG })).toEqual([
            { guildId: "g1", channelId: "c1", versionId: "forever" },
            { guildId: "g1", channelId: "c2", versionId: "" },
            { guildId: "g2", channelId: "c3", versionId: "classic" },
        ]);
        expect(allLogChannels({ config: {} })).toEqual([]);
    });

    it("logChannelEntry finds a channel only on its own server", () => {
        expect(logChannelEntry("g1", "c1", { config: CONFIG })).toEqual({ channelId: "c1", versionId: "forever" });
        expect(logChannelEntry("g2", "c1", { config: CONFIG })).toBeNull();
        expect(logChannelEntry("g1", "", { config: CONFIG })).toBeNull();
    });
});

describe("services/logcheck/logChannelSettings logChannelsFromBody", () => {
    const current = [{ channelId: "c1", versionId: "forever" }];
    const parentOf = (id) => (id === "inF" ? "catF" : "");

    it("an entry with a version sets exactly that version", () => {
        expect(logChannelsFromBody([{ channelId: "c1", versionId: "classic" }, { channelId: "c9", versionId: "" }], { current, parentOf, config: CONFIG }))
            .toEqual([{ channelId: "c1", versionId: "classic" }, { channelId: "c9", versionId: "" }]);
    });

    it("a bare id keeps the channel's version", () => {
        expect(logChannelsFromBody(["c1", { channelId: "c1" }], { current, parentOf, config: CONFIG }))
            .toEqual([{ channelId: "c1", versionId: "forever" }]);
    });

    it("a new channel takes its category's version, else the main version", () => {
        expect(logChannelsFromBody(["inF", "loose"], { current, parentOf, config: CONFIG }))
            .toEqual([{ channelId: "inF", versionId: "forever" }, { channelId: "loose", versionId: "tbc" }]);
    });

    it("drops a removed channel and empty entries", () => {
        expect(logChannelsFromBody(["", null], { current, parentOf, config: CONFIG })).toEqual([]);
        expect(logChannelsFromBody("c1", { current, config: CONFIG })).toEqual([]);
    });

    it("works without options (no category, main version)", () => {
        expect(logChannelsFromBody(["x"], { config: { mainVersion: "classic" } })).toEqual([{ channelId: "x", versionId: "classic" }]);
    });
});
