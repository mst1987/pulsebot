// Recurring events per category (#289): Berlin dates across the daylight-saving
// switch, the "X days before" window, never twice, skipped and cancelled dates,
// Raid-Helper categories left alone, failures kept and reported.
const { tempStoreFile } = require("../../helpers/tempStore");
const { DateTime } = require("luxon");

jest.mock("../../../src/services/discord/discord", () => ({
    getClient: jest.fn(() => ({ isReady: () => true })),
    listCategories: jest.fn(() => [{ id: "cat1", name: "Raids Mittwoch" }]),
}));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({
    signupSourceFor: jest.fn(() => "eventhelper"),
    ownUpcomingRaw: jest.fn(() => []),
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: [], error: null })) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/eventStore", () => ({ appendEventLog: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["cat1"], categoryRaidTemplate: {} })),
    getRaidTemplate: jest.fn((id) => (id === "tpl-ssc" ? { id: "tpl-ssc", name: "SSC + TK 25er", instanceIds: ["ssc", "tk"], size: 25 } : null)),
}));
jest.mock("../../../src/services/discord/channelNaming", () => ({
    loadNamingInputs: jest.fn(async () => ({ events: [], channels: [], schemas: {} })),
    raidTagFor: jest.fn(() => "ssc-tk"),
    namingContext: jest.fn(() => ({ source: "previous" })),
    describeResult: jest.fn((ctx, date) => ({
        name: `mi-${date.slice(8, 10)}-${date.slice(5, 7)}-ssc-tk`, source: "previous", label: "abgeleitet aus #mi-16-09-ssc-tk", detail: "Datum 16-09 → …", design: "Rechte und Thema von #mi-16-09-ssc-tk",
    })),
}));

const discord = require("../../../src/services/discord/discord");
const { createEvent } = require("../../../src/services/events/eventCreate");
const { signupSourceFor, ownUpcomingRaw } = require("../../../src/services/events/eventSources");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const eventStore = require("../../../src/stores/eventStore");
const store = require("../../../src/stores/eventSeriesStore");
const series = require("../../../src/web/events/eventSeries");
const { buildTasks, _internal: { eventSeriesTask } } = require("../../../src/web/dashboardOverview");
const { series: baseSeries } = require("../../factories/events");

const ZONE = "Europe/Berlin";
const at = (iso) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const utc = (ms) => new Date(ms).toISOString();
const WED = 3;
const SAT = 6;
const base = baseSeries({ weekdays: [WED] });

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("event-series.json"));
    series._resetForTests();
    discord.getClient.mockReturnValue({ isReady: () => true });
    signupSourceFor.mockReturnValue("eventhelper");
    ownUpcomingRaw.mockReturnValue([]);
    loadEventGroups.mockResolvedValue({ groups: [], error: null });
    let n = 0;
    createEvent.mockImplementation(async ({ body }) => {
        n += 1;
        return { status: 201, body: { id: `eh-${n}`, event: { id: `eh-${n}`, channelId: `ch${n}`, channelName: "" }, channelNaming: { name: `mi-${body.date}` }, messageError: null } };
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    console.error.mockRestore();
});

