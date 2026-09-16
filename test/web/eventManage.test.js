// Event verwalten (#288): the service behind the web menu and the Discord
// message — move, close/open, sign raiders up and off, cancel, reopen, the log.
// Stores run for real on an in-memory fs; Discord, the message, the talk
// overview and every DM/ping are mocks.
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
jest.mock("../../src/web/discord", () => ({
    listAllChannels: jest.fn(() => []),
    resolveUserNames: jest.fn(async () => ({})),
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
    memberRoleIds: jest.fn(async () => null),
}));
jest.mock("../../src/web/discordChannels", () => ({
    editChannel: jest.fn(async (id, { name }) => ({ id, name })),
    placeChannel: jest.fn(async () => true),
    archiveChannel: jest.fn(async (id) => ({ id, name: "mi-24-09-ssc-tk", fromParentId: "cat", fromCategory: "Raids", guildId: "g1" })),
    discordErrorText: jest.requireActual("../../src/web/discordChannels").discordErrorText,
}));
jest.mock("../../src/web/channelNaming", () => ({ deriveChannelName: jest.fn() }));
jest.mock("../../src/web/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../src/web/talkOverview", () => ({ scheduleOverviewSync: jest.fn() }));
jest.mock("../../src/web/pingDelivery", () => ({
    deliverUserPing: jest.fn(async () => ({})),
    sendDms: jest.fn(async (ids) => ({ sent: ids, failed: [] })),
}));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/setupEditor", () => ({ setupSummary: jest.fn(() => null) }));

const { DateTime } = require("luxon");
const fs = require("fs");
const discordChannels = require("../../src/web/discordChannels");
const channelNaming = require("../../src/web/channelNaming");
const { refreshEventMessage } = require("../../src/web/eventMessage");
const { scheduleOverviewSync } = require("../../src/web/talkOverview");
const { deliverUserPing, sendDms } = require("../../src/web/pingDelivery");
const discord = require("../../src/web/discord");
const settings = require("../../src/web/settingsStore");
const eventStore = require("../../src/web/eventStore");
const signupStore = require("../../src/web/signupStore");
const profiles = require("../../src/web/raiderProfileStore");
const reminderStore = require("../../src/web/reminderStore");
const archiveStore = require("../../src/web/channelArchiveStore");
const signupService = require("../../src/web/signupService");
const manage = require("../../src/web/eventManage");

const ZONE = "Europe/Berlin";
const ORGA = { id: "900000000000000001", name: "Orga" };
const RAIDER = "800000000000000001";
const OTHER = "800000000000000002";
const day = (days, time = "19:30") => {
    const d = DateTime.now().setZone(ZONE).plus({ days }).startOf("day");
    const [h, m] = time.split(":").map(Number);
    return d.set({ hour: h, minute: m });
};

let event;
function seed(over = {}) {
    const start = day(7);
    const { event: created } = eventStore.createEvent({
        guildId: "g1", channelId: "c1", channelName: "mi-24-09-ssc-tk", categoryId: "cat", categoryName: "Raids",
        title: "SSC + TK", startTime: Math.floor(start.toSeconds()), signupDeadline: Math.floor(start.toSeconds()) - 24 * 3600,
        instanceIds: ["ssc", "tk"], size: 25, ...over,
    });
    return created;
}
function signUp(userId, character, spec, status = "signed") {
    profiles.addCharacter(userId, { name: character, className: spec.split("-")[0], specs: [{ key: spec }] });
    return signupStore.saveSignup(event.id, userId, { character, spec, status });
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    settings.getConfig.mockReturnValue({});
    discord.listAllChannels.mockReturnValue([{ id: "c1", name: "mi-24-09-ssc-tk", parentId: "cat" }]);
    event = seed();
});

