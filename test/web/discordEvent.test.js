// Das Discord-Event zu einem eigenen Event (#305): Aufbau (Sprachkanal vs. External),
// Anlegen/Ändern/Absagen/Löschen mit einem Fake-Client, der 404-Fall, Schalter aus,
// fehlendes Recht — und dass nichts davon je wirft.
const mockEvents = new Map();
const clone = (x) => JSON.parse(JSON.stringify(x));
jest.mock("../../src/web/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventDiscordEvent: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.discordEvent = patch ? { ...(e.discordEvent || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return JSON.parse(JSON.stringify(e));
    }),
}));
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../src/web/discord", () => ({ getGuild: jest.fn(), botCanManageEvents: jest.fn(() => true) }));

const { ChannelType, GuildScheduledEventEntityType, GuildScheduledEventStatus } = require("discord.js");
const discord = require("../../src/web/discord");
const eventStore = require("../../src/web/eventStore");
const de = require("../../src/web/discordEvent");

const START = 2000000000;
const event = (over = {}) => ({
    id: "eh-1", guildId: "g1", categoryId: "cat1", channelId: "c1", channelName: "do-24-09-bt",
    title: "Hyjal + BT", description: "Treffpunkt Eingang", startTime: START, durationMinutes: 180,
    voiceChannelId: "", status: "active", cancel: null, message: { channelId: "c1", messageId: "m1" },
    discordEvent: null, ...over,
});

/** A guild whose scheduled events are all in memory; every call is recorded. */
function fakeGuild({ channels = { v1: ChannelType.GuildVoice, c1: ChannelType.GuildText }, createError = null, fetchError = null } = {}) {
    const stored = new Map();
    let made = 0;
    const cache = new Map(Object.entries(channels).map(([id, type]) => [id, { id, type }]));
    const wrap = (id, data) => ({
        id,
        data,
        status: GuildScheduledEventStatus.Scheduled,
        edit: jest.fn(function edit(patch) {
            Object.assign(this.data, patch);
            return Promise.resolve(this);
        }),
        setStatus: jest.fn(function setStatus(status) {
            this.status = status;
            return Promise.resolve(this);
        }),
        delete: jest.fn(() => {
            stored.delete(id);
            return Promise.resolve();
        }),
    });
    const guild = {
        id: "g1",
        channels: { cache },
        scheduledEvents: {
            create: jest.fn((payload) => {
                if (createError) return Promise.reject(createError);
                made += 1;
                const row = wrap(`d${made}`, { ...payload });
                stored.set(row.id, row);
                return Promise.resolve(row);
            }),
            fetch: jest.fn((id) => {
                if (fetchError) return Promise.reject(fetchError);
                const row = stored.get(String(id));
                if (!row) return Promise.reject(Object.assign(new Error("Unknown Guild Scheduled Event"), { code: 10070 }));
                return Promise.resolve(row);
            }),
        },
    };
    discord.getGuild.mockReturnValue(guild);
    return { guild, stored };
}

const put = (ev) => {
    mockEvents.set(ev.id, clone(ev));
    return ev.id;
};

