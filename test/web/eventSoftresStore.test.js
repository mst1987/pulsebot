// Mock fs with an in-memory store so tests never touch the repo's disk.
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

const fs = require("fs");
const {
    listEventSoftres, getEventSoftres, saveEventSoftres, setEventSoftresLink, deleteEventSoftres,
} = require("../../src/web/eventSoftresStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/eventSoftresStore", () => {
    it("returns null when nothing is recorded", () => {
        expect(getEventSoftres("evt1")).toBeNull();
        expect(getEventSoftres("")).toBeNull();
    });

    it("saves and reads back a softres record", () => {
        const saved = saveEventSoftres("evt1", {
            raidId: "abc", token: "tok", url: "https://softres.it/raid/abc",
            editUrl: "https://softres.it/raid/abc/tok", edition: "tbc",
            instances: ["kara", "gruul"], amount: 2, hardReserveCount: 1,
        });
        expect(saved.eventId).toBe("evt1");
        const got = getEventSoftres("evt1");
        expect(got.raidId).toBe("abc");
        expect(got.instances).toEqual(["kara", "gruul"]);
        expect(got.amount).toBe(2);
        expect(got.hardReserveCount).toBe(1);
        expect(got.createdAt).toEqual(expect.any(Number));
    });

    it("replaces the previous record for the same event (no duplicates)", () => {
        saveEventSoftres("evt1", { raidId: "old", instances: ["kara"] });
        saveEventSoftres("evt1", { raidId: "new", instances: ["gruul"] });
        const all = listEventSoftres().filter((e) => e.eventId === "evt1");
        expect(all).toHaveLength(1);
        expect(all[0].raidId).toBe("new");
    });

    it("ignores a blank event id", () => {
        expect(saveEventSoftres("", { raidId: "x" })).toBeNull();
    });

    it("sets a manual link on top of an existing record, keeping its metadata", () => {
        saveEventSoftres("evt1", {
            raidId: "abc", token: "tok", url: "https://softres.it/raid/abc",
            editUrl: "https://softres.it/raid/abc/tok", edition: "tbc",
            instances: ["kara"], amount: 2, hardReserveCount: 1,
        });
        const updated = setEventSoftresLink("evt1", {
            url: "https://softres.it/raid/xyz", editUrl: "https://softres.it/raid/xyz/newtok",
        });
        expect(updated.raidId).toBe("xyz");
        expect(updated.token).toBe("newtok");
        expect(updated.url).toBe("https://softres.it/raid/xyz");
        expect(updated.editUrl).toBe("https://softres.it/raid/xyz/newtok");
        // unrelated metadata from the previous record survives the link swap
        expect(updated.instances).toEqual(["kara"]);
        expect(updated.amount).toBe(2);
        expect(updated.hardReserveCount).toBe(1);
    });

    it("sets a manual link when no record exists yet", () => {
        const created = setEventSoftresLink("evt2", { url: "https://softres.it/raid/xyz" });
        expect(created.raidId).toBe("xyz");
        expect(created.url).toBe("https://softres.it/raid/xyz");
        expect(created.editUrl).toBe("https://softres.it/raid/xyz");
        expect(created.instances).toEqual([]);
    });

    it("ignores a blank event id when setting a manual link", () => {
        expect(setEventSoftresLink("", { url: "https://softres.it/raid/xyz" })).toBeNull();
    });

    it("deletes a record", () => {
        saveEventSoftres("evt1", { raidId: "abc" });
        expect(deleteEventSoftres("evt1")).toBe(true);
        expect(getEventSoftres("evt1")).toBeNull();
        expect(deleteEventSoftres("evt1")).toBe(false);
    });
});