describe("moving an event", () => {
    const target = day(9, "20:00");

    it("previews the new date, the deadline at the same distance, the channel's new name and who hears of it", async () => {
        channelNaming.deriveChannelName.mockResolvedValue({
            name: "fr-26-09-ssc-tk", source: "previous", fromChannelId: "c1", label: "abgeleitet aus #mi-24-09-ssc-tk", detail: "Datum 24-09 → 26-09",
        });
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        signUp(OTHER, "Ysolde", "Priest-Holy", "absence");
        const { plan } = await manage.movePlan({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00" });
        expect(plan.to.startTime).toBe(Math.floor(target.toSeconds()));
        expect(plan.signupDeadline).toBe(plan.to.startTime - 24 * 3600);
        expect(plan.channel).toMatchObject({ current: "mi-24-09-ssc-tk", next: "fr-26-09-ssc-tk", rename: true, label: "abgeleitet aus #mi-24-09-ssc-tk" });
        // the one who signed off is not told
        expect(plan.recipients).toBe(1);
        expect(channelNaming.deriveChannelName).toHaveBeenCalledWith(expect.objectContaining({ fromEventId: event.id, excludeChannelId: "c1", date: target.toISODate() }));
        // nothing changed yet
        expect(eventStore.getEvent(event.id).startTime).toBe(event.startTime);
    });

    it("keeps a hand-made channel name and says why", async () => {
        channelNaming.deriveChannelName.mockResolvedValue({ name: "raid-26-09", source: "default", fromChannelId: "c1", label: "Standard-Schema" });
        const { plan } = await manage.movePlan({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00" });
        expect(plan.channel.rename).toBe(false);
        expect(plan.channel.next).toBe("mi-24-09-ssc-tk");
        expect(plan.channel.reason).toMatch(/kein Datum/);
    });

    it("renames by the category schema only when the channel still carries the old day's schema name", async () => {
        channelNaming.deriveChannelName
            .mockResolvedValueOnce({ name: "raid-26-09", source: "schema", label: "nach Schema der Kategorie" })
            .mockResolvedValueOnce({ name: "mi-24-09-ssc-tk", source: "schema" });
        expect((await manage.movePlan({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00" })).plan.channel.rename).toBe(true);
        channelNaming.deriveChannelName
            .mockResolvedValueOnce({ name: "raid-26-09", source: "schema" })
            .mockResolvedValueOnce({ name: "raid-24-09", source: "schema" });
        expect((await manage.movePlan({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00" })).plan.channel.rename).toBe(false);
    });

    it("refuses a past date, an unchanged date, garbage and a Raid-Helper id", async () => {
        const past = day(-2);
        expect((await manage.movePlan({ guildId: "g1", eventId: event.id, date: past.toISODate(), time: "19:30" })).error.code).toBe("past");
        const same = DateTime.fromSeconds(event.startTime, { zone: ZONE });
        expect((await manage.movePlan({ guildId: "g1", eventId: event.id, date: same.toISODate(), time: same.toFormat("HH:mm") })).error.code).toBe("unchanged");
        expect((await manage.movePlan({ guildId: "g1", eventId: event.id, date: "morgen", time: "x" })).error.code).toBe("invalid_time");
        expect((await manage.movePlan({ guildId: "g1", eventId: "1234567", date: target.toISODate(), time: "20:00" })).error.code).toBe("not_own_event");
        expect((await manage.movePlan({ guildId: "g2", eventId: event.id, date: target.toISODate(), time: "20:00" })).error.code).toBe("not_found");
    });

    it("moves, renames the channel, re-arms the reminders, notes it in the channel and logs who did it", async () => {
        channelNaming.deriveChannelName.mockResolvedValue({ name: "fr-26-09-ssc-tk", source: "previous", fromChannelId: "c1", placement: { afterChannelId: "c0" } });
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        reminderStore.markSent(event.id, "missing");
        const result = await manage.moveEvent({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00", user: ORGA, byName: "Orga" });
        expect(result.error).toBeUndefined();
        const moved = eventStore.getEvent(event.id);
        expect(moved.startTime).toBe(Math.floor(target.toSeconds()));
        expect(moved.channelName).toBe("fr-26-09-ssc-tk");
        expect(discordChannels.editChannel).toHaveBeenCalledWith("c1", { name: "fr-26-09-ssc-tk" });
        expect(discordChannels.placeChannel).toHaveBeenCalledWith("c1", { afterChannelId: "c0" });
        expect(reminderStore.getSent(event.id).missing).toBeUndefined();
        expect(refreshEventMessage).toHaveBeenCalledWith(event.id);
        expect(scheduleOverviewSync).toHaveBeenCalled();
        expect(deliverUserPing).toHaveBeenCalledWith(expect.objectContaining({ target: "event", userIds: [RAIDER], text: expect.stringContaining("verschoben") }));
        expect(result.body.message).toMatch(/Kanal heißt jetzt #fr-26-09-ssc-tk/);
        expect(moved.log.at(-1)).toMatchObject({ action: "move", by: ORGA.id, byName: "Orga", detail: expect.stringContaining("Kanal #fr-26-09-ssc-tk") });
    });

    it("leaves the channel and the raiders alone when asked, and reports a rename Discord refuses", async () => {
        channelNaming.deriveChannelName.mockResolvedValue({ name: "fr-26-09-ssc-tk", source: "previous", fromChannelId: "c1" });
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        await manage.moveEvent({ guildId: "g1", eventId: event.id, date: target.toISODate(), time: "20:00", renameChannel: false, notify: false, user: ORGA });
        expect(discordChannels.editChannel).not.toHaveBeenCalled();
        expect(deliverUserPing).not.toHaveBeenCalled();

        discordChannels.editChannel.mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        const later = day(10, "20:00");
        const result = await manage.moveEvent({ guildId: "g1", eventId: event.id, date: later.toISODate(), time: "20:00", notify: false, user: ORGA });
        expect(result.body.warnings).toEqual(["Kanal nicht umbenannt: fehlende Rechte"]);
        expect(eventStore.getEvent(event.id).startTime).toBe(Math.floor(later.toSeconds()));
    });
});

describe("closing and opening the signup", () => {
    it("closes: members may only sign off, the orga still signs people up; logged both ways", async () => {
        const closed = await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: false, user: ORGA, byName: "Orga" });
        expect(closed.body.message).toMatch(/geschlossen/);
        const ev = eventStore.getEvent(event.id);
        expect(ev.signupsClosed).toBe(true);
        expect(signupService.allowedStatuses(ev)).toEqual(["absence"]);
        profiles.addCharacter(RAIDER, { name: "Thorwald", className: "Warrior", specs: [{ key: "Warrior-Protection" }] });
        const member = await signupService.submitSignup(event.id, RAIDER, { character: "Thorwald", spec: "Warrior-Protection", status: "signed" }, { roleIds: [] });
        expect(member.code).toBe("closed");
        const off = await signupService.submitSignup(event.id, RAIDER, { status: "absence" }, { roleIds: [] });
        expect(off.error).toBeUndefined();
        expect((await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: false, user: ORGA })).error.code).toBe("unchanged");

        await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: true, user: ORGA, byName: "Orga" });
        expect(eventStore.getEvent(event.id).signupsClosed).toBe(false);
        expect(eventStore.getEvent(event.id).log.map((l) => l.action)).toEqual(["close", "open"]);
        expect(refreshEventMessage).toHaveBeenCalledTimes(2);
    });
});

describe("signing raiders up and off as the orga", () => {
    it("signs up with a profile character, bypassing a closed signup", async () => {
        profiles.addCharacter(RAIDER, { name: "Thorwald", className: "Warrior", specs: [{ key: "Warrior-Protection" }] });
        eventStore.setEventState(event.id, { signupsClosed: true });
        const result = await manage.addRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, character: "Thorwald", spec: "Warrior-Protection", status: "late", user: ORGA, byName: "Orga" });
        expect(result.body.profileChanged).toBe(false);
        expect(signupStore.getSignup(event.id, RAIDER)).toMatchObject({ character: "Thorwald", spec: "Warrior-Protection", status: "late" });
        expect(eventStore.getEvent(event.id).log.at(-1)).toMatchObject({ action: "add", detail: expect.stringContaining("Thorwald") });
    });

    it("adds a character the profile does not know yet, and refuses a spec of another class", async () => {
        const result = await manage.addRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, character: "Neuling", spec: "Mage-Frost", user: ORGA });
        expect(result.body.profileChanged).toBe(true);
        expect(profiles.getProfile(RAIDER).characters.map((c) => c.name)).toEqual(["Neuling"]);
        expect(signupStore.getSignup(event.id, RAIDER).status).toBe("signed");
        const wrong = await manage.addRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, character: "Neuling", spec: "Priest-Holy", user: ORGA });
        expect(wrong.error.code).toBe("spec");
        expect((await manage.addRaider({ guildId: "g1", eventId: event.id, userId: "x", character: "A", spec: "Mage-Frost" })).error.code).toBe("bad_request");
    });

    it("takes further own characters as „kann auch mit“ and keeps them on a later single add (#293)", async () => {
        profiles.addCharacter(RAIDER, { name: "Thorwald", className: "Warrior", specs: [{ key: "Warrior-Protection" }] });
        const result = await manage.addRaider({
            guildId: "g1", eventId: event.id, userId: RAIDER, character: "Thorwald", spec: "Warrior-Protection",
            alternates: [{ character: "Heilbert", spec: "Priest-Holy" }], user: ORGA,
        });
        expect(result.body.profileChanged).toBe(true);
        expect(signupStore.getSignup(event.id, RAIDER).characters.map((c) => [c.character, c.spec])).toEqual([["Thorwald", "Warrior-Protection"], ["Heilbert", "Priest-Holy"]]);
        await manage.addRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, character: "Thorwald", spec: "Warrior-Protection", status: "late", user: ORGA });
        expect(signupStore.getSignup(event.id, RAIDER)).toMatchObject({ status: "late", characters: [expect.anything(), expect.objectContaining({ character: "Heilbert" })] });
        const tooMany = ["A", "B", "C"].map((c) => ({ character: c, spec: "Mage-Frost" }));
        expect((await manage.addRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, character: "Thorwald", spec: "Warrior-Protection", alternates: tooMany, user: ORGA })).error.code).toBe("characters");
    });

    it("signs a raider off entirely and logs it", async () => {
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        const result = await manage.removeRaider({ guildId: "g1", eventId: event.id, userId: RAIDER, user: ORGA, byName: "Orga" });
        expect(result.body.message).toBe("Thorwald ausgetragen.");
        expect(signupStore.getSignup(event.id, RAIDER)).toBeNull();
        expect((await manage.removeRaider({ guildId: "g1", eventId: event.id, userId: RAIDER })).error.code).toBe("not_signed_up");
        expect(eventStore.getEvent(event.id).log.at(-1)).toMatchObject({ action: "remove", by: ORGA.id });
    });
});

