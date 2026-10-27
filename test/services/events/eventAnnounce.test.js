// "Beim Anlegen ankündigen" (#306): ein neues eigenes Event pingt einmal die
// Raider-Rolle seiner Kategorie — über pingDelivery (#264), nicht über einen
// zweiten Weg, und immer im Kanal des Raids (#894). Der Store läuft echt auf einem In-Memory-fs, Discord ist Mock.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/pingDelivery", () => ({
    deliverAnnouncement: jest.fn(async () => ({ event: { messageId: "m1" }, mentioned: 0, dm: null })),
}));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const fs = require("fs");
const { deliverAnnouncement } = require("../../../src/services/discord/pingDelivery");
const eventStore = require("../../../src/stores/eventStore");
const announce = require("../../../src/services/events/eventAnnounce");
const { knownChannels } = require("../../helpers/linkCheck");

// The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
beforeEach(() => knownChannels("c1"));

const CAT = "300000000000000001";
const START = 1_900_000_000;

function makeEvent(over = {}) {
    const created = eventStore.createEvent({
        guildId: "g1", channelId: "c1", channelName: "mi-24-09-ssc-tk", categoryId: CAT, categoryName: "Mittwoch",
        title: "SSC + TK", startTime: START, size: 25, ...over,
    });
    expect(created.error).toBeUndefined();
    eventStore.setEventMessage(created.event.id, { channelId: "c1", messageId: "msg1" });
    return eventStore.getEvent(created.event.id);
}

beforeEach(() => {
    fs.__store.clear();
    deliverAnnouncement.mockClear();
    mockConfig = { categoryAnnounce: { [CAT]: { enabled: true } }, categoryRoles: { [CAT]: ["r-raider"] } };
});

describe("announceSetting", () => {
    it("folgt der Kategorie, der Dialog-Schalter sticht sie", () => {
        expect(announce.announceSetting(CAT)).toEqual({ enabled: true });
        expect(announce.announceSetting(CAT, { want: false })).toEqual({ enabled: false });
        expect(announce.announceSetting("andere")).toEqual({ enabled: false });
        expect(announce.announceSetting("andere", { want: true })).toEqual({ enabled: true });
    });

    it("kennt kein Ziel mehr – ein altes talk/both wird übergangen (#894)", () => {
        mockConfig = { categoryAnnounce: { [CAT]: { enabled: true, target: "talk" } } };
        expect(announce.announceSetting(CAT)).toEqual({ enabled: true });
    });
});

describe("buildAnnouncement", () => {
    it("ist eine Zeile mit Titel, Termin und Link auf die Anmelde-Nachricht", () => {
        const event = makeEvent();
        const payload = announce.buildAnnouncement(event, "en");
        expect(payload.title).toBe("New raid: SSC + TK");
        expect(payload.body).toContain(`<t:${START}:d> <t:${START}:t>`);
        expect(payload.body).toContain("https://discord.com/channels/g1/c1/msg1");
        expect(payload.body).toContain("[Sign up](https://discord.com/channels/g1/c1/msg1)");
    });

    it("spricht ohne Einstellung Deutsch (die Server-Sprache)", () => {
        const payload = announce.buildAnnouncement(makeEvent());
        expect(payload.title).toBe("Neuer Raid: SSC + TK");
        expect(payload.body).toContain("[Anmelden](https://discord.com/channels/g1/c1/msg1)");
        expect(announce.buildAnnouncement({ title: "X" }).body).toBe("Ein neuer Raid steht im Kalender.");
        expect(announce.buildAnnouncement({ title: "X" }, "en").body).toBe("A new raid is on the calendar.");
    });

    it("verlinkt den Kanal, solange keine Nachricht steht", () => {
        const created = eventStore.createEvent({ guildId: "g1", channelId: "c1", categoryId: CAT, title: "Kara", startTime: START });
        expect(announce.buildAnnouncement(created.event).body).toContain("https://discord.com/channels/g1/c1");
    });
});

describe("announceEvent", () => {
    it("pingt die Raider-Rolle der Kategorie im Event-Kanal und merkt sich den Zeitpunkt", async () => {
        const event = makeEvent();
        const res = await announce.announceEvent(event.id, { now: 1234 });
        expect(res).toMatchObject({ announced: true });
        expect(res).not.toHaveProperty("target");
        expect(deliverAnnouncement).toHaveBeenCalledWith({
            channelId: "c1", roleIds: ["r-raider"], template: expect.objectContaining({ title: "Neuer Raid: SSC + TK" }),
        });
        const stored = eventStore.getEvent(event.id);
        expect(stored.announcedAt).toBe(1234);
        expect(stored.log.map((l) => l.action)).toContain("announce");
    });

    it("kündigt nie zweimal an – auch nicht nach einer Bearbeitung", async () => {
        const event = makeEvent();
        await announce.announceEvent(event.id);
        deliverAnnouncement.mockClear();
        eventStore.updateEvent(event.id, { title: "SSC + TK (neu)" });
        const again = await announce.announceEvent(event.id);
        expect(again).toEqual({ announced: false, skipped: "already" });
        expect(deliverAnnouncement).not.toHaveBeenCalled();
    });

    it("tut nichts, wenn die Kategorie es nicht will", async () => {
        mockConfig = { categoryAnnounce: {}, categoryRoles: {} };
        const event = makeEvent();
        expect(await announce.announceEvent(event.id)).toEqual({ announced: false, skipped: "off" });
        expect(deliverAnnouncement).not.toHaveBeenCalled();
        expect(eventStore.getEvent(event.id).announcedAt).toBe(0);
    });

    it.each(["event", "talk", "both"])("postet auch mit einem alten Ziel %s nur im Kanal des Raids (#894)", async (target) => {
        mockConfig = { categoryAnnounce: { [CAT]: { enabled: true, target } }, categoryRoles: { [CAT]: ["r-raider"] } };
        const event = makeEvent();
        const res = await announce.announceEvent(event.id);
        expect(res.announced).toBe(true);
        expect(deliverAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1" }));
        expect(deliverAnnouncement.mock.calls[0][0]).not.toHaveProperty("target");
    });

    it("merkt einen Fehlschlag nicht vor – er lässt sich später von Hand nachholen", async () => {
        deliverAnnouncement.mockRejectedValueOnce(new Error("Vorlage oder Channel fehlt."));
        const event = makeEvent();
        const res = await announce.announceEvent(event.id);
        expect(res.announced).toBe(false);
        expect(res.error).toContain("Channel fehlt");
        expect(eventStore.getEvent(event.id).announcedAt).toBe(0);
    });

    it("kennt nur eigene Events", async () => {
        expect(await announce.announceEvent("1234567890")).toEqual({ announced: false, skipped: "not_own" });
        expect(await announce.announceEvent("eh-gibtsnicht")).toEqual({ announced: false, skipped: "not_found" });
    });
});
