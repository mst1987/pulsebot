// The job behind the temporary raid voice channels (services/voice/tempVoiceJob.js):
// Discord and the event store are mocked, the job's own store is a temp file.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

const mockEvents = [];
const mockListeners = [];
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: jest.fn((guildId, opts = {}) => mockEvents
        .filter((e) => !guildId || e.guildId === guildId)
        .filter((e) => !opts.sinceSeconds || e.startTime >= opts.sinceSeconds)
        .filter((e) => !opts.untilSeconds || e.startTime <= opts.untilSeconds)
        .map((e) => ({ ...e }))),
    getEvent: jest.fn((id) => {
        const hit = mockEvents.find((e) => e.id === id);
        return hit ? { ...hit } : null;
    }),
    onEventsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
let mockConfig = {};
const mockParent = "222222222222222222";
const mockFixed = "333333333333333333";
jest.mock("../../../src/stores/settings/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => ({ getGuild: jest.fn(() => ({ id: "g1" })), isOnline: jest.fn(() => true) }));
jest.mock("../../../src/services/voice/tempVoiceDiscord", () => ({
    createVoice: jest.fn(async (guildId, plan) => ({ id: `v-${plan.eventId}`, name: plan.name })),
    renameVoice: jest.fn(async (g, c, name) => name),
    closeVoice: jest.fn(async () => ({ moved: 0, deleted: true })),
    syncMembers: jest.fn(async () => 0),
    memberCount: jest.fn(() => 0),
    missingRights: jest.fn(() => []),
    memberName: jest.fn((g, id) => (id === "u9" ? "Lahelo" : "")),
    channelName: jest.fn((g, id) => ({ [mockParent]: "Raids", [mockFixed]: "Raid-Talk" })[id] || ""),
    channelUrl: (g, c) => `https://discord.com/channels/${g}/${c}`,
}));

const tempVoiceStore = require("../../../src/stores/events/tempVoiceStore");
const voice = require("../../../src/services/voice/tempVoiceDiscord");
const discord = require("../../../src/services/discord/discord");
const job = require("../../../src/services/voice/tempVoiceJob");

const FILE = tempStoreFile("temp-voice-job.json");
const CAT = "111111111111111111";
const PARENT = mockParent;
const FIXED = mockFixed;
const START = 1_793_473_200; // Sa 31.10.2026 20:00 Berlin
const raid = (over = {}) => ({
    id: "eh-1", guildId: "g1", categoryId: CAT, instanceIds: ["ssc"], title: "SSC", startTime: START, durationMinutes: 180, ...over,
});
const setCategory = (cat, extra = {}) => {
    mockConfig = { categoryTempVoice: { [CAT]: { parentId: PARENT, ...cat } }, ...extra };
};

beforeEach(() => {
    jest.clearAllMocks();
    job._resetForTests();
    tempVoiceStore.useFile(FILE);
    fs.rmSync(FILE, { force: true });
    mockEvents.length = 0;
    setCategory({ mode: "temp" });
    voice.memberCount.mockImplementation(() => 0);
    discord.getGuild.mockImplementation(() => ({ id: "g1" }));
});
afterAll(() => {
    job._resetForTests();
    tempVoiceStore.useFile(null);
});

describe("services/voice/tempVoiceJob", () => {
    describe("opening", () => {
        it("opens the channel lead minutes before the start, not earlier, and only once", async () => {
            mockEvents.push(raid());
            expect((await job.runTempVoice({ now: START - 31 * 60 })).opened).toEqual([]);
            expect((await job.runTempVoice({ now: START - 30 * 60 })).opened).toEqual(["eh-1"]);
            expect(voice.createVoice).toHaveBeenCalledWith("g1", expect.objectContaining({ name: "SSC · Sa 31.10.", parentId: PARENT }));
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", createdAt: START - 1800, closedAt: 0 });
            await job.runTempVoice({ now: START - 29 * 60 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
        });

        it("opens nothing without a mode, for a fixed channel or a cancelled raid", async () => {
            mockEvents.push(raid({ id: "a" }), raid({ id: "b", categoryId: "other" }), raid({ id: "c", status: "cancelled" }));
            setCategory({ mode: "existing" }, { categoryVoiceChannel: { [CAT]: FIXED } });
            expect((await job.runTempVoice({ now: START })).opened).toEqual([]);
            setCategory({ mode: "temp" });
            expect((await job.runTempVoice({ now: START })).opened).toEqual(["a"]);
        });

        it("notes a failed create and tries again only after ten minutes", async () => {
            mockEvents.push(raid());
            voice.createVoice.mockRejectedValueOnce(new Error("Missing Permissions"));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "", error: "Missing Permissions" });
            await job.runTempVoice({ now: START - 1500 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            await job.runTempVoice({ now: START - 1200 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", error: "" });
        });

        it("waits while the bot is not on the server", async () => {
            mockEvents.push(raid());
            discord.getGuild.mockImplementation(() => null);
            expect((await job.runTempVoice({ now: START })).opened).toEqual([]);
            expect(voice.createVoice).not.toHaveBeenCalled();
        });
    });

    describe("closing", () => {
        const openAt = async () => {
            mockEvents.push(raid());
            await job.runTempVoice({ now: START - 1800 });
        };

        it("never closes an empty channel before the raid's end", async () => {
            await openAt();
            expect((await job.runTempVoice({ now: START + 3600 })).closed).toEqual([]);
            expect(tempVoiceStore.getEntry("eh-1").closedAt).toBe(0);
        });

        it("closes after five empty minutes once the raid is over", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => 4);
            await job.runTempVoice({ now: START + 180 * 60 });
            voice.memberCount.mockImplementation(() => 0);
            await job.runTempVoice({ now: START + 181 * 60 });
            expect(tempVoiceStore.getEntry("eh-1").emptySince).toBe(START + 181 * 60);
            expect((await job.runTempVoice({ now: START + 185 * 60 })).closed).toEqual([]);
            expect((await job.runTempVoice({ now: START + 186 * 60 })).closed).toEqual(["eh-1"]);
            expect(voice.closeVoice).toHaveBeenCalledWith("g1", "v-eh-1", { moveTo: "" });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ closedAt: START + 186 * 60, closeReason: "empty" });
        });

        it("at the latest close moves those still in it to the fixed channel", async () => {
            setCategory({ mode: "existing", fromRaid2: true }, { categoryVoiceChannel: { [CAT]: FIXED } });
            mockEvents.push(raid({ raidGroupId: "eh-1" }), raid({ id: "eh-2", raidGroupId: "eh-1", raidGroupIndex: 2, leaderId: "u9" }));
            await job.runTempVoice({ now: START - 1800 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            expect(tempVoiceStore.getEntry("eh-2").name).toBe("SSC 2 · Sa 31.10.");
            voice.memberCount.mockImplementation(() => 3);
            expect((await job.runTempVoice({ now: START + 239 * 60 })).closed).toEqual([]);
            expect((await job.runTempVoice({ now: START + 240 * 60 })).closed).toEqual(["eh-2"]);
            expect(voice.closeVoice).toHaveBeenCalledWith("g1", "v-eh-2", { moveTo: FIXED });
            expect(tempVoiceStore.getEntry("eh-2").closeReason).toBe("limit");
        });

        it("closes at once when the raid is merged away, cancelled or deleted", async () => {
            mockEvents.push(raid({ raidGroupId: "eh-1" }), raid({ id: "eh-2", raidGroupId: "eh-1", raidGroupIndex: 2 }));
            await job.runTempVoice({ now: START - 1800 });
            mockEvents.splice(1, 1);
            mockEvents[0] = raid({ raidGroupId: "eh-1", status: "cancelled" });
            const out = await job.runTempVoice({ now: START - 1700 });
            expect(out.closed.sort()).toEqual(["eh-1", "eh-2"]);
            expect(tempVoiceStore.getEntry("eh-2").closeReason).toBe("gone");
        });

        it("renames raid 1 when the split is undone", async () => {
            mockEvents.push(raid({ raidGroupId: "eh-1" }), raid({ id: "eh-2", raidGroupId: "eh-1", raidGroupIndex: 2 }));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1").name).toBe("SSC 1 · Sa 31.10.");
            mockEvents.splice(0, 2, raid());
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.renameVoice).toHaveBeenCalledWith("g1", "v-eh-1", "SSC · Sa 31.10.");
            expect(tempVoiceStore.getEntry("eh-1").name).toBe("SSC · Sa 31.10.");
        });

        it("marks a channel deleted in Discord as missing, but not while the bot is offline", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => null);
            discord.isOnline.mockReturnValueOnce(false);
            await job.runTempVoice({ now: START });
            expect(tempVoiceStore.getEntry("eh-1").closedAt).toBe(0);
            await job.runTempVoice({ now: START + 60 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ closedAt: START + 60, closeReason: "missing" });
            expect(voice.closeVoice).not.toHaveBeenCalled();
        });

        it("keeps the assigned in sync with 'only assigned'", async () => {
            setCategory({ mode: "temp", onlyAssigned: true });
            mockEvents.push(raid({ setup: { groups: [{ index: 1, slots: [{ userId: "a" }] }] } }));
            await job.runTempVoice({ now: START - 1800 });
            expect(voice.createVoice).toHaveBeenCalledWith("g1", expect.objectContaining({ onlyAssigned: true, members: ["a"] }));
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.syncMembers).toHaveBeenCalledWith("g1", "v-eh-1", ["a"]);
        });
    });

    it("tracks emptiness from voice state updates", async () => {
        mockEvents.push(raid());
        await job.runTempVoice({ now: START - 1800 });
        voice.memberCount.mockImplementation(() => 2);
        job.onVoiceStateUpdate({ channelId: null }, { channelId: "v-eh-1" }, { now: START });
        expect(tempVoiceStore.getEntry("eh-1").emptySince).toBe(0);
        voice.memberCount.mockImplementation(() => 0);
        job.onVoiceStateUpdate({ channelId: "v-eh-1" }, { channelId: null }, { now: START + 60 });
        expect(tempVoiceStore.getEntry("eh-1").emptySince).toBe(START + 60);
        job.onVoiceStateUpdate({ channelId: "other" }, { channelId: null }, { now: START + 120 });
        expect(tempVoiceStore.getEntry("eh-1").emptySince).toBe(START + 60);
    });

    describe("manual actions", () => {
        it("opens early and closes on demand", async () => {
            mockEvents.push(raid());
            expect(await job.openNow("eh-1", { now: START - 7200 })).toEqual({ ok: true });
            expect(tempVoiceStore.getEntry("eh-1").manual).toBe(true);
            expect(await job.openNow("eh-1", { now: START - 7100 })).toMatchObject({ status: 409 });
            expect(await job.closeNow("eh-1", { now: START - 7000 })).toEqual({ ok: true });
            expect(tempVoiceStore.getEntry("eh-1").closeReason).toBe("manual");
            expect(await job.closeNow("eh-1")).toMatchObject({ status: 409 });
            // a manually closed channel does not come back by itself
            expect((await job.runTempVoice({ now: START - 1800 })).opened).toEqual([]);
            expect(await job.openNow("eh-1", { now: START - 1700 })).toEqual({ ok: true });
        });

        it("refuses raids without a temporary channel", async () => {
            mockEvents.push(raid({ status: "cancelled" }));
            expect(await job.openNow("nope")).toMatchObject({ status: 404 });
            expect(await job.openNow("eh-1")).toMatchObject({ status: 409 });
        });
    });

    describe("voiceStatus", () => {
        it("describes the fixed channel and the planned, open and closed temporary ones", async () => {
            setCategory({ mode: "existing", fromRaid2: true }, { categoryVoiceChannel: { [CAT]: FIXED } });
            mockEvents.push(raid({ raidGroupId: "eh-1" }), raid({ id: "eh-2", raidGroupId: "eh-1", raidGroupIndex: 2 }));
            let status = job.voiceStatus(mockEvents[0], { now: START - 3600 });
            expect(status[0]).toMatchObject({ kind: "fixed", state: "fixed", name: "Raid-Talk", channelId: FIXED });
            expect(status[1]).toMatchObject({ kind: "temp", state: "planned", name: "SSC 2 · Sa 31.10.", openAt: START - 1800, parentName: "Raids" });
            await job.runTempVoice({ now: START - 1800 });
            status = job.voiceStatus(mockEvents[1], { now: START });
            expect(status[1]).toMatchObject({ state: "open", channelId: "v-eh-2", url: "https://discord.com/channels/g1/v-eh-2", members: 0 });
            await job.closeNow("eh-2", { now: START + 60 });
            expect(job.voiceStatus(mockEvents[0], { now: START + 120 })[1]).toMatchObject({ state: "closed", closeReason: "manual" });
            expect(job.hasVoice(mockEvents[0])).toBe(true);
            setCategory({ mode: "none" });
            expect(job.hasVoice(mockEvents[0])).toBe(false);
            expect(job.voiceStatus(null)).toEqual([]);
        });
    });

    it("starts and stops its timers and event listener idempotently", () => {
        const t = job.startTempVoice({ intervalMs: 1e9, firstDelayMs: 1e9 });
        expect(job.startTempVoice()).toBe(t);
        expect(mockListeners).toHaveLength(1);
        job.stopTempVoice();
        job.stopTempVoice();
        expect(mockListeners).toHaveLength(0);
    });
});