describe("cancelling an event", () => {
    it("wants a reason and an archive category when the channel should go there", async () => {
        expect((await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: " ", user: ORGA })).error.code).toBe("reason");
        expect((await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: "Zu wenig Heiler", archiveChannel: true, user: ORGA })).error.code).toBe("no_archive");
        expect(eventStore.getEvent(event.id).status).toBe("active");
    });

    it("marks it cancelled, DMs everyone signed up, archives the channel and blocks every further signup", async () => {
        archiveStore.saveChannelConfig("g1", { archiveCategoryId: "arch" });
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        signUp(OTHER, "Ysolde", "Priest-Holy", "absence");
        const result = await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: "Zu wenig Heiler, wir verschieben auf Do.", archiveChannel: true, user: ORGA, byName: "Orga" });
        expect(result.body).toMatchObject({ archived: true, dm: { sent: 1, failed: 0 } });
        const ev = eventStore.getEvent(event.id);
        expect(ev).toMatchObject({ status: "cancelled", signupsClosed: true, cancel: { reason: "Zu wenig Heiler, wir verschieben auf Do.", by: ORGA.id, archived: true } });
        expect(sendDms).toHaveBeenCalledWith([RAIDER], { content: expect.stringContaining("Grund: Zu wenig Heiler") });
        expect(discordChannels.archiveChannel).toHaveBeenCalledWith("c1", "arch");
        expect(archiveStore.listArchived("g1")).toEqual([expect.objectContaining({ channelId: "c1", by: ORGA.id })]);
        expect(refreshEventMessage).toHaveBeenCalledWith(event.id);
        expect(scheduleOverviewSync).toHaveBeenCalled();
        expect(ev.log.at(-1)).toMatchObject({ action: "cancel", byName: "Orga", detail: expect.stringContaining("Kanal archiviert") });

        // nobody signs up any more — not even the orga — and nothing else can be done to it
        expect(signupService.allowedStatuses(ev, { byOrga: true })).toEqual([]);
        expect((await signupService.submitSignup(event.id, OTHER, { status: "absence" }, { byOrga: true })).code).toBe("cancelled");
        expect((await manage.addRaider({ guildId: "g1", eventId: event.id, userId: OTHER, character: "Ysolde", spec: "Priest-Holy", user: ORGA })).error.code).toBe("cancelled");
        expect((await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: true, user: ORGA })).error.code).toBe("cancelled");
    });

    it("sends no DM when switched off and reports DMs that did not arrive", async () => {
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: "Serverwartung", notify: false, user: ORGA });
        expect(sendDms).not.toHaveBeenCalled();
        await manage.reopenEvent({ guildId: "g1", eventId: event.id, user: ORGA });
        sendDms.mockResolvedValueOnce({ sent: [], failed: [RAIDER] });
        const result = await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: "Serverwartung", user: ORGA });
        expect(result.body.warnings).toEqual(["1 DM kam nicht an (DMs geschlossen?)"]);
    });

    it("takes a cancellation back and says the channel is still in the archive", async () => {
        archiveStore.saveChannelConfig("g1", { archiveCategoryId: "arch" });
        await manage.cancelEvent({ guildId: "g1", eventId: event.id, reason: "Zu wenig Heiler", archiveChannel: true, user: ORGA });
        const result = await manage.reopenEvent({ guildId: "g1", eventId: event.id, user: ORGA, byName: "Orga" });
        expect(result.body.message).toMatch(/Archiv/);
        expect(eventStore.getEvent(event.id)).toMatchObject({ status: "active", signupsClosed: false, cancel: null });
        expect((await manage.reopenEvent({ guildId: "g1", eventId: event.id, user: ORGA })).error.code).toBe("unchanged");
        expect(eventStore.getEvent(event.id).log.map((l) => l.action)).toEqual(["cancel", "reopen"]);
    });
});

