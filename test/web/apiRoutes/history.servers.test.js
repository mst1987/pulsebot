// Loot of the active Discord server only (#919), through the real router and
// on the real loot/event stores: server A never sees, imports into or changes
// the loot of server B's raids - not even when the two servers are linked
// (user decision: only the active server counts).
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
    listGuilds: jest.fn(() => [{ id: "gA", name: "A" }, { id: "gB", name: "B" }]),
    listCategories: jest.fn(() => []),
}));
jest.mock("../../../src/services/discord/serverOf", () => ({
    ...jest.requireActual("../../../src/services/discord/serverOf"),
    // The category-name snapshot: cat-b is a category of server B.
    storedCategoryGuilds: () => new Map([["cat-a", "gA"], ["cat-b", "gB"]]),
}));
jest.mock("../../../src/stores/lootStore", () => ({
    ...jest.requireActual("../../../src/stores/lootStore"),
    repairItemNames: jest.fn(async () => 0),
}));
jest.mock("../../../src/utils/loot/lootImport", () => ({
    ...jest.requireActual("../../../src/utils/loot/lootImport"),
    // No Wowhead lookup: the names come with the rows.
    enrichItemNames: jest.fn((items) => Promise.resolve(items)),
    // The export format is tested elsewhere; here one parsed row is enough.
    parseLoot: jest.fn(() => [{ source: "manual", rawId: "imp1", character: "Fritz", characterKey: "fritz", itemId: 7, itemName: "Ring", itemIconUrl: "x.jpg", itemQuality: 4, awardedAt: 1790000000000 }]),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    ...jest.requireActual("../../../src/services/events/raidEventGroups"),
    // The raid list of the active server: none listed, so the server rule decides.
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
}));

let mockGuild = "gA";
// Two linked servers: B is linked to A, still none of B's loot shows on A.
const mockConfig = {
    mainVersion: "tbc",
    discordServers: {
        servers: [{ guildId: "gA" }, { guildId: "gB" }],
        links: [{ from: "gA", to: "gB" }],
    },
};

const { json, status, routerClient } = require("../../helpers/http");
const { getUser } = require("../../../src/web/http/auth");
const lootStore = require("../../../src/stores/lootStore");
const eventStore = require("../../../src/stores/eventStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { get, post } = routerClient(require("../../../src/web/apiRoutes/history"));

const ADMIN = { id: "1", name: "Admin", isAdmin: true };

const row = (rawId, character, itemId) => ({
    source: "manual", rawId, character, characterKey: character.toLowerCase(), itemId,
    itemName: `Item ${rawId}`, itemIconUrl: "x.jpg", itemQuality: 4, awardedAt: 1790000000000,
});

let eventA;
let eventB;
beforeEach(() => {
    mockGuild = "gA";
    getUser.mockReturnValue(ADMIN);
    lootStore.useFile(tempStoreFile("srv-loot.json"));
    eventStore.useFile(tempStoreFile("srv-events.json"));
    const base = { channelId: "ch1", startTime: 1790000000, title: "Kara" };
    eventA = eventStore.createEvent({ ...base, guildId: "gA", categoryId: "cat-a" }).event;
    eventB = eventStore.createEvent({ ...base, guildId: "gB", categoryId: "cat-b" }).event;
    // Rule 1: over the raid. Rule 2: the server a raidless bucket was imported on.
    // Rule 3: the bucket's category. Rule 4: nothing known -> the first server (A).
    lootStore.addImport(eventA.id, [row("a1", "Anna", 1)], { eventLabel: "Kara A" });
    lootStore.addImport(eventB.id, [row("b1", "Bert", 2), row("b2", "Anna", 3)], { eventLabel: "Kara B" });
    lootStore.addImport("manual-raid-sgB", [row("b3", "Bert", 4)], { eventLabel: "Raid B", guildId: "gB" });
    lootStore.addImport("manual-cat-b", [row("b4", "Cleo", 5)], { eventLabel: "Kat B", categoryId: "cat-b" });
    lootStore.addImport("manual-old", [row("a2", "Dora", 6)], { eventLabel: "Alt" });
});
afterAll(() => {
    lootStore.useFile(null);
    eventStore.useFile(null);
});

const idsOf = (items) => items.map((it) => it.rawId).sort();

describe("reading", () => {
    it("shows a raid of server B as empty on server A, and in full on B", async () => {
        expect(json(await get("/api/history/event", { event: eventB.id })).data.items).toEqual([]);
        mockGuild = "gB";
        expect(idsOf(json(await get("/api/history/event", { event: eventB.id })).data.items)).toEqual(["b1", "b2"]);
    });

    it("lists only the character's loot of the active server", async () => {
        expect(idsOf(json(await get("/api/history/char", { name: "Anna" })).data.items)).toEqual(["a1"]);
        mockGuild = "gB";
        expect(idsOf(json(await get("/api/history/char", { name: "Anna" })).data.items)).toEqual(["b2"]);
    });

    it("places raidless buckets by import server, category, else the first server", async () => {
        const char = async (name) => idsOf(json(await get("/api/history/char", { name })).data.items);
        expect(await char("Bert")).toEqual([]);
        expect(await char("Cleo")).toEqual([]);
        expect(await char("Dora")).toEqual(["a2"]);
        mockGuild = "gB";
        expect(await char("Bert")).toEqual(["b1", "b3"]);
        expect(await char("Cleo")).toEqual(["b4"]);
        expect(await char("Dora")).toEqual([]);
    });
});

describe("writing", () => {
    it("refuses an import into server B's raid on server A", async () => {
        const res = await post("/api/history/import", { data: "x", event: eventB.id });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(lootStore.listByEvent(eventB.id)).toHaveLength(2);
        expect(status(await post("/api/history/import", { data: "x", event: eventA.id }))).toBe(201);
        expect(lootStore.listByEvent(eventA.id)).toHaveLength(2);
    });

    it("refuses clearing or re-categorising server B's bucket on server A", async () => {
        const cleared = await post("/api/history/clear", { event: "manual-raid-sgB" });
        expect(status(cleared)).toBe(403);
        const recat = await post("/api/history/loot-category", { event: eventB.id, categoryId: "cat-a" });
        expect(status(recat)).toBe(403);
        expect(lootStore.listByEvent("manual-raid-sgB")).toHaveLength(1);
    });

    it("treats a row of server B as not found when deleting on server A", async () => {
        const [rowB] = lootStore.listByEvent(eventB.id);
        const res = await post("/api/history/loot-delete", { id: rowB.id });
        expect(status(res)).toBe(404);
        expect(lootStore.listByEvent(eventB.id)).toHaveLength(2);
        mockGuild = "gB";
        expect(status(await post("/api/history/loot-delete", { id: rowB.id }))).toBe(200);
    });

    it("files a manual bucket of a second server under its own id", async () => {
        mockGuild = "gB";
        const res = await post("/api/history/loot-add", {
            event: "__manual__", manualLabel: "Pug", character: "Emil", itemId: 30095, awardedAt: 5000, response: "Mainspec",
        });
        expect(status(res)).toBe(201);
        expect(json(res).data.eventId).toBe("manual-pug-sgB");
        expect(lootStore.listByEvent("manual-pug-sgB")[0].guildId).toBe("gB");
    });
});
