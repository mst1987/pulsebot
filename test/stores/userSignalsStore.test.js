// The hints store (#982): events per server and person, one per kind and raid,
// kept for RETENTION_DAYS, and the orga's "Ausblenden".
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const signals = require("../../src/stores/userSignalsStore");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);
const U = "111111111111111111";
const V = "222222222222222222";
const signoff = (eventId, extra = {}) => ({ kind: "signoff_after_setup", eventId, title: "Karazhan", startTime: 1800000000, hoursBefore: 30.04, ...extra });

let file;
beforeEach(() => {
    file = tempStoreFile("user-signals.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    signals.useFile(file);
});
afterAll(() => signals.useFile(null));

describe("stores/userSignalsStore", () => {
    it("records an event per server and person, with the name and the hours rounded", () => {
        const stored = signals.recordEvent("A", U, signoff("e1", { byOrga: true }), { name: "Zed", now: NOW });
        expect(stored).toEqual({ kind: "signoff_after_setup", eventId: "e1", title: "Karazhan", startTime: 1800000000, at: NOW, hoursBefore: 30, byOrga: true });
        expect(signals.eventsFor("A", { now: NOW })).toEqual({ [U]: { name: "Zed", events: [stored] } });
        expect(signals.eventsFor("B", { now: NOW })).toEqual({});
        expect(JSON.parse(fs.readFileSync(file, "utf8")).guilds.A[U].name).toBe("Zed");
    });

    it("counts the same kind for the same raid once, another kind or raid again", () => {
        expect(signals.recordEvent("A", U, signoff("e1"), { now: NOW })).not.toBeNull();
        expect(signals.recordEvent("A", U, signoff("e1"), { now: NOW + 1000 })).toBeNull();
        expect(signals.recordEvent("A", U, signoff("e1", { kind: "late_signoff" }), { now: NOW + 2000 })).not.toBeNull();
        expect(signals.recordEvent("A", U, signoff("e2"), { now: NOW + 3000 })).not.toBeNull();
        expect(signals.eventsFor("A", { now: NOW + 3000 })[U].events).toHaveLength(3);
    });

    it("writes nothing for an event that is already there", () => {
        signals.recordEvent("A", U, signoff("e1"), { now: NOW });
        const spy = jest.spyOn(fs, "writeFileSync");
        try {
            expect(signals.recordEvent("A", U, signoff("e1"), { now: NOW + 1000 })).toBeNull();
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it("refuses unknown kinds, no server and no person", () => {
        expect(signals.recordEvent("A", U, signoff("e1", { kind: "no_show" }), { now: NOW })).toBeNull();
        expect(signals.recordEvent("", U, signoff("e1"), { now: NOW })).toBeNull();
        expect(signals.recordEvent("A", "", signoff("e1"), { now: NOW })).toBeNull();
        expect(signals.eventsFor("A", { now: NOW })).toEqual({});
    });

    it("records leaving the server without a raid, each time anew", () => {
        const leave = { kind: "left_server", eventId: "", title: "", startTime: 0 };
        signals.recordEvent("A", U, leave, { now: NOW });
        signals.recordEvent("A", U, leave, { now: NOW + DAY });
        expect(signals.eventsFor("A", { now: NOW + DAY })[U].events.map((e) => e.kind)).toEqual(["left_server", "left_server"]);
    });

    it("drops what is older than the retention on reading and writing", () => {
        signals.recordEvent("A", U, signoff("old"), { now: NOW });
        const later = NOW + (signals.RETENTION_DAYS + 1) * DAY;
        expect(signals.eventsFor("A", { now: later })).toEqual({});
        signals.recordEvent("A", V, signoff("new"), { now: later });
        const doc = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(Object.keys(doc.guilds.A)).toEqual([V]);
    });

    it("drops what is past the retention on reading at most once a day, and writes only then", () => {
        signals.recordEvent("A", U, signoff("old"), { now: NOW });
        signals.recordEvent("A", V, signoff("new"), { now: NOW + 100 * DAY });
        const later = NOW + (signals.RETENTION_DAYS + 1) * DAY;
        // nothing stale yet: a look, no write
        const spy = jest.spyOn(fs, "writeFileSync");
        try {
            expect(signals.pruneDaily(NOW + 101 * DAY)).toBe(false);
            expect(spy).not.toHaveBeenCalled();
            // within the same day no second look, even with something stale
            expect(signals.pruneDaily(NOW + 101 * DAY + 1000)).toBe(false);
            spy.mockRestore();
            expect(signals.eventsFor("A", { now: later })).toEqual({ [V]: expect.any(Object) });
            const doc = JSON.parse(fs.readFileSync(file, "utf8"));
            expect(Object.keys(doc.guilds.A)).toEqual([V]);
        } finally {
            spy.mockRestore();
        }
    });

    it("keeps the ignore per server, person and kind - any kind of hint, no unknown one", () => {
        expect(signals.ignore("A", U, "no_show", { now: NOW })).toEqual({ userId: U, kind: "no_show", at: NOW });
        expect(signals.ignore("A", U, "left_early", { now: NOW })).not.toBeNull();
        expect(signals.ignore("A", U, "behavior", { now: NOW })).toBeNull();
        expect(signals.ignoredFor("A")).toEqual({ [U]: { no_show: NOW, left_early: NOW } });
        expect(signals.ignoredFor("B")).toEqual({});
        // a copy: changing it changes nothing stored
        signals.ignoredFor("A")[U].no_show = 1;
        expect(signals.ignoredFor("A")[U].no_show).toBe(NOW);
    });

    it("cleans a hand-edited file", () => {
        fs.writeFileSync(file, JSON.stringify({
            guilds: { A: { [U]: { name: "Zed", events: [{ kind: "nope", at: 1 }, { kind: "late_signoff", eventId: "e1", at: NOW }] }, [V]: { events: [] } } },
            ignored: { A: { [U]: { late_signoff: NOW, other: NOW, no_show: -1 } } },
        }));
        signals.useFile(file);
        expect(signals.eventsFor("A", { now: NOW })[U].events).toEqual([{ kind: "late_signoff", eventId: "e1", title: "", startTime: 0, at: NOW }]);
        expect(signals.eventsFor("A", { now: NOW })[V]).toBeUndefined();
        expect(signals.ignoredFor("A")).toEqual({ [U]: { late_signoff: NOW } });
    });
});

// The hints are sensitive (docs/vermerke.md): only the recorder, the read side and the Vermerke
// routes touch the store, and only the signup save, leaving a server, the read side and the routes
// call the recorder. A new module on either list is a decision, not an accident.
describe("userSignalsStore - who loads it", () => {
    const path = require("path");
    const SRC = path.join(__dirname, "..", "..", "src");
    function modulesMatching(re) {
        const out = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "web-client" && entry.name !== "node_modules") walk(full);
                } else if (entry.name.endsWith(".js") && re.test(fs.readFileSync(full, "utf8"))) {
                    out.push(path.relative(SRC, full).split(path.sep).join("/"));
                }
            }
        };
        walk(SRC);
        return out.sort();
    }

    it("is required by the recorder, the read side and the Vermerke routes alone", () => {
        expect(modulesMatching(/require\(\s*["'][^"']*userSignalsStore["']\s*\)/))
            .toEqual(["services/vermerke/signalRecorder.js", "services/vermerke/userSignals.js", "web/apiRoutes/vermerke.js"]);
    });

    it("its recorder is required by the signup save, leaving a server, the read side and the routes alone", () => {
        expect(modulesMatching(/require\(\s*["'][^"']*signalRecorder["']\s*\)/))
            .toEqual(["services/discord/memberActivity.js", "services/signups/signupService.js", "services/vermerke/userSignals.js", "web/apiRoutes/vermerke.js"]);
    });
});
