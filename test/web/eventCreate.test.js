jest.mock("fs", () => {
    const store = new Map();
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => store.set(p, String(data))),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw new Error("ENOENT");
            return store.get(p);
        }),
    };
});
const mockCreateEvent = jest.fn();
const mockGetEvent = jest.fn();
jest.mock("../../src/utils/raidhelperClient", () => ({
    createRaidhelperClient: () => ({ createEvent: mockCreateEvent, getEvent: mockGetEvent }),
}));
jest.mock("../../src/web/discord", () => ({
    getChannelCategoryMap: jest.fn(() => ({})),
    duplicateChannel: jest.fn(),
    listAllChannels: jest.fn(() => []),
    listCategories: jest.fn(() => [{ id: "cat-eh", name: "EventHelper-Raids" }]),
}));
jest.mock("../../src/web/discordChannels", () => ({
    createFromTemplate: jest.fn(),
    placeChannel: jest.fn(async () => true),
    discordErrorText: jest.requireActual("../../src/web/discordChannels").discordErrorText,
}));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})), getRaidTemplate: jest.fn(() => null) }));
jest.mock("../../src/web/eventMessage", () => ({ postEventMessage: jest.fn(), refreshEventMessage: jest.fn() }));
jest.mock("../../src/web/eventAnnounce", () => ({ announceEvent: jest.fn(async () => ({ announced: true, target: "event" })) }));
jest.mock("../../src/web/talkOverview", () => ({ scheduleOverviewSync: jest.fn(), RAIDHELPER_CREATE_DELAY_MS: 35000 }));
jest.mock("../../src/web/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null), listRaidEvents: jest.fn(() => []) }));
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 1),
}));
jest.mock("../../src/web/raidListing", () => ({
    raidContentIds: ({ title }) => ({ contentIds: /kara/i.test(title || "") ? ["kara"] : [], sources: [] }),
}));

const fs = require("fs");
const discord = require("../../src/web/discord");
const discordChannels = require("../../src/web/discordChannels");
const { getConfig, getRaidTemplate } = require("../../src/web/settingsStore");
const { postEventMessage, refreshEventMessage } = require("../../src/web/eventMessage");
const { announceEvent } = require("../../src/web/eventAnnounce");
const { scheduleOverviewSync } = require("../../src/web/talkOverview");
const { createFromTemplate } = discordChannels;
const channelArchiveStore = require("../../src/web/channelArchiveStore");
const raidEventGroups = require("../../src/web/raidEventGroups");
const eventStore = require("../../src/web/eventStore");
const { createEvent, updateEvent, startTimeOf, schemaChannelName } = require("../../src/web/eventCreate");

const user = { id: "42" };
const body = (over = {}) => ({
    title: "Kara Donnerstag", date: "2026-10-01", time: "20:00", templateId: "t1", leaderId: "7", channelId: "c1", description: "Treffpunkt Eingang", ...over,
});

