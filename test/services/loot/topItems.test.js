const {
    MAX_TOP_ITEMS, normalizeTopItemLists, topItemListsOf, topItemsOf, topItemIds, withTopItem,
} = require("../../../src/services/loot/topItems");

const item = (id, extra = {}) => ({ id, name: `Item ${id}`, iconUrl: "https://wow.zamimg.com/x.jpg", quality: 4, ...extra });

describe("normalizeTopItemLists", () => {
    it("keeps one normalised list per known version", () => {
        const out = normalizeTopItemLists({
            tbc: [item(1), item(1), { id: "2", name: " B ", iconUrl: "javascript:x", quality: 0 }],
            classic: [item(3)],
            mists: [item(9)],
            forever: [],
        });
        expect(out).toEqual({
            tbc: [item(1), { id: 2, name: "B", iconUrl: "", quality: 0 }],
            classic: [item(3)],
        });
    });

    it("answers {} for anything that is not a map", () => {
        expect(normalizeTopItemLists(null)).toEqual({});
        expect(normalizeTopItemLists([item(1)])).toEqual({});
        expect(normalizeTopItemLists("tbc")).toEqual({});
    });

    it("caps a list at MAX_TOP_ITEMS", () => {
        const many = Array.from({ length: MAX_TOP_ITEMS + 5 }, (_, i) => item(i + 1));
        expect(normalizeTopItemLists({ tbc: many }).tbc).toHaveLength(MAX_TOP_ITEMS);
    });
});

describe("topItemsOf / topItemIds", () => {
    const config = {
        serverSettings: {
            g1: { topItems: { tbc: [item(10), item(11)], forever: [item(20)] } },
            g2: { topItems: { tbc: [item(30)] } },
        },
    };

    it("reads the list of one server and version", () => {
        expect(topItemsOf("g1", "tbc", { config }).map((it) => it.id)).toEqual([10, 11]);
        expect([...topItemIds("g1", "forever", { config })]).toEqual([20]);
        expect([...topItemIds("g2", "tbc", { config })]).toEqual([30]);
    });

    it("is empty for another server, an unknown version or no server", () => {
        expect(topItemsOf("g2", "forever", { config })).toEqual([]);
        expect(topItemsOf("g3", "tbc", { config })).toEqual([]);
        expect(topItemsOf("g1", "mists", { config })).toEqual([]);
        expect(topItemsOf("", "tbc", { config })).toEqual([]);
        expect(topItemIds("g1", "", { config }).size).toBe(0);
    });

    it("topItemListsOf gives every version of a server", () => {
        expect(Object.keys(topItemListsOf("g1", { config }))).toEqual(["tbc", "forever"]);
        expect(topItemListsOf("g3", { config })).toEqual({});
    });
});

describe("withTopItem", () => {
    const lists = { tbc: [item(1), item(2)], classic: [item(5)] };

    it("appends a new item and keeps a known one in place", () => {
        expect(withTopItem(lists, "tbc", item(3), true).tbc.map((it) => it.id)).toEqual([1, 2, 3]);
        expect(withTopItem(lists, "tbc", item(1, { name: "neu" }), true).tbc[0].name).toBe("Item 1");
    });

    it("removes an item and drops an emptied version", () => {
        expect(withTopItem(lists, "tbc", { id: 1 }, false).tbc.map((it) => it.id)).toEqual([2]);
        const out = withTopItem(lists, "classic", { id: 5 }, false);
        expect(out.classic).toBeUndefined();
        expect(out.tbc).toHaveLength(2);
    });

    it("starts a version that had no list yet", () => {
        expect(withTopItem(lists, "forever", item(7), true).forever.map((it) => it.id)).toEqual([7]);
    });

    it("ignores an unknown version or an item without id", () => {
        expect(withTopItem(lists, "mists", item(7), true)).toEqual(normalizeTopItemLists(lists));
        expect(withTopItem(lists, "tbc", { id: 0 }, true)).toEqual(normalizeTopItemLists(lists));
        expect(withTopItem(null, "tbc", item(4), true)).toEqual({ tbc: [item(4)] });
    });
});
