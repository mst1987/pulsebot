jest.mock("../../src/web/discord", () => ({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
const mockListeners = [];
jest.mock("../../src/web/signupStore", () => ({
    onSignupsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
let mockState = {};
jest.mock("../../src/web/talkOverviewStore", () => ({
    getOverviewState: jest.fn(() => ({
        channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "", ...mockState,
    })),
    setOverviewState: jest.fn((patch) => { mockState = { ...mockState, ...patch }; return mockState; }),
}));

const discord = require("../../src/web/discord");
const { getConfig } = require("../../src/web/settingsStore");
const { loadEventGroups } = require("../../src/web/raidEventGroups");
const {
    buildOverviewMessage, formatStart, channelUrl, payloadHash, syncOverview, overviewStatus,
    scheduleOverviewSync, startTalkOverview, overviewLinks, currentPayload,
} = require("../../src/web/talkOverview");

const NOW = Date.UTC(2026, 8, 16, 12, 0); // Wed 16.09.2026 14:00 Berlin
const sec = (y, m, d, h, min) => Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);

const ev = (over = {}) => ({
    id: "e1", source: "raidhelper", title: "SSC + TK", startTime: sec(2026, 9, 17, 17, 30),
    channelId: "c1", channelName: "mi-17-09-ssc-tk", signUps: [], ...over,
});
const signed = (n, status = "signed") => Array.from({ length: n }, (_, i) => ({ userId: String(i), specName: "Arcane", status }));

const opts = { eventGuildId: "111", eventGuildName: "Pulse Events", baseUrl: "https://eh.example/", now: NOW };

describe("web/talkOverview — buildOverviewMessage", () => {
    it("formats the start in Berlin time with a German weekday", () => {
        expect(formatStart(sec(2026, 9, 17, 17, 30))).toBe("Do 17.09. 19:30");
        expect(formatStart(0)).toBe("");
    });

    it("links into the event channel on the event server", () => {
        expect(channelUrl("111", "c1")).toBe("https://discord.com/channels/111/c1");
        expect(channelUrl("", "c1")).toBe("");
    });

    it("groups the upcoming raids by category, soonest category first, one line per raid", () => {
        const groups = [
            { categoryId: "k2", categoryName: "PuG", events: [ev({ id: "p1", title: "Karazhan", startTime: sec(2026, 9, 19, 18, 0), channelId: "c3", channelName: "sa-kara" })] },
            {
                categoryId: "k1", categoryName: "Donnerstag-Raid", events: [
                    ev({ id: "e2", source: "eventhelper", title: "Hyjal + BT", startTime: sec(2026, 9, 24, 17, 30), channelId: "c2", channelName: "do-hyjal", size: 25, signUps: [...signed(14), ...signed(2, "absence"), ...signed(1, "late")] }),
                    ev({ id: "e1", signUps: signed(9) }),
                    ev({ id: "old", title: "Vorbei", startTime: sec(2026, 9, 1, 17, 0) }),
                ],
            },
        ];
        const payload = buildOverviewMessage(groups, opts);
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Kommende Raids");
        expect(embed.description).toContain("**Pulse Events**");
        expect(embed.fields.map((f) => f.name)).toEqual(["Donnerstag-Raid", "PuG"]);
        expect(embed.fields[0].value.split("\n")).toEqual([
            "**SSC + TK** · Do 17.09. 19:30 · 👥 9 · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1) · Raid-Helper",
            "**Hyjal + BT** · Do 24.09. 19:30 · 👥 15/25 · [#do-hyjal](https://discord.com/channels/111/c2)",
        ]);
        expect(embed.fields[1].value).toContain("Karazhan");
        expect(JSON.stringify(payload)).not.toContain("Vorbei");
    });

    it("offers the next raids in the select and three link buttons", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev()] }], opts);
        const [selectRow, buttonRow] = payload.components;
        const select = selectRow.components[0];
        expect(select.custom_id).toBe("talk-signup");
        expect(select.placeholder).toBe("Einzelnen Raid wählen …");
        expect(select.options).toEqual([{ label: "SSC + TK", description: "Do 17.09. 19:30 · Mi", value: "e1" }]);
        expect(buttonRow.components.map((b) => [b.label, b.url, b.style])).toEqual([
            ["Web-Übersicht", "https://eh.example/raids", 5],
            ["Meine Anmeldungen", "https://eh.example/signups", 5],
            ["Mein Profil", "https://eh.example/profile", 5],
        ]);
        expect(overviewLinks("https://x.y").profile).toBe("https://x.y/profile");
    });

    it("puts „Für alle Raids anmelden“ and „Mehrere Raids wählen …“ above the select once an own event is listed (#293)", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev(), ev({ id: "eh-1", source: "eventhelper", title: "Kara" })] }], opts);
        const [signupRow, selectRow, linkRow] = payload.components;
        expect(signupRow.components.map((b) => [b.custom_id, b.label, b.style])).toEqual([
            ["talk-signup-all", "Für alle Raids anmelden", 1],
            ["talk-signup-multi", "Mehrere Raids wählen …", 2],
        ]);
        expect(selectRow.components[0].custom_id).toBe("talk-signup");
        expect(linkRow.components).toHaveLength(3);
        // only Raid-Helper events: nothing to sign up for here, so no buttons
        const rhOnly = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev()] }], opts);
        expect(JSON.stringify(rhOnly)).not.toContain("talk-signup-all");
    });

    it("keeps only the configured event categories when there are any", () => {
        const groups = [
            { categoryId: "k1", categoryName: "Raid", events: [ev()] },
            { categoryId: "k9", categoryName: "Sonstiges", events: [ev({ id: "x", title: "Gildentreffen" })] },
        ];
        const payload = buildOverviewMessage(groups, { ...opts, categoryIds: ["k1"] });
        expect(payload.embeds[0].fields.map((f) => f.name)).toEqual(["Raid"]);
    });

    it("says there is nothing planned and drops the select when no raid is upcoming", () => {
        const payload = buildOverviewMessage([], opts);
        expect(payload.embeds[0].description).toContain("keine Raids geplant");
        expect(payload.embeds[0].fields).toBeUndefined();
        expect(payload.components).toHaveLength(1);
        expect(payload.components[0].components).toHaveLength(3);
    });

    it("stays within Discord's limits: 25 fields, 1024 per field, 6000 per embed, 25 options", () => {
        const groups = Array.from({ length: 40 }, (_, g) => ({
            categoryId: `k${g}`,
            categoryName: `Kategorie ${g}`,
            events: Array.from({ length: 12 }, (_, i) => ev({
                id: `e${g}-${i}`, title: `Ein ziemlich langer Raidtitel Nummer ${g}-${i}`,
                startTime: sec(2026, 10, 1, 17, 0) + g * 3600 + i * 60, channelName: "ein-langer-kanalname-fuer-den-raid",
            })),
        }));
        const payload = buildOverviewMessage(groups, opts);
        const embed = payload.embeds[0];
        expect(embed.fields.length).toBeLessThanOrEqual(25);
        for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
        const total = embed.title.length + embed.description.length + (embed.footer ? embed.footer.text.length : 0)
            + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
        expect(total).toBeLessThanOrEqual(6000);
        expect(embed.fields[0].value).toMatch(/\+\d+ weitere$/);
        expect(embed.footer.text).toMatch(/^\+\d+ weitere Raids in der Web-Übersicht$/);
        const options = payload.components[0].components[0].options;
        expect(options).toHaveLength(25);
        // the next 25 raids, soonest first
        expect(options[0].value).toBe("e0-0");
    });

    it("hashes the same content the same way", () => {
        const a = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev()] }], opts);
        const b = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev()] }], opts);
        const c = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev({ signUps: signed(1) })] }], opts);
        expect(payloadHash(a)).toBe(payloadHash(b));
        expect(payloadHash(a)).not.toBe(payloadHash(c));
    });
});

