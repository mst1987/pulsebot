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

const fs = require("fs");
const {
    addImport, listByEvent, listByCharacter, eventsWithLoot, characters, clearEvent,
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
    });

    describe("characters", () => {
        it("aggregates loot per character, most first", () => {
            addImport("e1", [
                item({ rawId: "a", character: "Foo", characterKey: "foo" }),
                item({ rawId: "b", character: "Foo", characterKey: "foo" }),
                item({ rawId: "c", character: "Bar", characterKey: "bar" }),
            ]);
            const chars = characters();
            expect(chars[0]).toMatchObject({ character: "Foo", count: 2 });
            expect(chars[1]).toMatchObject({ character: "Bar", count: 1 });
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
});