describe("what the menu shows", () => {
    it("lists state, recipients with names, the archive and the log newest first", async () => {
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        discord.resolveUserNames.mockResolvedValue({ [RAIDER]: "thor" });
        await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: false, user: ORGA, byName: "Orga" });
        await manage.setSignupsOpen({ guildId: "g1", eventId: event.id, open: true, user: ORGA, byName: "Orga" });
        const { body } = await manage.manageInfo({ guildId: "g1", eventId: event.id });
        expect(body.event).toMatchObject({ id: event.id, status: "active", signupsClosed: false, channelName: "mi-24-09-ssc-tk" });
        expect(body.recipients).toEqual([{ userId: RAIDER, name: "thor", character: "Thorwald", status: "signed" }]);
        expect(body.counts).toMatchObject({ attending: 1, size: 25 });
        expect(body.archive).toEqual({ configured: false });
        expect(body.log.map((l) => l.label)).toEqual(["Anmeldung geöffnet", "Anmeldung geschlossen"]);
    });

    it("offers profiles, role holders and signups as raiders, plus the classes for a new character", async () => {
        settings.getConfig.mockReturnValue({ categoryRoles: { cat: ["role1"] } });
        discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: OTHER, displayName: "Ysi" }], error: null });
        signUp(RAIDER, "Thorwald", "Warrior-Protection");
        const { body } = await manage.raiderCandidates({ guildId: "g1", eventId: event.id });
        const thor = body.raiders.find((r) => r.userId === RAIDER);
        expect(thor.characters[0]).toMatchObject({ name: "Thorwald", className: "Warrior", specs: [expect.objectContaining({ key: "Warrior-Protection" })] });
        expect(thor.signup).toMatchObject({ status: "signed" });
        expect(body.raiders.find((r) => r.userId === OTHER)).toMatchObject({ name: "Ysi", characters: [] });
        expect(body.classes.map((c) => c.id)).toContain("Mage");
    });
});
