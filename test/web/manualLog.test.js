// In-memory fs so the real logStore never touches the repo disk.
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
// matchableEvents pulls in the Discord client wrapper at require time; only its
// pure eventLinkFields() is used here, so keep the heavy module out entirely.
jest.mock("../../src/web/discord.js", () => ({}));

const fs = require("fs");
const logStore = require("../../src/web/logStore.js");
const { linkLogByUrl } = require("../../src/web/manualLog.js");

const EVENT = { id: "e1", title: "SSC/TK", startTime: 1750000000 }; // seconds

beforeEach(() => {
    fs.__store.clear();
});

describe("web/manualLog — linkLogByUrl", () => {
    it("rejects text without a Warcraft-Logs report link", () => {
        for (const bad of ["", "abc123", "https://example.com/reports/abc", "warcraftlogs"]) {
            const result = linkLogByUrl(bad, EVENT, "g1");
            expect(result.error).toContain("Kein gültiger Warcraft-Logs-Link");
        }
        expect(logStore.listLogs()).toHaveLength(0);
    });

    it("registers a fresh log and links it to the event", () => {
        const result = linkLogByUrl("https://classic.warcraftlogs.com/reports/AbC123xY", EVENT, "g1");
        expect(result.error).toBeUndefined();
        expect(result.created).toBe(true);
        expect(result.log).toMatchObject({
            reportId: "AbC123xY",
            link: "https://classic.warcraftlogs.com/reports/AbC123xY",
            source: "manual",
            guildId: "g1",
            status: "open",
            eventId: "e1",
            eventLabel: "SSC/TK",
            eventStartTime: 1750000000,
            eventLinkSource: "manual",
        });
        // dated at the raid's start (ms), since there is no Discord post to date it by
        expect(result.log.postedAt).toBe(1750000000 * 1000);
        expect(logStore.listLogsForEvent("e1")).toHaveLength(1);
    });

    it("accepts links carrying a fight fragment or query", () => {
        const result = linkLogByUrl("https://www.warcraftlogs.com/reports/ZZtop99?fight=12#boss", EVENT, "g1");
        expect(result.log.reportId).toBe("ZZtop99");
    });

    it("re-uses an already tracked log instead of duplicating it", () => {
        const tracked = logStore.saveLog({
            guildId: "g1", channelId: "c1", messageId: "m1",
            reportId: "RPT1", link: "https://classic.warcraftlogs.com/reports/RPT1",
            source: "listener", postedAt: 123000,
        });
        const result = linkLogByUrl("https://classic.warcraftlogs.com/reports/RPT1", EVENT, "g1");
        expect(result.created).toBe(false);
        expect(result.log.id).toBe(tracked.id);
        expect(result.log.channelId).toBe("c1"); // channel origin kept
        expect(result.log.postedAt).toBe(123000); // original post time kept
        expect(result.log.eventId).toBe("e1");
        expect(logStore.listLogs()).toHaveLength(1);
    });

    it("refuses a log that is already assigned to a different event", () => {
        const tracked = logStore.saveLog({
            reportId: "RPT2", link: "https://classic.warcraftlogs.com/reports/RPT2",
        });
        logStore.linkEvent(tracked.id, { eventId: "other", eventLabel: "Kara Woche 1", eventStartTime: 1, source: "auto" });
        const result = linkLogByUrl("https://classic.warcraftlogs.com/reports/RPT2", EVENT, "g1");
        expect(result.error).toContain("Kara Woche 1");
        expect(logStore.getLog(tracked.id).eventId).toBe("other"); // untouched
    });

    it("allows re-linking to the same event", () => {
        const first = linkLogByUrl("https://classic.warcraftlogs.com/reports/RPT3", EVENT, "g1");
        const again = linkLogByUrl("https://classic.warcraftlogs.com/reports/RPT3", EVENT, "g1");
        expect(again.error).toBeUndefined();
        expect(again.created).toBe(false);
        expect(again.log.id).toBe(first.log.id);
        expect(logStore.listLogs()).toHaveLength(1);
    });
});
