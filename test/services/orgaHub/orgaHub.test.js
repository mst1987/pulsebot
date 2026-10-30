// The Orga-Zentrale's data, posting and redraws (services/orgaHub/orgaHub.js),
// with Discord, the event and signup stores mocked; the hub store is real.
let mockEvents = [];
let mockSignups = {};
let mockBase = "https://eh.example";
const mockEventListeners = new Set();
const mockSignupListeners = new Set();

jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(),
    editPayload: jest.fn(),
    deleteMessage: jest.fn(async () => true),
}));
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ categoryNameFor: jest.fn(() => "TBC Montag") }));
jest.mock("../../../src/services/discord/appEmojis", () => ({ ...jest.requireActual("../../../src/services/discord/appEmojis"), appEmojiMap: () => ({}) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: jest.fn((guildId, { sinceSeconds, untilSeconds }) => mockEvents
        .filter((e) => e.startTime >= sinceSeconds && e.startTime <= untilSeconds)
        .sort((a, b) => b.startTime - a.startTime)),
    onEventsChanged: (fn) => {
        mockEventListeners.add(fn);
        return () => mockEventListeners.delete(fn);
    },
}));
jest.mock("../../../src/stores/signupStore", () => ({
    listSignups: (id) => mockSignups[id] || [],
    onSignupsChanged: (fn) => {
        mockSignupListeners.add(fn);
        return () => mockSignupListeners.delete(fn);
    },
}));
jest.mock("../../../src/services/versions/mainVersion", () => ({
    versionOfEvent: (e) => e.versionId || "tbc",
    visibleRows: (rows, versionOf) => rows.filter((r) => versionOf(r) !== "hidden"),
}));
jest.mock("../../../src/utils/publicUrl", () => ({ publicBaseUrl: () => mockBase }));
jest.mock("../../../src/logger", () => ({ warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const logger = require("../../../src/logger");
const store = require("../../../src/stores/orgaHubStore");
const hub = require("../../../src/services/orgaHub/orgaHub");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const NOW_SEC = Math.floor(NOW / 1000);
const DAY = 86400;

const ev = (id, over = {}) => ({
    id, categoryId: "cat1", title: `Raid ${id}`, startTime: NOW_SEC + 5 * DAY, channelId: `ch-${id}`, status: "active",
    signupDeadline: 0, size: 25, setup: null, setupPost: null, ...over,
});

const posted = (messageId = "m1", channelId = "c1") => ({ guildId: "g1", channelId, messageId, url: `https://discord.com/channels/g1/${channelId}/${messageId}` });

beforeAll(() => store.useFile(tempStoreFile("orga-hubs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    for (const h of store.listHubs()) store.removeHub(h.categoryId);
    mockBase = "https://eh.example";
    mockSignups = {};
    mockEvents = [
        ev("eh-b", { startTime: NOW_SEC + 9 * DAY }),
        ev("eh-a", { startTime: NOW_SEC + 2 * DAY, setup: { status: "draft", groups: [{ slots: [{ userId: "u1" }] }] } }),
        ev("eh-x", { status: "cancelled", startTime: NOW_SEC + 3 * DAY }),
        ev("eh-old", { startTime: NOW_SEC - DAY }),
        ev("eh-far", { startTime: NOW_SEC + 40 * DAY }),
        ev("eh-other", { categoryId: "cat2" }),
        ev("eh-hidden", { versionId: "hidden" }),
    ];
    mockSignups["eh-b"] = [{ userId: "u1", status: "signed" }];
});

describe("services/orgaHub/orgaHub hubRaids", () => {
    it("lists the category's raids of the next four weeks, soonest first, with status and link", () => {
        const raids = hub.hubRaids("cat1", { now: NOW });
        expect(raids.map((r) => r.id)).toEqual(["eh-a", "eh-x", "eh-b"]);
        expect(raids[0]).toMatchObject({ status: "draft", linkLabel: "Setup", url: "https://eh.example/raids/detail?event=eh-a&tab=setup", channelId: "ch-eh-a" });
        expect(raids[1]).toMatchObject({ status: "cancelled", linkLabel: "", url: "" });
        expect(raids[2]).toMatchObject({ status: "signup", detail: "1 Anmeldung", linkLabel: "Raid", url: "https://eh.example/raids/detail?event=eh-b" });
    });

    it("gives no links without a public address", () => {
        mockBase = "";
        expect(hub.hubRaids("cat1", { now: NOW }).every((r) => r.url === "")).toBe(true);
    });

    it("is empty without a category", () => {
        expect(hub.hubRaids("", { now: NOW })).toEqual([]);
    });
});

describe("services/orgaHub/orgaHub currentPayload", () => {
    it("counts the active raids in the heading and links all raids in the web", () => {
        const p = hub.currentPayload("cat1", {}, { now: NOW });
        const head = p.components[0].components[0].content;
        expect(head).toContain("Orga-Zentrale · TBC Montag");
        expect(head).toContain("2 Raids in den nächsten 4 Wochen");
        expect(JSON.stringify(p)).toContain("https://eh.example/raids\"");
    });
});

describe("services/orgaHub/orgaHub postHub / removeHub", () => {
    it("posts the hub, remembers it and drops the category's earlier one", async () => {
        discord.postPayload.mockResolvedValueOnce(posted("m1", "c1")).mockResolvedValueOnce(posted("m2", "c2"));
        const first = await hub.postHub({ categoryId: "cat1", channelId: "c1", by: "u9", now: NOW });
        expect(first.url).toBe("https://discord.com/channels/g1/c1/m1");
        expect(first.hub).toMatchObject({ categoryId: "cat1", guildId: "g1", channelId: "c1", messageId: "m1", postedBy: "u9", postedAt: NOW });
        expect(first.hub.hash).toHaveLength(16);
        expect(discord.deleteMessage).not.toHaveBeenCalled();

        await hub.postHub({ categoryId: "cat1", channelId: "c2", now: NOW });
        expect(discord.deleteMessage).toHaveBeenCalledWith("c1", "m1");
        expect(store.getHub("cat1").messageId).toBe("m2");
    });

    it("refuses without category or channel and reports a failed post", async () => {
        expect(await hub.postHub({ channelId: "c1" })).toEqual({ error: "Keine Kategorie gewählt." });
        expect(await hub.postHub({ categoryId: "cat1" })).toEqual({ error: "Kein Kanal gewählt." });
        discord.postPayload.mockRejectedValueOnce(new Error("Missing Access"));
        expect((await hub.postHub({ categoryId: "cat1", channelId: "c1" })).error).toContain("Missing Access");
        expect(store.getHub("cat1")).toBeNull();
    });

    it("takes a hub down with its message", async () => {
        store.setHub({ categoryId: "cat1", channelId: "c1", messageId: "m1" });
        expect(await hub.removeHub("cat1")).toMatchObject({ messageId: "m1" });
        expect(discord.deleteMessage).toHaveBeenCalledWith("c1", "m1");
        expect(await hub.removeHub("cat1")).toBeNull();
    });
});

describe("services/orgaHub/orgaHub saveLinks", () => {
    const A = { label: "WCL", url: "https://www.warcraftlogs.com/guild/x" };

    beforeEach(() => {
        for (const cat of ["cat1", "cat7"]) store.setLinks(cat, []);
    });

    it("shows the links in the hub's payload", () => {
        store.setLinks("cat1", [A]);
        const p = hub.currentPayload("cat1", {}, { now: NOW });
        expect(JSON.stringify(p)).toContain(A.url);
        expect(JSON.stringify(hub.currentPayload("cat2", {}, { now: NOW }))).not.toContain(A.url);
    });

    it("saves and redraws that category's posted hub at once", async () => {
        discord.postPayload.mockResolvedValue(posted("m1", "c1"));
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        discord.editPayload.mockResolvedValue(posted());
        expect(await hub.saveLinks("cat1", [A])).toEqual({ links: [A] });
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(discord.editPayload.mock.calls[0][2])).toContain(A.url);
        expect(store.getLinks("cat1")).toEqual([A]);
        // the new fingerprint is remembered, so the sweep leaves it alone
        expect(await hub.refreshHubs()).toMatchObject({ edited: 0, unchanged: 1 });
    });

    it("refuses bad links without saving or redrawing, and saves for a category without a hub", async () => {
        expect(await hub.saveLinks("cat1", [{ label: "X", url: "ftp://x" }])).toEqual({ error: expect.stringContaining("https://") });
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(store.getLinks("cat1")).toEqual([]);
        expect(await hub.saveLinks("cat7", [A])).toEqual({ links: [A] });
        expect(discord.editPayload).not.toHaveBeenCalled();
    });
});

describe("services/orgaHub/orgaHub saveFeatures (#969)", () => {
    afterEach(() => store.setFeatures("cat1", { newRaid: true, links: true, summary: true }));

    it("saves and redraws the posted hub at once without the switched-off button", async () => {
        discord.postPayload.mockResolvedValue(posted("m1", "c1"));
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        discord.editPayload.mockResolvedValue(posted());
        const res = await hub.saveFeatures("cat1", { newRaid: false });
        expect(res.features).toMatchObject({ newRaid: false, links: true, summary: true });
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(discord.editPayload.mock.calls[0][2])).not.toContain("orga:new:cat1");
        expect(store.getFeatures("cat1").newRaid).toBe(false);
    });

    it("refuses an unknown part without saving or redrawing", async () => {
        const res = await hub.saveFeatures("cat1", { bogus: false });
        expect(res.error).toBeTruthy();
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(store.getFeatures("cat1")).toMatchObject({ newRaid: true, links: true, summary: true });
    });
});

describe("services/orgaHub/orgaHub refreshHubs", () => {
    beforeEach(() => {
        discord.postPayload.mockResolvedValue(posted("m1", "c1"));
    });

    it("leaves a hub alone whose content is unchanged and redraws a stale one", async () => {
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        expect(await hub.refreshHubs({ now: NOW })).toEqual({ edited: 0, reposted: 0, failed: 0, unchanged: 1 });
        mockSignups["eh-b"] = [{ userId: "u1", status: "signed" }, { userId: "u2", status: "signed" }];
        discord.editPayload.mockResolvedValue(posted());
        expect(await hub.refreshHubs({ now: NOW })).toEqual({ edited: 1, reposted: 0, failed: 0, unchanged: 0 });
        expect(discord.editPayload).toHaveBeenCalledWith("c1", "m1", expect.objectContaining({ flags: expect.any(Number) }));
        expect(await hub.refreshHubs({ now: NOW })).toMatchObject({ unchanged: 1 });
    });

    it("redraws all of them with onlyStale off, and only the one category asked for", async () => {
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        discord.postPayload.mockResolvedValue(posted("m2", "c2"));
        await hub.postHub({ categoryId: "cat2", channelId: "c2", now: NOW });
        discord.editPayload.mockResolvedValue(posted());
        expect(await hub.refreshHubs({ onlyStale: false, categoryId: "cat2", now: NOW })).toMatchObject({ edited: 1 });
        expect(discord.editPayload).toHaveBeenCalledWith("c2", "m2", expect.any(Object));
    });

    it("posts a deleted hub anew into its channel", async () => {
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        discord.editPayload.mockRejectedValue(Object.assign(new Error("Unknown Message"), { code: 10008 }));
        discord.postPayload.mockResolvedValue(posted("m9", "c1"));
        expect(await hub.refreshHubs({ onlyStale: false, now: NOW })).toMatchObject({ reposted: 1 });
        expect(store.getHub("cat1")).toMatchObject({ channelId: "c1", messageId: "m9" });
    });

    it("logs a hub that cannot be drawn only once", async () => {
        await hub.postHub({ categoryId: "cat1", channelId: "c1", now: NOW });
        discord.editPayload.mockRejectedValue(new Error("Missing Access"));
        expect(await hub.refreshHubs({ onlyStale: false, now: NOW })).toMatchObject({ failed: 1 });
        await hub.refreshHubs({ onlyStale: false, now: NOW });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        discord.editPayload.mockResolvedValue(posted());
        expect(await hub.refreshHubs({ onlyStale: false, now: NOW })).toMatchObject({ edited: 1 });
    });
});

describe("services/orgaHub/orgaHub start / nudge", () => {
    // the clock starts at NOW: with the real date the fixture raids would lie in the past one day
    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => {
        hub.stopOrgaHubs();
        jest.useRealTimers();
    });

    it("schedules nothing while no hub is posted", () => {
        expect(hub.scheduleRefresh()).toBeNull();
    });

    it("forgets a deleted hub's fingerprint, so the next redraw posts it anew", async () => {
        discord.postPayload.mockResolvedValue(posted("m1", "c1"));
        await hub.postHub({ categoryId: "cat1", channelId: "c1" });
        expect(hub.onHubMessageDeleted("other")).toBe(false);
        expect(hub.onHubMessageDeleted("")).toBe(false);
        expect(hub.onHubMessageDeleted("m1", { delayMs: 10 })).toBe(true);
        expect(store.getHub("cat1").hash).toBe("");
        discord.editPayload.mockRejectedValue(Object.assign(new Error("Unknown Message"), { code: 10008 }));
        discord.postPayload.mockResolvedValue(posted("m2", "c1"));
        await jest.advanceTimersByTimeAsync(20);
        expect(store.getHub("cat1").messageId).toBe("m2");
    });

    it("sweeps after the first delay and redraws a few seconds after a change", async () => {
        discord.postPayload.mockResolvedValue(posted());
        await hub.postHub({ categoryId: "cat1", channelId: "c1" });
        discord.editPayload.mockResolvedValue(posted());
        const stop = hub.startOrgaHubs({ firstDelayMs: 1000, intervalMs: 60000, nudgeMs: 50 });
        expect(hub.startOrgaHubs()).toBe(stop);
        expect(mockEventListeners.size).toBe(1);
        expect(mockSignupListeners.size).toBe(1);

        // a signup changes: the redraw follows after the nudge delay, once for a burst
        mockSignups["eh-b"] = [];
        for (const fn of mockSignupListeners) fn("eh-b");
        for (const fn of mockEventListeners) fn();
        await jest.advanceTimersByTimeAsync(60);
        expect(discord.editPayload).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        stop();
        expect(mockEventListeners.size).toBe(0);
        expect(mockSignupListeners.size).toBe(0);
        hub.stopOrgaHubs();
    });
});
