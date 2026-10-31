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
jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(() => ({ id: "g1" })),
    isOnline: jest.fn(() => true),
    isGuildAvailable: jest.fn(() => true),
    isRateLimitError: jest.fn((e) => !!e && String(e.name || "").startsWith("RateLimitError")),
}));
let mockLang = "de";
jest.mock("../../../src/services/discord/botLanguage", () => ({ eventLang: jest.fn(() => mockLang) }));
jest.mock("../../../src/services/voice/tempVoiceDiscord", () => ({
    createVoice: jest.fn(async (guildId, plan) => ({ id: `v-${plan.eventId}`, name: plan.name, granted: plan.onlyAssigned ? plan.members : [] })),
    renameVoice: jest.fn(async (g, c, name) => name),
    closeVoice: jest.fn(async () => ({ moved: 0, deleted: true })),
    syncMembers: jest.fn(async (g, c, members) => ({ granted: members, changed: 0 })),
    setAccess: jest.fn(async (g, c, { onlyAssigned, members }) => ({ granted: onlyAssigned ? members : [] })),
    channelGone: jest.fn(async () => true),
    findCreatedVoice: jest.fn(() => null),
    memberCount: jest.fn(() => 0),
    missingRightKeys: jest.fn(() => []),
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
    discord.isGuildAvailable.mockImplementation(() => true);
    voice.channelGone.mockImplementation(async () => true);
    voice.findCreatedVoice.mockImplementation(() => null);
    mockLang = "de";
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
            voice.createVoice.mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { status: 403 }));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "", creatingAt: 0, error: "Missing Permissions" });
            await job.runTempVoice({ now: START - 1500 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            await job.runTempVoice({ now: START - 1200 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", error: "" });
        });

        it("keeps the mark after a network error, so the next run takes over a channel made anyway", async () => {
            mockEvents.push(raid());
            voice.createVoice.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "", creatingAt: START - 1800, error: "socket hang up" });
            voice.findCreatedVoice.mockImplementation(() => ({ id: "v-late", name: "SSC · Sa 31.10." }));
            await job.runTempVoice({ now: START - 1740 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-late", creatingAt: 0, error: "" });
        });

        it("after a network error without a channel creates again only after ten minutes", async () => {
            mockEvents.push(raid());
            voice.createVoice.mockRejectedValueOnce(new Error("timeout"));
            await job.runTempVoice({ now: START - 1800 });
            await job.runTempVoice({ now: START - 1740 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "", creatingAt: 0 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            await job.runTempVoice({ now: START - 1200 });
            expect(voice.createVoice).toHaveBeenCalledTimes(2);
        });

        it("names the weekday in the raid's language", async () => {
            mockLang = "en";
            mockEvents.push(raid());
            await job.runTempVoice({ now: START - 1800 });
            expect(voice.createVoice).toHaveBeenCalledWith("g1", expect.objectContaining({ name: "SSC · Sat 31.10." }));
        });

        it("says so when Discord's rate limit stops the create", async () => {
            mockEvents.push(raid());
            voice.createVoice.mockRejectedValueOnce(Object.assign(new Error("limited"), { name: "RateLimitError" }));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "", creatingAt: 0, error: expect.stringContaining("Ratelimit") });
        });

        it("notes the create before it runs, so a crash in between finds the channel again", async () => {
            mockEvents.push(raid());
            let seen = null;
            voice.createVoice.mockImplementationOnce(async (g, plan) => {
                seen = tempVoiceStore.getEntry("eh-1");
                return { id: "v1", name: plan.name, granted: [] };
            });
            await job.runTempVoice({ now: START - 1800 });
            expect(seen).toMatchObject({ creatingAt: START - 1800, channelId: "", name: "SSC · Sa 31.10.", parentId: PARENT });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ creatingAt: 0, channelId: "v1" });
        });

        it("takes over a channel created before a crash instead of creating a second", async () => {
            mockEvents.push(raid());
            tempVoiceStore.updateEntry("eh-1", { guildId: "g1", creatingAt: START - 1800, name: "SSC · Sa 31.10.", parentId: PARENT, limitAt: START + 14400 });
            voice.findCreatedVoice.mockImplementation(() => ({ id: "v-found", name: "SSC · Sa 31.10." }));
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.findCreatedVoice).toHaveBeenCalledWith("g1", { name: "SSC · Sa 31.10.", parentId: PARENT, since: START - 1800 });
            expect(voice.createVoice).not.toHaveBeenCalled();
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-found", createdAt: START - 1800, creatingAt: 0, closedAt: 0 });
        });

        it("creates again when a crash left no channel behind, but not while the server is unavailable", async () => {
            mockEvents.push(raid());
            tempVoiceStore.updateEntry("eh-1", { guildId: "g1", creatingAt: START - 1800, name: "SSC · Sa 31.10.", parentId: PARENT });
            discord.isGuildAvailable.mockImplementation(() => false);
            await job.runTempVoice({ now: START - 1700 });
            expect(tempVoiceStore.getEntry("eh-1").creatingAt).toBe(START - 1800);
            discord.isGuildAvailable.mockImplementation(() => true);
            await job.runTempVoice({ now: START - 1600 });
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", creatingAt: 0 });
        });

        it("waits while the bot is not on the server", async () => {
            mockEvents.push(raid());
            discord.isGuildAvailable.mockImplementation(() => false);
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
            expect(voice.closeVoice).toHaveBeenCalledTimes(2);
            expect(tempVoiceStore.getEntry("eh-1")).toBeNull();
            expect(tempVoiceStore.getEntry("eh-2")).toBeNull();
        });

        it("keeps the entry of a deleted raid while Discord cannot answer and closes it once it can", async () => {
            await openAt();
            mockEvents.length = 0;
            discord.isOnline.mockReturnValueOnce(false);
            expect((await job.runTempVoice({ now: START - 1700 })).closed).toEqual([]);
            discord.isGuildAvailable.mockImplementation(() => false);
            expect((await job.runTempVoice({ now: START - 1600 })).closed).toEqual([]);
            expect(voice.closeVoice).not.toHaveBeenCalled();
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", closedAt: 0 });
            discord.isGuildAvailable.mockImplementation(() => true);
            expect((await job.runTempVoice({ now: START - 1500 })).closed).toEqual(["eh-1"]);
            expect(voice.closeVoice).toHaveBeenCalledWith("g1", "v-eh-1", { moveTo: "" });
            expect(tempVoiceStore.getEntry("eh-1")).toBeNull();
        });

        it("keeps the entry when closing the channel fails", async () => {
            mockEvents.push(raid({ status: "cancelled" }));
            tempVoiceStore.updateEntry("eh-1", { guildId: "g1", channelId: "v-old", limitAt: START + 14400 });
            voice.closeVoice.mockRejectedValueOnce(new Error("Service Unavailable"));
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-old", closedAt: 0, error: "Service Unavailable" });
        });

        it("opens again for a raid back from cancelled after its channel went", async () => {
            mockEvents.push(raid({ status: "cancelled" }));
            tempVoiceStore.updateEntry("eh-1", { guildId: "g1", channelId: "v-old", limitAt: START + 14400 });
            await job.runTempVoice({ now: START - 1800 });
            expect(tempVoiceStore.getEntry("eh-1")).toBeNull();
            mockEvents[0] = raid();
            expect((await job.runTempVoice({ now: START - 1700 })).opened).toEqual(["eh-1"]);
        });

        it("closes an empty channel when the raid moved later and opens it on the new time", async () => {
            await openAt();
            mockEvents[0] = raid({ startTime: START + 7200 });
            expect((await job.runTempVoice({ now: START - 1700 })).closed).toEqual(["eh-1"]);
            expect(tempVoiceStore.getEntry("eh-1")).toBeNull();
            expect((await job.runTempVoice({ now: START + 5400 })).opened).toEqual(["eh-1"]);
        });

        it("keeps a channel with people in it when the raid moved later", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => 2);
            mockEvents[0] = raid({ startTime: START + 7200 });
            expect((await job.runTempVoice({ now: START - 1700 })).closed).toEqual([]);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ closedAt: 0, limitAt: START + 7200 + 240 * 60 });
        });

        it("lets an open channel run to its end when the category stops giving temporary channels", async () => {
            await openAt();
            setCategory({ mode: "none" });
            expect((await job.runTempVoice({ now: START + 60 })).closed).toEqual([]);
            expect(job.voiceStatus(mockEvents[0], { now: START + 60 })[0]).toMatchObject({ kind: "temp", state: "open", channelId: "v-eh-1", canOpen: false });
            expect((await job.runTempVoice({ now: START + 186 * 60 })).closed).toEqual(["eh-1"]);
            expect(tempVoiceStore.getEntry("eh-1").closeReason).toBe("empty");
            // and once closed, nothing opens it again
            expect((await job.runTempVoice({ now: START + 187 * 60 })).opened).toEqual([]);
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

        it("renames at most every five minutes and lives with a rate limit", async () => {
            await openAt();
            mockEvents[0] = raid({ title: "x", instanceIds: ["tk"] });
            voice.renameVoice.mockRejectedValueOnce(Object.assign(new Error("limited"), { name: "RateLimitError" }));
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.renameVoice).toHaveBeenCalledTimes(1);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ name: "SSC · Sa 31.10.", renameAt: START - 1700, closedAt: 0 });
            await job.runTempVoice({ now: START - 1500 });
            expect(voice.renameVoice).toHaveBeenCalledTimes(1);
            await job.runTempVoice({ now: START - 1400 });
            expect(voice.renameVoice).toHaveBeenCalledTimes(2);
            expect(tempVoiceStore.getEntry("eh-1").name).toBe("TK · Sa 31.10.");
        });

        it("marks a channel deleted in Discord as missing, but not while the bot is offline", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => null);
            discord.isOnline.mockReturnValueOnce(false);
            await job.runTempVoice({ now: START });
            expect(tempVoiceStore.getEntry("eh-1").closedAt).toBe(0);
            await job.runTempVoice({ now: START + 60 });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ closedAt: START + 60, closeReason: "missing" });
            expect(voice.channelGone).toHaveBeenCalledTimes(1);
            expect(voice.closeVoice).not.toHaveBeenCalled();
        });

        it("does not reopen a channel deleted in Discord by itself, but 'Jetzt anlegen' does", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => null);
            await job.runTempVoice({ now: START });
            expect(tempVoiceStore.getEntry("eh-1").closeReason).toBe("missing");
            expect((await job.runTempVoice({ now: START + 60 })).opened).toEqual([]);
            expect(job.voiceStatus(raid(), { now: START + 60 })[0]).toMatchObject({ state: "closed", canOpen: true });
            voice.memberCount.mockImplementation(() => 0);
            expect(await job.openNow("eh-1", { now: START + 120 })).toEqual({ ok: true });
            expect(voice.createVoice).toHaveBeenCalledTimes(2);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", closedAt: 0, closeReason: "", manual: true });
        });

        it("does not mark it missing without Discord's proof or while the server is unavailable", async () => {
            await openAt();
            voice.memberCount.mockImplementation(() => null);
            voice.channelGone.mockImplementation(async () => false);
            await job.runTempVoice({ now: START });
            discord.isGuildAvailable.mockImplementation(() => false);
            voice.channelGone.mockImplementation(async () => true);
            await job.runTempVoice({ now: START + 60 });
            expect(voice.channelGone).toHaveBeenCalledTimes(1);
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ closedAt: 0, closeReason: "" });
        });

        it("keeps the assigned in sync with 'only assigned'", async () => {
            setCategory({ mode: "temp", onlyAssigned: true });
            mockEvents.push(raid({ setup: { groups: [{ index: 1, slots: [{ userId: "a" }] }] } }));
            await job.runTempVoice({ now: START - 1800 });
            expect(voice.createVoice).toHaveBeenCalledWith("g1", expect.objectContaining({ onlyAssigned: true, members: ["a"] }));
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.syncMembers).toHaveBeenCalledWith("g1", "v-eh-1", ["a"], ["a"]);
            expect(tempVoiceStore.getEntry("eh-1").granted).toEqual(["a"]);
        });

        it("notes which seats the bot gave when the assigned change", async () => {
            setCategory({ mode: "temp", onlyAssigned: true });
            mockEvents.push(raid({ setup: { groups: [{ index: 1, slots: [{ userId: "a" }] }] } }));
            await job.runTempVoice({ now: START - 1800 });
            mockEvents[0] = raid({ setup: { groups: [{ index: 1, slots: [{ userId: "b" }] }] } });
            voice.syncMembers.mockResolvedValueOnce({ granted: ["b"], changed: 2 });
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.syncMembers).toHaveBeenCalledWith("g1", "v-eh-1", ["b"], ["a"]);
            expect(tempVoiceStore.getEntry("eh-1").granted).toEqual(["b"]);
        });

        it("opens or locks the open channel when 'only assigned' is switched", async () => {
            mockEvents.push(raid({ setup: { groups: [{ index: 1, slots: [{ userId: "a" }] }] } }));
            await job.runTempVoice({ now: START - 1800 });
            setCategory({ mode: "temp", onlyAssigned: true });
            await job.runTempVoice({ now: START - 1700 });
            expect(voice.setAccess).toHaveBeenCalledWith("g1", "v-eh-1", { onlyAssigned: true, members: ["a"] });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ onlyAssigned: true, granted: ["a"] });
            setCategory({ mode: "temp" });
            await job.runTempVoice({ now: START - 1600 });
            expect(voice.setAccess).toHaveBeenLastCalledWith("g1", "v-eh-1", { onlyAssigned: false, members: [] });
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ onlyAssigned: false, granted: [] });
            expect(voice.syncMembers).not.toHaveBeenCalled();
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

        it("does not close by hand while Discord cannot answer: 503, the entry stays", async () => {
            mockEvents.push(raid());
            await job.runTempVoice({ now: START - 1800 });
            discord.isGuildAvailable.mockImplementation(() => false);
            expect(await job.closeNow("eh-1", { now: START })).toMatchObject({ status: 503, error: expect.stringContaining("nicht erreichbar") });
            expect(voice.closeVoice).not.toHaveBeenCalled();
            expect(tempVoiceStore.getEntry("eh-1")).toMatchObject({ channelId: "v-eh-1", closedAt: 0, closeReason: "" });
            discord.isGuildAvailable.mockImplementation(() => true);
            expect(await job.closeNow("eh-1", { now: START + 60 })).toEqual({ ok: true });
        });

        it("creates one channel when 'Jetzt anlegen' meets the job", async () => {
            mockEvents.push(raid());
            let release;
            voice.createVoice.mockImplementationOnce((g, plan) => new Promise((resolve) => {
                release = () => resolve({ id: "v1", name: plan.name, granted: [] });
            }));
            const first = job.openNow("eh-1", { now: START - 1800 });
            const second = job.openNow("eh-1", { now: START - 1800 });
            const sweep = job.runTempVoice({ now: START - 1800 });
            expect(job.voiceStatus(mockEvents[0], { now: START - 1800 })[0]).toMatchObject({ state: "creating", canOpen: false });
            release();
            expect(await first).toEqual({ ok: true });
            expect(await second).toEqual({ ok: true });
            await sweep;
            expect(voice.createVoice).toHaveBeenCalledTimes(1);
        });

        it("refuses 'Jetzt anlegen' while a create mark has no running create", async () => {
            mockEvents.push(raid());
            tempVoiceStore.updateEntry("eh-1", { guildId: "g1", creatingAt: START - 1800, name: "SSC · Sa 31.10.", parentId: PARENT });
            expect(await job.openNow("eh-1", { now: START - 1700 })).toMatchObject({ status: 409, error: expect.stringContaining("angelegt") });
            expect(voice.createVoice).not.toHaveBeenCalled();
        });

        it("offers 'Jetzt anlegen' again after a close, until the latest close", async () => {
            mockEvents.push(raid());
            await job.runTempVoice({ now: START - 1800 });
            await job.closeNow("eh-1", { now: START });
            expect(job.voiceStatus(mockEvents[0], { now: START + 60 })[0]).toMatchObject({ state: "closed", canOpen: true });
            expect(job.voiceStatus(mockEvents[0], { now: START + 240 * 60 })[0]).toMatchObject({ canOpen: false });
            expect(await job.openNow("eh-1", { now: START + 240 * 60 })).toMatchObject({ status: 409 });
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
