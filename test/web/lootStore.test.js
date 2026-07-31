// In-memory fs so the store never touches the repo disk.
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
        writeFileSync: jest.fn((p, data) => { store.set(p, String(data)); }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

// repairItemNames() runs the import-time Wowhead enrichment — mock the lookup
// so no test ever hits the network (id 100 resolves, everything else misses).
jest.mock("../../src/utils/wowhead", () => ({
    ...jest.requireActual("../../src/utils/wowhead"),
    lookupItem: jest.fn(async (id) => (Number(id) === 100
        ? { id: 100, name: "Thing", icon: "inv_thing", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_thing.jpg", quality: 4 }
        : null)),
}));

const fs = require("fs");
const {
    addImport, listAll, listByEvent, listByCharacter, eventsWithLoot, characters, setEventCategory, clearEvent, repairItemNames,
} = require("../../src/web/lootStore.js");

beforeEach(() => {
    fs.__store.clear();
});

const item = (over = {}) => ({
    source: "rclc", rawId: "r1", itemId: 100, itemName: "Thing",
    player: "Foo-Thunderstrike", character: "Foo", characterKey: "foo", realm: "Thunderstrike",
    response: "BIS", offspec: false, boss: "Boss", awardedAt: 1000, awardedBy: "ML",
    ...over,
});

describe("web/lootStore", () => {
    // Reason, raid and tier are derived on every read rather than stored, so
    // rows imported before those tables existed profit from them too.
    describe("read-time enrichment", () => {
        it("adds the award reason to every row without touching the raw response", () => {
            addImport("e1", [item({ response: "Off Spec", offspec: true })]);
            expect(listByEvent("e1")[0]).toMatchObject({
                response: "Off Spec", reason: "offspec", reasonLabel: "Offspec", reasonTone: "offspec",
            });
        });

        it("resolves the raid and boss from the item id (30105 = SSC / Lady Vashj)", () => {
            addImport("e1", [item({ itemId: 30105, boss: "" })]);
            expect(listByEvent("e1")[0]).toMatchObject({ contentId: "ssc", boss: "Lady Vashj" });
        });

        it("leaves an unknown item without a raid rather than guessing", () => {
            addImport("e1", [item({ itemId: 100, boss: "" })]);
            expect(listByEvent("e1")[0]).toMatchObject({ contentId: "", boss: "" });
        });

        it("applies to listAll and listByCharacter the same way", () => {
            addImport("e1", [item({ itemId: 30105 })]);
            expect(listAll()[0].contentId).toBe("ssc");
            expect(listByCharacter("Foo")[0].reason).toBe("bis");
        });

        it("carries the reason into the per-character preview items", () => {
            addImport("e1", [item({ response: "PvP" })]);
            expect(characters()[0].items[0]).toMatchObject({ reason: "pvp", reasonTone: "pvp" });
        });
    });

    describe("addImport", () => {
        it("stores items against an event and reports the added count", () => {
            const res = addImport("e1", [item(), item({ rawId: "r2", character: "Bar", characterKey: "bar" })], { categoryId: "cat1" });
            expect(res).toEqual({ added: 2, skipped: 0 });
            const stored = listByEvent("e1");
            expect(stored).toHaveLength(2);
            expect(stored[0]).toMatchObject({ eventId: "e1", categoryId: "cat1" });
            expect(stored[0].id).toMatch(/^[0-9a-f]{12}$/);
        });

        it("dedupes on (event, source, rawId) across re-imports", () => {
            addImport("e1", [item()]);
            const res = addImport("e1", [item(), item({ rawId: "r2" })]);
            expect(res).toEqual({ added: 1, skipped: 1 });
            expect(listByEvent("e1")).toHaveLength(2);
        });

        it("keeps the same rawId separate per event", () => {
            addImport("e1", [item()]);
            addImport("e2", [item()]);
            expect(listByEvent("e1")).toHaveLength(1);
            expect(listByEvent("e2")).toHaveLength(1);
        });

        it("ignores empty input and a blank event id", () => {
            expect(addImport("", [item()])).toEqual({ added: 0, skipped: 0 });
            expect(addImport("e1", [])).toEqual({ added: 0, skipped: 0 });
        });
    });

    describe("listByEvent", () => {
        it("returns loot newest-award first", () => {
            addImport("e1", [item({ rawId: "a", awardedAt: 100 }), item({ rawId: "b", awardedAt: 500 })]);
            expect(listByEvent("e1").map((i) => i.rawId)).toEqual(["b", "a"]);
        });
    });

    describe("listByCharacter", () => {
        it("matches case-insensitively across events", () => {
            addImport("e1", [item({ rawId: "a", character: "Foo", characterKey: "foo" })]);
            addImport("e2", [item({ rawId: "b", character: "Foo", characterKey: "foo" })]);
            expect(listByCharacter("FOO")).toHaveLength(2);
            expect(listByCharacter("nobody")).toHaveLength(0);
        });
    });

    describe("eventsWithLoot", () => {
        it("summarizes distinct events with counts and sources", () => {
            addImport("e1", [item({ rawId: "a", source: "rclc" }), item({ rawId: "b", source: "gargul" })]);
            addImport("e2", [item({ rawId: "c" })]);
            const events = eventsWithLoot();
            const e1 = events.find((e) => e.eventId === "e1");
            expect(e1.count).toBe(2);
            expect(e1.sources.sort()).toEqual(["gargul", "rclc"]);
        });

        it("reports the bucket's category, empty for a manual import without one", () => {
            addImport("e1", [item({ rawId: "a" })], { categoryId: "cat-pug" });
            addImport("manual-raid", [item({ rawId: "b" })]);
            const events = eventsWithLoot();
            expect(events.find((e) => e.eventId === "e1").categoryId).toBe("cat-pug");
            expect(events.find((e) => e.eventId === "manual-raid").categoryId).toBe("");
        });
    });

    describe("setEventCategory", () => {
        it("files every row of one bucket under a category and reports the count", () => {
            addImport("manual-raid", [item({ rawId: "a" }), item({ rawId: "b" })]);
            addImport("e2", [item({ rawId: "c" })], { categoryId: "cat-montag" });

            expect(setEventCategory("manual-raid", "cat-pug")).toBe(2);
            expect(listByEvent("manual-raid").map((i) => i.categoryId)).toEqual(["cat-pug", "cat-pug"]);
            // untouched — the assignment is per bucket, not global
            expect(listByEvent("e2")[0].categoryId).toBe("cat-montag");
            // and it is what the overviews group by from now on
            expect(characters().find((c) => c.key === "foo").categoryIds.sort()).toEqual(["cat-montag", "cat-pug"]);
        });

        it("clears the category again for an empty id", () => {
            addImport("e1", [item()], { categoryId: "cat-pug" });
            expect(setEventCategory("e1", "")).toBe(1);
            expect(listByEvent("e1")[0].categoryId).toBe("");
        });

        it("changes nothing when the category already matches or the event is unknown", () => {
            addImport("e1", [item()], { categoryId: "cat-pug" });
            expect(setEventCategory("e1", "cat-pug")).toBe(0);
            expect(setEventCategory("nope", "cat-pug")).toBe(0);
            expect(setEventCategory("", "cat-pug")).toBe(0);
        });

        it("persists the assignment", () => {
            addImport("manual-raid", [item()]);
            setEventCategory("manual-raid", "cat-pug");
            const written = JSON.parse(fs.__store.get([...fs.__store.keys()].find((k) => k.endsWith("loot.json"))));
            expect(written.items[0].categoryId).toBe("cat-pug");
        });
    });

    describe("characters", () => {
        it("aggregates loot per character, most first", () => {
            addImport("e1", [
                item({ rawId: "a", character: "Foo", characterKey: "foo" }),
                item({ rawId: "b", character: "Foo", characterKey: "foo" }),
                item({ rawId: "c", character: "Bar", characterKey: "bar" }),
            ], { eventLabel: "Raid A" });
            const chars = characters();
            expect(chars[0]).toMatchObject({ character: "Foo", count: 2 });
            expect(chars[1]).toMatchObject({ character: "Bar", count: 1 });
        });

        it("collects the distinct raid categories each character got loot in", () => {
            addImport("e1", [item({ rawId: "a", character: "Foo", characterKey: "foo" })], { categoryId: "cat-pug" });
            addImport("e2", [item({ rawId: "b", character: "Foo", characterKey: "foo" })], { categoryId: "cat-montag" });
            addImport("e1", [item({ rawId: "c", character: "Foo", characterKey: "foo" })], { categoryId: "cat-pug" }); // same category again — no duplicate
            const foo = characters().find((c) => c.key === "foo");
            expect(foo.count).toBe(3);
            expect(foo.categoryIds.sort()).toEqual(["cat-montag", "cat-pug"]);
        });

        it("leaves categoryIds empty for loot without a category (pure manual import)", () => {
            addImport("e1", [item({ rawId: "a", character: "Foo", characterKey: "foo" })]);
            expect(characters().find((c) => c.key === "foo").categoryIds).toEqual([]);
        });

        it("carries each character's items for the hover preview, newest award first", () => {
            addImport("e1", [
                item({ rawId: "a", character: "Foo", characterKey: "foo", itemId: 100, itemName: "Thing", response: "BiS", awardedAt: 100 }),
                item({ rawId: "b", character: "Foo", characterKey: "foo", itemId: 200, itemName: "Other", response: "Offspec", offspec: true, awardedAt: 500 }),
                item({ rawId: "c", character: "Bar", characterKey: "bar" }),
            ], { categoryId: "cat-pug", eventLabel: "Raid A" });
            const foo = characters().find((c) => c.key === "foo");
            expect(foo.items).toHaveLength(2);
            expect(foo.items[0]).toMatchObject({
                itemId: 200, itemName: "Other", response: "Offspec", offspec: true,
                categoryId: "cat-pug", eventLabel: "Raid A", awardedAt: 500,
            });
            expect(foo.items[1]).toMatchObject({ itemId: 100, response: "BiS", offspec: false });
            // the preview stays trimmed — no raw importer bookkeeping rides along
            expect(foo.items[0]).not.toHaveProperty("rawId");
            expect(foo.items[0]).not.toHaveProperty("player");
        });

        it("spans events in a character's item list and defaults the fields an export left out", () => {
            addImport("e1", [item({ rawId: "a", character: "Foo", characterKey: "foo", response: "", itemName: "" })], { categoryId: "cat-pug" });
            addImport("e2", [item({ rawId: "b", character: "Foo", characterKey: "foo" })], { categoryId: "cat-montag" });
            const foo = characters().find((c) => c.key === "foo");
            expect(foo.items).toHaveLength(2);
            expect(foo.items.map((i) => i.categoryId).sort()).toEqual(["cat-montag", "cat-pug"]);
            const bare = foo.items.find((i) => !i.itemName);
            expect(bare).toMatchObject({ itemName: "", itemIconUrl: "", itemLink: "", response: "", offspec: false });
        });
    });

    describe("clearEvent", () => {
        it("removes all loot for one event only", () => {
            addImport("e1", [item({ rawId: "a" })]);
            addImport("e2", [item({ rawId: "b" })]);
            expect(clearEvent("e1")).toBe(1);
            expect(listByEvent("e1")).toHaveLength(0);
            expect(listByEvent("e2")).toHaveLength(1);
        });
    });

    describe("repairItemNames", () => {
        it("backfills missing names/icons/qualities via Wowhead and persists them", async () => {
            addImport("e1", [item({ itemName: "" })]); // pre-enrichment row: id only
            expect(await repairItemNames()).toBe(1);
            const [row] = listByEvent("e1");
            expect(row.itemName).toBe("Thing");
            expect(row.itemIconUrl).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_thing.jpg");
            expect(row.itemQuality).toBe(4);
            // persisted — a second run finds nothing left to repair
            expect(await repairItemNames()).toBe(0);
        });

        // Rows imported before the quality was stored have name and icon but no
        // colour to render the item name in — the backfill has to pick them up.
        it("backfills the quality alone on rows that already have name and icon", async () => {
            addImport("e1", [item()]); // name + icon-less legacy row, no quality
            expect(await repairItemNames()).toBe(1);
            expect(listByEvent("e1")[0].itemQuality).toBe(4);
        });

        it("leaves rows untouched when Wowhead does not know the id", async () => {
            addImport("e1", [item({ itemName: "", itemId: 999 })]);
            expect(await repairItemNames()).toBe(0);
            expect(listByEvent("e1")[0].itemName).toBe("");
        });
    });
});
