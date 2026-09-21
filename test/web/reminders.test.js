// Automatic reminders (#264): exactly once per event and kind, never after the
// raid started, the sign-up deadline when the event has one.
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../../src/web/discord", () => ({ listMembersWithRoles: jest.fn() }));
jest.mock("../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
jest.mock("../../src/web/pingDelivery", () => ({ deliverUserPing: jest.fn() }));
jest.mock("../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "100000") }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/eventStore", () => ({ listEvents: jest.fn(() => []), saveSetupDraft: jest.fn() }));
jest.mock("../../src/web/setupInput", () => ({ proposeSetup: jest.fn() }));

const discord = require("../../src/web/discord");
const eventStore = require("../../src/web/eventStore");
const { proposeSetup } = require("../../src/web/setupInput");
const { loadEventGroups } = require("../../src/web/raidEventGroups");
const { deliverUserPing } = require("../../src/web/pingDelivery");
const reminderStore = require("../../src/web/reminderStore");
const reminders = require("../../src/web/reminders");

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const sec = (ms) => Math.floor(ms / 1000);

let dir;
beforeEach(() => {
    jest.resetAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-reminders-"));
    reminderStore._setFileForTests(path.join(dir, "reminders-sent.json"));
    reminders._resetForTests();
    require("../../src/web/guildRoles").eventGuildId.mockReturnValue("100000");
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1" }, { id: "2" }, { id: "3" }], error: null });
    deliverUserPing.mockResolvedValue({});
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("toMs", () => {
    it("reads seconds, milliseconds, numeric strings and ISO dates; blank is 0", () => {
        expect(reminders.toMs(1900000000)).toBe(1900000000000);
        expect(reminders.toMs(1900000000000)).toBe(1900000000000);
        expect(reminders.toMs("1900000000")).toBe(1900000000000);
        expect(reminders.toMs("2026-09-20T12:00:00Z")).toBe(NOW);
        expect(reminders.toMs(undefined)).toBe(0);
        expect(reminders.toMs("")).toBe(0);
        expect(reminders.toMs("kein Datum")).toBe(0);
    });
});

describe("dueReminders", () => {
    const rule = { missingHours: 24, signedHours: 1 };

    it("sends nothing before the window opens", () => {
        expect(reminders.dueReminders({ startTime: sec(NOW + 30 * HOUR) }, rule, {}, NOW)).toEqual([]);
    });

    it("opens the missing reminder X hours before the start when there is no deadline", () => {
        expect(reminders.dueReminders({ startTime: sec(NOW + 20 * HOUR) }, rule, {}, NOW)).toEqual(["missing"]);
    });

    it("measures the missing reminder against the sign-up deadline when the event has one", () => {
        const event = { startTime: sec(NOW + 48 * HOUR), signupDeadline: sec(NOW + 10 * HOUR) };
        expect(reminders.dueReminders(event, rule, {}, NOW)).toEqual(["missing"]);
        // After the deadline nobody is asked to sign up any more.
        const past = { startTime: sec(NOW + 48 * HOUR), signupDeadline: sec(NOW - HOUR) };
        expect(reminders.dueReminders(past, rule, {}, NOW)).toEqual([]);
    });

    it("ignores a deadline after the start", () => {
        const event = { startTime: sec(NOW + 5 * HOUR), signupDeadline: sec(NOW + 50 * HOUR) };
        expect(reminders.dueReminders(event, rule, {}, NOW)).toEqual(["missing"]);
    });

    it("sends both within the last hour and never once the raid started", () => {
        expect(reminders.dueReminders({ startTime: sec(NOW + 30 * 60 * 1000) }, rule, {}, NOW)).toEqual(["missing", "signed"]);
        expect(reminders.dueReminders({ startTime: sec(NOW - 60 * 1000) }, rule, {}, NOW)).toEqual([]);
        expect(reminders.dueReminders({ startTime: sec(NOW) }, rule, {}, NOW)).toEqual([]);
    });

    it("skips what is already marked or switched off", () => {
        const event = { startTime: sec(NOW + 30 * 60 * 1000) };
        expect(reminders.dueReminders(event, rule, { missing: 1 }, NOW)).toEqual(["signed"]);
        expect(reminders.dueReminders(event, { missingHours: 0, signedHours: 0 }, {}, NOW)).toEqual([]);
    });
});

describe("runReminders", () => {
    const config = {
        categoryRoles: { 900000: ["500000"] },
        categoryReminders: { 900000: { missingHours: 24, signedHours: 2, target: "talk" } },
    };
    const soon = {
        id: "e1", title: "Karazhan", startTime: sec(NOW + HOUR), channelId: "110000",
        signUps: [{ userId: "1", status: "signed" }, { userId: "2", status: "absence" }, { userId: "4", status: "late" }],
    };
    const groups = (events) => ({ groups: [{ categoryId: "900000", categoryName: "Raids", events }], error: null });

    it("sends each reminder exactly once, however often the sweep runs", async () => {
        loadEventGroups.mockResolvedValue(groups([soon]));
        const first = await reminders.runReminders({ now: NOW, config });
        expect(first.sent).toBe(2);
        await reminders.runReminders({ now: NOW + 5 * 60 * 1000, config });
        await reminders.runReminders({ now: NOW + 10 * 60 * 1000, config });
        expect(deliverUserPing).toHaveBeenCalledTimes(2);

        const missing = deliverUserPing.mock.calls.find((c) => c[0].text.includes("sign up or sign off"))[0];
        // 1 signed up, 2 signed off — only 3 has not reacted.
        expect(missing).toMatchObject({ target: "talk", userIds: ["3"], guildId: "100000" });
        const signed = deliverUserPing.mock.calls.find((c) => c[0].text.includes("starts"))[0];
        expect(signed.userIds).toEqual(["1", "4"]);
        expect(reminderStore.getSent("e1")).toEqual({ missing: NOW, signed: NOW });
    });

    it("never reminds anybody of a cancelled event (#288)", async () => {
        loadEventGroups.mockResolvedValue(groups([{ ...soon, status: "cancelled" }]));
        const r = await reminders.runReminders({ now: NOW, config });
        expect(r.sent).toBe(0);
        expect(deliverUserPing).not.toHaveBeenCalled();
        expect(reminderStore.getSent("e1")).toEqual({});
    });

    it("never sends for a raid that already started", async () => {
        loadEventGroups.mockResolvedValue(groups([{ ...soon, startTime: sec(NOW - 60 * 1000) }]));
        const r = await reminders.runReminders({ now: NOW, config });
        expect(r.sent).toBe(0);
        expect(deliverUserPing).not.toHaveBeenCalled();
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
    });

    it("takes the mark back when the send fails, so the next sweep retries", async () => {
        loadEventGroups.mockResolvedValue(groups([{ ...soon, startTime: sec(NOW + 10 * HOUR) }]));
        deliverUserPing.mockRejectedValueOnce(new Error("Discord weg"));
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const r = await reminders.runReminders({ now: NOW, config });
        expect(r.failed).toBe(1);
        expect(reminderStore.getSent("e1")).toEqual({});
        const again = await reminders.runReminders({ now: NOW + 5 * 60 * 1000, config });
        expect(again.sent).toBe(1);
        expect(deliverUserPing).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });

    it("waits when the members cannot be read instead of marking the reminder done", async () => {
        loadEventGroups.mockResolvedValue(groups([{ ...soon, startTime: sec(NOW + 10 * HOUR) }]));
        discord.listMembersWithRoles.mockResolvedValue({ members: [], error: "Intent fehlt" });
        const r = await reminders.runReminders({ now: NOW, config });
        expect(r.skipped).toBe(1);
        expect(reminderStore.getSent("e1")).toEqual({});
        expect(deliverUserPing).not.toHaveBeenCalled();
    });

    it("does nothing for categories without a rule or without configuration at all", async () => {
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "123456", events: [soon] }], error: null });
        await reminders.runReminders({ now: NOW, config });
        expect(deliverUserPing).not.toHaveBeenCalled();
        const idle = await reminders.runReminders({ now: NOW, config: {} });
        expect(idle).toEqual({ sent: 0, failed: 0, skipped: 0, error: null });
        expect(loadEventGroups).toHaveBeenCalledTimes(1);
    });
});

