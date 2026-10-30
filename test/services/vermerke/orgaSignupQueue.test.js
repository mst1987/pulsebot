// The write side of the orga's hint at signup (#983): first signups only, per
// server with the switch on, one batch per server after two minutes.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const marks = require("../../../src/stores/orgaSignupNoticeStore");
const queue = require("../../../src/services/vermerke/orgaSignupQueue");

const NOW = Date.UTC(2026, 9, 30, 12);
const U = "111111111111111111";
const V = "222222222222222222";
const raid = (extra = {}) => ({ id: "e1", guildId: "A", categoryId: "c1", title: "Karazhan", startTime: 1800000000, ...extra });
const signedUp = { status: "primary", character: "Zedchar" };
const absence = { status: "absence", character: "Zedchar" };
const on = (level = "warning") => ({ serverSettings: { A: { vermerkeOrgaNotice: { enabled: true, level } } } });

beforeEach(() => {
    jest.useFakeTimers();
    const file = tempStoreFile("orga-signup-notices.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    marks.useFile(file);
    queue.clearPending();
    queue.setFlushHandler(null);
});
afterEach(() => {
    queue.clearPending();
    jest.useRealTimers();
});
afterAll(() => marks.useFile(null));

describe("services/vermerke/orgaSignupQueue", () => {
    describe("the switch", () => {
        it("is off by default and normalizes what is stored", () => {
            expect(queue.orgaNoticeOf("A", { config: {} })).toEqual({ enabled: false, level: "warning" });
            expect(queue.orgaNoticeOf("A", { config: on("shadowban") })).toEqual({ enabled: true, level: "shadowban" });
            expect(queue.normalizeOrgaNotice({ enabled: "yes", level: "hint" })).toEqual({ enabled: false, level: "warning" });
            expect(queue.normalizeOrgaNotice(null)).toEqual(queue.NOTICE_DEFAULT);
        });

        it("names the fields that are not valid", () => {
            expect(queue.validateOrgaNotice({ enabled: true, level: "shadowban" })).toEqual({ value: { enabled: true, level: "shadowban" }, fields: [] });
            expect(queue.validateOrgaNotice({ enabled: 1, level: "hint" }).fields).toEqual(["enabled", "level"]);
            expect(queue.validateOrgaNotice("on").fields).toEqual(["orgaNotice"]);
            expect(queue.validateOrgaNotice(undefined)).toEqual({ value: { enabled: false, level: "warning" }, fields: [] });
        });
    });

    it("counts a first signup and a signup after a sign-off, not a sign-off or a change", () => {
        expect(queue.isFirstSignup(null, signedUp)).toBe(true);
        expect(queue.isFirstSignup(absence, signedUp)).toBe(true);
        expect(queue.isFirstSignup(null, absence)).toBe(false);
        expect(queue.isFirstSignup(signedUp, { ...signedUp, status: "tentative" })).toBe(false);
        expect(queue.isFirstSignup(null, null)).toBe(false);
    });

    it("queues nothing while the server's switch is off, and sets no mark", () => {
        expect(queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config: {} })).toBe(false);
        expect(queue.pendingCounts()).toEqual({});
        expect(marks.hasMark("e1", U)).toBe(false);
    });

    it("batches the first signups of a server and hands them over after two minutes", async () => {
        const handler = jest.fn(async () => {});
        queue.setFlushHandler(handler);
        expect(queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config: on(), name: "Zed" })).toBe(true);
        jest.advanceTimersByTime(60 * 1000);
        expect(queue.noteSignup(raid({ id: "e2" }), V, null, signedUp, { now: NOW, config: on() })).toBe(true);
        expect(queue.pendingCounts()).toEqual({ A: 2 });
        jest.advanceTimersByTime(queue.BUFFER_MS - 60 * 1000 - 1);
        expect(handler).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith("A", [
            { eventId: "e1", categoryId: "c1", title: "Karazhan", startTime: 1800000000, userId: U, name: "Zed", at: NOW },
            // no account name: the character
            expect.objectContaining({ eventId: "e2", userId: V, name: "Zedchar" }),
        ]);
        expect(queue.pendingCounts()).toEqual({});
    });

    it("queues a person once per raid: no second line after a change, a sign-off or a new signup", () => {
        queue.setFlushHandler(jest.fn());
        expect(queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config: on() })).toBe(true);
        expect(queue.noteSignup(raid(), U, signedUp, { ...signedUp, status: "tentative" }, { now: NOW, config: on() })).toBe(false);
        expect(queue.noteSignup(raid(), U, signedUp, absence, { now: NOW, config: on() })).toBe(false);
        expect(queue.noteSignup(raid(), U, absence, signedUp, { now: NOW, config: on() })).toBe(false);
        // the next night of a raid group is its own raid: one line per night
        expect(queue.noteSignup(raid({ id: "e1-2" }), U, null, signedUp, { now: NOW, config: on() })).toBe(true);
        expect(queue.pendingCounts()).toEqual({ A: 2 });
    });

    it("keeps the servers apart: one batch each, each with its own switch", () => {
        const handler = jest.fn(async () => {});
        queue.setFlushHandler(handler);
        const config = { serverSettings: { A: { vermerkeOrgaNotice: { enabled: true } }, B: { vermerkeOrgaNotice: { enabled: true } }, C: {} } };
        queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config });
        queue.noteSignup(raid({ id: "b1", guildId: "B" }), U, null, signedUp, { now: NOW, config });
        queue.noteSignup(raid({ id: "c1", guildId: "C" }), U, null, signedUp, { now: NOW, config });
        expect(queue.pendingCounts()).toEqual({ A: 1, B: 1 });
        jest.advanceTimersByTime(queue.BUFFER_MS);
        expect(handler.mock.calls.map(([g, items]) => [g, items.map((i) => i.eventId)])).toEqual([["A", ["e1"]], ["B", ["b1"]]]);
    });

    it("only logs without a handler (no bot process) and survives a failing handler", async () => {
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config: on() });
        await queue.flush("A");
        expect(log).toHaveBeenCalledWith(expect.stringContaining("kein Bot-Prozess"));

        queue.setFlushHandler(jest.fn(async () => { throw new Error("boom"); }));
        queue.noteSignup(raid({ id: "e2" }), U, null, signedUp, { now: NOW, config: on() });
        await expect(queue.flush("A")).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
        await queue.flush("nothing-pending");
        log.mockRestore();
        warn.mockRestore();
    });

    it("never throws on the signup path", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const spy = jest.spyOn(marks, "markOnce").mockImplementation(() => { throw new Error("disk full"); });
        expect(queue.noteSignup(raid(), U, null, signedUp, { now: NOW, config: on() })).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
        expect(queue.noteSignup(null, U, null, signedUp, { config: on() })).toBe(false);
        expect(queue.noteSignup(raid({ guildId: "", categoryId: "" }), U, null, signedUp, { config: on() })).toBe(false);
        spy.mockRestore();
        warn.mockRestore();
    });
});
