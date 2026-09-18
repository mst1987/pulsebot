// "Beim Anlegen ankündigen" (#306): ein neues eigenes Event pingt einmal die
// Raider-Rolle seiner Kategorie — über pingDelivery (#264), nicht über einen
// zweiten Weg. Der Store läuft echt auf einem In-Memory-fs, Discord ist Mock.
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
jest.mock("../../src/web/pingDelivery", () => ({
    normalizePingTarget: jest.requireActual("../../src/web/pingDelivery").normalizePingTarget,
    deliverAnnouncement: jest.fn(async ({ target }) => ({ target, event: { messageId: "m1" }, talk: null, mentioned: 0, dm: null })),
}));
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig }));

const fs = require("fs");
const { deliverAnnouncement } = require("../../src/web/pingDelivery");
const eventStore = require("../../src/web/eventStore");
const announce = require("../../src/web/eventAnnounce");

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
    mockConfig = { categoryAnnounce: { [CAT]: { enabled: true, target: "event" } }, categoryRoles: { [CAT]: ["r-raider"] } };
});

describe("announceSetting", () => {
    it("folgt der Kategorie, der Dialog-Schalter sticht sie", () => {
        expect(announce.announceSetting(CAT)).toEqual({ enabled: true, target: "event" });
        expect(announce.announceSetting(CAT, { want: false })).toEqual({ enabled: false, target: "event" });
        expect(announce.announceSetting("andere")).toEqual({ enabled: false, target: "event" });
        expect(announce.announceSetting("andere", { want: true })).toEqual({ enabled: true, target: "event" });
    });

    it("macht aus einem unbekannten Ziel den Event-Kanal", () => {
        mockConfig = { categoryAnnounce: { [CAT]: { enabled: true, target: "irgendwo" } } };
        expect(announce.announceSetting(CAT).target).toBe("event");
    });
});

describe("buildAnnouncement", () => {
    it("ist eine Zeile mit Titel, Termin und Link auf die Anmelde-Nachricht", () => {
        const event = makeEvent();
        const payload = announce.buildAnnouncement(event);
        expect(payload.title).toBe("Neuer Raid: SSC + TK");
        expect(payload.body).toContain(`<t:${START}:F>`);
        expect(payload.body).toContain("https://discord.com/channels/g1/c1/msg1");
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
        expect(res).toMatchObject({ announced: true, target: "event" });
        expect(deliverAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
            target: "event", channelId: "c1", roleIds: ["r-raider"], guildId: "g1",
        }));
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

    it.each(["event", "talk", "both"])("reicht das Ziel %s an pingDelivery durch", async (target) => {
        mockConfig = { categoryAnnounce: { [CAT]: { enabled: true, target } }, categoryRoles: { [CAT]: ["r-raider"] } };
        const event = makeEvent();
        const res = await announce.announceEvent(event.id);
        expect(res.announced).toBe(true);
        expect(deliverAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ target }));
    });

    it("merkt einen Fehlschlag nicht vor – er lässt sich später von Hand nachholen", async () => {
        deliverAnnouncement.mockRejectedValueOnce(new Error("Auf dem Kommunikations-Discord ist kein Ping-Kanal eingestellt."));
        const event = makeEvent();
        const res = await announce.announceEvent(event.id);
        expect(res.announced).toBe(false);
        expect(res.error).toContain("Ping-Kanal");
        expect(eventStore.getEvent(event.id).announcedAt).toBe(0);
    });

    it("kennt nur eigene Events", async () => {
        expect(await announce.announceEvent("1234567890")).toEqual({ announced: false, skipped: "not_own" });
        expect(await announce.announceEvent("eh-gibtsnicht")).toEqual({ announced: false, skipped: "not_found" });
    });
});
