// The raid list per game version (#743, #892): TBC and Forever share the Discord server.
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
jest.mock("../../../src/stores/events/signupStore", () => ({ onSignupsChanged: jest.fn(() => () => {}) }));
jest.mock("../../../src/stores/discord/talkOverviewStore", () => ({
    overviewKeys: jest.requireActual("../../../src/stores/discord/talkOverviewStore").overviewKeys,
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
// all the text of the container, sections included
const text = (payload) => payload.components[0].components
    .flatMap((c) => (c.type === 10 ? [c.content] : (c.components || []).filter((t) => t.type === 10).map((t) => t.content)))
    .join("\n");
const headings = (payload) => text(payload).match(/^### .*$/gm) || [];
// the small line of every raid, in block order; the first small line is the head's
const metas = (payload) => text(payload).split("\n").filter((l) => l.startsWith("-# ")).slice(1);

describe("talkOverview per game version (#743)", () => {
    const groups = [
        { categoryId: "k1", categoryName: "Donnerstag", events: [ev({ id: "t1", versionId: "tbc", title: "SSC" })] },
        { categoryId: "k2", categoryName: "Montag", events: [ev({ id: "f1", versionId: "forever", title: "Barrow", instanceIds: ["forever-barrow"], startTime: sec(16, 20) })] },
    ];

    it("names the version in each block's name when raids of several versions are listed", () => {
        const payload = buildOverviewMessage(groups, { ...opts, config: {} });
        expect(headings(payload)).toEqual(["### Barrow Deeps · Forever", "### Höhle des Schlangenschreins · TBC"]);
        expect(metas(payload).map((m) => m.split(" · ")[0])).toEqual(["-# Montag", "-# Donnerstag"]);
    });

    it("keeps the versions apart inside one category, even for one title", () => {
        const mixed = [{ categoryId: "k1", categoryName: "Raids", events: [
            ev({ id: "t1", versionId: "tbc", title: "Donnerstagsraid" }),
            ev({ id: "f1", versionId: "forever", title: "Donnerstagsraid", startTime: sec(17, 18) }),
        ] }];
        expect(headings(buildOverviewMessage(mixed, { ...opts, config: {} }))).toEqual(["### Donnerstagsraid · TBC", "### Donnerstagsraid · Forever"]);
    });

    it("leaves the version out while only one version is listed", () => {
        const payload = buildOverviewMessage([groups[0]], { ...opts, config: {} });
        expect(headings(payload)).toEqual(["### Höhle des Schlangenschreins"]);
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
        // one version left: no version in the block's name
        expect(headings(only)).toEqual(["### Barrow Deeps"]);
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