function fakeDiscord({ fetchError, sendId = "m-new" } = {}) {
    const message = { id: "m1", edit: jest.fn(), delete: jest.fn() };
    const channel = {
        id: "ov",
        isTextBased: () => true,
        send: jest.fn(() => Promise.resolve({ id: sendId })),
        messages: { fetch: jest.fn(() => (fetchError ? Promise.reject(fetchError) : Promise.resolve(message))) },
    };
    discord.getClient.mockReturnValue({ channels: { fetch: jest.fn(() => Promise.resolve(channel)) } });
    return { channel, message };
}

const config = { guildId: "111", discordServers: { talkGuildId: "222", talkOverviewChannelId: "ov" } };

describe("web/talkOverview — syncOverview", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockState = {};
        getConfig.mockReturnValue(config);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "k", categoryName: "R", events: [ev({ startTime: Math.floor(Date.now() / 1000) + 86400 })] }], error: null });
    });

    it("does nothing without a talk server and overview channel", async () => {
        getConfig.mockReturnValue({ guildId: "111" });
        expect(await syncOverview()).toEqual({ status: "unconfigured" });
        expect(loadEventGroups).not.toHaveBeenCalled();
    });

    it("posts the overview the first time and remembers where", async () => {
        const { channel } = fakeDiscord();
        const result = await syncOverview({ now: 5 });
        expect(result).toEqual({ status: "posted", messageId: "m-new" });
        expect(loadEventGroups).toHaveBeenCalledWith("111");
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(mockState).toMatchObject({ channelId: "ov", messageId: "m-new", postedAt: 5, error: "" });
        expect(mockState.hash).toHaveLength(40);
    });

    it("edits when the content changed and skips when it did not", async () => {
        const { channel, message } = fakeDiscord();
        await syncOverview();
        mockState.messageId = "m1";
        expect(await syncOverview()).toEqual({ status: "unchanged", messageId: "m1" });
        expect(message.edit).not.toHaveBeenCalled();

        loadEventGroups.mockResolvedValue({ groups: [], error: null });
        expect(await syncOverview({ now: 9 })).toEqual({ status: "edited", messageId: "m1" });
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(mockState.editedAt).toBe(9);
    });

    it("posts anew when the message was deleted in Discord", async () => {
        mockState = { channelId: "ov", messageId: "gone", hash: "x" };
        const { channel } = fakeDiscord({ fetchError: Object.assign(new Error("Unknown Message"), { code: 10008 }) });
        expect(await syncOverview()).toEqual({ status: "posted", messageId: "m-new" });
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(mockState.messageId).toBe("m-new");
    });

    it("re-posts on request: the old message goes, a new one comes", async () => {
        mockState = { channelId: "ov", messageId: "m1", hash: "x" };
        const { channel, message } = fakeDiscord({ sendId: "m2" });
        expect(await syncOverview({ repost: true })).toEqual({ status: "posted", messageId: "m2" });
        expect(message.delete).toHaveBeenCalled();
        expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("leaves an existing message alone when the events cannot be loaded completely", async () => {
        mockState = { channelId: "ov", messageId: "m1", hash: "x" };
        const { channel, message } = fakeDiscord();
        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper down" });
        const result = await syncOverview();
        expect(result.status).toBe("error");
        expect(message.edit).not.toHaveBeenCalled();
        expect(channel.send).not.toHaveBeenCalled();
        expect(mockState.error).toContain("Raid-Helper down");
    });

    it("records other failures instead of throwing", async () => {
        discord.getClient.mockReturnValue(null);
        expect(await syncOverview()).toEqual({ status: "error", error: "Bot nicht verbunden." });
        expect(mockState.error).toBe("Bot nicht verbunden.");
    });

    it("reports the status with a jump link for the settings page", () => {
        mockState = { channelId: "ov", messageId: "m1", postedAt: 1, editedAt: 2, checkedAt: 3 };
        expect(overviewStatus(config)).toEqual({
            configured: true, channelId: "ov", messageId: "m1",
            messageUrl: "https://discord.com/channels/222/ov/m1", postedAt: 1, editedAt: 2, checkedAt: 3, error: "",
        });
        mockState.channelId = "other";
        expect(overviewStatus(config)).toMatchObject({ messageId: "", messageUrl: "", postedAt: 0 });
    });

    it("builds the dry-run payload from the event server's groups", async () => {
        const { payload, error } = await currentPayload({ config });
        expect(error).toBeNull();
        expect(payload.embeds[0].description).toContain("Pulse Events");
    });
});