describe("runAutoSuggest (Vorschlag bei Anmeldeschluss)", () => {
    const own = (over = {}) => ({
        id: "eh-kara", title: "Karazhan", source: "eventhelper", autoSuggest: true, setup: null,
        signupDeadline: sec(NOW - HOUR), startTime: sec(NOW + 5 * HOUR), ...over,
    });
    const proposal = { version: 1, groups: [], bench: [], checks: { ok: false } };

    beforeEach(() => {
        eventStore.listEvents.mockReturnValue([own()]);
        proposeSetup.mockReturnValue(proposal);
        eventStore.saveSetupDraft.mockReturnValue({ event: {} });
    });

    it("stores the proposal as a draft once the deadline passed — exactly once", () => {
        expect(reminders.runAutoSuggest({ now: NOW })).toEqual({ drafted: ["eh-kara"], failed: 0 });
        expect(proposeSetup).toHaveBeenCalledWith(["eh-kara"], { now: NOW });
        expect(eventStore.saveSetupDraft).toHaveBeenCalledWith("eh-kara", proposal, { createdBy: "auto", now: NOW });
        expect(reminderStore.getSent("eh-kara")).toEqual({ autoSuggest: NOW });
        expect(reminders.runAutoSuggest({ now: NOW + 5 * 60 * 1000 })).toEqual({ drafted: [], failed: 0 });
        expect(proposeSetup).toHaveBeenCalledTimes(1);
    });

    it("waits for the deadline and skips events without the switch, with a setup, or already started", () => {
        expect(reminders.autoSuggestDue(own({ signupDeadline: sec(NOW + HOUR) }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own({ autoSuggest: false }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own({ setup: { status: "draft" } }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own({ signupDeadline: 0 }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own({ startTime: sec(NOW - 60 * 1000) }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own(), { autoSuggest: 1 }, NOW)).toBe(false);
        // a cancelled event (#288) gets no setup proposal
        expect(reminders.autoSuggestDue(own({ status: "cancelled" }), {}, NOW)).toBe(false);
        expect(reminders.autoSuggestDue(own(), {}, NOW)).toBe(true);
    });

    it("takes the mark back when the proposal fails, so the next sweep retries", () => {
        proposeSetup.mockImplementationOnce(() => { throw new Error("kaputt"); });
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        expect(reminders.runAutoSuggest({ now: NOW })).toEqual({ drafted: [], failed: 1 });
        expect(reminderStore.getSent("eh-kara")).toEqual({});
        expect(reminders.runAutoSuggest({ now: NOW + 60 * 1000 })).toEqual({ drafted: ["eh-kara"], failed: 0 });
        spy.mockRestore();
    });

    it("never approves: an approved setup in the meantime is left alone and not retried", () => {
        eventStore.saveSetupDraft.mockReturnValue({ error: "Das Setup ist schon freigegeben.", code: "approved" });
        expect(reminders.runAutoSuggest({ now: NOW })).toEqual({ drafted: [], failed: 0 });
        expect(reminderStore.getSent("eh-kara")).toEqual({ autoSuggest: NOW });
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "reminders.js"), "utf8");
        expect(src).not.toMatch(/status:\s*"approved"/);
    });
});

describe("reminderStore", () => {
    it("marks once, clears, and prunes old events", () => {
        expect(reminderStore.markSent("e9", "signed", 1000)).toBe(true);
        expect(reminderStore.markSent("e9", "signed", 2000)).toBe(false);
        expect(reminderStore.clearSent("e9", "signed")).toBe(true);
        expect(reminderStore.getSent("e9")).toEqual({});
        reminderStore.markSent("old", "missing", 1000);
        reminderStore.markSent("new", "missing", NOW);
        expect(reminderStore.prune(24 * HOUR, NOW)).toBe(1);
        expect(reminderStore.getSent("old")).toEqual({});
        expect(reminderStore.getSent("new")).toEqual({ missing: NOW });
    });
});
