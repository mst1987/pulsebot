// Filtering and paging behind both "Latest Loot" views (dashboard card and the
// Historie tab). The stores are mocked; what is exercised is the selection, not
// the disk.
jest.mock("../../../src/stores/loot/lootStore", () => {
    const actual = jest.requireActual("../../../src/stores/loot/lootStore");
    return {
        listAll: jest.fn(() => []),
        // The trimming itself is real: the row shape is the one the history
        // pages already get.
        charLootPreview: actual.charLootPreview,
    };
});
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/roster/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));
// Own events, for the version filter (#545) — an id starting "eh-" is an own
// event, everything else (Raid-Helper, manual) counts as TBC.
jest.mock("../../../src/stores/events/eventStore", () => ({
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    getEvent: jest.fn(() => null),
}));

const lootStore = require("../../../src/stores/loot/lootStore");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const charStore = require("../../../src/stores/roster/characterStore");
const eventStore = require("../../../src/stores/events/eventStore");
const { listAwards, topItemCount, PAGE_SIZE, UNKNOWN_CONTENT } = require("../../../src/web/loot/lootAwards");

// Top items live per server and version (#952): a config whose first server
// (config.guildId) picked these TBC items.
const HOME = "1400000000000000001";
const OTHER = "1400000000000000002";
const topConfig = (tbc, more = {}) => ({ guildId: HOME, serverSettings: { [HOME]: { topItems: { tbc: tbc.map((id) => ({ id })) } }, ...more } });

// A decorated loot row as lootStore.listAll() hands it out, newest first.
const lootRow = (over = {}) => ({
    itemId: 30883, itemName: "Kalter Fels", itemIconUrl: "https://x/i.jpg", itemQuality: 4,
    itemLink: "https://www.wowhead.com/tbc/item=30883", character: "Kilrogg", characterKey: "kilrogg",
    realm: "Thunderstrike", response: "BiS", offspec: false, reason: "bis", reasonLabel: "BiS", reasonTone: "bis",
    contentId: "ssc", boss: "Hydross", categoryId: "cat1", eventId: "e1", eventLabel: "Montagsraid",
    awardedAt: 1000, source: "gargul", ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue(topConfig([30883, 32235]));
    lootStore.listAll.mockReturnValue([]);
    charStore.characterMap.mockReturnValue({});
});

