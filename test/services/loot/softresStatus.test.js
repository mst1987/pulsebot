// The softres card: who is expected, the match against softres.it, the card's
// options, posting/editing and the one job. softres.it, Discord and the stores
// are mocked — nothing here leaves the process.
jest.mock("../../../src/utils/loot/softres", () => {
    const actual = jest.requireActual("../../../src/utils/loot/softres");
    return { normalizeTitle: actual.normalizeTitle, nameOf: actual.nameOf, fetchRaid: jest.fn() };
});
jest.mock("../../../src/stores/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => null),
    listEventSoftres: jest.fn(() => []),
    markEventSoftresPosted: jest.fn(),
    setEventSoftresStatus: jest.fn(),
}));
jest.mock("../../../src/stores/eventStore", () => ({
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh-")),
    getEvent: jest.fn(() => null),
}));
jest.mock("../../../src/stores/raidhelperEventsStore", () => ({ readSnapshot: jest.fn(() => ({ events: [] })) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    getProfile: jest.fn(() => null),
    charactersOfVersion: jest.fn((profile, versionId) => ((profile && profile.characters) || []).filter((c) => !versionId || c.versionId === versionId)),
}));
jest.mock("../../../src/services/events/eventSources", () => ({ getStoredEvent: jest.fn(() => null) }));
jest.mock("../../../src/services/events/mainVersion", () => ({ versionOfEvent: jest.fn(() => "tbc") }));
jest.mock("../../../src/services/setup/setupCore", () => ({
    approvedSetupOf: (event) => (event && event.setup && event.setup.approved) || null,
}));
jest.mock("../../../src/services/events/embedLook", () => ({ embedColor: jest.fn(() => 0x123456) }));
jest.mock("../../../src/services/discord/discord", () => ({
    postLink: jest.fn(async (channelId) => ({ channelId, messageId: "m-new" })),
    editLink: jest.fn(async (channelId, messageId) => ({ channelId, messageId })),
}));
jest.mock("../../../src/services/discord/botLanguage", () => ({ eventLang: jest.fn(() => "de") }));

const softres = require("../../../src/utils/loot/softres");
const store = require("../../../src/stores/eventSoftresStore");
const eventStore = require("../../../src/stores/eventStore");
const { readSnapshot } = require("../../../src/stores/raidhelperEventsStore");
const { getProfile } = require("../../../src/stores/raiderProfileStore");
const { getStoredEvent } = require("../../../src/services/events/eventSources");
const { eventLang } = require("../../../src/services/discord/botLanguage");
const discord = require("../../../src/services/discord/discord");
const s = require("../../../src/services/loot/softresStatus");

const signup = (userId, name, extra = {}) => ({ userId, name, ...extra });
const reserve = (name, discordId = "") => ({ name, discordId, items: [] });
const raid = (reserves, extra = {}) => ({ raidId: "r1", reserves, hideReserves: false, reserveLimit: 2, instances: ["kara"], isManager: false, ...extra });
const SR = { eventId: "eh-1", raidId: "r1", url: "https://softres.it/raid/r1", instances: ["kara"], amount: 1 };

beforeEach(() => {
    jest.clearAllMocks();
    eventLang.mockReturnValue("de");
    // clearAllMocks keeps return values a test set — reset the lookups each test leans on.
    getStoredEvent.mockReset().mockReturnValue(null);
    eventStore.getEvent.mockReset().mockReturnValue(null);
    readSnapshot.mockReset().mockReturnValue({ events: [] });
    getProfile.mockReset().mockReturnValue(null);
    store.getEventSoftres.mockReset().mockReturnValue(null);
    store.listEventSoftres.mockReset().mockReturnValue([]);
    softres.fetchRaid.mockReset();
});

