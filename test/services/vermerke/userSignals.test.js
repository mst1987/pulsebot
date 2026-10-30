// The read side of the hints (#982): only persons over the server's threshold,
// newest first; no-shows from the attendance overrides; "Ausblenden" and a
// Vermerk with the matching reason hold a hint back until something new.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockEvents = [];
let mockOverrides = {};
let mockSignups = {};
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: jest.fn(() => mockEvents),
}));
jest.mock("../../../src/stores/events/attendanceOverridesStore", () => ({
    listOverrides: jest.fn(() => mockOverrides),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({
    getSignup: jest.fn((eventId, userId) => (mockSignups[eventId] || {})[userId] || null),
}));

const eventStore = require("../../../src/stores/events/eventStore");
const signals = require("../../../src/stores/roster/userSignalsStore");
const notes = require("../../../src/stores/roster/userNotesStore");
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
        expect(Object.keys(KIND_RULES)).toEqual(["signoff_after_setup", "late_signoff", "no_show", "left_early", "left_server"]);
    });

    it("computes nights left early from the confirmed overrides, with their own threshold (#990)", () => {
        mockEvents = [
            { id: "e1", title: "Kara", startTime: sec(NOW - 5 * DAY) },
            { id: "e2", title: "Gruul", startTime: sec(NOW - 3 * DAY) },
            { id: "e3", title: "Maggi", startTime: sec(NOW - 2 * DAY) },
        ];
        mockOverrides = {
            e1: { [U]: { status: "leftEarly" } },
            e2: { [U]: { status: "noShow" } },
            // a dismissed suggestion is present - no hint
            e3: { [U]: { status: "present", reason: "Log-Vorschlag verworfen: nicht früh gegangen" } },
        };
        // one night left early stays below the default threshold of two, and does not mix with no_show
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        mockOverrides.e3 = { [U]: { status: "leftEarly" } };
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([expect.objectContaining({
            userId: U, kind: "left_early", count: 2,
            events: [{ eventId: "e3", title: "Maggi", startTime: sec(NOW - 2 * DAY) }, { eventId: "e1", title: "Kara", startTime: sec(NOW - 5 * DAY) }],
        })]);
        // the server's own threshold
        expect(signalsFor("A", { now: NOW, config: cfg({ leftEarly: 3 }) })).toEqual([]);
        // a Vermerk with the reason left_early covers it
        notes.addEntry("A", U, { level: "hint", reason: "left_early" }, { by: "1", byName: "Admin", now: NOW - DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
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
            // newest first, each at the start of its raid (the time of the override does not count)
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
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([expect.objectContaining({ count: 3 })]);
        expect(ignoreSignal("A", U, "signoff_after_setup", { now: NOW - 2 * DAY + 1 })).toMatchObject({ userId: U });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e4", NOW - DAY);
        // back - and it counts the whole window, the hidden ones too
        const [hint] = signalsFor("A", { now: NOW, config: {} });
        expect(hint).toMatchObject({ count: 4, lastAt: NOW - DAY });
        expect(hint.events.map((e) => e.eventId)).toEqual(["e4", "e3", "e2", "e1"]);
        expect(ignoreSignal("A", U, "behavior")).toBeNull();
    });

    it("holds a hint back while a Vermerk with the matching reason covers it, until something new", () => {
        signoff(U, "e1", NOW - 5 * DAY);
        signoff(U, "e2", NOW - 4 * DAY, "signoff_after_setup");
        notes.addEntry("A", U, { level: "warning", reason: "late_signoff" }, { by: "1", byName: "Admin", now: NOW - 3 * DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
        signoff(U, "e3", NOW - 2 * DAY);
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([expect.objectContaining({ count: 3 })]);
    });

    it("hides leaving the server behind a Vermerk with the reason left_server", () => {
        signals.recordEvent("A", U, { kind: "left_server" }, { now: NOW - 2 * DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toHaveLength(1);
        notes.addEntry("A", U, { level: "hint", reason: "left_server" }, { by: "1", byName: "Admin", now: NOW - DAY });
        expect(signalsFor("A", { now: NOW, config: {} })).toEqual([]);
    });

    it("counts a raid group as one night: an override at a further raid counts for the first, once per person", () => {
        const start = sec(NOW - 5 * DAY);
        mockEvents = [
            { id: "p1", raidGroupId: "p1", title: "SSC 1", startTime: start },
            { id: "s1", raidGroupId: "p1", title: "SSC 2", startTime: start },
            { id: "p2", raidGroupId: "p2", title: "TK 1", startTime: sec(NOW - 2 * DAY) },
            { id: "s2", raidGroupId: "p2", title: "TK 2", startTime: sec(NOW - 2 * DAY) },
        ];
        mockOverrides = {
            p1: { [U]: { status: "noShow", at: NOW } },
            s1: { [U]: { status: "noShow", at: NOW } },
            s2: { [U]: { status: "noShow", at: NOW } },
        };
        const [hint] = signalsFor("A", { now: NOW, config: {} });
        expect(hint).toMatchObject({ kind: "no_show", count: 2, lastAt: (start + 3 * 24 * 3600) * 1000 });
        expect(hint.events).toEqual([
            { eventId: "p2", title: "TK 1", startTime: sec(NOW - 2 * DAY) },
            { eventId: "p1", title: "SSC 1", startTime: start },
        ]);
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
