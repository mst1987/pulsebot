// services/events/eventServer.js (#925): the server of a raid a route names, and
// whether all named raids belong to the caller's active server.
let mockOwn = {};
let mockSnapshots = {};
let mockLists = {};
jest.mock("../../../src/stores/eventStore", () => ({
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: (id) => mockOwn[id] || null,
}));
jest.mock("../../../src/stores/raidEventStore", () => ({ getRaidEvent: (id) => mockSnapshots[id] || null }));
jest.mock("../../../src/stores/raidhelperEventsStore", () => ({
    snapshotGuilds: () => Object.keys(mockLists),
    readSnapshot: (g) => mockLists[g] || { events: [] },
}));
// the stored category snapshot, the stored series and the bot's live cache (#925 re-review)
let mockSnapshotCats = {};
let mockSeries = {};
let mockLive = {};
let mockClient = null;
jest.mock("../../../src/services/discord/servers/serverOf", () => ({
    storedCategoryGuilds: () => new Map(Object.entries(mockSnapshotCats)),
}));
jest.mock("../../../src/stores/eventSeriesStore", () => ({ getSeries: (id) => mockSeries[id] || null }));
jest.mock("../../../src/services/discord/discord", () => ({ getClient: () => mockClient }));

const { serverOfEntry, allOnServer, guildOfCategory } = require("../../../src/services/events/eventServer");

beforeEach(() => {
    mockOwn = { "eh-a": { id: "eh-a", guildId: "A" }, "eh-cat": { id: "eh-cat", categoryId: "catB" } };
    mockSnapshots = { 111: { id: "111", guildId: "B" } };
    mockLists = { A: { events: [{ id: "222" }] } };
    mockSnapshotCats = { catA: "A", catB: "B" };
    mockSeries = {};
    mockLive = {};
    mockClient = { channels: { cache: { get: (id) => (mockLive[id] ? { id, guildId: mockLive[id] } : null) } } };
});

describe("guildOfCategory", () => {
    it("asks the live cache first: a new category is not in the snapshot yet", () => {
        mockLive = { catNew: "A", catB: "A" };
        expect(guildOfCategory("catNew")).toBe("A");
        expect(guildOfCategory("catB")).toBe("A");
    });

    it("falls back to the stored series' server, then to the snapshot", () => {
        mockSeries = { catS: { categoryId: "catS", guildId: "B" } };
        expect(guildOfCategory("catS")).toBe("B");
        expect(guildOfCategory("catA")).toBe("A");
    });

    it("answers empty for a category nobody knows, also with the bot offline", () => {
        mockClient = null;
        expect(guildOfCategory("ghost")).toBe("");
        expect(guildOfCategory("")).toBe("");
    });
});

describe("serverOfEntry", () => {
    it("reads an own event's server, else its category's", () => {
        expect(serverOfEntry("eh-a")).toBe("A");
        expect(serverOfEntry("eh-cat")).toBe("B");
    });

    it("reads a Raid-Helper raid from its snapshot, else from the synced list holding it", () => {
        expect(serverOfEntry("111")).toBe("B");
        expect(serverOfEntry("222")).toBe("A");
    });

    it("takes a row by its id, a new raid by its category", () => {
        expect(serverOfEntry({ id: "eh-a" })).toBe("A");
        expect(serverOfEntry({ categoryId: "catB" })).toBe("B");
    });

    it("answers empty for what no source knows", () => {
        expect(serverOfEntry("999")).toBe("");
        expect(serverOfEntry("")).toBe("");
        expect(serverOfEntry(null)).toBe("");
        expect(serverOfEntry({})).toBe("");
    });
});

describe("allOnServer", () => {
    it("lets raids of the active server through", () => {
        expect(allOnServer(["eh-a", "222"], "A")).toBe(true);
    });

    it("refuses as soon as one raid belongs to another server", () => {
        expect(allOnServer(["eh-a", "111"], "A")).toBe(false);
        expect(allOnServer("eh-a", "B")).toBe(false);
    });

    it("refuses a raid of a known server when there is no active server", () => {
        expect(allOnServer("eh-a", "")).toBe(false);
    });

    it("refuses a raid or category of no known server (fail closed: only a full admin reaches it)", () => {
        expect(allOnServer("999", "A")).toBe(false);
        expect(allOnServer({ categoryId: "ghost" }, "A")).toBe(false);
        expect(allOnServer(["eh-a", "999"], "A")).toBe(false);
    });

    it("takes a new category from the live cache: one of another server refuses", () => {
        mockLive = { catNew: "A" };
        expect(allOnServer({ categoryId: "catNew" }, "B")).toBe(false);
        expect(allOnServer({ categoryId: "catNew" }, "A")).toBe(true);
    });

    it("skips entries that name nothing, and passes when nothing is named", () => {
        expect(allOnServer([], "A")).toBe(true);
        expect(allOnServer(["", { categoryId: "" }, {}], "A")).toBe(true);
        expect(allOnServer(["", "eh-a"], "A")).toBe(true);
    });

    it("asks a lazy active server only once something is named", () => {
        const active = jest.fn(() => "A");
        expect(allOnServer([""], active)).toBe(true);
        expect(active).not.toHaveBeenCalled();
        expect(allOnServer(["eh-a"], active)).toBe(true);
        expect(active).toHaveBeenCalledTimes(1);
    });
});
