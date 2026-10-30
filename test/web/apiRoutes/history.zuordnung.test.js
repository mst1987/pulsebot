// "Wartet auf Zuordnung" in the Addon-Inbox (#1002), through the real router on
// the real inbox and guild-bank stores: a waiting upload shows for the orga of
// each of its servers, the first assignment wins (the second server gets 409),
// a dismissed upload comes back within 14 days, and a waiting guild bank goes
// to one of the servers it waits for.
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    getRealUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => mockGuild),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn(),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    listGuilds: jest.fn(() => [{ id: "gA", name: "Server A" }, { id: "gB", name: "Server B" }, { id: "gC", name: "Server C" }]),
    listCategories: jest.fn(() => []),
}));
jest.mock("../../../src/services/discord/serverOf", () => ({
    ...jest.requireActual("../../../src/services/discord/serverOf"),
    storedCategoryGuilds: () => new Map(),
}));
jest.mock("../../../src/utils/loot/lootImport", () => ({
    ...jest.requireActual("../../../src/utils/loot/lootImport"),
    enrichItemNames: jest.fn((items) => Promise.resolve(items)),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    ...jest.requireActual("../../../src/services/events/raidEventGroups"),
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
}));

let mockGuild = "gA";
const mockConfig = {
    mainVersion: "tbc",
    discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }, { guildId: "gC" }], links: [] },
};

const { json, status, routerClient } = require("../../helpers/http");
const { getUser } = require("../../../src/web/http/auth");
const inbox = require("../../../src/stores/lootInboxStore");
const banks = require("../../../src/stores/guildBankStockStore");
const lootStore = require("../../../src/stores/lootStore");
const eventStore = require("../../../src/stores/eventStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { get, post } = routerClient(require("../../../src/web/apiRoutes/history"));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");

const ADMIN = { id: "1", name: "Admin", isAdmin: true };

/** The raid groups one server answers with; every other server has none. */
function raidsOn(guildId, groups) {
    loadEventGroups.mockImplementation(async (id) => ({ groups: id === guildId ? groups : [] }));
}
const DAY = 24 * 60 * 60 * 1000;

const item = (rawId, character) => ({
    source: "gargul", rawId, itemId: 30095, itemName: "Ring", character, characterKey: character.toLowerCase(), awardedAt: 1790000000000,
});
const candidate = (eventId, guildId, matched) => ({ eventId, guildId, matched, total: 5, eventLabel: `Raid ${eventId}`, startTime: 1790000000 });

/** A waiting upload for servers A and B: raid evA (4 of 5) is the best, raid evB (1 of 5) the other. */
function waitingUpload(sessionId = "s1") {
    return inbox.upsertPending({ sessionId, startedAt: 1790000000000, items: [item("r1", "Arthas")] }, {
        realm: "Thunderstrike", gameVersion: "tbc", waiting: true, servers: ["gA", "gB"],
        match: { candidates: [candidate("evA", "gA", 4), candidate("evB", "gB", 1)], best: "evA", suggested: null, ambiguous: false },
    }).entry;
}

beforeEach(() => {
    inbox.useFile(tempStoreFile("inbox.json"));
    banks.useFile(tempStoreFile("banks.json"));
    lootStore.useFile(tempStoreFile("loot.json"));
    eventStore.useFile(tempStoreFile("events.json"));
    mockGuild = "gA";
    getUser.mockReturnValue(ADMIN);
    loadEventGroups.mockImplementation(async () => ({ groups: [] }));
});

afterAll(() => {
    for (const s of [inbox, banks, lootStore, eventStore]) s.useFile(null);
});

describe("GET /api/history/inbox", () => {
    it("lists a waiting upload on each of its servers with named candidates, the best one suggested", async () => {
        const entry = waitingUpload();
        const onA = json(await get("/api/history/inbox")).data;
        expect(onA.sessions).toEqual([]);
        expect(onA.waiting.map((s) => s.id)).toEqual([entry.id]);
        // named like the sync app names it (versionHead, #1001)
        expect(onA.waiting[0].versionShort).toBe("TBC");
        expect(onA.waiting[0].candidates).toEqual([
            expect.objectContaining({ eventId: "evA", serverName: "Server A", ownServer: true, suggested: true }),
            expect.objectContaining({ eventId: "evB", serverName: "Server B", ownServer: false, suggested: false }),
        ]);
        mockGuild = "gB";
        expect(json(await get("/api/history/inbox")).data.waiting[0].candidates[1].ownServer).toBe(true);
        mockGuild = "gC";
        expect(json(await get("/api/history/inbox")).data.waiting).toEqual([]);
    });

    it("lists only the uploads of the requested game version", async () => {
        waitingUpload();
        expect(json(await get("/api/history/inbox", { version: "forever" })).data.waiting).toEqual([]);
    });
});

