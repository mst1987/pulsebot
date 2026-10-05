// "Fehlende pingen" under the signup message: the preview (who is missing, how
// many, the buttons), nobody missing, many names, the confirm that pings once
// and the guards against a second ping.
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: jest.fn(), appendEventLog: jest.fn() }));
jest.mock("../../../src/services/events/missingPing", () => ({ findMissingRaiders: jest.fn(), pingMissingRaiders: jest.fn() }));
jest.mock("../../../src/services/events/eventMessage", () => ({ MISSING_PREFIX: "event-missing" }));

const { ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const eventStore = require("../../../src/stores/eventStore");
const { findMissingRaiders, pingMissingRaiders } = require("../../../src/services/events/missingPing");
const { KIND_COLORS } = require("../../../src/utils/discord/card");
const bot = require("../../../src/services/events/missingPingBot");

const { parseMissingId, namesLine, recentPing, inFlight, MAX_NAMES, COOLDOWN_MS } = bot._internal;

const START = 1900000000;
const baseEvent = (over = {}) => ({ id: "eh-abc", guildId: "100000", title: "Karazhan", startTime: START, channelId: "110000", log: [], ...over });
const member = (i) => ({ id: String(200000 + i), displayName: `Raider${i}` });

/** A button click: reply / deferReply / editReply / update as spies. */
function click(customId, { userId = "42", displayName = "Orga" } = {}) {
    return {
        customId,
        user: { id: userId, username: "orga" },
        member: { displayName },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    };
}

const container = (payload) => payload.components[0];
const texts = (payload) => container(payload).components.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content);
const buttons = (payload) => container(payload).components
    .filter((c) => c.type === ComponentType.ActionRow).flatMap((r) => r.components);
