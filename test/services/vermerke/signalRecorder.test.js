// The write side of the hints (#982): which saved signup is a sign-off after
// the setup, which one a late sign-off, which nothing; leaving the server; the
// thresholds per server.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockGroup = null;
jest.mock("../../../src/services/events/raidGroup", () => ({
    ...jest.requireActual("../../../src/services/events/raidGroup"),
    groupEvents: jest.fn((event) => mockGroup || [event]),
}));

const signals = require("../../../src/stores/roster/userSignalsStore");
const recorder = require("../../../src/services/vermerke/signalRecorder");

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);
const U = "111111111111111111";
const V = "222222222222222222";
const START = Math.floor((NOW + 48 * HOUR) / 1000);
const placed = (userId) => ({ approved: { groups: [{ slots: [{ userId }, { userId: "" }] }] } });
const raid = (extra = {}) => ({ id: "e1", guildId: "A", title: "Karazhan", startTime: START, ...extra });
const signedUp = { status: "primary", character: "Zedchar" };
const absence = { status: "absence", character: "Zedchar" };
const config = (vermerkeSignals) => ({ serverSettings: { A: { vermerkeSignals } } });

beforeEach(() => {
    const file = tempStoreFile("user-signals.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    signals.useFile(file);
    mockGroup = null;
});
afterAll(() => signals.useFile(null));

describe("services/vermerke/signalRecorder", () => {
    describe("thresholds", () => {
        it("are the defaults without own values", () => {
            expect(recorder.thresholdsOf("A", { config: {} })).toEqual(recorder.DEFAULT_THRESHOLDS);
            expect(recorder.DEFAULT_THRESHOLDS).toMatchObject({ windowDays: 60, signoffAfterSetup: 2, lateHours: 12 });
        });

        it("take a server's own values over the defaults, per server", () => {
            const cfg = { serverSettings: { A: { vermerkeSignals: { lateHours: 6 } }, B: { vermerkeSignals: { noShow: 4 } } } };
            expect(recorder.thresholdsOf("A", { config: cfg })).toMatchObject({ lateHours: 6, noShow: 2 });
            expect(recorder.thresholdsOf("B", { config: cfg })).toMatchObject({ lateHours: 12, noShow: 4 });
        });

        it("keep known keys only, as whole numbers in range; empty values are left out", () => {
            expect(recorder.normalizeThresholds({ windowDays: 3, lateHours: "6.4", noShow: 99, leftServer: "", foo: 2, lateSignoff: "x", signoffAfterSetup: null }))
                .toEqual({ windowDays: 7, lateHours: 6, noShow: 20 });
            expect(recorder.normalizeThresholds(null)).toEqual({});
            expect(recorder.normalizeThresholds([1])).toEqual({});
        });

        it("are checked strictly for the settings: a wrong value names its field instead of being moved", () => {
            expect(recorder.validateThresholds({ windowDays: 30, lateHours: "6", noShow: "", leftServer: null, foo: 9 }))
                .toEqual({ value: { windowDays: 30, lateHours: 6 }, fields: [] });
            expect(recorder.validateThresholds({ windowDays: 3, lateHours: 6.5, noShow: 21, lateSignoff: "x", signoffAfterSetup: " ", leftServer: 1 }))
                .toEqual({ value: { leftServer: 1 }, fields: ["windowDays", "signoffAfterSetup", "lateSignoff", "lateHours", "noShow"] });
            // #990: nights left early 1-20, the log's missed kills 1-5
            expect(recorder.DEFAULT_THRESHOLDS).toMatchObject({ leftEarly: 2, leftEarlyBosses: 2 });
            expect(recorder.validateThresholds({ leftEarly: 20, leftEarlyBosses: 5 })).toEqual({ value: { leftEarly: 20, leftEarlyBosses: 5 }, fields: [] });
            expect(recorder.validateThresholds({ leftEarly: 21, leftEarlyBosses: 6 })).toEqual({ value: {}, fields: ["leftEarly", "leftEarlyBosses"] });
            expect(recorder.normalizeThresholds({ leftEarly: 0, leftEarlyBosses: 9 })).toEqual({ leftEarly: 1, leftEarlyBosses: 5 });
            expect(recorder.validateThresholds(undefined)).toEqual({ value: {}, fields: [] });
            expect(recorder.validateThresholds(null)).toEqual({ value: {}, fields: [] });
            expect(recorder.validateThresholds([1])).toEqual({ value: {}, fields: ["thresholds"] });
            expect(recorder.validateThresholds("7")).toEqual({ value: {}, fields: ["thresholds"] });
        });
    });

    describe("recordSignoff", () => {
        it("notes a sign-off while placed in the approved setup, with the hours before the start", () => {
            const e = recorder.recordSignoff(raid({ setup: placed(U) }), U, signedUp, absence, { now: NOW, byOrga: true });
            expect(e).toMatchObject({ kind: "signoff_after_setup", eventId: "e1", title: "Karazhan", startTime: START, hoursBefore: 48, byOrga: true, at: NOW });
            expect(signals.eventsFor("A", { now: NOW })[U].name).toBe("Zedchar");
        });

        it("counts a placement in another raid of the raid group, not the bench", () => {
            const event = raid();
            mockGroup = [event, raid({ id: "e2", setup: placed(U) })];
            expect(recorder.recordSignoff(event, U, signedUp, absence, { now: NOW }).kind).toBe("signoff_after_setup");
            mockGroup = [event, raid({ id: "e2", setup: { approved: { groups: [{ slots: [{ userId: V }] }] }, bench: [{ userId: U }] } })];
            expect(recorder.recordSignoff(event, U, signedUp, absence, { now: NOW + 1 })).toBeNull();
        });

        it("notes a late sign-off under the server's hours, not over them", () => {
            const event = raid({ startTime: Math.floor((NOW + 5 * HOUR) / 1000) });
            expect(recorder.recordSignoff(event, U, signedUp, absence, { now: NOW, config: {} }).kind).toBe("late_signoff");
            expect(recorder.recordSignoff(raid({ id: "e9", startTime: Math.floor((NOW + 5 * HOUR) / 1000) }), U, signedUp, absence, { now: NOW, config: config({ lateHours: 3 }) }))
                .toBeNull();
            expect(recorder.recordSignoff(raid(), V, signedUp, absence, { now: NOW, config: {} })).toBeNull();
        });

        it("notes nothing for a first answer 'Abmelden', a change between other states or a repeat", () => {
            const late = raid({ startTime: Math.floor((NOW + HOUR) / 1000), setup: placed(V) });
            expect(recorder.recordSignoff(late, U, null, absence, { now: NOW })).toBeNull();
            expect(recorder.recordSignoff(late, U, signedUp, { status: "tentative" }, { now: NOW })).toBeNull();
            expect(recorder.recordSignoff(late, U, absence, absence, { now: NOW })).toBeNull();
            expect(signals.eventsFor("A", { now: NOW })).toEqual({});
        });

        it("notes nothing after the start, without a server or without a raid", () => {
            expect(recorder.recordSignoff(raid({ startTime: Math.floor((NOW - HOUR) / 1000), setup: placed(U) }), U, signedUp, absence, { now: NOW })).toBeNull();
            expect(recorder.recordSignoff(raid({ guildId: "", setup: placed(U) }), U, signedUp, absence, { now: NOW })).toBeNull();
            expect(recorder.recordSignoff(null, U, signedUp, absence, { now: NOW })).toBeNull();
        });

        it("never throws - a hint is never worth a failed signup", () => {
            const spy = jest.spyOn(signals, "recordEvent").mockImplementation(() => { throw new Error("disk full"); });
            try {
                expect(recorder.recordSignoff(raid({ setup: placed(U) }), U, signedUp, absence, { now: NOW })).toBeNull();
                expect(recorder.recordLeave("A", U, { now: NOW })).toBeNull();
            } finally {
                spy.mockRestore();
            }
        });
    });

    it("recordLeave notes leaving the server with the name", () => {
        expect(recorder.recordLeave("A", U, { name: "Zed", now: NOW })).toMatchObject({ kind: "left_server", eventId: "", at: NOW });
        expect(signals.eventsFor("A", { now: NOW })[U].name).toBe("Zed");
    });
});
