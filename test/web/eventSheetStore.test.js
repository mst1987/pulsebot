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
    listEventSheets, getEventSheet, markEventSheetFilled, markEventSheetPosted, deleteEventSheet,
} = require("../../src/web/eventSheetStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/eventSheetStore", () => {
    describe("getEventSheet", () => {
        it("returns null when nothing is recorded", () => {
            expect(getEventSheet("evt1")).toBeNull();
        });

        it("returns null for a blank event id", () => {
            markEventSheetFilled("evt1");
            expect(getEventSheet("")).toBeNull();
            expect(getEventSheet(null)).toBeNull();
        });

        it("finds a recorded event by id", () => {
            markEventSheetFilled("evt1", { sheetId: "tier45", sheetName: "Tier 4/5", playerCount: 25 });
            const rec = getEventSheet("evt1");
            expect(rec).toMatchObject({ eventId: "evt1", sheetId: "tier45", sheetName: "Tier 4/5", playerCount: 25 });
            expect(typeof rec.filledAt).toBe("number");
        });
    });

    describe("markEventSheetFilled", () => {
        it("rejects a blank event id", () => {
            expect(markEventSheetFilled("")).toBeNull();
            expect(listEventSheets()).toEqual([]);
        });

        it("creates a record with a filledAt timestamp", () => {
            const before = Date.now();
            const saved = markEventSheetFilled("evt1", { sheetId: "s1", playerCount: 10 });
            expect(saved.eventId).toBe("evt1");
            expect(saved.filledAt).toBeGreaterThanOrEqual(before);
            expect(listEventSheets()).toHaveLength(1);
        });

        it("upserts by event id instead of duplicating, refreshing the timestamp/summary", async () => {
            const first = markEventSheetFilled("evt1", { sheetId: "s1", playerCount: 10 });
            await new Promise((r) => setTimeout(r, 2));
            const second = markEventSheetFilled("evt1", { sheetId: "s2", playerCount: 22 });
            expect(listEventSheets()).toHaveLength(1);
            expect(second.sheetId).toBe("s2");
            expect(second.playerCount).toBe(22);
            expect(second.filledAt).toBeGreaterThanOrEqual(first.filledAt);
        });

        it("coerces the player count to a number", () => {
            const saved = markEventSheetFilled("evt1", { playerCount: "17" });
            expect(saved.playerCount).toBe(17);
        });

        it("keeps records for different events separate", () => {
            markEventSheetFilled("evt1", { sheetId: "s1" });
            markEventSheetFilled("evt2", { sheetId: "s2" });
            expect(listEventSheets()).toHaveLength(2);
            expect(getEventSheet("evt2").sheetId).toBe("s2");
        });

        it("stores the per-raid copy details (Drive file, link, deletion time)", () => {
            const saved = markEventSheetFilled("evt1", {
                spreadsheetId: "copy-1", url: "https://docs.google.com/spreadsheets/d/copy-1/edit",
                sourceSheetId: "src-1", deleteAfter: 999,
            });
            expect(saved).toMatchObject({
                spreadsheetId: "copy-1", url: "https://docs.google.com/spreadsheets/d/copy-1/edit",
                sourceSheetId: "src-1", deleteAfter: 999,
            });
        });

        it("preserves copy details when a later fill only refreshes the player count", () => {
            markEventSheetFilled("evt1", { spreadsheetId: "copy-1", url: "u", deleteAfter: 999 });
            const second = markEventSheetFilled("evt1", { sheetId: "tier45", playerCount: 25 });
            // second call keeps the copy fields from the first
            expect(second).toMatchObject({ spreadsheetId: "copy-1", url: "u", deleteAfter: 999, playerCount: 25 });
        });
    });

    describe("markEventSheetPosted", () => {
        it("returns null for an event with no fill record", () => {
            expect(markEventSheetPosted("evt1", { channelId: "c1", messageId: "m1" })).toBeNull();
        });

        it("records the posted message on top of an existing fill record", () => {
            markEventSheetFilled("evt1", { sheetId: "s1" });
            const saved = markEventSheetPosted("evt1", { channelId: "c1", messageId: "m1", message: "Bitte eintragen!" });
            expect(saved).toMatchObject({
                eventId: "evt1", sheetId: "s1", postedChannelId: "c1", postedMessageId: "m1", postedMessage: "Bitte eintragen!",
            });
            expect(typeof saved.postedAt).toBe("number");
            expect(getEventSheet("evt1")).toMatchObject({ postedChannelId: "c1", postedMessageId: "m1" });
        });

        it("survives a later re-fill (posted state isn't wiped by regenerating the sheet)", () => {
            markEventSheetFilled("evt1", { sheetId: "s1" });
            markEventSheetPosted("evt1", { channelId: "c1", messageId: "m1", message: "Hi" });
            markEventSheetFilled("evt1", { sheetId: "s1", playerCount: 25 });
            expect(getEventSheet("evt1")).toMatchObject({ postedChannelId: "c1", postedMessageId: "m1", playerCount: 25 });
        });
    });

    describe("deleteEventSheet", () => {
        it("removes a record by event id and reports success", () => {
            markEventSheetFilled("evt1", { sheetId: "s1" });
            expect(deleteEventSheet("evt1")).toBe(true);
            expect(deleteEventSheet("evt1")).toBe(false);
            expect(getEventSheet("evt1")).toBeNull();
        });
    });

    describe("listEventSheets", () => {
        it("returns records newest-filled first", async () => {
            markEventSheetFilled("evt1");
            await new Promise((r) => setTimeout(r, 2));
            markEventSheetFilled("evt2");
            const list = listEventSheets();
            expect(list[0].eventId).toBe("evt2");
            expect(list[1].eventId).toBe("evt1");
        });

        it("tolerates a corrupt/empty store file", () => {
            expect(listEventSheets()).toEqual([]);
        });
    });
});
