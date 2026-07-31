// Filtering and paging behind both "Latest Loot" views (dashboard card and the
// Historie tab). The stores are mocked; what is exercised is the selection, not
// the disk.
jest.mock("../../src/web/lootStore", () => {
    const actual = jest.requireActual("../../src/web/lootStore");
    return {
        listAll: jest.fn(() => []),
        // The trimming itself is real: the row shape is the one the history
        // pages already get.
        charLootPreview: actual.charLootPreview,
    };
});
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));

const lootStore = require("../../src/web/lootStore");
const settingsStore = require("../../src/web/settingsStore");
const charStore = require("../../src/web/characterStore");
const { listAwards, PAGE_SIZE, UNKNOWN_CONTENT } = require("../../src/web/lootAwards");

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
    settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }, { id: 32235 }] });
    lootStore.listAll.mockReturnValue([]);
    charStore.characterMap.mockReturnValue({});
});

describe("web/lootAwards listAwards", () => {
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
});
