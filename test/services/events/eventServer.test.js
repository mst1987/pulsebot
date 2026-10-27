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
jest.mock("../../../src/services/discord/serverOf", () => ({
    guildOfEvent: (event) => {
        if (!event) return "";
        if (event.guildId) return event.guildId;
        return { catA: "A", catB: "B" }[event.categoryId] || "";
    },
}));

const { serverOfEntry, allOnServer } = require("../../../src/services/events/eventServer");

beforeEach(() => {
    mockOwn = { "eh-a": { id: "eh-a", guildId: "A" }, "eh-cat": { id: "eh-cat", categoryId: "catB" } };
    mockSnapshots = { 111: { id: "111", guildId: "B" } };
    mockLists = { A: { events: [{ id: "222" }] } };
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

    it("lets a raid of no known server through (the area rights still apply)", () => {
        expect(allOnServer("999", "A")).toBe(true);
    });

    it("asks a lazy active server only when a named raid has a known server", () => {
        const active = jest.fn(() => "A");
        expect(allOnServer(["999"], active)).toBe(true);
        expect(active).not.toHaveBeenCalled();
        expect(allOnServer(["eh-a"], active)).toBe(true);
        expect(active).toHaveBeenCalledTimes(1);
    });
});