describe("occurrences", () => {
    it("lists the coming Wednesdays at 19:30 Berlin time, with the creation moment 6 days before", () => {
        const list = series._internal.occurrences(base, { now: at("2026-09-14T12:00"), count: 3 });
        expect(list.map((o) => o.date)).toEqual(["2026-09-16", "2026-09-23", "2026-09-30"]);
        expect(utc(list[0].startTime * 1000)).toBe("2026-09-16T17:30:00.000Z");
        expect(utc(list[0].createAt)).toBe("2026-09-10T17:30:00.000Z");
    });

    it("orders several weekdays and keeps today only while its start is ahead", () => {
        const s = { ...base, weekdays: [SAT, WED] };
        expect(series._internal.occurrences(s, { now: at("2026-09-16T19:00"), count: 3 }).map((o) => o.date))
            .toEqual(["2026-09-16", "2026-09-19", "2026-09-23"]);
        expect(series._internal.occurrences(s, { now: at("2026-09-16T19:30"), count: 2 }).map((o) => o.date))
            .toEqual(["2026-09-19", "2026-09-23"]);
    });

    it("keeps 19:30 wall-clock time across the October switch (last Sunday, 25.10.2026)", () => {
        const s = { ...base, weekdays: [7, WED] };
        const list = series._internal.occurrences(s, { now: at("2026-10-15T12:00"), count: 4 });
        expect(list.map((o) => [o.date, utc(o.startTime * 1000)])).toEqual([
            ["2026-10-18", "2026-10-18T17:30:00.000Z"],
            ["2026-10-21", "2026-10-21T17:30:00.000Z"],
            ["2026-10-25", "2026-10-25T18:30:00.000Z"],
            ["2026-10-28", "2026-10-28T18:30:00.000Z"],
        ]);
        // 6 calendar days before the 28th is the 22nd, still summer time: 19:30 CEST.
        expect(utc(list[3].createAt)).toBe("2026-10-22T17:30:00.000Z");
        expect(DateTime.fromMillis(list[3].createAt, { zone: ZONE }).toFormat("dd.MM. HH:mm")).toBe("22.10. 19:30");
    });

    it("keeps 19:30 across the March switch (last Sunday, 28.03.2027)", () => {
        const s = { ...base, weekdays: [2], daysBefore: 3 };
        const [first] = series._internal.occurrences(s, { now: at("2027-03-24T12:00"), count: 1 });
        expect(first.date).toBe("2027-03-30");
        expect(utc(first.startTime * 1000)).toBe("2027-03-30T17:30:00.000Z");
        expect(utc(first.createAt)).toBe("2027-03-27T18:30:00.000Z"); // 27.03. 19:30 CET
    });

    it("marks skipped dates", () => {
        const list = series._internal.occurrences({ ...base, skipDates: ["2026-09-23"] }, { now: at("2026-09-14T12:00"), count: 2 });
        expect(list.map((o) => o.skipped)).toEqual([false, true]);
    });
});

describe("normalizeSeries", () => {
    const now = at("2026-09-14T12:00");
    it("cleans weekdays, time and skip dates", () => {
        const { value } = series._internal.normalizeSeries({ ...base, weekdays: [6, "3", 3, 9], time: "1930", skipDates: ["2026-09-23", "2026-09-01", "x"] }, { now });
        expect(value).toMatchObject({ weekdays: [3, 6], time: "19:30", skipDates: ["2026-09-23"], enabled: true });
    });

    it("refuses what cannot become a series", () => {
        expect(series._internal.normalizeSeries({ ...base, weekdays: [] }, { now }).error).toMatch(/Wochentag/);
        expect(series._internal.normalizeSeries({ ...base, time: "25:00" }, { now }).error).toMatch(/Uhrzeit/);
        expect(series._internal.normalizeSeries({ ...base, daysBefore: 0 }, { now }).error).toMatch(/Tage vorher/);
        expect(series._internal.normalizeSeries({ ...base, daysBefore: 40 }, { now }).error).toMatch(/Tage vorher/);
        expect(series._internal.normalizeSeries({ ...base, raidTemplateId: "gone" }, { now }).error).toMatch(/Vorlage/);
        expect(series._internal.normalizeSeries({ ...base, raidTemplateId: "" }, { now }).error).toMatch(/Standard-Vorlage/);
        expect(series._internal.normalizeSeries({ ...base, raidTemplateId: "" }, { now, categoryTemplateId: "tpl-ssc" }).value).toBeTruthy();
    });
});

describe("summaryLine", () => {
    it("is the one compact line of the page", () => {
        expect(series._internal.summaryLine(base, "SSC + TK 25er")).toBe("Mi 19:30 · SSC + TK 25er · 6 Tage vorher");
        expect(series._internal.summaryLine({ ...base, weekdays: [3, 6], daysBefore: 1 }, "Kara")).toBe("Mi + Sa 19:30 · Kara · 1 Tag vorher");
    });
});