describe("web/loot/lootAwards listAwards", () => {
    describe("scope", () => {
        it("keeps only top items by default", () => {
            lootStore.listAll.mockReturnValue([
                lootRow(),
                lootRow({ itemId: 12345, itemName: "Kein Top-Item" }),
                lootRow({ itemId: 32235, itemName: "Zweites Top-Item" }),
            ]);

            const res = listAwards();

            expect(res.items.map((it) => it.itemId)).toEqual([30883, 32235]);
            expect(res.total).toBe(2);
            expect(res.topItemCount).toBe(2);
        });

        it("widens to every award with topOnly false", () => {
            lootStore.listAll.mockReturnValue([lootRow(), lootRow({ itemId: 12345 })]);
            expect(listAwards({ topOnly: false }).total).toBe(2);
        });

        // "Nichts konfiguriert" must not read as "alles ist ein Top-Item".
        it("is empty when no top items are configured", () => {
            settingsStore.getConfig.mockReturnValue({});
            lootStore.listAll.mockReturnValue([lootRow()]);
            const res = listAwards();
            expect(res.items).toEqual([]);
            expect(res.topItemCount).toBe(0);
        });
    });

    // #952: a row counts as top item by the list of its raid's server and version.
    describe("top items per server and version (#952)", () => {
        it("matches a row against the list of its own server, not another one's", () => {
            settingsStore.getConfig.mockReturnValue({
                guildId: HOME,
                serverSettings: {
                    [HOME]: { topItems: { tbc: [{ id: 30883 }] } },
                    [OTHER]: { topItems: { tbc: [{ id: 32235 }] } },
                },
            });
            lootStore.listAll.mockReturnValue([
                lootRow({ character: "Heim" }),
                lootRow({ itemId: 32235, character: "Fremd-Item" }),
                lootRow({ itemId: 32235, character: "Partner", eventId: "", categoryId: "", guildId: OTHER }),
                lootRow({ character: "Partner-Kein-Top", eventId: "", categoryId: "", guildId: OTHER }),
            ]);
            expect(listAwards().items.map((it) => it.character)).toEqual(["Heim", "Partner"]);
        });

        it("matches by the raid's version: a Forever raid needs the Forever list", () => {
            settingsStore.getConfig.mockReturnValue({
                guildId: HOME,
                serverSettings: { [HOME]: { topItems: { tbc: [{ id: 30883 }], forever: [{ id: 32235 }] } } },
            });
            eventStore.getEvent.mockImplementation((id) => (id === "eh-9" ? { versionId: "forever", guildId: HOME } : null));
            lootStore.listAll.mockReturnValue([
                lootRow({ character: "Tbc" }),
                lootRow({ character: "Forever-Tbc-Item", eventId: "eh-9" }),
                lootRow({ itemId: 32235, character: "Forever", eventId: "eh-9" }),
            ]);
            expect(listAwards().items.map((it) => it.character)).toEqual(["Tbc", "Forever"]);
        });

        it("counts the active server's list of the shown version, else all of its versions", () => {
            const config = {
                guildId: HOME,
                serverSettings: {
                    [HOME]: { topItems: { tbc: [{ id: 1 }, { id: 2 }], forever: [{ id: 2 }, { id: 3 }] } },
                    [OTHER]: { topItems: { tbc: [{ id: 9 }] } },
                },
            };
            expect(topItemCount(config, { guildId: HOME, versionId: "tbc" })).toBe(2);
            expect(topItemCount(config, { guildId: HOME, versionId: "forever" })).toBe(2);
            expect(topItemCount(config, { guildId: HOME })).toBe(3);
            expect(topItemCount(config, { guildId: "" })).toBe(0);
            expect(topItemCount(config)).toBe(4);
        });
    });

    describe("filters", () => {
        beforeEach(() => {
            lootStore.listAll.mockReturnValue([
                lootRow(),
                lootRow({ itemId: 32235, itemName: "Verfluchte Vision", character: "Shalya", characterKey: "shalya", reason: "offspec", contentId: "bt", categoryId: "cat2" }),
                lootRow({ itemId: 32235, itemName: "Verfluchte Vision", character: "Morvran", characterKey: "morvran", reason: "mainspec", contentId: "", categoryId: "cat1" }),
            ]);
        });

        it("searches the item name", () => {
            expect(listAwards({ search: "kalter" }).items.map((it) => it.character)).toEqual(["Kilrogg"]);
        });

        it("searches the character name, case-insensitively", () => {
            expect(listAwards({ search: "SHALYA" }).items.map((it) => it.character)).toEqual(["Shalya"]);
        });

        // A Gargul row can reach the store without a name at all; the id is the
        // one handle it always has.
        it("searches the item id", () => {
            expect(listAwards({ search: "30883" }).total).toBe(1);
        });

        it("filters by raid category", () => {
            expect(listAwards({ categoryId: "cat2" }).items.map((it) => it.character)).toEqual(["Shalya"]);
        });

        it("filters by content", () => {
            expect(listAwards({ contentId: "bt" }).items.map((it) => it.character)).toEqual(["Shalya"]);
        });

        it("filters by award reason", () => {
            expect(listAwards({ reason: "offspec" }).items.map((it) => it.character)).toEqual(["Shalya"]);
        });

        it("filters by game version (#545): an own event's own, else TBC", () => {
            eventStore.getEvent.mockImplementation((id) => (id === "eh-9" ? { versionId: "forever" } : null));
            lootStore.listAll.mockReturnValue([
                lootRow({ character: "Aldric", eventId: "eh-9" }),
                lootRow({ character: "Kilrogg", eventId: "e1" }),
            ]);
            expect(listAwards({ topOnly: false, versionId: "forever" }).items.map((it) => it.character)).toEqual(["Aldric"]);
            expect(listAwards({ topOnly: false, versionId: "tbc" }).items.map((it) => it.character)).toEqual(["Kilrogg"]);
            expect(listAwards({ topOnly: false }).items.map((it) => it.character).sort()).toEqual(["Aldric", "Kilrogg"]);
        });

        // Loot whose raid the content table doesn't know stays findable instead
        // of being filed into a wrong one.
        it("filters the rows without a known content", () => {
            const res = listAwards({ contentId: UNKNOWN_CONTENT });
            expect(res.items.map((it) => it.character)).toEqual(["Morvran"]);
            expect(res.unknownContentCount).toBe(1);
        });

        it("combines filters", () => {
            expect(listAwards({ categoryId: "cat1", reason: "bis" }).items.map((it) => it.character)).toEqual(["Kilrogg"]);
        });

        // Offering a raid or a reason that cannot match anything is noise.
        it("only offers the contents and reasons that occur in scope", () => {
            const res = listAwards();
            expect(res.contents.map((c) => c.id)).toEqual(["ssc", "bt"]);
            expect(res.reasons.map((r) => r.id)).toEqual(["bis", "mainspec", "offspec"]);
        });
    });

    describe("paging", () => {
        const many = (n) => Array.from({ length: n }, (_, i) => lootRow({ character: `C${i}`, awardedAt: 10000 - i }));

        it("cuts the list into pages of 25", () => {
            lootStore.listAll.mockReturnValue(many(60));

            const first = listAwards();
            expect(first.pageSize).toBe(PAGE_SIZE);
            expect(first.items).toHaveLength(25);
            expect(first.items[0].character).toBe("C0");
            expect(first.total).toBe(60);
            expect(first.totalPages).toBe(3);

            const third = listAwards({ page: 3 });
            expect(third.items).toHaveLength(10);
            expect(third.items[0].character).toBe("C50");
        });

        it("clamps a page beyond the end and below the start", () => {
            lootStore.listAll.mockReturnValue(many(30));
            expect(listAwards({ page: 99 }).page).toBe(2);
            expect(listAwards({ page: 0 }).page).toBe(1);
            expect(listAwards({ page: "unsinn" }).page).toBe(1);
        });

        it("reports one page and no rows for an empty result", () => {
            const res = listAwards({ search: "gibtsnicht" });
            expect(res).toMatchObject({ items: [], total: 0, totalPages: 1, page: 1 });
        });

        it("honours a custom page size (the dashboard card's five rows)", () => {
            lootStore.listAll.mockReturnValue(many(12));
            const res = listAwards({ pageSize: 5 });
            expect(res.items).toHaveLength(5);
            expect(res.totalPages).toBe(3);
        });
    });

    describe("class/spec of the winner", () => {
        it("annotates the rows from the character store", () => {
            lootStore.listAll.mockReturnValue([lootRow()]);
            charStore.characterMap.mockReturnValue({ kilrogg: { className: "Mage", spec: "Fire" } });

            expect(listAwards().items[0]).toMatchObject({
                className: "Mage", spec: "Fire", classColor: "#69CCF0",
            });
        });

        it("leaves the look empty for an unresolved character", () => {
            lootStore.listAll.mockReturnValue([lootRow()]);
            expect(listAwards().items[0]).toMatchObject({ className: "", spec: "", classColor: "", specIconUrl: "" });
        });

        // Reading the store costs a file read; an empty page has nothing to annotate.
        it("does not touch the character store for an empty page", () => {
            listAwards();
            expect(charStore.characterMap).not.toHaveBeenCalled();
        });
    });

    describe("sorting", () => {
        const rows = () => [
            lootRow({ itemName: "Zeitlos", character: "Anna", awardedAt: 300, reasonLabel: "Offspec", contentId: "tk" }),
            lootRow({ itemName: "Amulett", character: "Zora", awardedAt: 200, reasonLabel: "BiS", contentId: "ssc" }),
            lootRow({ itemName: "Mantel", character: "Berta", awardedAt: 100, reasonLabel: "Mainspec", contentId: "bt" }),
        ];
        const names = (res) => res.items.map((it) => it.itemName);

        beforeEach(() => lootStore.listAll.mockReturnValue(rows()));

        it("keeps the store's order (newest first) by default", () => {
            expect(names(listAwards({ topOnly: false }))).toEqual(["Zeitlos", "Amulett", "Mantel"]);
        });

        it("orders by item name and by player, ascending or descending", () => {
            expect(names(listAwards({ topOnly: false, sort: "item", dir: "asc" }))).toEqual(["Amulett", "Mantel", "Zeitlos"]);
            expect(names(listAwards({ topOnly: false, sort: "character", dir: "desc" }))).toEqual(["Amulett", "Mantel", "Zeitlos"]);
        });

        it("orders by reason, raid and oldest first", () => {
            expect(names(listAwards({ topOnly: false, sort: "reason", dir: "asc" }))).toEqual(["Amulett", "Mantel", "Zeitlos"]);
            expect(names(listAwards({ topOnly: false, sort: "raid", dir: "asc" }))).toEqual(["Mantel", "Amulett", "Zeitlos"]);
            expect(names(listAwards({ topOnly: false, sort: "date", dir: "asc" }))).toEqual(["Mantel", "Amulett", "Zeitlos"]);
        });

        it("sorts before it pages, so a column orders every page", () => {
            const res = listAwards({ topOnly: false, sort: "item", dir: "desc", pageSize: 1, page: 1 });
            expect(names(res)).toEqual(["Zeitlos"]);
        });

        it("ignores an unknown column", () => {
            expect(names(listAwards({ topOnly: false, sort: "nope", dir: "asc" }))).toEqual(["Zeitlos", "Amulett", "Mantel"]);
        });
    });
});

// Only the loot of the active Discord server (#919).
describe("listAwards per server", () => {
    it("keeps another server's awards off the active one", () => {
        // gA is the first server; each server picked both items for TBC (#952).
        const both = { topItems: { tbc: [{ id: 30883 }, { id: 32235 }] } };
        settingsStore.getConfig.mockReturnValue({ guildId: "gA", serverSettings: { gA: both, gB: both } });
        lootStore.listAll.mockReturnValue([
            lootRow({ eventId: "manual-b", guildId: "gB" }),
            lootRow({ eventId: "manual-a", itemId: 32235 }),
        ]);
        expect(listAwards({ guildId: "gA" }).items.map((it) => it.itemId)).toEqual([32235]);
        expect(listAwards().total).toBe(2);
    });
});