describe("web/talkOverview — triggers", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockState = {};
        getConfig.mockReturnValue({ guildId: "111" }); // unconfigured: runs stay cheap
    });
    afterEach(() => jest.useRealTimers());

    it("collapses a burst of triggers into one sync", async () => {
        getConfig.mockClear();
        scheduleOverviewSync({ delayMs: 1000 });
        scheduleOverviewSync({ delayMs: 1000 });
        scheduleOverviewSync({ delayMs: 1000 });
        await jest.advanceTimersByTimeAsync(1500);
        expect(getConfig).toHaveBeenCalledTimes(1);
    });

    it("syncs after roster changes and on every sweep, and is idempotent", async () => {
        const stop = startTalkOverview({ intervalMs: 60000, debounceMs: 500, firstDelayMs: 100 });
        expect(startTalkOverview()).toBe(stop);
        await jest.advanceTimersByTimeAsync(150);
        expect(getConfig).toHaveBeenCalledTimes(1); // first run

        mockListeners.forEach((fn) => fn("eh-1"));
        mockListeners.forEach((fn) => fn("eh-1"));
        await jest.advanceTimersByTimeAsync(600);
        expect(getConfig).toHaveBeenCalledTimes(2); // one debounced run

        await jest.advanceTimersByTimeAsync(60000);
        expect(getConfig).toHaveBeenCalledTimes(3); // sweep
        stop();
        expect(mockListeners).toHaveLength(0);
    });
});