describe("web/discordEvent", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEvents.clear();
        mockConfig = { categoryDiscordEvent: { cat1: true } };
        discord.botCanManageEvents.mockReturnValue(true);
    });

    describe("buildScheduledEvent", () => {
        it("is External with the signup message as its place, and says the signup is not here", () => {
            const payload = de.buildScheduledEvent(event());
            expect(payload).toMatchObject({
                name: "Hyjal + BT",
                entityType: GuildScheduledEventEntityType.External,
                entityMetadata: { location: "https://discord.com/channels/g1/c1/m1" },
            });
            expect(payload.description).toContain("Treffpunkt Eingang");
            expect(payload.description).toContain(de.SIGNUP_NOTE);
            // Ende = Start + Dauer
            expect(payload.scheduledStartTime).toBe(new Date(START * 1000).toISOString());
            expect(payload.scheduledEndTime).toBe(new Date((START + 180 * 60) * 1000).toISOString());
        });

        it("takes the duration of the event, and the store's default without one", () => {
            expect(de.buildScheduledEvent(event({ durationMinutes: 300 })).scheduledEndTime)
                .toBe(new Date((START + 300 * 60) * 1000).toISOString());
            expect(de.buildScheduledEvent(event({ durationMinutes: undefined })).scheduledEndTime)
                .toBe(new Date((START + 180 * 60) * 1000).toISOString());
        });

        it("is a Voice event when the raid has a voice channel", () => {
            const payload = de.buildScheduledEvent(event({ voiceChannelId: "v1" }), { voiceChannelId: "v1" });
            expect(payload.entityType).toBe(GuildScheduledEventEntityType.Voice);
            expect(payload.channel).toBe("v1");
            expect(payload.entityMetadata).toBeUndefined();
        });

        it("names the cancellation and its reason", () => {
            const payload = de.buildScheduledEvent(event({ status: "cancelled", cancel: { reason: "zu wenige Heiler" } }));
            expect(payload.description).toContain("Abgesagt: zu wenige Heiler");
        });

        it("keeps Discord's limits", () => {
            const payload = de.buildScheduledEvent(event({ title: "T".repeat(300), description: "D".repeat(2000) }));
            expect(payload.name.length).toBeLessThanOrEqual(de.LIMITS.name);
            expect(payload.description.length).toBeLessThanOrEqual(de.LIMITS.description);
        });
    });

    describe("voiceChannelFor", () => {
        it("takes a voice channel, refuses a text channel and an unknown id", () => {
            const { guild } = fakeGuild();
            expect(de.voiceChannelFor(guild, event({ voiceChannelId: "v1" }))).toBe("v1");
            expect(de.voiceChannelFor(guild, event({ voiceChannelId: "c1" }))).toBe("");
            expect(de.voiceChannelFor(guild, event({ voiceChannelId: "gone" }))).toBe("");
            expect(de.voiceChannelFor(guild, event())).toBe("");
        });
    });

    describe("createForEvent", () => {
        it("creates one and remembers it — with the voice channel as its place", async () => {
            const { stored } = fakeGuild();
            const id = put(event({ voiceChannelId: "v1" }));
            const result = await de.createForEvent(id);
            expect(result.id).toBe("d1");
            expect(stored.get("d1").data.entityType).toBe(GuildScheduledEventEntityType.Voice);
            expect(eventStore.setEventDiscordEvent).toHaveBeenCalledWith(id, expect.objectContaining({ id: "d1", guildId: "g1", error: "" }));
        });

        it("does nothing for a category without the switch", async () => {
            const { guild } = fakeGuild();
            mockConfig = { categoryDiscordEvent: {} };
            const id = put(event());
            expect(await de.createForEvent(id)).toEqual({ skipped: "disabled" });
            expect(guild.scheduledEvents.create).not.toHaveBeenCalled();
        });

        it("skips a cancelled event, one that already has one, and a raid that is over", async () => {
            fakeGuild();
            expect((await de.createForEvent(put(event({ id: "eh-c", status: "cancelled" })))).skipped).toBe("cancelled");
            expect((await de.createForEvent(put(event({ id: "eh-e", discordEvent: { id: "d9" } })))).skipped).toBe("exists");
            expect((await de.createForEvent(put(event({ id: "eh-p" })), { now: (START + 10 * 3600) * 1000 })).skipped).toBe("past");
        });

        it("warns instead of failing when the right is missing, and notes it on the event", async () => {
            const { guild } = fakeGuild();
            discord.botCanManageEvents.mockReturnValue(false);
            const result = await de.createForEvent(put(event()));
            expect(result.warning).toBe(de.MISSING_RIGHT);
            expect(guild.scheduledEvents.create).not.toHaveBeenCalled();
            expect(eventStore.setEventDiscordEvent).toHaveBeenCalledWith("eh-1", expect.objectContaining({ error: de.MISSING_RIGHT }));
            expect(de.warningOf(result)).toBe(`Discord-Event: ${de.MISSING_RIGHT}`);
        });

        it("tries anyway while the right cannot be known, and turns Discord's refusal into one sentence", async () => {
            const { guild } = fakeGuild({ createError: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
            discord.botCanManageEvents.mockReturnValue(null);
            const result = await de.createForEvent(put(event()));
            expect(guild.scheduledEvents.create).toHaveBeenCalled();
            expect(result.warning).toBe(de.MISSING_RIGHT);
        });

        it("says so instead of throwing while the bot is offline", async () => {
            discord.getGuild.mockReturnValue(null);
            expect(await de.createForEvent(put(event()))).toEqual({ skipped: "offline" });
        });
    });

    describe("syncForEvent", () => {
        it("edits title, time and place of the existing one", async () => {
            const { stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            mockEvents.get(id).title = "Sunwell";
            mockEvents.get(id).startTime = START + 86400;
            mockEvents.get(id).voiceChannelId = "v1";
            const result = await de.syncForEvent(id);
            expect(result.id).toBe("d1");
            const row = stored.get("d1");
            expect(row.edit).toHaveBeenCalled();
            expect(row.data.name).toBe("Sunwell");
            expect(row.data.scheduledStartTime).toBe(new Date((START + 86400) * 1000).toISOString());
            expect(row.data.entityType).toBe(GuildScheduledEventEntityType.Voice);
        });

        it("creates one when there is none yet", async () => {
            const { guild } = fakeGuild();
            const result = await de.syncForEvent(put(event()));
            expect(guild.scheduledEvents.create).toHaveBeenCalledTimes(1);
            expect(result.id).toBe("d1");
        });

        it("forgets a Discord event deleted by hand (404) and makes a new one", async () => {
            const { guild } = fakeGuild();
            const id = put(event({ discordEvent: { id: "gone", guildId: "g1" } }));
            const result = await de.syncForEvent(id);
            expect(eventStore.setEventDiscordEvent).toHaveBeenCalledWith(id, null);
            expect(guild.scheduledEvents.create).toHaveBeenCalledTimes(1);
            expect(result.id).toBe("d1");
        });

        it("leaves a Discord event alone that is no longer scheduled", async () => {
            const { stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            stored.get("d1").status = GuildScheduledEventStatus.Completed;
            const result = await de.syncForEvent(id);
            expect(result.skipped).toBe("closed");
            expect(stored.get("d1").edit).not.toHaveBeenCalled();
        });
    });

    describe("cancelForEvent", () => {
        it("sets the status to Canceled and writes the reason into the description", async () => {
            const { stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            mockEvents.get(id).status = "cancelled";
            mockEvents.get(id).cancel = { reason: "zu wenige Heiler" };
            const result = await de.cancelForEvent(id);
            expect(result.cancelled).toBe(true);
            expect(stored.get("d1").status).toBe(GuildScheduledEventStatus.Canceled);
            expect(stored.get("d1").data.description).toContain("zu wenige Heiler");
        });

        it("deletes it when Discord refuses the status change", async () => {
            const { stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            stored.get("d1").setStatus.mockRejectedValue(new Error("Invalid status transition"));
            const result = await de.cancelForEvent(id);
            expect(result).toMatchObject({ cancelled: true, deleted: true });
            expect(stored.has("d1")).toBe(false);
            expect(eventStore.setEventDiscordEvent).toHaveBeenLastCalledWith(id, null);
        });

        it("does nothing without one, and forgets one that is already gone", async () => {
            fakeGuild();
            expect(await de.cancelForEvent(put(event({ id: "eh-n" })))).toEqual({ skipped: "none" });
            const id = put(event({ id: "eh-g", discordEvent: { id: "gone" } }));
            expect(await de.cancelForEvent(id)).toEqual({ skipped: "gone" });
            expect(eventStore.setEventDiscordEvent).toHaveBeenCalledWith(id, null);
        });
    });

    describe("deleteForEvent", () => {
        it("deletes it and forgets it", async () => {
            const { stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            expect(await de.deleteForEvent(id)).toEqual({ deleted: true });
            expect(stored.has("d1")).toBe(false);
        });

        it("counts one that is already gone as deleted, and never writes with store: false", async () => {
            fakeGuild();
            const ev = event({ discordEvent: { id: "gone" } });
            put(ev);
            const result = await de.deleteForEvent(ev, { store: false });
            expect(result.skipped).toBe("gone");
            expect(eventStore.setEventDiscordEvent).not.toHaveBeenCalled();
        });

        it("reports any other error as a warning", async () => {
            fakeGuild({ fetchError: Object.assign(new Error("Server Error"), { code: 500 }) });
            const id = put(event({ discordEvent: { id: "d9" } }));
            const result = await de.deleteForEvent(id);
            expect(result.warning).toMatch(/Server Error/);
        });
    });

    describe("reopenForEvent", () => {
        it("drops the cancelled one and creates a new one", async () => {
            const { guild, stored } = fakeGuild();
            const id = put(event());
            await de.createForEvent(id);
            mockEvents.get(id).discordEvent = { id: "d1", guildId: "g1" };
            const result = await de.reopenForEvent(id);
            expect(stored.has("d1")).toBe(false);
            expect(guild.scheduledEvents.create).toHaveBeenCalledTimes(2);
            expect(result.id).toBe("d2");
        });
    });

    describe("enabledFor", () => {
        it("is off by default and on only for the switched category", () => {
            expect(de.enabledFor(event(), { categoryDiscordEvent: { cat1: true } })).toBe(true);
            expect(de.enabledFor(event(), {})).toBe(false);
            expect(de.enabledFor(event({ categoryId: "" }), { categoryDiscordEvent: { "": true } })).toBe(false);
        });
    });
});
