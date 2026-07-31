// What matters here is that a category id never loses its name: the live
// Discord list is only one of three sources, and the two others exist precisely
// for the states in which the live one is empty.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const mockListCategories = jest.fn(() => []);
jest.mock("../../src/web/discord", () => ({
    listCategories: (...a) => mockListCategories(...a),
}));

const mockListRaidEvents = jest.fn(() => []);
jest.mock("../../src/web/raidEventStore", () => ({
    listRaidEvents: (...a) => mockListRaidEvents(...a),
}));

const fs = require("fs");
const { listKnownCategories, rememberCategories, CATEGORY_NAMES_FILE } = require("../../src/web/categoryNames");

const snapshot = () => JSON.parse(fs.__store.get(CATEGORY_NAMES_FILE) || "{}");
const nameOf = (list, id) => (list.find((c) => c.id === id) || {}).name;

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    mockListCategories.mockReturnValue([]);
    mockListRaidEvents.mockReturnValue([]);
});

describe("web/categoryNames listKnownCategories", () => {
    it("serves the live Discord categories in their Discord order", () => {
        mockListCategories.mockReturnValue([{ id: "c2", name: "Montagsraid" }, { id: "c1", name: "Pug" }]);

        expect(listKnownCategories("g1")).toEqual([
            { id: "c2", name: "Montagsraid" },
            { id: "c1", name: "Pug" },
        ]);
        expect(mockListCategories).toHaveBeenCalledWith("g1");
    });

    it("remembers the live names, so they survive the gateway going away", () => {
        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }]);
        listKnownCategories("g1");

        mockListCategories.mockReturnValue([]); // Discord offline / guild not cached
        expect(nameOf(listKnownCategories("g1"), "c1")).toBe("Montagsraid");
    });

    it("still labels the ids when no guild is active at all", () => {
        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }]);
        listKnownCategories("g1");

        // Without a Discord connection there is no guild list either, so the
        // active guild is "" — the case that left raw snowflakes in the roster.
        expect(listKnownCategories("")).toEqual([{ id: "c1", name: "Montagsraid" }]);
        expect(mockListCategories).toHaveBeenCalledTimes(1);
    });

    it("keeps a category Discord no longer lists, next to the live ones", () => {
        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }, { id: "c2", name: "Pug" }]);
        listKnownCategories("g1");

        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }]); // c2 deleted
        expect(listKnownCategories("g1")).toEqual([
            { id: "c1", name: "Montagsraid" },
            { id: "c2", name: "Pug" },
        ]);
    });

    it("prefers the current live name over the remembered one after a rename", () => {
        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }]);
        listKnownCategories("g1");

        mockListCategories.mockReturnValue([{ id: "c1", name: "Dienstagsraid" }]);
        expect(listKnownCategories("g1")).toEqual([{ id: "c1", name: "Dienstagsraid" }]);
    });

    it("falls back to the category name a scanned raid event carries", () => {
        mockListRaidEvents.mockReturnValue([
            { id: "e1", guildId: "g1", categoryId: "c9", categoryName: "Karazhan" },
        ]);
        expect(listKnownCategories("g1")).toEqual([{ id: "c9", name: "Karazhan" }]);
    });

    it("takes the newest event's name when a category was renamed between scans", () => {
        mockListRaidEvents.mockReturnValue([
            { id: "e2", guildId: "g1", categoryId: "c9", categoryName: "Neuer Name" },
            { id: "e1", guildId: "g1", categoryId: "c9", categoryName: "Alter Name" },
        ]);
        expect(listKnownCategories("g1")).toEqual([{ id: "c9", name: "Neuer Name" }]);
    });

    it("ignores events and snapshots of another guild while one is selected", () => {
        mockListCategories.mockReturnValue([{ id: "other", name: "Fremd" }]);
        listKnownCategories("g2");
        mockListCategories.mockReturnValue([]);
        mockListRaidEvents.mockReturnValue([{ id: "e1", guildId: "g2", categoryId: "c9", categoryName: "Karazhan" }]);

        expect(listKnownCategories("g1")).toEqual([]);
    });

    it("skips entries without an id or a name instead of showing a blank badge", () => {
        mockListCategories.mockReturnValue([{ id: "", name: "Ohne Id" }, { id: "c1", name: "" }]);
        mockListRaidEvents.mockReturnValue([{ id: "e1", guildId: "g1", categoryId: "c2", categoryName: "" }]);

        expect(listKnownCategories("g1")).toEqual([{ id: "c1", name: "" }]);
        expect(snapshot().guilds).toBeUndefined(); // nothing worth remembering
    });

    it("survives a corrupt snapshot file", () => {
        fs.__store.set(CATEGORY_NAMES_FILE, "{ not json");
        mockListCategories.mockReturnValue([{ id: "c1", name: "Montagsraid" }]);
        expect(listKnownCategories("g1")).toEqual([{ id: "c1", name: "Montagsraid" }]);
    });
});

describe("web/categoryNames rememberCategories", () => {
    it("merges instead of replacing, across guilds and over time", () => {
        rememberCategories("g1", [{ id: "c1", name: "Montagsraid" }]);
        rememberCategories("g1", [{ id: "c2", name: "Pug" }]);
        rememberCategories("g2", [{ id: "c3", name: "Fremdgilde" }]);

        expect(snapshot().guilds).toEqual({
            g1: { c1: "Montagsraid", c2: "Pug" },
            g2: { c3: "Fremdgilde" },
        });
    });

    it("does not write when there is nothing new to remember", () => {
        rememberCategories("g1", [{ id: "c1", name: "Montagsraid" }]);
        const writes = fs.writeFileSync.mock.calls.length;

        rememberCategories("g1", [{ id: "c1", name: "Montagsraid" }]);
        rememberCategories("g1", []);
        rememberCategories("", [{ id: "c1", name: "Montagsraid" }]);

        expect(fs.writeFileSync.mock.calls.length).toBe(writes);
    });

    it("never lets a failing write break the caller", () => {
        fs.writeFileSync.mockImplementationOnce(() => {
            throw new Error("EACCES");
        });
        expect(() => rememberCategories("g1", [{ id: "c1", name: "Montagsraid" }])).not.toThrow();
    });
});
