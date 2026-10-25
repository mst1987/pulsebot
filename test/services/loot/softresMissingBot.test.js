// "Wer fehlt?" and "Jetzt pingen" under the softres card: the list for everyone
// (deferred before softres.it is read), the ping for the orga with cooldown and
// double-click guard. softresStatus, the store and Discord are mocked.
jest.mock("../../../src/services/loot/softresStatus", () => ({
    SOFTRES_MISSING_PREFIX: "softres-missing",
    SOFTRES_PING_PREFIX: "softres-ping",
    resolveEvent: jest.fn(),
    readStatus: jest.fn(),
    refreshSoftresCard: jest.fn(async () => null),
}));
jest.mock("../../../src/stores/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => ({ url: "https://softres.it/raid/r1" })),
}));
jest.mock("../../../src/services/discord/discord", () => ({ postMissingPing: jest.fn(async () => undefined) }));
jest.mock("../../../src/services/discord/botLanguage", () => ({ eventLang: jest.fn(() => "de") }));
jest.mock("../../../src/services/events/versionTag", () => ({ eventVersionTag: jest.fn(() => "") }));

const { MessageFlags } = require("discord.js");
const status = require("../../../src/services/loot/softresStatus");
const discord = require("../../../src/services/discord/discord");
const { eventLang } = require("../../../src/services/discord/botLanguage");
const { handleSoftresComponent, _internal } = require("../../../src/services/loot/softresMissingBot");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { asEmbed, cardButtons } = require("../../helpers/card");

const EVENT = { id: "eh-1", title: "Kara", startTime: 1800000000, channelId: "chan1", guildId: "g1" };
const missing = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, label: `Raider${i}` }));
const okStatus = (n, extra = {}) => ({ ok: true, filled: 3, expected: 3 + n, missing: missing(n), missingKey: "", checkedAt: 1799990000, ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    _internal.resetCooldowns();
    eventLang.mockReturnValue("de");
    status.resolveEvent.mockReturnValue({ event: EVENT, raw: null });
});