const isEphemeral = (payload) => (payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
const isCardPayload = (payload) => (payload.flags & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2;

beforeEach(() => {
    jest.clearAllMocks();
    inFlight.clear();
    eventStore.getEvent.mockReturnValue(baseEvent());
});

describe("missingPingBot ids", () => {
    it("reads the event and the step from the customId, an id that is no own event as empty", () => {
        expect(parseMissingId("event-missing:eh-abc")).toEqual({ eventId: "eh-abc", step: "" });
        expect(parseMissingId("event-missing:eh-abc:go")).toEqual({ eventId: "eh-abc", step: "go" });
        expect(parseMissingId("event-missing:12345:no")).toEqual({ eventId: "", step: "no" });
        expect(parseMissingId(undefined)).toEqual({ eventId: "", step: "" });
    });
});

describe("the preview (the button on the signup message)", () => {
    it("defers ephemerally and shows who is missing, how many, and Jetzt pingen / Abbrechen", async () => {
        findMissingRaiders.mockResolvedValue({ event: baseEvent(), missing: [member(1), member(2), { id: "3", displayName: "*Bold* @here" }] });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(findMissingRaiders).toHaveBeenCalledWith({ guildId: "100000", eventId: "eh-abc" });
        // the derivation alone — nothing is posted yet
        expect(pingMissingRaiders).not.toHaveBeenCalled();
        const payload = i.editReply.mock.calls[0][0];
        expect(isCardPayload(payload)).toBe(true);
        expect(container(payload).accent_color).toBe(KIND_COLORS.warn);
        const [head] = texts(payload);
        expect(head).toContain(`-# Karazhan · <t:${START}:d> <t:${START}:t>`);
        expect(head).toContain("## 3 Raider fehlen");
        // names as plain text: no markdown, no mention
        expect(head).toContain("Raider1 · Raider2 · \\*Bold\\* @\u200bhere");
        expect(head).not.toMatch(/:[fF]>/);
        expect(buttons(payload).map((b) => [b.label, b.custom_id, b.style])).toEqual([
            ["Jetzt pingen", "event-missing:eh-abc:go", ButtonStyle.Primary],
            ["Abbrechen", "event-missing:eh-abc:no", ButtonStyle.Secondary],
        ]);
    });

    it("says 1 Raider fehlt for one", async () => {
        findMissingRaiders.mockResolvedValue({ event: baseEvent(), missing: [member(1)] });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        expect(texts(i.editReply.mock.calls[0][0])[0]).toContain("## 1 Raider fehlt");
    });

    it("shows the first 25 names and +N weitere", async () => {
        const many = Array.from({ length: 40 }, (_, k) => member(k));
        findMissingRaiders.mockResolvedValue({ event: baseEvent(), missing: many });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        const head = texts(i.editReply.mock.calls[0][0])[0];
        expect(head).toContain("## 40 Raider fehlen");
        expect(head).toContain("Raider24");
        expect(head).not.toContain("Raider25");
        expect(head).toContain("+15 weitere");
        expect(MAX_NAMES).toBe(25);
        expect(namesLine(many.slice(0, 2))).toBe("Raider0 · Raider1");
    });

    it("answers an ok card when everybody reacted", async () => {
        findMissingRaiders.mockResolvedValue({ event: baseEvent(), missing: [] });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        const payload = i.editReply.mock.calls[0][0];
        expect(container(payload).accent_color).toBe(KIND_COLORS.ok);
        expect(texts(payload)[0]).toContain("## Alle haben reagiert");
        expect(buttons(payload)).toEqual([]);
    });

    it("answers an error card with the service's reason (no roles, started, members unreadable)", async () => {
        findMissingRaiders.mockResolvedValue({ error: { status: 400, code: "event_past", message: "Der Raid hat bereits begonnen." } });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        const payload = i.editReply.mock.calls[0][0];
        expect(container(payload).accent_color).toBe(KIND_COLORS.error);
        expect(texts(payload)[0]).toContain("Der Raid hat bereits begonnen.");
    });

    it("sends the edits without the ephemeral flag (an edit cannot change it) and the first reply with it", async () => {
        findMissingRaiders.mockResolvedValue({ event: baseEvent(), missing: [member(1)] });
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "100000");
        expect(isEphemeral(i.editReply.mock.calls[0][0])).toBe(false);

        eventStore.getEvent.mockReturnValue(null);
        const gone = click("event-missing:eh-abc");
        await bot.handleMissingComponent(gone, "100000");
        const payload = gone.reply.mock.calls[0][0];
        expect(isEphemeral(payload)).toBe(true);
        expect(container(payload).accent_color).toBe(KIND_COLORS.error);
        expect(findMissingRaiders).not.toHaveBeenCalledTimes(2);
    });

    it("refuses an event of another server", async () => {
        const i = click("event-missing:eh-abc");
        await bot.handleMissingComponent(i, "999999");
        expect(i.reply).toHaveBeenCalledTimes(1);
        expect(findMissingRaiders).not.toHaveBeenCalled();
    });
});

describe("Jetzt pingen", () => {
    it("drops the buttons at once, pings through the existing path once, logs it and says how many", async () => {
        pingMissingRaiders.mockResolvedValue({ message: "3 fehlende Raider gepingt.", count: 3 });
        const i = click("event-missing:eh-abc:go");
        await bot.handleMissingComponent(i, "100000");
        // first the preview without buttons — a second click has nothing left to press
        const first = i.update.mock.calls[0][0];
        expect(buttons(first)).toEqual([]);
        expect(isEphemeral(first)).toBe(false);
        expect(pingMissingRaiders).toHaveBeenCalledTimes(1);
        expect(pingMissingRaiders).toHaveBeenCalledWith({ guildId: "100000", eventId: "eh-abc", target: "event" });
        expect(eventStore.appendEventLog).toHaveBeenCalledWith("eh-abc", { action: "ping", by: "42", byName: "Orga", detail: "3 Raider · Anmelde-Nachricht" });
        const done = i.editReply.mock.calls[0][0];
        expect(container(done).accent_color).toBe(KIND_COLORS.ok);
        expect(texts(done)[0]).toContain("## 3 Raider gepingt");
        expect(texts(done)[0]).toContain("<#110000>");
        expect(inFlight.size).toBe(0);
    });

    it("refuses a second ping while the first one runs", async () => {
        let release;
        pingMissingRaiders.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const first = click("event-missing:eh-abc:go");
        const running = bot.handleMissingComponent(first, "100000");
        await new Promise((r) => setImmediate(r));
        const second = click("event-missing:eh-abc:go");
        await bot.handleMissingComponent(second, "100000");
        expect(texts(second.update.mock.calls[0][0])[0]).toContain("## Schon gepingt");
        release({ message: "", count: 1 });
        await running;
        expect(pingMissingRaiders).toHaveBeenCalledTimes(1);
    });

    it("refuses a ping when the event logged one in the last two minutes", async () => {
        const now = Date.now();
        eventStore.getEvent.mockReturnValue(baseEvent({ log: [{ at: now - 30 * 1000, action: "ping", byName: "Anna", detail: "3 Raider" }] }));
        const i = click("event-missing:eh-abc:go");
        await bot.handleMissingComponent(i, "100000");
        expect(pingMissingRaiders).not.toHaveBeenCalled();
        const payload = i.update.mock.calls[0][0];
        expect(container(payload).accent_color).toBe(KIND_COLORS.warn);
        expect(texts(payload)[0]).toContain("(von Anna)");
        expect(texts(payload)[0]).toMatch(/<t:\d+:R>/);
    });

    it("lets an older ping pass the cooldown", () => {
        const now = Date.now();
        expect(recentPing(baseEvent({ log: [{ at: now - COOLDOWN_MS - 1, action: "ping" }] }), now)).toBeNull();
        expect(recentPing(baseEvent({ log: [{ at: now - 1000, action: "move" }] }), now)).toBeNull();
        expect(recentPing(baseEvent({ log: [{ at: now - 1000, action: "ping" }] }), now)).toMatchObject({ action: "ping" });
        expect(recentPing({}, now)).toBeNull();
    });

    it("shows the service's error and logs nothing", async () => {
        pingMissingRaiders.mockResolvedValue({ error: { status: 500, code: "post_failed", message: "Missing Access" } });
        const i = click("event-missing:eh-abc:go");
        await bot.handleMissingComponent(i, "100000");
        const payload = i.editReply.mock.calls[0][0];
        expect(container(payload).accent_color).toBe(KIND_COLORS.error);
        expect(texts(payload)[0]).toContain("Missing Access");
        expect(eventStore.appendEventLog).not.toHaveBeenCalled();
        expect(inFlight.size).toBe(0);
    });

    it("says so when everybody reacted in the meantime", async () => {
        pingMissingRaiders.mockResolvedValue({ message: "Niemand fehlt", count: 0 });
        const i = click("event-missing:eh-abc:go");
        await bot.handleMissingComponent(i, "100000");
        expect(texts(i.editReply.mock.calls[0][0])[0]).toContain("## Alle haben reagiert");
        expect(eventStore.appendEventLog).not.toHaveBeenCalled();
    });
});

describe("Abbrechen", () => {
    it("replaces the preview, pings nobody", async () => {
        const i = click("event-missing:eh-abc:no");
        await bot.handleMissingComponent(i, "100000");
        const payload = i.update.mock.calls[0][0];
        expect(texts(payload)[0]).toContain("## Abgebrochen");
        expect(buttons(payload)).toEqual([]);
        expect(pingMissingRaiders).not.toHaveBeenCalled();
    });

    it("answers a click on a vanished event by replacing the preview", async () => {
        eventStore.getEvent.mockReturnValue(null);
        const i = click("event-missing:eh-abc:no");
        await bot.handleMissingComponent(i, "100000");
        expect(i.update).toHaveBeenCalledTimes(1);
        expect(i.reply).not.toHaveBeenCalled();
    });
});