describe("dueDates", () => {
    it("opens a date's window X days before its start, and not a minute earlier", () => {
        expect(series._internal.dueDates(base, {}, at("2026-09-10T19:29"))).toEqual([]);
        expect(series._internal.dueDates(base, {}, at("2026-09-10T19:30")).map((o) => o.date)).toEqual(["2026-09-16"]);
    });

    it("leaves marked, skipped and switched-off dates alone", () => {
        const now = at("2026-09-10T20:00");
        expect(series._internal.dueDates(base, { "2026-09-16": { status: "created" } }, now)).toEqual([]);
        expect(series._internal.dueDates({ ...base, skipDates: ["2026-09-16"] }, {}, now)).toEqual([]);
        expect(series._internal.dueDates({ ...base, enabled: false }, {}, now)).toEqual([]);
    });
});

describe("runSeries", () => {
    const now = at("2026-09-10T20:00");

    it("creates the due date's event once, with a derived channel in the category and the template", async () => {
        store.saveSeries({ ...base, guildId: "g1", leaderId: "u1" });
        const first = await series.runSeries({ now });
        expect(first).toMatchObject({ created: 1, failed: 0 });
        expect(createEvent).toHaveBeenCalledTimes(1);
        expect(createEvent.mock.calls[0][0]).toEqual({
            guildId: "g1",
            user: { id: "u1" },
            body: {
                title: "SSC + TK 25er", date: "2026-09-16", time: "19:30",
                newChannel: { name: "", categoryId: "cat1" }, signupSource: "eventhelper", raidTemplateId: "tpl-ssc",
            },
        });
        // #306: kein Sonderweg — die Serie schickt kein `announce` mit, also entscheidet
        // die Kategorie, ob das Event beim Anlegen angekündigt wird.
        expect(createEvent.mock.calls[0][0].body.announce).toBeUndefined();
        expect(store.getRuns("cat1")["2026-09-16"]).toMatchObject({ status: "created", eventId: "eh-1", channelName: "mi-2026-09-16" });
        expect(eventStore.appendEventLog).toHaveBeenCalledWith("eh-1", expect.objectContaining({ action: "series" }));

        // A second sweep — also one a minute later or after a restart — creates nothing.
        const second = await series.runSeries({ now: now + 60 * 1000 });
        expect(second.created).toBe(0);
        expect(createEvent).toHaveBeenCalledTimes(1);
    });

    it("does not create a date again whose event was deleted, and shows it as deleted", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        await series.runSeries({ now });
        // eventManage.deleteEvent turns the mark into "deleted"; the event is gone from every list
        store.setRun("cat1", "2026-09-16", { status: "deleted", at: now, eventId: "eh-1" });
        expect(series._internal.dueDates(base, store.getRuns("cat1"), now + 60 * 1000)).toEqual([]);
        expect((await series.runSeries({ now: now + 60 * 60 * 1000 })).created).toBe(0);
        expect(createEvent).toHaveBeenCalledTimes(1);
        const plan = series._internal.planSeries(base, store.getRuns("cat1"), { now, events: [] });
        expect(plan[0]).toMatchObject({ date: "2026-09-16", state: "deleted" });
        // it is no failure the dashboard reports
        expect(series.seriesFailures({ now })).toEqual([]);
    });

    it("never creates a date twice when two sweeps overlap", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        let release;
        createEvent.mockImplementationOnce(() => new Promise((r) => { release = r; }));
        const a = series.runSeries({ now });
        await new Promise((r) => setImmediate(r));
        const b = await series.runSeries({ now });
        expect(b.error).toBe("läuft bereits");
        release({ status: 201, body: { id: "eh-x", event: { id: "eh-x" } } });
        await a;
        expect(createEvent).toHaveBeenCalledTimes(1);
        // and a claimed date cannot be claimed again
        expect(store.claimDate("cat1", "2026-09-16")).toBe(false);
    });

    it("only marks a date that already has an event — a cancelled one is not recreated", async () => {
        store.saveSeries({ ...base, weekdays: [WED, 5], guildId: "g1" });
        ownUpcomingRaw.mockReturnValue([
            { id: "eh-cancelled", startTime: at("2026-09-16T19:30") / 1000, status: "cancelled", channelName: "mi-16-09" },
        ]);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [{ id: "123", startTime: at("2026-09-11T20:00") / 1000, channelName: "fr-11-09" }] }] });
        const out = await series.runSeries({ now });
        expect(out).toMatchObject({ created: 0, existing: 2 });
        expect(createEvent).not.toHaveBeenCalled();
        const runs = store.getRuns("cat1");
        expect(runs["2026-09-16"]).toMatchObject({ status: "existing", eventId: "eh-cancelled" });
        expect(runs["2026-09-11"]).toMatchObject({ status: "existing", eventId: "123" });
        const plan = series._internal.planSeries({ ...base, weekdays: [WED] }, runs, { now, events: ownUpcomingRaw() });
        expect(plan[0].state).toBe("cancelled");
    });

    it("skips skipped dates, switched-off series and Raid-Helper categories", async () => {
        store.saveSeries({ ...base, skipDates: ["2026-09-16"], guildId: "g1" });
        expect((await series.runSeries({ now })).created).toBe(0);
        store.saveSeries({ ...base, enabled: false, guildId: "g1" });
        expect((await series.runSeries({ now })).created).toBe(0);
        store.saveSeries({ ...base, guildId: "g1" });
        signupSourceFor.mockReturnValue("raidhelper");
        expect(await series.runSeries({ now })).toMatchObject({ created: 0, ignored: 1 });
        expect(createEvent).not.toHaveBeenCalled();
        expect(store.getRuns("cat1")).toEqual({});
    });

    it("waits for Discord instead of failing every date", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        discord.getClient.mockReturnValue({ isReady: () => false });
        expect((await series.runSeries({ now })).error).toMatch(/Discord/);
        expect(createEvent).not.toHaveBeenCalled();
        expect(store.getRuns("cat1")).toEqual({});
    });

    it("keeps a failure, retries it a few times ten minutes apart and reports it for the dashboard", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        createEvent.mockResolvedValue({ error: { status: 400, code: "create_failed", message: "Kanal konnte nicht angelegt werden: fehlende Rechte" } });
        expect((await series.runSeries({ now })).failed).toBe(1);
        expect((await series.runSeries({ now: now + 5 * 60 * 1000 })).failed).toBe(0); // too soon
        await series.runSeries({ now: now + 11 * 60 * 1000 });
        await series.runSeries({ now: now + 22 * 60 * 1000 });
        await series.runSeries({ now: now + 33 * 60 * 1000 }); // attempts exhausted
        expect(createEvent).toHaveBeenCalledTimes(series._internal.MAX_ATTEMPTS);
        expect(store.getRuns("cat1")["2026-09-16"]).toMatchObject({ status: "failed", attempts: 3 });

        const failures = series.seriesFailures({ now: now + 40 * 60 * 1000 });
        expect(failures).toEqual([expect.objectContaining({ categoryId: "cat1", date: "2026-09-16", error: "Kanal konnte nicht angelegt werden: fehlende Rechte" })]);
        const task = eventSeriesTask([{ ...failures[0], categoryName: "Raids Mittwoch" }]);
        expect(task).toMatchObject({ id: "series", tone: "bad", href: "/raids/series", title: "Serie konnte Event nicht anlegen: fehlende Rechte", tip: "Kanal konnte nicht angelegt werden: fehlende Rechte" });
        expect(task.ref.text).toBe("Raids Mittwoch · Mi 16.09.");
        expect(buildTasks({ seriesFailures: [] }).some((t) => t.id === "series")).toBe(false);
        expect(buildTasks({ seriesFailures: failures }).some((t) => t.id === "series")).toBe(true);
    });

    it("reports an interrupted creation but never retries it on its own", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        store.claimDate("cat1", "2026-09-16", { at: now });
        await series.runSeries({ now: now + 60 * 60 * 1000 });
        expect(createEvent).not.toHaveBeenCalled();
        expect(series.seriesFailures({ now: now + 60 * 60 * 1000 })[0].error).toMatch(/unterbrochen/);
        expect(series._internal.planSeries(base, store.getRuns("cat1"), { now: now + 60 * 60 * 1000 })[0].state).toBe("interrupted");
    });
});