describe("first to assign wins", () => {
    it("answers 409 on the second server, also for a dismissal, and 404 for an unknown id", async () => {
        const entry = waitingUpload();
        inbox.resolvePending(entry.id, "accepted", { eventId: "evA", guildId: "gA" });
        mockGuild = "gB";
        expect(json(await get("/api/history/inbox")).data.waiting).toEqual([]);
        const accept = await post("/api/history/inbox-accept", { id: entry.id, event: "__manual__", manualLabel: "Kara" });
        expect(status(accept)).toBe(409);
        expect(json(accept).error.code).toBe("already_assigned");
        expect(status(await post("/api/history/inbox-dismiss", { id: entry.id }))).toBe(409);
        expect(status(await post("/api/history/inbox-accept", { id: "nope" }))).toBe(404);
    });

    it("files the upload once when two servers accept at the same time", async () => {
        const entry = waitingUpload();
        const send = (guild) => {
            mockGuild = guild;
            return post("/api/history/inbox-accept", { id: entry.id, event: "__manual__", manualLabel: `Kara ${guild}` });
        };
        const results = await Promise.all([send("gA"), send("gB")]);
        expect(results.map(status).sort()).toEqual([201, 409]);
        expect(inbox.getPending(entry.id)).toBeNull();
        expect(inbox.resolvedById(entry.id).action).toBe("accepted");
    });

    it("tells an accept that the upload was dismissed meanwhile", async () => {
        const entry = waitingUpload();
        inbox.resolvePending(entry.id, "dismissed", { by: "Admin" });
        mockGuild = "gB";
        const res = await post("/api/history/inbox-accept", { id: entry.id, event: "__manual__", manualLabel: "Kara" });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("already_dismissed");
    });

    it("lets a full admin assign a raid of another server, an orga only its own", async () => {
        const entry = waitingUpload();
        const listed = json(await get("/api/history/inbox")).data.waiting[0].candidates;
        expect(listed.map((c) => c.assignable)).toEqual([true, true]);

        getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, isOrga: true, access: { history: { read: true, write: true } } });
        const forOrga = json(await get("/api/history/inbox")).data.waiting[0].candidates;
        expect(forOrga.map((c) => c.assignable)).toEqual([true, false]);
        expect(status(await post("/api/history/inbox-accept", { id: entry.id, event: "evB" }))).toBe(403);
        expect(inbox.getPending(entry.id)).not.toBeNull();

        getUser.mockReturnValue(ADMIN);
        raidsOn("gB", [{ categoryId: "catB", events: [{ id: "evB", title: "Kara B" }] }]);
        const res = await post("/api/history/inbox-accept", { id: entry.id, event: "evB", categoryId: "catA" });
        expect(status(res)).toBe(201);
        expect(json(res).data).toMatchObject({ eventId: "evB", eventLabel: "Kara B", categoryId: "catB" });
        expect(loadEventGroups).toHaveBeenCalledWith("gB", expect.anything());
        expect(inbox.resolvedById(entry.id)).toMatchObject({ action: "accepted", categoryId: "catB", guildId: "gB" });
        expect(lootStore.listByEvent("evB").map((i) => [i.guildId, i.categoryId])).toEqual([["gB", "catB"]]);
    });

    it("refuses a foreign raid that was deleted after the upload, and keeps the upload waiting", async () => {
        const entry = waitingUpload();
        raidsOn("gB", [{ categoryId: "catB", events: [{ id: "evOther" }] }]);
        const res = await post("/api/history/inbox-accept", { id: entry.id, event: "evB" });
        expect(status(res)).toBe(404);
        expect(json(res).error.code).toBe("event_gone");
        expect(inbox.getPending(entry.id)).not.toBeNull();
        expect(lootStore.listByEvent("evB")).toEqual([]);
    });

    it("never files a foreign raid under the active server's category", async () => {
        const entry = waitingUpload();
        raidsOn("gB", [{ categoryId: "", events: [{ id: "evB" }] }]);
        const res = await post("/api/history/inbox-accept", { id: entry.id, event: "evB", categoryId: "catA" });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("no_category");
        expect(inbox.getPending(entry.id)).not.toBeNull();
        expect(lootStore.listByEvent("evB")).toEqual([]);
    });

    it("refuses the upload on a server it does not wait for", async () => {
        const entry = waitingUpload();
        mockGuild = "gC";
        const res = await post("/api/history/inbox-dismiss", { id: entry.id });
        expect(status(res)).toBe(403);
        expect(inbox.getPending(entry.id)).not.toBeNull();
    });
});

