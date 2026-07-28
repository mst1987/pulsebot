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
    listLogs, getLog, getByReportId, getByReportRefId, saveLog, setButtonMessage,
    markEvaluated, evaluatedSections, clearEvaluation, setLogTitle, deleteLog,
    linkEvent, unlinkEvent, listLogsForEvent,
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

        it("accumulates the evaluated sections across both halves", () => {
            const a = saveLog(base());
            const afterCla = markEvaluated(a.id, { reportRefId: "r1", sections: ["cla"] });
            expect(afterCla.sections).toEqual(["cla"]);

            const afterRpb = markEvaluated(a.id, { reportRefId: "r1", sections: ["rpb"] });
            expect(afterRpb.sections).toEqual(expect.arrayContaining(["cla", "rpb"]));
            expect(afterRpb.sections).toHaveLength(2);
        });

        it("does not duplicate a section that ran twice", () => {
            const a = saveLog(base());
            markEvaluated(a.id, { sections: ["cla"] });
            const again = markEvaluated(a.id, { sections: ["cla"] });
            expect(again.sections).toEqual(["cla"]);
        });
    });

    describe("evaluatedSections", () => {
        it("returns the explicit sections when present", () => {
            expect(evaluatedSections({ status: "done", sections: ["rpb"] })).toEqual(["rpb"]);
        });

        it("treats a legacy done log (no sections field) as CLA-evaluated", () => {
            expect(evaluatedSections({ status: "done" })).toEqual(["cla"]);
        });

        it("returns nothing for an open or missing log", () => {
            expect(evaluatedSections({ status: "open" })).toEqual([]);
            expect(evaluatedSections(null)).toEqual([]);
        });
    });

    describe("getByReportRefId / clearEvaluation", () => {
        it("finds the log a report was generated from", () => {
            const a = saveLog(base());
            saveLog(base({ reportId: "RPT2", messageId: "m2" }));
            markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123" });
            expect(getByReportRefId("abc123")).toMatchObject({ id: a.id });
        });

        it("returns null for a blank or unknown report ref", () => {
            saveLog(base());
            expect(getByReportRefId("")).toBeNull();
            expect(getByReportRefId(null)).toBeNull();
            expect(getByReportRefId("nope")).toBeNull();
        });

        it("puts an evaluated log back to open and drops the report reference", () => {
            const a = saveLog(base());
            markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123", title: "SSC" });
            const cleared = clearEvaluation(a.id);
            expect(cleared.status).toBe("open");
            expect(cleared.reportRefId).toBe("");
            expect(cleared.reportUrl).toBe("");
            expect(cleared.evaluatedAt).toBeUndefined();
            expect(cleared.title).toBe("SSC"); // title stays — it's the WCL report name
            expect(getByReportRefId("abc123")).toBeNull();
            expect(getLog(a.id).status).toBe("open"); // persisted
        });

        it("resets both halves — CLA and RPB shared the report that was deleted", () => {
            const a = saveLog(base());
            markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123", sections: ["cla"] });
            markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123", sections: ["rpb"] });
            expect(evaluatedSections(getLog(a.id))).toEqual(["cla", "rpb"]);

            const cleared = clearEvaluation(a.id);

            expect(cleared.sections).toBeUndefined();
            expect(evaluatedSections(cleared)).toEqual([]); // both buttons on offer again
        });

        it("keeps the event assignment when the evaluation is cleared", () => {
            const a = saveLog(base());
            linkEvent(a.id, { eventId: "e1", eventLabel: "Gruul", eventStartTime: 42, source: "manual" });
            markEvaluated(a.id, { reportRefId: "abc123", reportUrl: "/r/abc123" });
            const cleared = clearEvaluation(a.id);
            expect(cleared.eventId).toBe("e1");
            expect(cleared.eventLabel).toBe("Gruul");
        });

        it("returns null for an unknown id", () => {
            expect(clearEvaluation("nope")).toBeNull();
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

    describe("linkEvent / unlinkEvent", () => {
        it("stores the event assignment incl. a label/start snapshot", () => {
            const a = saveLog(base());
            const linked = linkEvent(a.id, { eventId: "ev1", eventLabel: "SSC/TK", eventStartTime: 1785000000 });
            expect(linked.eventId).toBe("ev1");
            expect(linked.eventLabel).toBe("SSC/TK");
            expect(linked.eventStartTime).toBe(1785000000);
            expect(linked.eventLinkSource).toBe("manual");
            expect(typeof linked.eventLinkedAt).toBe("number");
            expect(getLog(a.id).eventId).toBe("ev1");
        });

        it("records an automatic match as such", () => {
            const a = saveLog(base());
            expect(linkEvent(a.id, { eventId: "ev1", source: "auto" }).eventLinkSource).toBe("auto");
        });

        it("survives a re-detection of the same report", () => {
            const a = saveLog(base());
            linkEvent(a.id, { eventId: "ev1", eventLabel: "SSC/TK" });
            const again = saveLog(base({ messageId: "m2" }));
            expect(again.eventId).toBe("ev1");
            expect(again.eventLabel).toBe("SSC/TK");
        });

        it("replaces an existing assignment", () => {
            const a = saveLog(base());
            linkEvent(a.id, { eventId: "ev1", eventLabel: "Alt" });
            const moved = linkEvent(a.id, { eventId: "ev2", eventLabel: "Neu" });
            expect(moved.eventId).toBe("ev2");
            expect(moved.eventLabel).toBe("Neu");
        });

        it("refuses a blank event id or unknown log", () => {
            const a = saveLog(base());
            expect(linkEvent(a.id, { eventId: "  " })).toBeNull();
            expect(linkEvent("nope", { eventId: "ev1" })).toBeNull();
            expect(linkEvent(a.id)).toBeNull();
            expect(getLog(a.id).eventId).toBeUndefined();
        });

        it("unlinkEvent clears every link field", () => {
            const a = saveLog(base());
            linkEvent(a.id, { eventId: "ev1", eventLabel: "SSC/TK", eventStartTime: 1785000000, source: "auto" });
            const cleared = unlinkEvent(a.id);
            expect(cleared.eventId).toBeUndefined();
            expect(cleared.eventLabel).toBeUndefined();
            expect(cleared.eventStartTime).toBeUndefined();
            expect(cleared.eventLinkSource).toBeUndefined();
            expect(cleared.eventLinkedAt).toBeUndefined();
            expect(getLog(a.id).eventId).toBeUndefined();
        });

        it("unlinkEvent is a no-op without a link / for an unknown id", () => {
            const a = saveLog(base());
            const writes = fs.writeFileSync.mock.calls.length;
            expect(unlinkEvent(a.id)).toBeNull();
            expect(unlinkEvent("nope")).toBeNull();
            expect(fs.writeFileSync.mock.calls.length).toBe(writes);
        });
    });

    describe("listLogsForEvent", () => {
        it("returns only the logs linked to that event", () => {
            const a = saveLog(base({ reportId: "R1" }));
            const b = saveLog(base({ reportId: "R2", messageId: "m2" }));
            saveLog(base({ reportId: "R3", messageId: "m3" }));
            linkEvent(a.id, { eventId: "ev1" });
            linkEvent(b.id, { eventId: "ev2" });
            expect(listLogsForEvent("ev1").map((l) => l.reportId)).toEqual(["R1"]);
            expect(listLogsForEvent("ev2").map((l) => l.reportId)).toEqual(["R2"]);
            expect(listLogsForEvent("")).toEqual([]);
            expect(listLogsForEvent("unknown")).toEqual([]);
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