describe("planSeries", () => {
    it("says for every coming date what happens: planned, due, created, skipped", () => {
        const now = at("2026-09-10T20:00");
        const runs = { "2026-09-16": { status: "created", at: now, eventId: "eh-1", channelName: "mi-16-09-ssc-tk" } };
        const plan = series._internal.planSeries({ ...base, skipDates: ["2026-09-30"] }, runs, { now, count: 4 });
        expect(plan.map((o) => o.state)).toEqual(["created", "planned", "skipped", "planned"]);
        expect(plan[0]).toMatchObject({ eventId: "eh-1", channelName: "mi-16-09-ssc-tk" });
        expect(series._internal.planSeries(base, {}, { now: at("2026-09-17T20:00"), count: 1 })[0].state).toBe("due");
        expect(series._internal.planSeries({ ...base, enabled: false }, {}, { now, count: 1 })[0].state).toBe("off");
    });
});

describe("saving and the overview", () => {
    it("refuses a new series in a Raid-Helper category, with the hint", () => {
        signupSourceFor.mockReturnValue("raidhelper");
        const out = series.saveSeriesFor({ guildId: "g1", input: base, user: { id: "u1" } });
        expect(out.error).toMatchObject({ status: 409, code: "raidhelper_category" });
        expect(out.error.message).toMatch(/Raid-Helper/);
    });

    it("stores who set it up as the events' leader", () => {
        const out = series.saveSeriesFor({ guildId: "g1", input: base, user: { id: "u1", name: "Orga" }, now: at("2026-09-10T12:00") });
        expect(out.series).toMatchObject({ categoryId: "cat1", guildId: "g1", leaderId: "u1", updatedByName: "Orga" });
        expect(store.getSeries("cat1")).toMatchObject({ weekdays: [3], time: "19:30" });
    });

    it("keeps run marks when a series is deleted, so a new one does not repeat a date", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        await series.runSeries({ now: at("2026-09-10T20:00") });
        store.deleteSeries("cat1");
        store.saveSeries({ ...base, guildId: "g1" });
        await series.runSeries({ now: at("2026-09-10T20:10") });
        expect(createEvent).toHaveBeenCalledTimes(1);
    });

    it("lists every event category with summary, next dates and the channel each would get", async () => {
        store.saveSeries({ ...base, guildId: "g1" });
        const out = await series.seriesOverview({ guildId: "g1", now: at("2026-09-14T12:00"), config: { categoryIds: ["cat1", "cat2"], categoryRaidTemplate: {} } });
        expect(out.categories.map((c) => c.id)).toEqual(["cat1", "cat2"]);
        const [row, empty] = out.categories;
        expect(row).toMatchObject({ name: "Raids Mittwoch", summary: "Mi 19:30 · SSC + TK 25er · 6 Tage vorher", source: "eventhelper" });
        expect(row.upcoming).toHaveLength(4);
        expect(row.upcoming[0]).toMatchObject({ date: "2026-09-16", state: "due", previewName: "mi-16-09-ssc-tk" });
        expect(row.upcoming[0].naming.label).toMatch(/abgeleitet/);
        expect(empty.series).toBeNull();
    });

    it("previews an unsaved series, or says what is wrong", async () => {
        const ok = await series.previewSeries({ guildId: "g1", input: { ...base, weekdays: [SAT] }, now: at("2026-09-14T12:00") });
        expect(ok.error).toBe("");
        expect(ok.upcoming[0].date).toBe("2026-09-19");
        const bad = await series.previewSeries({ guildId: "g1", input: { ...base, weekdays: [] } });
        expect(bad.error).toMatch(/Wochentag/);
    });
});
