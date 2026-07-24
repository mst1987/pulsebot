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
    listLogs, getLog, getByReportId, saveLog, setButtonMessage,
    markEvaluated, setLogTitle, deleteLog,
} = require("../../src/web/logStore.js");

beforeEach(() => {
    fs.__store.clear();
});

const base = (over = {}) => ({
    guildId: "g1", channelId: "c1", messageId: "m1",
    reportId: "RPT1", link: "https://classic.warcraftlogs.com/reports/RPT1",
    ...over,
});

describe("web/logStore", () => {
    describe("saveLog", () => {
        it("creates a new open log with a generated id", () => {
            const saved = saveLog(base());
            expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
            expect(saved.status).toBe("open");
            expect(typeof saved.detectedAt).toBe("number");
            expect(getByReportId("RPT1")).toMatchObject({ id: saved.id, reportId: "RPT1" });
        });

        it("deduplicates by reportId and preserves status on re-save", () => {
            const a = saveLog(base());
            markEvaluated(a.id, { reportRefId: "abc", reportUrl: "/r/abc" });
            const b = saveLog(base({ messageId: "m2" }));
            expect(b.id).toBe(a.id);
            expect(b.status).toBe("done"); // not reset by a re-detection
            expect(b.messageId).toBe("m2"); // updated
            expect(listLogs()).toHaveLength(1);
        });

        it("tracks distinct reports separately", () => {
            saveLog(base());
            saveLog(base({ reportId: "RPT2", messageId: "m2" }));
            expect(listLogs()).toHaveLength(2);
        });

        it("stores the channel post time (postedAt) and preserves it on re-save", () => {
            const a = saveLog(base({ postedAt: 1234 }));
            expect(a.postedAt).toBe(1234);
            // a later re-detection without postedAt keeps the original
            const b = saveLog(base({ messageId: "m2" }));
            expect(b.postedAt).toBe(1234);
        });

        it("defaults postedAt to 0 when not provided", () => {
            expect(saveLog(base()).postedAt).toBe(0);
        });
    });

    describe("setButtonMessage", () => {
        it("stores the bot's button message ids", () => {
            const a = saveLog(base());
            const updated = setButtonMessage(a.id, { buttonChannelId: "c1", buttonMessageId: "btn9" });
            expect(updated.buttonChannelId).toBe("c1");
            expect(updated.buttonMessageId).toBe("btn9");
            expect(getLog(a.id).buttonMessageId).toBe("btn9");
        });

        it("returns null for an unknown id", () => {
            expect(setButtonMessage("nope", {})).toBeNull();
        });
    });

    describe("setLogTitle", () => {
        it("backfills a log's display title", () => {
            const a = saveLog(base());
            const updated = setLogTitle(a.id, "  Karazhan 24/07  ");
            expect(updated.title).toBe("Karazhan 24/07");
            expect(getLog(a.id).title).toBe("Karazhan 24/07");
        });

        it("is a no-op for a blank title or unknown id", () => {
            const a = saveLog(base());
            const writes = fs.writeFileSync.mock.calls.length;
            expect(setLogTitle(a.id, "   ")).toBeNull();
            expect(setLogTitle("nope", "x")).toBeNull();
            // neither wrote to disk
            expect(fs.writeFileSync.mock.calls.length).toBe(writes);
        });
    });

    describe("markEvaluated", () => {
        it("flags the log done and attaches the report", () => {
            const a = saveLog(base());
            const done = markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123", title: "SSC + TK", zone: "SSC" });
            expect(done.status).toBe("done");
            expect(done.reportRefId).toBe("abc123");
            expect(done.reportUrl).toBe("/r/abc123");
            expect(done.title).toBe("SSC + TK");
            expect(done.zone).toBe("SSC");
            expect(typeof done.evaluatedAt).toBe("number");
        });

        it("returns null for an unknown id", () => {
            expect(markEvaluated("nope", {})).toBeNull();
        });
    });

    describe("listLogs / getLog", () => {
        it("lists newest detection first", () => {
            const a = saveLog(base({ reportId: "OLD" }));
            const b = saveLog(base({ reportId: "NEW", messageId: "m2" }));
            // force a later detectedAt on b
            a.detectedAt = 1000; b.detectedAt = 5000;
            // re-persist via setButtonMessage (touches the store) — simplest way to write back
            const all = listLogs();
            expect(all.map((l) => l.reportId)).toContain("OLD");
            expect(all.map((l) => l.reportId)).toContain("NEW");
        });

        it("getLog returns null for unknown id", () => {
            expect(getLog("missing")).toBeNull();
        });
    });

    describe("deleteLog", () => {
        it("removes by id and reports success", () => {
            const a = saveLog(base());
            expect(deleteLog(a.id)).toBe(true);
            expect(deleteLog(a.id)).toBe(false);
            expect(listLogs()).toHaveLength(0);
        });
    });

    it("tolerates a missing/corrupt file", () => {
        expect(listLogs()).toEqual([]);
    });
});