describe("web/eventCreate", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.__store.clear();
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara-do", categoryId: "cat-rh", categoryName: "Raid-Helper-Raids" },
            c2: { name: "kara-fr", categoryId: "cat-eh", categoryName: "EventHelper-Raids" },
        });
        getConfig.mockReturnValue({ categorySignupSource: { "cat-eh": "eventhelper" } });
        postEventMessage.mockResolvedValue({ channelId: "c2", messageId: "m1" });
    });

    it("reads date and time in Berlin time", () => {
        expect(startTimeOf("01-10-2026", "20:00")).toBe(Math.floor(Date.UTC(2026, 9, 1, 18, 0) / 1000));
        expect(startTimeOf("01-10-2026", "kaputt")).toBe(0);
    });

    it("creates the event at Raid-Helper in a category that was not switched", async () => {
        mockCreateEvent.mockResolvedValue({ id: "rh-1" });
        const result = await createEvent({ guildId: "g1", user, body: body() });
        expect(mockCreateEvent).toHaveBeenCalledWith({
            channelId: "c1", leaderId: "7", templateId: "t1", date: "01-10-2026", time: "20:00", title: "Kara Donnerstag", description: "Treffpunkt Eingang",
        });
        expect(result).toEqual({ status: 201, body: { id: "rh-1", channelId: "c1" } });
        expect(scheduleOverviewSync).toHaveBeenCalledWith({ delayMs: 35000 });
        expect(eventStore.listEvents("g1")).toEqual([]);
        expect(postEventMessage).not.toHaveBeenCalled();
    });

    it("creates the event in the own store in an EventHelper category and posts the message", async () => {
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
        expect(mockCreateEvent).not.toHaveBeenCalled();
        expect(result.status).toBe(201);
        expect(result.body).toMatchObject({ source: "eventhelper", messageError: null });
        const stored = eventStore.getEvent(result.body.id);
        expect(stored).toMatchObject({
            guildId: "g1", channelId: "c2", channelName: "kara-fr", categoryId: "cat-eh", categoryName: "EventHelper-Raids",
            title: "Kara Donnerstag", leaderId: "7", startTime: startTimeOf("01-10-2026", "20:00"),
            // instances read from the title, size and tanks/healers from the rule set
            versionId: "tbc", instanceIds: ["kara"], size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
            createdBy: "42",
        });
        expect(postEventMessage).toHaveBeenCalledWith(result.body.id);
        expect(scheduleOverviewSync).toHaveBeenCalledWith();
    });

    it("accepts the planning fields for an EventHelper event", async () => {
        const result = await createEvent({ guildId: "g1", user, body: body({
            channelId: "c2", versionId: "tbc", instanceIds: ["gruul", "mag"], size: 25,
            composition: { tank: 4, healer: 7 }, signupDeadline: startTimeOf("01-10-2026", "12:00"), fairness: true,
        }) });
        expect(eventStore.getEvent(result.body.id)).toMatchObject({
            instanceIds: ["gruul", "mag"], size: 25, composition: { tank: 4, healer: 7 }, fairness: true, wishes: false,
        });
    });

    it("takes what the body leaves open from the category's default raid template", async () => {
        getConfig.mockReturnValue({ categorySignupSource: { "cat-eh": "eventhelper" }, categoryRaidTemplate: { "cat-eh": "tpl-t5" } });
        getRaidTemplate.mockImplementation((id) => (id === "tpl-t5" ? {
            id: "tpl-t5", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
            composition: { tank: 3, healer: 7, melee: { min: 4, max: null }, ranged: null },
            signupDeadline: { hoursBefore: 24 }, fairness: true, wishes: false,
        } : null));
        try {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", title: "Donnerstag", size: 20 }) });
            const start = startTimeOf("01-10-2026", "20:00");
            expect(eventStore.getEvent(result.body.id)).toMatchObject({
                instanceIds: ["ssc", "tk"], size: 20, composition: { tank: 3, healer: 7, melee: 4, ranged: 0 },
                signupDeadline: start - 24 * 3600, fairness: true, wishes: false,
            });
        } finally {
            getRaidTemplate.mockReturnValue(null);
        }
    });

    it("refuses a bad plan before it clones a channel", async () => {
        eventStore.createEvent({ guildId: "g1", channelId: "c2", categoryId: "cat-eh", title: "Alt", startTime: 1900000000 });
        const source = eventStore.listEvents("g1")[0];
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", sourceEventId: source.id, channelName: "neu", size: 99 }) });
        expect(result.error).toMatchObject({ status: 400, code: "invalid_plan" });
        expect(discord.duplicateChannel).not.toHaveBeenCalled();
    });

    it("clones the channel of an own source event and keeps its category's source", async () => {
        const { event: source } = eventStore.createEvent({ guildId: "g1", channelId: "c2", categoryId: "cat-eh", title: "Kara alt", startTime: 1900000000 });
        discord.duplicateChannel.mockResolvedValue({ id: "c3", name: "kara-neu" });
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", sourceEventId: source.id, channelName: "kara-neu" }) });
        expect(mockGetEvent).not.toHaveBeenCalled();
        expect(discord.duplicateChannel).toHaveBeenCalledWith("c2", "kara-neu");
        // the copy is sorted in by date too (#285) — best-effort, nothing to sort against here
        expect(discordChannels.placeChannel).toHaveBeenCalledWith("c3", {});
        expect(eventStore.getEvent(result.body.id)).toMatchObject({ channelId: "c3", channelName: "kara-neu", categoryId: "cat-eh" });
    });

    it("creates a new channel in the asked category, only after the plan was checked (#260)", async () => {
        discordChannels.createFromTemplate.mockResolvedValue({ id: "c9", name: "mi-24-09-kara" });
        const bad = await createEvent({ guildId: "g1", user, body: body({
            channelId: "", newChannel: { name: "Mi 24 09 Kara", categoryId: "cat-eh" }, size: 99,
        }) });
        expect(bad.error.code).toBe("invalid_plan");
        expect(discordChannels.createFromTemplate).not.toHaveBeenCalled();

        const result = await createEvent({ guildId: "g1", user, body: body({
            channelId: "", newChannel: { name: "Mi 24 09 Kara", categoryId: "cat-eh", templateChannelId: "c2" },
        }) });
        expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("g1", { name: "mi-24-09-kara", parentId: "cat-eh", templateChannelId: "c2" });
        expect(eventStore.getEvent(result.body.id)).toMatchObject({ channelId: "c9", channelName: "mi-24-09-kara", categoryId: "cat-eh" });
    });

    it("reports a new channel Discord refused, readable", async () => {
        discordChannels.createFromTemplate.mockRejectedValue(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: { name: "kara", categoryId: "cat-rh" } }) });
        expect(result.error).toEqual({ status: 400, code: "create_failed", message: "Kanal konnte nicht angelegt werden: fehlende Rechte" });
        expect(mockCreateEvent).not.toHaveBeenCalled();
    });

    it("lets the caller pick the other source for one event", async () => {
        mockCreateEvent.mockResolvedValue({ id: "rh-2" });
        const rh = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", signupSource: "raidhelper" }) });
        expect(rh.body).toEqual({ id: "rh-2", channelId: "c2" });
        const own = await createEvent({ guildId: "g1", user, body: body({ channelId: "c1", signupSource: "eventhelper" }) });
        expect(own.body.source).toBe("eventhelper");
        const ignored = await createEvent({ guildId: "g1", user, body: body({ channelId: "c1", signupSource: "kaputt" }) });
        expect(ignored.body).toEqual({ id: "rh-2", channelId: "c1" });
    });

    it("still creates the event when the message cannot be posted, and says so", async () => {
        postEventMessage.mockRejectedValue(new Error("Bot nicht verbunden."));
        const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
        expect(result.status).toBe(201);
        expect(result.body.messageError).toBe("Bot nicht verbunden.");
        expect(eventStore.getEvent(result.body.id)).not.toBeNull();
    });

    it("rejects a missing date or channel for both sources", async () => {
        expect((await createEvent({ guildId: "g1", user, body: body({ date: "x" }) })).error.code).toBe("invalid_date");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "" }) })).error.code).toBe("no_channel");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", time: "" }) })).error.code).toBe("invalid_time");
        expect((await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", title: " " }) })).error.code).toBe("invalid_title");
    });

    it("reports Raid-Helper's refusal", async () => {
        mockCreateEvent.mockResolvedValue({ status: "failed", reason: "invalid token" });
        const result = await createEvent({ guildId: "g1", user, body: body() });
        expect(result.error).toEqual({ status: 400, code: "create_failed", message: "invalid token" });
    });

    describe("planning fields from the web dialog (#261)", () => {
        const T5 = {
            id: "tpl-t5", name: "SSC + TK", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
            composition: { tank: 3, healer: 6, melee: { min: 6, max: 8 }, ranged: null },
            requiredBuffs: ["windfury"], signupDeadline: null, fairness: false, wishes: true, raidhelperTemplateId: "rh-9",
        };
        const snapshot = JSON.parse(JSON.stringify(T5));
        beforeEach(() => getRaidTemplate.mockImplementation((id) => (id === "tpl-t5" ? T5 : null)));
        afterEach(() => getRaidTemplate.mockReturnValue(null));

        it("takes size, tanks, healers, ranges and buffs from the chosen raid template", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", raidTemplateId: "tpl-t5" }) });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({
                raidTemplateId: "tpl-t5", instanceIds: ["ssc", "tk"], size: 25,
                composition: { tank: 3, healer: 6, melee: 6, ranged: 0 }, compositionMax: { melee: 8, ranged: null },
                requiredBuffs: ["windfury"], wishes: true,
            });
        });

        it("overrides the template for this one event without touching the template", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({
                channelId: "c2", raidTemplateId: "tpl-t5", size: 20, composition: { tank: 2, healer: 5, melee: { min: 4, max: 6 } }, requiredBuffs: [],
            }) });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({
                size: 20, composition: { tank: 2, healer: 5, melee: 4 }, compositionMax: { melee: 6 }, requiredBuffs: [],
            });
            expect(T5).toEqual(snapshot);
        });

        it("takes the waiting-list switches from the raid template (#306)", async () => {
            getRaidTemplate.mockImplementation((id) => (id === "tpl-t5" ? { ...T5, overflow: "off", lockAtLimit: true } : null));
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", raidTemplateId: "tpl-t5" }) });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({ overflow: "off", lockAtLimit: true });
        });

        it("lets the create dialog override the template's waiting list (#306)", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", raidTemplateId: "tpl-t5", overflow: "off", lockAtLimit: true }) });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({ overflow: "off", lockAtLimit: true });
        });

        it("takes the deadline as hours before the start and the auto-suggest switch", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", signupDeadlineHours: 2, autoSuggest: true }) });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({
                signupDeadline: startTimeOf("01-10-2026", "18:00"), autoSuggest: true,
            });
        });

        it("refuses a composition that does not fit the size", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", size: 10, composition: { tank: 2, healer: 3, melee: { min: 4, max: 3 } } }) });
            expect(result.error).toMatchObject({ code: "invalid_plan", message: expect.stringMatching(/Nahkampf/) });
            const tooMany = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", size: 10, composition: { tank: 5, healer: 6 } }) });
            expect(tooMany.error.code).toBe("invalid_plan");
            expect(eventStore.listEvents("g1")).toEqual([]);
        });

        it("creates a new channel in the chosen category, named by the category's schema", async () => {
            channelArchiveStore.saveCategorySchema("g1", "cat-eh", { schema: "{raid}-{dd}-{mm}", raid: "t5" });
            createFromTemplate.mockResolvedValue({ id: "c9", name: "ssc-tk-01-10" });
            // the web dialog leaves the name to the server when nobody typed one
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: { name: "", categoryId: "cat-eh" }, raidTemplateId: "tpl-t5" }) });
            expect(createFromTemplate).toHaveBeenCalledWith("g1", { name: "ssc-tk-01-10", parentId: "cat-eh", templateChannelId: "" });
            expect(eventStore.getEvent(result.body.id)).toMatchObject({ channelId: "c9", channelName: "ssc-tk-01-10", categoryId: "cat-eh", categoryName: "EventHelper-Raids" });
            // without instances the schema's stored raid fills {raid}; without a schema the default applies
            expect(schemaChannelName("g1", "cat-eh", "2026-10-01", [])).toBe("t5-01-10");
            expect(schemaChannelName("g1", "cat-other", "2026-10-01", ["kara"])).toBe("do-01-10-kara");
        });

        it("names and designs a new channel like the category's previous event channel, sorted in behind it (#285)", async () => {
            discord.listAllChannels.mockReturnValue([
                { id: "prev", name: "🔥・do-24-09-ssc-tk", parentId: "cat-eh" },
                { id: "older", name: "🔥・do-17-09-ssc-tk", parentId: "cat-eh" },
            ]);
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat-eh", events: [
                { id: "eh-a", title: "SSC", instanceIds: ["ssc", "tk"], channelId: "prev", startTime: startTimeOf("24-09-2026", "19:30") },
                { id: "eh-b", title: "SSC", instanceIds: ["ssc", "tk"], channelId: "older", startTime: startTimeOf("17-09-2026", "19:30") },
            ] }] });
            createFromTemplate.mockImplementation(async (guildId, { name }) => ({ id: "c9", name }));
            try {
                const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: { name: "", categoryId: "cat-eh" }, raidTemplateId: "tpl-t5" }) });
                expect(createFromTemplate).toHaveBeenCalledWith("g1", {
                    name: "🔥・do-01-10-ssc-tk", parentId: "cat-eh", templateChannelId: "prev", afterChannelId: "prev",
                });
                expect(result.body.channelNaming).toMatchObject({
                    name: "🔥・do-01-10-ssc-tk", source: "previous", label: "abgeleitet aus #🔥・do-24-09-ssc-tk",
                    design: "Rechte und Thema von #🔥・do-24-09-ssc-tk",
                });
                // both Thursdays: only the date changes, and the line says exactly that
                expect(result.body.channelNaming.detail).toBe("Datum 24-09 → 01-10");
            } finally {
                discord.listAllChannels.mockReturnValue([]);
                raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            }
        });

        it("keeps a name the dialog sends and the schema's template channel, refuses a new channel with neither name nor category", async () => {
            channelArchiveStore.saveCategorySchema("g1", "cat-eh", { schema: "{raid}", templateChannelId: "c2" });
            createFromTemplate.mockResolvedValue({ id: "c9", name: "mein-kanal" });
            await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: { name: "Mein Kanal", categoryId: "cat-eh" } }) });
            expect(createFromTemplate).toHaveBeenCalledWith("g1", { name: "mein-kanal", parentId: "cat-eh", templateChannelId: "c2" });
            const missing = await createEvent({ guildId: "g1", user, body: body({ channelId: "", newChannel: {} }) });
            expect(missing.error.code).toBe("no_channel");
            expect(eventStore.listEvents("g1")).toHaveLength(1);
        });

        it("lets the dialog pick the signup source against the category's default", async () => {
            // c2 sits in an EventHelper category, the dialog says Raid-Helper
            mockCreateEvent.mockResolvedValue({ id: "rh-2" });
            const rh = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", signupSource: "raidhelper", templateId: "", raidTemplateId: "tpl-t5" }) });
            expect(rh.body).toEqual({ id: "rh-2", channelId: "c2" });
            // the raid template's linked Raid-Helper template stands in for the missing id
            expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ templateId: "rh-9" }));
            // c1 is a Raid-Helper category, the dialog says EventHelper
            const own = await createEvent({ guildId: "g1", user, body: body({ channelId: "c1", signupSource: "eventhelper" }) });
            expect(own.body.source).toBe("eventhelper");
        });
    });

    describe("Ankündigung beim Anlegen (#306)", () => {
        it("kündigt ein neues eigenes Event an und meldet das Ergebnis zurück", async () => {
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
            expect(announceEvent).toHaveBeenCalledWith(result.body.id, { want: undefined });
            expect(result.body.announced).toBe(true);
            expect(result.body.announceError).toBeNull();
        });

        it("reicht den Schalter des Dialogs durch", async () => {
            await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", announce: true }) });
            expect(announceEvent).toHaveBeenCalledWith(expect.any(String), { want: true });
            await createEvent({ guildId: "g1", user, body: body({ channelId: "c2", announce: false }) });
            expect(announceEvent).toHaveBeenLastCalledWith(expect.any(String), { want: false });
        });

        it("lässt das Event stehen, wenn die Ankündigung nicht rausgeht", async () => {
            announceEvent.mockResolvedValueOnce({ announced: false, error: "Kein Ping-Kanal." });
            const result = await createEvent({ guildId: "g1", user, body: body({ channelId: "c2" }) });
            expect(result.status).toBe(201);
            expect(result.body.announceError).toBe("Kein Ping-Kanal.");
            expect(eventStore.getEvent(result.body.id)).toBeTruthy();
        });
    });

    describe("updateEvent (PATCH /api/raids)", () => {
        const own = () => eventStore.createEvent({
            guildId: "g1", channelId: "c2", categoryId: "cat-eh", title: "Kara", startTime: startTimeOf("01-10-2026", "20:00"),
            instanceIds: ["kara"], raidTemplateId: "tpl-x",
        }).event;

        it("changes date, plan and text of an own event and refreshes its message", async () => {
            const ev = own();
            const result = await updateEvent({ guildId: "g1", body: {
                id: ev.id, title: "Kara Freitag", date: "2026-10-02", time: "19:30", size: 10,
                composition: { tank: 2, healer: 2, ranged: { min: 2, max: 4 } }, requiredBuffs: ["kings"],
            } });
            expect(result.status).toBe(200);
            expect(eventStore.getEvent(ev.id)).toMatchObject({
                title: "Kara Freitag", startTime: startTimeOf("02-10-2026", "19:30"), channelId: "c2", raidTemplateId: "tpl-x",
                composition: { tank: 2, healer: 2, ranged: 2 }, compositionMax: { ranged: 4 }, requiredBuffs: ["kings"],
            });
            expect(refreshEventMessage).toHaveBeenCalledWith(ev.id);
            expect(scheduleOverviewSync).toHaveBeenCalledWith();
        });

        it("counts the deadline hours from the (new) Berlin start and stores the switches", async () => {
            const ev = own();
            await updateEvent({ guildId: "g1", body: { id: ev.id, date: "2026-10-03", signupDeadlineHours: 24, autoSuggest: true, fairness: true } });
            expect(eventStore.getEvent(ev.id)).toMatchObject({
                signupDeadline: startTimeOf("02-10-2026", "20:00"), autoSuggest: true, fairness: true,
            });
            await updateEvent({ guildId: "g1", body: { id: ev.id, signupDeadlineHours: 0 } });
            expect(eventStore.getEvent(ev.id).signupDeadline).toBe(0);
        });

        it("keeps the time when only the date changes", async () => {
            const ev = own();
            await updateEvent({ guildId: "g1", body: { id: ev.id, date: "2026-10-08" } });
            expect(eventStore.getEvent(ev.id).startTime).toBe(startTimeOf("08-10-2026", "20:00"));
        });

        it("refuses Raid-Helper events, unknown or foreign events and a bad plan", async () => {
            expect((await updateEvent({ guildId: "g1", body: { id: "123456" } })).error.code).toBe("not_own_event");
            expect((await updateEvent({ guildId: "g1", body: { id: "eh-missing" } })).error.code).toBe("not_found");
            const ev = own();
            expect((await updateEvent({ guildId: "g2", body: { id: ev.id, title: "x" } })).error.code).toBe("not_found");
            expect((await updateEvent({ guildId: "g1", body: { id: ev.id, size: 10, composition: { tank: 6, healer: 6 } } })).error.code).toBe("invalid_plan");
            expect(refreshEventMessage).not.toHaveBeenCalled();
        });

        it("logs who edited what on the event, and refuses a cancelled event (#288)", async () => {
            const ev = own();
            await updateEvent({ guildId: "g1", body: { id: ev.id, title: "Kara Freitag", size: 10, time: "20:00" }, user: { id: "orga", name: "Orga" } });
            // only the fields that really changed: the time was sent unchanged
            expect(eventStore.getEvent(ev.id).log).toEqual([
                expect.objectContaining({ action: "edit", by: "orga", byName: "Orga", detail: "Titel" }),
            ]);
            eventStore.setEventState(ev.id, { status: "cancelled" });
            expect((await updateEvent({ guildId: "g1", body: { id: ev.id, title: "x" } })).error.code).toBe("cancelled");
        });

        it("still saves when the message cannot be refreshed, and says so", async () => {
            refreshEventMessage.mockRejectedValueOnce(new Error("Bot offline"));
            const ev = own();
            const result = await updateEvent({ guildId: "g1", body: { id: ev.id, title: "Neu" } });
            expect(result.body).toMatchObject({ messageError: "Bot offline" });
            expect(eventStore.getEvent(ev.id).title).toBe("Neu");
        });
    });
});
