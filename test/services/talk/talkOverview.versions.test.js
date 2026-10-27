// The raid list per game version (#743, #892): TBC and Forever share the Discord server.
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
jest.mock("../../../src/stores/signupStore", () => ({ onSignupsChanged: jest.fn(() => () => {}) }));
jest.mock("../../../src/stores/talkOverviewStore", () => ({
    overviewKeys: jest.requireActual("../../../src/stores/talkOverviewStore").overviewKeys,
    getOverviewState: jest.fn(() => ({})),
    setOverviewState: jest.fn(),
}));

const { _internal: { buildOverviewMessage, payloadHash } } = require("../../../src/services/talk/talkOverview");
const { event: baseEvent } = require("../../factories/events");
const { knownChannels } = require("../../helpers/linkCheck");

beforeEach(() => knownChannels("c1"));

const NOW = Date.UTC(2026, 8, 16, 12, 0);
const sec = (d, h = 17) => Math.floor(Date.UTC(2026, 8, d, h, 0) / 1000);
const ev = (over = {}) => baseEvent({ source: "eventhelper", title: "Raid", startTime: sec(17), channelName: "c", signUps: [], ...over });
const opts = { eventGuildId: "111", eventGuildName: "Pulse Events", baseUrl: "https://eh.example", now: NOW, lang: "en" };
// the meta line of every raid, in agenda order
const metas = (payload) => (payload.embeds[0].fields || []).flatMap((f) => f.value.split("\n").filter((l) => l.startsWith("-#")));

describe("talkOverview per game version (#743)", () => {
    const groups = [
        { categoryId: "k1", categoryName: "Donnerstag", events: [ev({ id: "t1", versionId: "tbc", title: "SSC" })] },
        { categoryId: "k2", categoryName: "Montag", events: [ev({ id: "f1", versionId: "forever", title: "Barrow", startTime: sec(16, 20) })] },
    ];

    it("names the version in each raid's line when raids of several versions are listed; fields stay days", () => {
        const payload = buildOverviewMessage(groups, { ...opts, config: {} });
        expect(payload.embeds[0].fields.map((f) => f.name)).toEqual(["Wednesday 16 September", "Thursday 17 September"]);
        expect(metas(payload).map((m) => m.split(" · ").slice(0, 2).join(" · "))).toEqual(["-# Forever · Montag", "-# TBC · Donnerstag"]);
    });

    it("names the version per raid inside one category that holds both", () => {
        const mixed = [{ categoryId: "k1", categoryName: "Raids", events: [
            ev({ id: "t1", versionId: "tbc", title: "SSC" }), ev({ id: "f1", versionId: "forever", title: "Barrow", startTime: sec(17, 18) }),
        ] }];
        const [ssc, barrow] = buildOverviewMessage(mixed, { ...opts, config: {} }).embeds[0].fields[0].value.split("\n\n");
        expect(ssc).toContain("-# TBC · Raids");
        expect(barrow).toContain("Barrow");
        expect(barrow).toContain("-# Forever · Raids");
    });

    it("leaves the version out while only one version is listed", () => {
        const payload = buildOverviewMessage([groups[0]], { ...opts, config: {} });
        expect(metas(payload)[0]).toMatch(/^-# Donnerstag ·/);
    });

    it("drops the raids of a hidden version (main version TBC)", () => {
        const payload = buildOverviewMessage(groups, { ...opts, config: { hideOtherVersions: true } });
        expect(metas(payload)).toHaveLength(1);
        expect(metas(payload)[0]).toMatch(/^-# Donnerstag ·/);
        expect(JSON.stringify(payload)).not.toContain("Barrow");
        expect(payload.components[0].components.length).toBeGreaterThan(0);
    });

    it("keeps only the versions a link lists (#892); an empty list means all", () => {
        const only = buildOverviewMessage(groups, { ...opts, config: {}, versions: ["forever"] });
        expect(JSON.stringify(only)).toContain("Barrow");
        expect(JSON.stringify(only)).not.toContain("SSC");
        // one version left: no version in the line
        expect(metas(only)[0]).toMatch(/^-# Montag ·/);
        expect(metas(buildOverviewMessage(groups, { ...opts, config: {}, versions: [] }))).toHaveLength(2);
    });

    it("reads the stored version of a raid, not the category's today", () => {
        const stored = [{ categoryId: "k1", categoryName: "Raids", events: [ev({ id: "x", versionId: "forever", title: "Barrow" })] }];
        const payload = buildOverviewMessage(stored, { ...opts, config: { categoryVersion: { k1: "tbc" } } });
        expect(JSON.stringify(payload)).toContain("Barrow");
    });

    it("keeps the payload hash stable and sensitive to the filtering", () => {
        const a = buildOverviewMessage(groups, { ...opts, config: {} });
        const b = buildOverviewMessage(groups, { ...opts, config: {} });
        const c = buildOverviewMessage(groups, { ...opts, config: { hideOtherVersions: true } });
        expect(payloadHash(a, "en")).toBe(payloadHash(b, "en"));
        expect(payloadHash(a, "en")).not.toBe(payloadHash(c, "en"));
    });
});
