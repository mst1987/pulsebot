// The read side of the hints (#982): only persons over the server's threshold,
// newest first; no-shows from the attendance overrides; "Ausblenden" and a
// Vermerk with the matching reason hold a hint back until something new.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockEvents = [];
let mockOverrides = {};
let mockSignups = {};
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => mockEvents),
}));
jest.mock("../../../src/stores/attendanceOverridesStore", () => ({
    listOverrides: jest.fn(() => mockOverrides),
}));
jest.mock("../../../src/stores/signupStore", () => ({
    getSignup: jest.fn((eventId, userId) => (mockSignups[eventId] || {})[userId] || null),
}));

const eventStore = require("../../../src/stores/eventStore");
const signals = require("../../../src/stores/userSignalsStore");
const notes = require("../../../src/stores/userNotesStore");
const { signalsFor, ignoreSignal, KIND_RULES } = require("../../../src/services/vermerke/userSignals");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);
const U = "111111111111111111";
const V = "222222222222222222";
const sec = (ms) => Math.floor(ms / 1000);
const signoff = (userId, eventId, at, kind = "signoff_after_setup") =>
    signals.recordEvent("A", userId, { kind, eventId, title: `Raid ${eventId}`, startTime: sec(at + DAY) }, { name: "Zed", now: at });
const cfg = (vermerkeSignals) => ({ serverSettings: { A: { vermerkeSignals } } });

beforeEach(() => {
    for (const [store, name] of [[signals, "user-signals.json"], [notes, "user-notes.json"]]) {
        const file = tempStoreFile(name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        store.useFile(file);
    }
    mockEvents = [];
    mockOverrides = {};
    mockSignups = {};
    eventStore.listEvents.mockClear();
});
afterAll(() => {
    signals.useFile(null);
    notes.useFile(null);
});

describe("services/vermerke/userSignals", () => {
    it("knows every kind it shows", () => {
        expect(Object.keys(KIND_RULES)).toEqual(["signoff_after_setup", "late_signoff", "no_show", "left_server"]);
    });

    it("shows a person from the threshold on, with the raids, newest first", () => {
        signoff(U, "e1", NOW - 10 * DAY);
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e2", NOW - 2 * DAY);
        signoff(V, "e3", NOW - DAY);
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([{
            userId: U, name: "Zed", kind: "signoff_after_setup", count: 2, windowDays: 60,
            events: [
                { eventId: "e2", title: "Raid e2", startTime: sec(NOW - DAY) },
                { eventId: "e1", title: "Raid e1", startTime: sec(NOW - 9 * DAY) },
            ],
            lastAt: NOW - 2 * DAY,
        }]);
        // a server's own threshold of one shows V too, and V first (newest)
        expect(signalsFor("A", { now: NOW, config: cfg({ signoffAfterSetup: 1 }) }).map((s) => s.userId)).toEqual([V, U]);
        expect(signalsFor("B", { now: NOW, config: {} })).toEqual([]);
    });

    it("counts inside the window only", () => {
        signoff(U, "e1", NOW - 70 * DAY);
        signoff(U, "e2", NOW - DAY);
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        expect(signalsFor("A", { now: NOW, config: cfg({ windowDays: 90 }) })).toHaveLength(1);
    });

    it("keeps the kinds apart", () => {
        signoff(U, "e1", NOW - 3 * DAY);
        signoff(U, "e2", NOW - 2 * DAY, "late_signoff");
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signals.recordEvent("A", U, { kind: "left_server" }, { now: NOW - DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([
            expect.objectContaining({ kind: "left_server", count: 1, events: [], lastAt: NOW - DAY }),
        ]);
    });

    it("computes no-shows from the overrides of the server's raids, named from the signups", () => {
        mockEvents = [{ id: "e1", title: "Kara", startTime: sec(NOW - 5 * DAY) }, { id: "e2", title: "Gruul", startTime: sec(NOW - 3 * DAY) }];
        mockOverrides = {
            e1: { [U]: { status: "noShow", at: NOW - 4 * DAY }, [V]: { status: "present" } },
            e2: { [U]: { status: "noShow" } },
            other: { [U]: { status: "noShow", at: NOW - DAY } },
        };
        mockSignups = { e1: { [U]: { character: "Zedchar" } } };
        const out = signalsFor("A", { now: NOW, config: {} });
        expect(out).toEqual([{
            userId: U, name: "Zedchar", kind: "no_show", count: 2, windowDays: 60,
            // newest first: e2 has no time of its own, so its start counts
            events: [{ eventId: "e2", title: "Gruul", startTime: sec(NOW - 3 * DAY) }, { eventId: "e1", title: "Kara", startTime: sec(NOW - 5 * DAY) }],
            lastAt: NOW - 3 * DAY,
        }]);
        // one list of the server's raids, from the window on
        expect(eventStore.listEvents).toHaveBeenCalledTimes(1);
        expect(eventStore.listEvents).toHaveBeenCalledWith("A", { siblings: true, sinceSeconds: sec(NOW - 60 * DAY) });
    });

    it("holds a hint back after 'Ausblenden' until a new event of that kind", () => {
        signoff(U, "e1", NOW - 5 * DAY);
        signoff(U, "e2", NOW - 4 * DAY);
        expect(ignoreSignal("A", U, "signoff_after_setup", { now: NOW - 3 * DAY })).toMatchObject({ userId: U });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e3", NOW - 2 * DAY);
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e4", NOW - DAY);
        const [hint] = signalsFor("A", { now: NOW, config: {} });
        expect(hint).toMatchObject({ count: 2, events: [expect.objectContaining({ eventId: "e4" }), expect.objectContaining({ eventId: "e3" })] });
        expect(ignoreSignal("A", U, "behavior")).toBeNull();
    });

    it("holds a hint back while a Vermerk with the matching reason covers it, until something new", () => {
        signoff(U, "e1", NOW - 5 * DAY);
        signoff(U, "e2", NOW - 4 * DAY, "signoff_after_setup");
        notes.addEntry("A", U, { level: "warning", reason: "late_signoff" }, { by: "1", byName: "Admin", now: NOW - 3 * DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e3", NOW - 2 * DAY);
        expect(signalsFor("A", { now: NOW, config: cfg({ signoffAfterSetup: 1 }) })).toEqual([expect.objectContaining({ count: 1 })]);
    });

    it("is not held back by a Vermerk with another reason or on another server", () => {
        signoff(U, "e1", NOW - 5 * DAY);
        signoff(U, "e2", NOW - 4 * DAY);
        notes.addEntry("A", U, { level: "hint", reason: "behavior" }, { by: "1", byName: "Admin", now: NOW - 3 * DAY });
        notes.addEntry("B", U, { level: "warning", reason: "late_signoff" }, { by: "1", byName: "Admin", now: NOW - 3 * DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toHaveLength(1);
    });

    it("answers nothing without a server", () => {
        expect(signalsFor("", { now: NOW })).toEqual([]);
    });
});