describe("services/loot/softresStatus", () => {
    describe("nameKey", () => {
        it("ignores case, accents, spaces and the realm suffix", () => {
            expect(s.nameKey("Dévì-Thunderstrike")).toBe(s.nameKey("devi"));
            expect(s.nameKey(" Big Tank ")).toBe("bigtank");
            expect(s.nameKey("")).toBe("");
        });
    });

    describe("resolveEvent", () => {
        it("takes the stored event and, for own events, the raw one", () => {
            getStoredEvent.mockReturnValue({ id: "eh-1", title: "Kara" });
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: {} });
            expect(s.resolveEvent("eh-1")).toEqual({ event: { id: "eh-1", title: "Kara" }, raw: { id: "eh-1", setup: {} } });
        });

        it("falls back to the synced Raid-Helper list, never Raid-Helper itself", () => {
            readSnapshot.mockReturnValue({ events: [{ id: "123", title: "Gruul" }] });
            expect(s.resolveEvent("123")).toEqual({ event: { source: "raidhelper", id: "123", title: "Gruul" }, raw: null });
            expect(eventStore.getEvent).not.toHaveBeenCalled();
            expect(s.resolveEvent("")).toEqual({ event: null, raw: null });
            expect(s.resolveEvent("999").event).toBeNull();
        });
    });

    describe("expectedRaiders", () => {
        it("takes the approved setup's slots when there is one", () => {
            const raw = { setup: { approved: { groups: [{ slots: [signup("u1", "Tank"), signup("u2", "Heal"), { name: "Leer" }] }] } } };
            const event = { signUps: [signup("u9", "Someone")] };
            expect(s.expectedRaiders(event, raw).map((r) => r.userId)).toEqual(["u1", "u2"]);
        });

        it("else every active signup — no sign-off, bench or absence — one per raider", () => {
            const event = {
                signUps: [
                    signup("u1", "Alpha"), signup("u1", "AlphaTwo"), signup("u2", "Beta", { status: "tentative" }),
                    signup("u3", "Gamma", { className: "Absence" }), signup("u4", "Delta", { status: "bench" }),
                    signup("u5", "Eps", { status: "declined" }),
                ],
            };
            const out = s.expectedRaiders(event, null);
            expect(out.map((r) => r.userId)).toEqual(["u1", "u2"]);
            expect(out[0]).toMatchObject({ label: "Alpha", names: ["Alpha", "AlphaTwo"] });
        });

        it("adds the profile's characters of the event's version", () => {
            getProfile.mockReturnValue({ characters: [{ name: "Twink", versionId: "tbc" }, { name: "Forever", versionId: "forever" }] });
            const [r] = s.expectedRaiders({ signUps: [signup("u1", "Main", { characters: [{ name: "Alt" }, "Alt2"] })] }, null);
            expect(r.names).toEqual(["Main", "Alt", "Alt2", "Twink"]);
        });
    });

    describe("matchReserves", () => {
        const expected = [
            { userId: "u1", names: ["Alpha"], label: "Alpha" },
            { userId: "u2", names: ["Beta", "BetaAlt"], label: "Beta" },
            { userId: "u3", names: ["Gamma"], label: "Gamma" },
        ];

        it("matches by Discord id first, then by any character name", () => {
            const { filled, missing } = s.matchReserves(expected, [reserve("Whatever", "u1"), reserve("bétaalt")]);
            expect(filled.map((r) => r.userId)).toEqual(["u1", "u2"]);
            expect(missing.map((r) => r.userId)).toEqual(["u3"]);
        });

        it("counts a reserve once only", () => {
            const twins = [{ userId: "a", names: ["Same"] }, { userId: "b", names: ["Same"] }];
            expect(s.matchReserves(twins, [reserve("Same")]).filled).toHaveLength(1);
        });
    });

    describe("readStatus", () => {
        const event = { id: "eh-1", signUps: [signup("u1", "Alpha"), signup("u2", "Beta"), signup("u3", "Gamma")] };

        it("counts who entered and lists the missing", async () => {
            softres.fetchRaid.mockResolvedValue(raid([reserve("alpha"), reserve("x", "u2")]));
            const st = await s.readStatus("eh-1", { event, raw: null, sr: SR });
            expect(softres.fetchRaid).toHaveBeenCalledWith("r1", undefined);
            expect(st).toMatchObject({ ok: true, filled: 2, expected: 3, missing: [{ userId: "u3", label: "Gamma" }], missingKey: "u3", reserveLimit: 2 });
            expect(typeof st.checkedAt).toBe("number");
        });

        it("hands the admin token on and counts hidden reserves when it makes the bot a manager", async () => {
            softres.fetchRaid.mockResolvedValue(raid([reserve("Alpha")], { hideReserves: true, isManager: true }));
            const st = await s.readStatus("eh-1", { event, raw: null, sr: { ...SR, token: "t" } });
            expect(softres.fetchRaid).toHaveBeenCalledWith("r1", "t");
            expect(st.ok).toBe(true);
        });

        it("leaves the count out: no list, hidden reserves, softres.it down, nobody expected", async () => {
            expect(await s.readStatus("eh-1", { event, sr: null })).toMatchObject({ ok: false, reason: "no_softres" });
            softres.fetchRaid.mockResolvedValue(raid([], { hideReserves: true }));
            expect(await s.readStatus("eh-1", { event, raw: null, sr: SR })).toMatchObject({ ok: false, reason: "hidden" });
            softres.fetchRaid.mockRejectedValue(new Error("HTTP 500"));
            expect(await s.readStatus("eh-1", { event, raw: null, sr: SR })).toMatchObject({ ok: false, reason: "fetch_failed" });
            softres.fetchRaid.mockResolvedValue(raid([]));
            expect(await s.readStatus("eh-1", { event: { signUps: [] }, raw: null, sr: SR })).toMatchObject({ ok: false, reason: "nobody_expected" });
        });
    });

    describe("softresCardOpts", () => {
        const event = { id: "eh-1", title: "Kara Do", startTime: 1800000000 };
        const ok = { ok: true, filled: 14, expected: 25, reserveLimit: 2, instances: ["kara", "gruul"], checkedAt: 1799990000 };

        it("is the softres card: icon, instances, start, SR per player, entered, two buttons, as-of", () => {
            const o = s.softresCardOpts(event, SR, ok);
            expect(o).toMatchObject({ url: SR.url, kicker: "Kara Do", title: "Softres", thumbnail: s.SOFTRES_ICON, label: "Softres öffnen", color: 0x123456 });
            expect(o.lines).toEqual([`${softres.nameOf("kara")} · ${softres.nameOf("gruul")}`]);
            expect(o.facts).toEqual([
                ["Start", "<t:1800000000:d> <t:1800000000:t> · <t:1800000000:R>"],
                ["SR je Spieler", "2"],
                ["Eingetragen", "14 / 25"],
            ]);
            expect(o.buttons.map((b) => b.toJSON())).toEqual([expect.objectContaining({ custom_id: "softres-missing:eh-1", label: "Wer fehlt?" })]);
            expect(o.note).toBe("Zuletzt geändert <t:1799990000:R>");
        });

        it("speaks the event's language", () => {
            eventLang.mockReturnValue("en");
            const o = s.softresCardOpts(event, SR, ok);
            expect(o.label).toBe("Open Softres");
            expect(o.facts[2]).toEqual(["Entered", "14 / 25"]);
        });

        it("drops the count and the button without a count, the stored instances and amount stand in", () => {
            const o = s.softresCardOpts(event, SR, { ok: false, reason: "hidden", checkedAt: 0 });
            expect(o.facts.map((f) => f[0])).toEqual(["Start", "SR je Spieler"]);
            expect(o.facts[1][1]).toBe("1");
            expect(o.lines).toEqual([softres.nameOf("kara")]);
            expect(o.buttons).toEqual([]);
            expect(o.note).toBe("");
        });
    });

    describe("postSoftresCard", () => {
        const event = { id: "eh-1", title: "Kara", channelId: "chan1", signUps: [signup("u1", "Alpha")] };

        it("reads fresh, posts a new card and remembers message and count", async () => {
            store.getEventSoftres.mockReturnValue(SR);
            softres.fetchRaid.mockResolvedValue(raid([reserve("Alpha")]));
            const r = await s.postSoftresCard({ eventId: "eh-1", event, message: "Bitte" });
            expect(r.edited).toBe(false);
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.objectContaining({ title: "Softres", message: "Bitte" }));
            expect(store.markEventSoftresPosted).toHaveBeenCalledWith("eh-1", { channelId: "chan1", messageId: "m-new", message: "Bitte" });
            expect(store.setEventSoftresStatus).toHaveBeenCalledWith("eh-1", expect.objectContaining({ ok: true, filled: 1, expected: 1, missingKey: "" }));
        });

        it("edits the posted card in place, and posts anew when it is gone", async () => {
            store.getEventSoftres.mockReturnValue({ ...SR, postedChannelId: "chan1", postedMessageId: "m1" });
            softres.fetchRaid.mockRejectedValue(new Error("down"));
            expect((await s.postSoftresCard({ eventId: "eh-1", event })).edited).toBe(true);
            expect(discord.editLink).toHaveBeenCalledWith("chan1", "m1", expect.any(Object));
            discord.editLink.mockRejectedValueOnce(new Error("Unknown Message"));
            await s.postSoftresCard({ eventId: "eh-1", event });
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.any(Object));
        });

        it("refuses without a list", async () => {
            store.getEventSoftres.mockReturnValue(null);
            await expect(s.postSoftresCard({ eventId: "eh-1", event })).rejects.toThrow(/keine Softres-Liste/);
        });
    });

    describe("refreshSoftresCard", () => {
        const posted = { ...SR, postedChannelId: "chan1", postedMessageId: "m1", postedMessage: "Text" };
        beforeEach(() => getStoredEvent.mockReturnValue({ id: "eh-1", title: "Kara", signUps: [signup("u1", "Alpha"), signup("u2", "Beta")] }));

        it("edits only when count or missing names changed", async () => {
            softres.fetchRaid.mockResolvedValue(raid([reserve("Alpha")]));
            store.getEventSoftres.mockReturnValue({ ...posted, status: { ok: true, filled: 1, expected: 2, missingKey: "u2" } });
            await s.refreshSoftresCard("eh-1");
            expect(discord.editLink).not.toHaveBeenCalled();
            store.getEventSoftres.mockReturnValue({ ...posted, status: { ok: true, filled: 0, expected: 2, missingKey: "u1|u2" } });
            await s.refreshSoftresCard("eh-1");
            expect(discord.editLink).toHaveBeenCalledWith("chan1", "m1", expect.objectContaining({ message: "Text" }));
            expect(store.setEventSoftresStatus).toHaveBeenCalledWith("eh-1", expect.objectContaining({ filled: 1, missingKey: "u2" }));
        });

        it("keeps the last count when softres.it is down, and takes a status already read", async () => {
            store.getEventSoftres.mockReturnValue({ ...posted, status: { ok: true, filled: 1, expected: 2, missingKey: "u2" } });
            softres.fetchRaid.mockRejectedValue(new Error("down"));
            expect(await s.refreshSoftresCard("eh-1")).toMatchObject({ reason: "fetch_failed" });
            expect(discord.editLink).not.toHaveBeenCalled();
            softres.fetchRaid.mockClear();
            await s.refreshSoftresCard("eh-1", { status: { ok: true, filled: 2, expected: 2, missingKey: "", checkedAt: 1 } });
            expect(softres.fetchRaid).not.toHaveBeenCalled();
            expect(discord.editLink).toHaveBeenCalledTimes(1);
        });

        it("does nothing without a posted card and never throws on a Discord error", async () => {
            store.getEventSoftres.mockReturnValue(SR);
            expect(await s.refreshSoftresCard("eh-1")).toBeNull();
            store.getEventSoftres.mockReturnValue(posted);
            softres.fetchRaid.mockResolvedValue(raid([]));
            discord.editLink.mockRejectedValueOnce(new Error("Missing Access"));
            await expect(s.refreshSoftresCard("eh-1")).resolves.toMatchObject({ ok: true });
            expect(store.setEventSoftresStatus).not.toHaveBeenCalled();
        });
    });

    describe("the job", () => {
        const now = 1800000000;
        const card = (eventId) => ({ eventId, raidId: "r", url: "u", postedChannelId: "c", postedMessageId: "m" });

        it("takes the posted cards of raids from 2 h ago to 7 days ahead", () => {
            store.listEventSoftres.mockReturnValue([card("soon"), card("past"), card("far"), card("old"), { ...card("unposted"), postedMessageId: "" }]);
            const starts = { soon: now + 3600, past: now - 3600, far: now + 8 * 86400, old: now - 3 * 3600, unposted: now };
            getStoredEvent.mockImplementation((id) => ({ id, startTime: starts[id] }));
            expect(s.cardsInWindow(now).map((c) => c.eventId)).toEqual(["soon", "past"]);
        });

        it("sweeps the cards one by one and counts the edits", async () => {
            store.listEventSoftres.mockReturnValue([card("eh-a")]);
            store.getEventSoftres.mockReturnValue(card("eh-a"));
            getStoredEvent.mockReturnValue({ id: "eh-a", startTime: Math.floor(Date.now() / 1000) + 600, signUps: [signup("u1", "Alpha")] });
            softres.fetchRaid.mockResolvedValue(raid([]));
            expect(await s.sweep()).toBe(1);
            expect(discord.editLink).toHaveBeenCalledTimes(1);
        });

        it("starts once and stops again", () => {
            jest.useFakeTimers();
            try {
                const a = s.startSoftresStatus({ intervalMs: 1000, firstDelayMs: 10 });
                expect(s.startSoftresStatus()).toBe(a);
                s.stopSoftresStatus();
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                s.stopSoftresStatus();
                jest.useRealTimers();
            }
        });
    });
});