describe("dismissed and restored", () => {
    it("keeps a dismissed upload under its servers and brings it back waiting", async () => {
        const entry = waitingUpload();
        expect(status(await post("/api/history/inbox-dismiss", { id: entry.id }))).toBe(200);
        const data = json(await get("/api/history/inbox")).data;
        expect(data.waiting).toEqual([]);
        expect(data.dismissed).toEqual([expect.objectContaining({ id: entry.id, dismissedBy: "Admin" })]);

        mockGuild = "gC";
        expect(status(await post("/api/history/inbox-restore", { id: entry.id }))).toBe(403);
        mockGuild = "gB";
        const restored = await post("/api/history/inbox-restore", { id: entry.id });
        expect(json(restored).data).toEqual({ id: entry.id, sessionId: "s1", waiting: true });
        expect(json(await get("/api/history/inbox")).data.waiting.map((s) => s.id)).toEqual([entry.id]);
        expect(status(await post("/api/history/inbox-restore", { id: entry.id }))).toBe(404);
    });

    it("drops a dismissal after 14 days", async () => {
        const entry = waitingUpload();
        const realNow = Date.now;
        try {
            await post("/api/history/inbox-dismiss", { id: entry.id });
            Date.now = () => realNow() + 15 * DAY;
            expect(json(await get("/api/history/inbox")).data.dismissed).toEqual([]);
            expect(status(await post("/api/history/inbox-restore", { id: entry.id }))).toBe(404);
        } finally {
            Date.now = realNow;
        }
    });
});

describe("POST /api/history/inbox-bank-assign", () => {
    const scan = (guild) => ({
        key: `tbc:thunderstrike:${guild.toLowerCase()}`, gameVersion: "tbc", realm: "Thunderstrike", guild, faction: "Horde",
        scannedAt: 1791000000, scannedBy: "Gemli", money: 0, tabs: [], items: [],
    });

    it("lists a waiting bank for its servers and gives it to the first one picked", async () => {
        const { bank } = banks.recordScan(scan("Die Gilde"), { waitingFor: ["gA", "gB"], uploadedBy: "Arthas" });
        const listed = json(await get("/api/history/inbox")).data.waitingBanks;
        expect(listed).toEqual([expect.objectContaining({
            key: bank.key, guild: "Die Gilde",
            servers: [{ guildId: "gA", name: "Server A", ownServer: true }, { guildId: "gB", name: "Server B", ownServer: false }],
        })]);
        mockGuild = "gC";
        expect(json(await get("/api/history/inbox")).data.waitingBanks).toEqual([]);
        expect(status(await post("/api/history/inbox-bank-assign", { key: bank.key, guildId: "gA" }))).toBe(403);

        mockGuild = "gA";
        expect(status(await post("/api/history/inbox-bank-assign", { key: bank.key, guildId: "gC" }))).toBe(403);
        const res = await post("/api/history/inbox-bank-assign", { key: bank.key, guildId: "gB" });
        expect(json(res).data).toEqual({ key: bank.key, guildId: "gB" });

        mockGuild = "gB";
        expect(status(await post("/api/history/inbox-bank-assign", { key: bank.key, guildId: "gB" }))).toBe(409);
        expect(status(await post("/api/history/inbox-bank-assign", { key: "tbc:x:y", guildId: "gB" }))).toBe(404);
    });
});
