// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { listRaidEvents, getRaidEvent, saveRaidEvents } = require("../../src/stores/raidEventStore.js");
const { event: baseEvent } = require("../factories/events");

beforeEach(() => {
    fs.__store.clear();
});

const event = (over = {}) => baseEvent({
    guildId: "g1", channelName: "kara",
    categoryId: "cat", categoryName: "Raids", startTime: 1721851200, ...over,
});

describe("stores/raidEventStore", () => {
    it("returns nothing when the store is empty", () => {
        expect(listRaidEvents("g1")).toEqual([]);
        expect(getRaidEvent("e1")).toBeNull();
    });

    it("saves and reads back an event, including the channel/category name", () => {
        saveRaidEvents([event()]);
        const got = getRaidEvent("e1");
        expect(got).toMatchObject({
            id: "e1", guildId: "g1", title: "Kara", channelName: "kara", categoryName: "Raids", startTime: 1721851200,
        });
        expect(got.firstSeenAt).toEqual(expect.any(Number));
        expect(got.updatedAt).toEqual(expect.any(Number));
    });

    it("stays in the store once seen, even when a later scan no longer includes it", () => {
        saveRaidEvents([event()]);
        // a later scan of the guild found nothing new (event fell out of Raid-Helper's window)
        saveRaidEvents([]);
        expect(getRaidEvent("e1")).not.toBeNull();
        expect(listRaidEvents("g1")).toHaveLength(1);
    });

    it("stores the signup roster and the raidplan snapshot", () => {
        saveRaidEvents([event({
            signUps: [{ userId: "u1", specName: "Fury" }],
            setup: [{ name: "Tank", class: "Warrior" }],
        })]);

        expect(getRaidEvent("e1")).toMatchObject({
            signUps: [{ userId: "u1", specName: "Fury" }],
            setup: [{ name: "Tank", class: "Warrior" }],
        });
    });

    it("defaults roster and raidplan to empty arrays", () => {
        saveRaidEvents([event()]);
        expect(getRaidEvent("e1")).toMatchObject({ signUps: [], setup: [] });
    });

    // The crucial one: Raid-Helper stops returning an event's signups a while
    // after the raid. A rescan handing us an empty roster must not erase what was
    // captured at raid time — "we no longer know" is not "nobody signed up".
    it("never lets an empty rescan wipe a captured roster or raidplan", () => {
        saveRaidEvents([event({
            signUps: [{ userId: "u1", specName: "Fury" }],
            setup: [{ name: "Tank", class: "Warrior" }],
        })]);

        saveRaidEvents([event({ signUps: [], setup: [] })]);

        expect(getRaidEvent("e1")).toMatchObject({
            signUps: [{ userId: "u1", specName: "Fury" }],
            setup: [{ name: "Tank", class: "Warrior" }],
        });
    });

    it("does replace the roster when a rescan brings a non-empty one", () => {
        saveRaidEvents([event({ signUps: [{ userId: "u1", specName: "Fury" }] })]);
        saveRaidEvents([event({ signUps: [{ userId: "u2", specName: "Frost" }] })]);

        expect(getRaidEvent("e1").signUps).toEqual([{ userId: "u2", specName: "Frost" }]);
    });

    it("upserts by id: refreshes fields but preserves the first-seen timestamp", () => {
        saveRaidEvents([event({ title: "Kara" })]);
        const firstSeenAt = getRaidEvent("e1").firstSeenAt;
        saveRaidEvents([event({ title: "Kara (renamed)", channelName: "kara-2" })]);
        const updated = getRaidEvent("e1");
        expect(updated.title).toBe("Kara (renamed)");
        expect(updated.channelName).toBe("kara-2");
        expect(updated.firstSeenAt).toBe(firstSeenAt);
        expect(listRaidEvents("g1")).toHaveLength(1); // no duplicate
    });

    it("keeps the previous channel/category name when a re-scan omits it", () => {
        saveRaidEvents([event({ channelName: "kara", categoryName: "Raids" })]);
        // e.g. the channel was deleted before the next scan — meta wasn't available
        saveRaidEvents([{ id: "e1", guildId: "g1", title: "Kara", startTime: 1721851200 }]);
        const got = getRaidEvent("e1");
        expect(got.channelName).toBe("kara");
        expect(got.categoryName).toBe("Raids");
    });

    it("filters listRaidEvents by guild", () => {
        saveRaidEvents([event({ id: "e1", guildId: "g1" }), event({ id: "e2", guildId: "g2" })]);
        expect(listRaidEvents("g1").map((e) => e.id)).toEqual(["e1"]);
        expect(listRaidEvents("g2").map((e) => e.id)).toEqual(["e2"]);
    });

    it("returns every event when no guild is given", () => {
        saveRaidEvents([event({ id: "e1", guildId: "g1" }), event({ id: "e2", guildId: "g2" })]);
        expect(listRaidEvents().map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    });

    it("sorts listRaidEvents by start time, newest first", () => {
        saveRaidEvents([
            event({ id: "old", startTime: 100 }),
            event({ id: "new", startTime: 300 }),
            event({ id: "mid", startTime: 200 }),
        ]);
        expect(listRaidEvents("g1").map((e) => e.id)).toEqual(["new", "mid", "old"]);
    });

    it("skips entries without an id", () => {
        const added = saveRaidEvents([{ guildId: "g1", title: "no id" }]);
        expect(added).toBe(0);
        expect(listRaidEvents("g1")).toEqual([]);
    });

    it("tolerates an empty or missing list", () => {
        expect(saveRaidEvents([])).toBe(0);
        expect(saveRaidEvents()).toBe(0);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("reports how many events were newly seen for the first time", () => {
        expect(saveRaidEvents([event({ id: "e1" }), event({ id: "e2" })])).toBe(2);
        expect(saveRaidEvents([event({ id: "e1" }), event({ id: "e3" })])).toBe(1);
    });
});

// The dashboard scans on every view: a rescan that brings nothing new must not
// rewrite the file, and the snapshots are read from the cache.
describe("stores/raidEventStore - only real changes are written", () => {
    const { RAID_EVENTS_FILE } = require("../../src/stores/raidEventStore.js");
    const writes = () => fs.renameSync.mock.calls.filter(([, to]) => to === RAID_EVENTS_FILE).length;

    beforeEach(() => {
        fs.__store.clear();
        fs.renameSync.mockClear();
        fs.readFileSync.mockClear();
    });

    it("leaves the file alone on a rescan with the same content, updatedAt included", () => {
        const now = jest.spyOn(Date, "now");
        try {
            now.mockReturnValue(1000);
            expect(saveRaidEvents([event({ signUps: [{ userId: "u1", specName: "Fury", status: "signed" }] })])).toBe(1);
            expect(writes()).toBe(1);
            now.mockReturnValue(2000);
            // same scan again, and one that only lacks the (kept) roster
            expect(saveRaidEvents([event({ signUps: [{ userId: "u1", specName: "Fury", status: "signed" }] })])).toBe(0);
            expect(saveRaidEvents([event({ signUps: [] })])).toBe(0);
            expect(writes()).toBe(1);
            expect(getRaidEvent("e1")).toMatchObject({ firstSeenAt: 1000, updatedAt: 1000 });
        } finally {
            now.mockRestore();
        }
    });

    it("writes when a field changed, and bumps updatedAt", () => {
        const now = jest.spyOn(Date, "now");
        try {
            now.mockReturnValue(1000);
            saveRaidEvents([event()]);
            now.mockReturnValue(2000);
            saveRaidEvents([event({ channelName: "kara-neu" })]);
            expect(writes()).toBe(2);
            expect(getRaidEvent("e1")).toMatchObject({ channelName: "kara-neu", firstSeenAt: 1000, updatedAt: 2000 });
            now.mockReturnValue(3000);
            saveRaidEvents([event({ channelName: "kara-neu", signUps: [{ userId: "u2", specName: "Arms" }] })]);
            expect(writes()).toBe(3);
            expect(getRaidEvent("e1").updatedAt).toBe(3000);
        } finally {
            now.mockRestore();
        }
    });

    it("writes nothing for an empty or id-less batch", () => {
        saveRaidEvents([]);
        saveRaidEvents([{ title: "ohne id" }]);
        expect(writes()).toBe(0);
    });

    it("parses the file once for many lookups and hands out copies", () => {
        saveRaidEvents([event(), event({ id: "e2" })]);
        fs.readFileSync.mockClear();
        for (let i = 0; i < 10; i += 1) {
            getRaidEvent("e1");
            listRaidEvents("g1");
        }
        expect(fs.readFileSync.mock.calls.filter(([p]) => p === RAID_EVENTS_FILE)).toHaveLength(1);
        getRaidEvent("e1").title = "x";
        listRaidEvents("g1")[0].signUps.push({ userId: "x" });
        expect(getRaidEvent("e1").title).toBe("Kara");
        expect(listRaidEvents("g1").every((e) => e.signUps.length === 0)).toBe(true);
    });
});
