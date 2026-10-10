// The raid overview groups per game version (#743): TBC and Forever share the Discord server.
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
jest.mock("../../../src/stores/signupStore", () => ({ onSignupsChanged: jest.fn(() => () => {}) }));
jest.mock("../../../src/stores/talkOverviewStore", () => ({ getOverviewState: jest.fn(() => ({})), setOverviewState: jest.fn() }));

const { _internal: { buildOverviewMessage, payloadHash } } = require("../../../src/services/talk/talkOverview");
const { event: baseEvent } = require("../../factories/events");
const { knownChannels } = require("../../helpers/linkCheck");

beforeEach(() => knownChannels("c1"));

const NOW = Date.UTC(2026, 8, 16, 12, 0);
const sec = (d, h = 17) => Math.floor(Date.UTC(2026, 8, d, h, 0) / 1000);
const ev = (over = {}) => baseEvent({ source: "eventhelper", title: "Raid", startTime: sec(17), channelName: "c", signUps: [], ...over });
const opts = { eventGuildId: "111", eventGuildName: "Pulse Events", baseUrl: "https://eh.example", now: NOW, lang: "en" };
const names = (payload) => payload.embeds[0].fields.map((f) => f.name).filter((n) => n.trim() && n !== "​");

describe("talkOverview per game version (#743)", () => {
    const groups = [
        { categoryId: "k1", categoryName: "Donnerstag", events: [ev({ id: "t1", versionId: "tbc", title: "SSC" })] },
        { categoryId: "k2", categoryName: "Montag", events: [ev({ id: "f1", versionId: "forever", title: "Barrow", startTime: sec(16, 20) })] },
    ];

    it("names the version in the field title when raids of several versions are listed, TBC first", () => {
        const payload = buildOverviewMessage(groups, { ...opts, config: {} });
        expect(names(payload)).toEqual(["TBC · Donnerstag", "Forever · Montag"]);
    });

    it("splits one category that holds raids of two versions into one field per version", () => {
        const mixed = [{ categoryId: "k1", categoryName: "Raids", events: [
            ev({ id: "t1", versionId: "tbc", title: "SSC" }), ev({ id: "f1", versionId: "forever", title: "Barrow" }),
        ] }];
        const payload = buildOverviewMessage(mixed, { ...opts, config: {} });
        expect(names(payload)).toEqual(["TBC · Raids", "Forever · Raids"]);
        expect(payload.embeds[0].fields.find((f) => f.name === "Forever · Raids").value).toContain("Barrow");
    });

    it("leaves the version out of the title while only one version is listed", () => {
        const payload = buildOverviewMessage([groups[0]], { ...opts, config: {} });
        expect(names(payload)).toEqual(["Donnerstag"]);
    });

    it("drops the raids of a hidden version (main version TBC)", () => {
        const payload = buildOverviewMessage(groups, { ...opts, config: { hideOtherVersions: true } });
        expect(names(payload)).toEqual(["Donnerstag"]);
        expect(JSON.stringify(payload)).not.toContain("Barrow");
        expect(payload.components[0].components.length).toBeGreaterThan(0);
    });

    it("reads the stored version of a raid, not the category's today", () => {
        const stored = [{ categoryId: "k1", categoryName: "Raids", events: [ev({ id: "x", versionId: "forever", title: "Barrow" })] }];
        const payload = buildOverviewMessage(stored, { ...opts, config: { categoryVersion: { k1: "tbc" } } });
        expect(JSON.stringify(payload)).toContain("Barrow");
    });

    it("keeps the payload hash stable and sensitive to the grouping", () => {
        const a = buildOverviewMessage(groups, { ...opts, config: {} });
        const b = buildOverviewMessage(groups, { ...opts, config: {} });
        const c = buildOverviewMessage(groups, { ...opts, config: { hideOtherVersions: true } });
        expect(payloadHash(a, "en")).toBe(payloadHash(b, "en"));
        expect(payloadHash(a, "en")).not.toBe(payloadHash(c, "en"));
    });
});