describe("services/loot/softresMissingBot", () => {
    describe("parseEventId / namesLine", () => {
        it("takes own and Raid-Helper ids only", () => {
            expect(_internal.parseEventId("softres-missing:eh-abc")).toBe("eh-abc");
            expect(_internal.parseEventId("softres-ping:12345")).toBe("12345");
            expect(_internal.parseEventId("softres-ping:../x")).toBe("");
            expect(_internal.parseEventId("")).toBe("");
        });

        it("cuts the names at MAX_NAMES and escapes markdown and mentions", () => {
            const line = _internal.namesLine(missing(_internal.MAX_NAMES + 3), "de");
            expect(line).toContain("Raider0 · Raider1");
            expect(line).toMatch(/\n\+3 weitere$/);
            expect(_internal.namesLine([{ userId: "u", label: "@everyone *x*" }], "de")).toBe("@​everyone \\*x\\*");
        });
    });

    describe("Wer fehlt?", () => {
        it("defers before reading softres.it, then answers with the list and refreshes the card", async () => {
            const order = [];
            const interaction = mockInteraction({ customId: "softres-missing:eh-1" });
            interaction.deferReply.mockImplementation(async () => { order.push("defer"); });
            status.readStatus.mockImplementation(async () => { order.push("read"); return okStatus(2); });
            await handleSoftresComponent(interaction, "g1");
            expect(order).toEqual(["defer", "read"]);
            expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
            expect(interaction.reply).not.toHaveBeenCalled();
            expect(status.refreshSoftresCard).toHaveBeenCalledWith("eh-1", { status: expect.objectContaining({ ok: true }) });
            const payload = interaction.editReply.mock.calls[0][0];
            expect(payload.flags & MessageFlags.Ephemeral).toBe(0);
            const card = asEmbed(payload);
            expect(card.title).toBe("2 fehlen noch");
            expect(card.text).toContain("Raider0 · Raider1");
            expect(card.footer.text).toBe("Pingen kann nur die Orga · Stand <t:1799990000:t>");
            expect(cardButtons(payload)).toEqual([expect.objectContaining({ custom_id: "softres-ping:eh-1", label: "Jetzt pingen" })]);
        });

        it("says one missing, everyone in, or why there is no count — in the event's language", async () => {
            const run = async (st) => {
                status.readStatus.mockResolvedValueOnce(st);
                const i = mockInteraction({ customId: "softres-missing:eh-1" });
                await handleSoftresComponent(i, "g1");
                return i.editReply.mock.calls[0][0];
            };
            expect(asEmbed(await run(okStatus(1))).title).toBe("1 fehlt noch");
            const all = await run(okStatus(0));
            expect(asEmbed(all).title).toBe("Alle haben ihre Softres eingetragen");
            expect(cardButtons(all)).toEqual([]);
            expect(asEmbed(await run({ ok: false, reason: "hidden" })).title).toBe("Kein Zähler verfügbar");
            eventLang.mockReturnValue("en");
            const en = asEmbed(await run({ ok: false, reason: "fetch_failed" }));
            expect(en.title).toBe("No count available");
            expect(en.text).toContain("softres.it cannot be reached");
        });

        it("refuses an unknown event or one of another server with a reply", async () => {
            status.resolveEvent.mockReturnValue({ event: null });
            const i = mockInteraction({ customId: "softres-missing:eh-1" });
            await handleSoftresComponent(i, "g1");
            expect(i.reply).toHaveBeenCalledTimes(1);
            expect(asEmbed(i.reply.mock.calls[0][0]).title).toBe("Geht gerade nicht");
            status.resolveEvent.mockReturnValue({ event: EVENT });
            const other = mockInteraction({ customId: "softres-missing:eh-1" });
            await handleSoftresComponent(other, "g2");
            expect(other.reply).toHaveBeenCalledTimes(1);
            expect(status.readStatus).not.toHaveBeenCalled();
        });
    });

    describe("Jetzt pingen", () => {
        const click = () => mockInteraction({ customId: "softres-ping:eh-1" });

        it("takes the buttons away first, reads fresh and pings the missing in the event channel", async () => {
            status.readStatus.mockResolvedValue(okStatus(2));
            const i = click();
            await handleSoftresComponent(i, "g1");
            expect(asEmbed(i.update.mock.calls[0][0]).title).toBe("Pinge die Fehlenden …");
            expect(cardButtons(i.update.mock.calls[0][0])).toEqual([]);
            expect(discord.postMissingPing).toHaveBeenCalledWith("chan1", ["u0", "u1"], "Bitte Softres eintragen: https://softres.it/raid/r1");
            expect(status.refreshSoftresCard).toHaveBeenCalled();
            const done = asEmbed(i.editReply.mock.calls[0][0]);
            expect(done.title).toBe("2 Raider gepingt");
            expect(done.text).toContain("<#chan1>");
        });

        it("pings in English for an English event", async () => {
            eventLang.mockReturnValue("en");
            status.readStatus.mockResolvedValue(okStatus(1));
            const i = click();
            await handleSoftresComponent(i, "g1");
            expect(discord.postMissingPing).toHaveBeenCalledWith("chan1", ["u0"], "Please enter your soft reserves: https://softres.it/raid/r1");
            expect(asEmbed(i.editReply.mock.calls[0][0]).title).toBe("1 Raider gepingt");
        });

        it("refuses a second ping within the cooldown and while one runs", async () => {
            status.readStatus.mockResolvedValue(okStatus(1));
            await handleSoftresComponent(click(), "g1");
            const again = click();
            await handleSoftresComponent(again, "g1");
            expect(asEmbed(again.update.mock.calls[0][0]).title).toBe("Schon gepingt");
            expect(discord.postMissingPing).toHaveBeenCalledTimes(1);

            _internal.resetCooldowns();
            _internal.inFlight.add("eh-1");
            const busy = click();
            await handleSoftresComponent(busy, "g1");
            expect(asEmbed(busy.update.mock.calls[0][0]).text).toContain("gerade");
        });

        it("pings again once the cooldown is over", async () => {
            status.readStatus.mockResolvedValue(okStatus(1));
            _internal.lastPing.set("eh-1", { at: Date.now() - _internal.COOLDOWN_MS - 1 });
            await handleSoftresComponent(click(), "g1");
            expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        });

        it("pings nobody without a count or when all are in, and reports a Discord error", async () => {
            status.readStatus.mockResolvedValueOnce({ ok: false, reason: "hidden" });
            const a = click();
            await handleSoftresComponent(a, "g1");
            expect(asEmbed(a.editReply.mock.calls[0][0]).title).toBe("Geht gerade nicht");
            status.readStatus.mockResolvedValueOnce(okStatus(0));
            const b = click();
            await handleSoftresComponent(b, "g1");
            expect(asEmbed(b.editReply.mock.calls[0][0]).title).toBe("Alle haben eingetragen");
            expect(discord.postMissingPing).not.toHaveBeenCalled();

            status.readStatus.mockResolvedValueOnce(okStatus(1));
            discord.postMissingPing.mockRejectedValueOnce(new Error("Missing Permissions"));
            const c = click();
            await handleSoftresComponent(c, "g1");
            expect(asEmbed(c.editReply.mock.calls[0][0]).text).toContain("Missing Permissions");
            expect(_internal.inFlight.size).toBe(0);
            expect(_internal.lastPing.size).toBe(0);
        });

        it("answers an unknown event by updating the list", async () => {
            status.resolveEvent.mockReturnValue({ event: null });
            const i = click();
            await handleSoftresComponent(i, "g1");
            expect(i.update).toHaveBeenCalledTimes(1);
            expect(i.reply).not.toHaveBeenCalled();
        });
    });
});
