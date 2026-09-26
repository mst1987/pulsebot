// "Event verwalten" in Discord (#288): /event verwalten, the message context
// menu, and the buttons/selects/modals of the ephemeral message. The service
// (web/eventManage.js) runs for real on in-memory stores; Discord writes, the
// message, the talk overview and every DM/ping are mocks.
jest.mock("fs", () => ({
    ...require("../../helpers/memoryFs").memoryFs(),
    readdirSync: jest.requireActual("fs").readdirSync,
    existsSync: jest.fn(() => false),
}));
jest.mock("../../../src/web/discord", () => require("../../helpers/discordMock").withClientHelpers({
    listAllChannels: jest.fn(() => [{ id: "200000000000000001", name: "mi-24-09-ssc-tk", parentId: "100000000000000001" }]),
    listCategories: jest.fn(() => []),
    resolveUserNames: jest.fn(async () => ({})),
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
    memberRoleIds: jest.fn(async () => null),
    getClient: jest.fn(() => null),
}));
jest.mock("../../../src/web/discordChannels", () => ({
    editChannel: jest.fn(async (id, { name }) => ({ id, name })),
    placeChannel: jest.fn(async () => true),
    archiveChannel: jest.fn(async (id) => ({ id, name: "mi-24-09-ssc-tk", guildId: "300000000000000001" })),
    discordErrorText: (e) => e.message,
}));
jest.mock("../../../src/web/channelNaming", () => ({ deriveChannelName: jest.fn(), namingLine: jest.fn(() => "") }));
jest.mock("../../../src/web/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/web/talkOverview", () => ({ scheduleOverviewSync: jest.fn() }));
jest.mock("../../../src/web/pingDelivery", () => ({
    deliverUserPing: jest.fn(async () => ({})),
    sendDms: jest.fn(async (ids) => ({ sent: ids, failed: [] })),
}));
jest.mock("../../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})), listRaidTemplates: jest.fn(() => []), getRaidTemplate: jest.fn(() => null),
}));
jest.mock("../../../src/web/setupEditor", () => ({ setupSummary: jest.fn(() => null) }));
jest.mock("../../../src/web/eventCreate", () => ({ updateEvent: jest.fn(async () => ({ status: 200, body: { messageError: null } })) }));
jest.mock("../../../src/web/missingPing", () => ({ pingMissingRaiders: jest.fn(async () => ({ message: "3 fehlende Raider gepingt.", count: 3 })) }));
jest.mock("../../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "") }));
jest.mock("../../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: [] })), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const { DateTime } = require("luxon");
const fs = require("fs");
const channelNaming = require("../../../src/web/channelNaming");
const { sendDms, deliverUserPing } = require("../../../src/web/pingDelivery");
const { updateEvent } = require("../../../src/web/eventCreate");
const { pingMissingRaiders } = require("../../../src/web/missingPing");
const eventStore = require("../../../src/web/eventStore");
const signupStore = require("../../../src/web/signupStore");
const profiles = require("../../../src/web/raiderProfileStore");
const bot = require("../../../src/web/eventManageBot");
const eventCommand = require("../../../src/commands/event/event");
const stepCommand = require("../../../src/commands/event/eventManageStep");
const formCommand = require("../../../src/commands/event/eventManageForm");
const contextCommand = require("../../../src/commands/event/eventManageContext");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");
const { makeClient, makeChannel } = require("../../helpers/discordClient");

const GUILD = "300000000000000001";
const CHANNEL = "200000000000000001";
const RAIDER = "800000000000000001";
const ZONE = "Europe/Berlin";
const lastPayload = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];
const buttons = (payload) => payload.components.flatMap((r) => r.components);

let event;
function interaction(opts) {
    const i = mockInteraction({ userId: "900000000000000001", ...opts, guild: { id: GUILD } });
    i.guildId = GUILD;
    i.channelId = CHANNEL;
    i.member = { displayName: "Orga" };
    return i;
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    const start = DateTime.now().setZone(ZONE).plus({ days: 7 }).set({ hour: 19, minute: 30, second: 0, millisecond: 0 });
    event = eventStore.createEvent({
        guildId: GUILD, channelId: CHANNEL, channelName: "mi-24-09-ssc-tk", categoryId: "100000000000000001",
        title: "SSC + TK", startTime: Math.floor(start.toSeconds()), instanceIds: ["ssc", "tk"], size: 25,
    }).event;
    eventStore.setEventMessage(event.id, { channelId: CHANNEL, messageId: "700000000000000001" });
    profiles.addCharacter(RAIDER, { name: "Thorwald", className: "Warrior", specs: [{ key: "Warrior-Protection" }] });
    signupStore.saveSignup(event.id, RAIDER, { character: "Thorwald", spec: "Warrior-Protection", status: "signed" });
});

describe("access", () => {
    it("is /event's: admins by default, every part inherits it", () => {
        expect(memberMayRun(eventCommand)).toBe(false);
        for (const c of [stepCommand, formCommand, contextCommand]) expect(c.accessOf).toBe("event");
    });
});

describe("opening", () => {
    it("the context menu on the signup message opens that event's actions", async () => {
        const i = interaction({ commandName: "Event verwalten" });
        i.targetMessage = { id: "700000000000000001", channelId: CHANNEL };
        await contextCommand.execute(i);
        const payload = lastPayload(i.reply);
        expect(payload.flags).toBe(64);
        expect(payload.embeds[0].title).toBe("SSC + TK verwalten");
        expect(payload.embeds[0].description).toContain("1/25");
        expect(buttons(payload).map((b) => b.label || b.placeholder)).toEqual([
            "Bearbeiten", "Verschieben", "Anmeldung schließen", "Raider eintragen / austragen …",
            "Fehlende pingen", "Setup öffnen", "Absagen", "Löschen",
        ]);
        expect(buttons(payload).find((b) => b.label === "Setup öffnen").url).toBe(`https://eh.test/raids/detail?event=${event.id}&tab=setup`);
        // every customId fits Discord's 100 characters
        for (const b of buttons(payload)) expect(String(b.custom_id || "").length).toBeLessThanOrEqual(100);
    });

    it("a message of no event says so", async () => {
        const i = interaction({ commandName: "Event verwalten" });
        i.targetMessage = { id: "1", channelId: "999" };
        await contextCommand.execute(i);
        expect(lastPayload(i.reply).content).toMatch(/keinem EventHelper-Event/);
    });

    it("/event verwalten takes the named event, else the channel's", async () => {
        const named = interaction({ commandName: "event", options: { __subcommand: "verwalten", event: event.id } });
        named.channelId = "somewhere-else";
        await eventCommand.execute(named);
        expect(lastPayload(named.reply).embeds[0].title).toBe("SSC + TK verwalten");
        const here = interaction({ commandName: "event", options: { __subcommand: "verwalten" } });
        await eventCommand.execute(here);
        expect(lastPayload(here.reply).embeds[0].title).toBe("SSC + TK verwalten");
    });

    it("suggests the server's events in the autocomplete", async () => {
        const i = interaction({ commandName: "event", focused: { name: "event", value: "ssc" } });
        await eventCommand.autocomplete(i);
        expect(lastPayload(i.respond)).toEqual([{ name: expect.stringMatching(/^SSC \+ TK · /), value: event.id }]);
    });
});

describe("actions", () => {
    it("Bearbeiten, Verschieben, Absagen and Löschen open their modal without deferring", async () => {
        for (const [field, title] of [["e", "bearbeiten"], ["v", "verschieben"], ["x", "absagen"], ["l", "löschen"]]) {
            const i = interaction({ customId: bot.manageId(field, event.id) });
            await stepCommand.execute(i);
            expect(i.deferUpdate).not.toHaveBeenCalled();
            expect(lastPayload(i.showModal).toJSON().title).toBe(`SSC + TK ${title}`);
        }
    });

    it("closes the signup and says so in the same message", async () => {
        const i = interaction({ customId: bot.manageId("s", event.id) });
        await stepCommand.execute(i);
        expect(eventStore.getEvent(event.id).signupsClosed).toBe(true);
        const payload = lastPayload(i.editReply);
        expect(payload.embeds[0].description).toMatch(/Anmeldung geschlossen/);
        expect(buttons(payload).some((b) => b.label === "Anmeldung öffnen")).toBe(true);
        expect(eventStore.getEvent(event.id).log.at(-1)).toMatchObject({ action: "close", byName: "Orga" });
    });

    it("picks a raider, signs them up with a profile character, and signs them off", async () => {
        const pick = interaction({ customId: bot.manageId("u", event.id), values: [RAIDER] });
        await stepCommand.execute(pick);
        const panel = lastPayload(pick.editReply);
        expect(panel.embeds[0].description).toContain("Eingetragen: **Dabei**");
        const select = buttons(panel).find((c) => c.type === 3);
        expect(select.options[0]).toMatchObject({ label: "Thorwald · Schutz", value: "thorwald|Warrior-Protection" });

        signupStore.removeSignup(event.id, RAIDER);
        const add = interaction({ customId: bot.manageId("a", event.id, RAIDER), values: ["thorwald|Warrior-Protection"] });
        await stepCommand.execute(add);
        expect(signupStore.getSignup(event.id, RAIDER)).toMatchObject({ character: "Thorwald", status: "signed" });
        expect(lastPayload(add.editReply).embeds[0].description).toContain("Thorwald eingetragen");

        const off = interaction({ customId: bot.manageId("d", event.id, RAIDER) });
        await stepCommand.execute(off);
        expect(signupStore.getSignup(event.id, RAIDER)).toBeNull();
    });

    it("pings the missing raiders in the event channel and logs it", async () => {
        const i = interaction({ customId: bot.manageId("p", event.id) });
        await stepCommand.execute(i);
        expect(pingMissingRaiders).toHaveBeenCalledWith({ guildId: GUILD, eventId: event.id, target: "event" });
        expect(eventStore.getEvent(event.id).log.at(-1)).toMatchObject({ action: "ping", detail: "3 Raider" });
    });

    it("edits title, size and description from the modal", async () => {
        const i = interaction({ customId: `event-manage-form:e:${event.id}`, modal: true, options: { title: "SSC + TK (Neu)", comp: "25/3/6", description: "" } });
        await formCommand.execute(i);
        expect(updateEvent).toHaveBeenCalledWith(expect.objectContaining({
            guildId: GUILD, byName: "Orga",
            body: expect.objectContaining({ id: event.id, title: "SSC + TK (Neu)", size: 25, composition: expect.objectContaining({ tank: 3, healer: 6 }) }),
        }));
        expect(lastPayload(i.editReply).embeds[0].description).toContain("Gespeichert.");
    });

    it("moves only after the preview: it shows the channel's new name and who is told, then confirms", async () => {
        channelNaming.deriveChannelName.mockResolvedValue({ name: "fr-26-09-ssc-tk", source: "previous", fromChannelId: CHANNEL, label: "abgeleitet aus #mi-24-09-ssc-tk" });
        const target = DateTime.now().setZone(ZONE).plus({ days: 9 });
        const i = interaction({ customId: `event-manage-form:v:${event.id}`, modal: true, options: { date: target.toFormat("dd.MM.yyyy"), time: "20:00" } });
        await formCommand.execute(i);
        const preview = lastPayload(i.editReply);
        expect(preview.embeds[0].title).toBe("SSC + TK verschieben?");
        expect(preview.embeds[0].description).toContain("`mi-24-09-ssc-tk` → `fr-26-09-ssc-tk`");
        expect(preview.embeds[0].description).toContain("an 1 Angemeldete");
        expect(eventStore.getEvent(event.id).startTime).toBe(event.startTime);
        const labels = buttons(preview).map((b) => b.label);
        expect(labels).toEqual(["Verschieben", "Ohne Umbenennen", "Ohne Hinweis", "Zurück"]);

        const confirm = interaction({ customId: buttons(preview)[0].custom_id });
        await stepCommand.execute(confirm);
        const moved = eventStore.getEvent(event.id);
        expect(DateTime.fromSeconds(moved.startTime, { zone: ZONE }).toFormat("dd.MM. HH:mm")).toBe(target.toFormat("dd.MM. 20:00"));
        expect(moved.channelName).toBe("fr-26-09-ssc-tk");
        expect(deliverUserPing).toHaveBeenCalled();
        expect(lastPayload(confirm.editReply).embeds[0].description).toMatch(/Verschoben auf/);
    });

    it("cancels with a reason from the modal: DM to the signed-up raider, archive only on \"ja\", and reopens", async () => {
        const i = interaction({ customId: `event-manage-form:x:${event.id}`, modal: true, options: { reason: "Zu wenig Heiler", archive: "nein" } });
        await formCommand.execute(i);
        expect(eventStore.getEvent(event.id)).toMatchObject({ status: "cancelled", cancel: { reason: "Zu wenig Heiler", archived: false } });
        expect(sendDms).toHaveBeenCalledWith([RAIDER], expect.any(Object));
        const payload = lastPayload(i.editReply);
        expect(payload.embeds[0].title).toBe("ABGESAGT · SSC + TK verwalten");
        expect(buttons(payload).filter((b) => b.disabled).map((b) => b.label || b.placeholder)).toEqual([
            "Bearbeiten", "Verschieben", "Anmeldung öffnen", "Raider eintragen / austragen …", "Fehlende pingen",
        ]);
        const reopen = buttons(payload).find((b) => b.label === "Absage zurücknehmen");
        const back = interaction({ customId: reopen.custom_id });
        await stepCommand.execute(back);
        expect(eventStore.getEvent(event.id).status).toBe("active");
    });

    it("deletes only with LÖSCHEN typed: the event and its signups go, the message is deleted, the panel says so", async () => {
        const message = { delete: jest.fn(async () => ({})) };
        const client = makeClient({ channels: [makeChannel({ id: CHANNEL, guildId: GUILD, messages: [["700000000000000001", message]] })] });
        require("../../../src/web/discord").getClient.mockReturnValue(client);

        const modal = interaction({ customId: bot.manageId("l", event.id) });
        await stepCommand.execute(modal);
        const fields = lastPayload(modal.showModal).toJSON().components.map((r) => r.components[0].custom_id);
        // a raid still ahead: the DM is offered, "nein" by default
        expect(fields).toEqual(["confirm", "archive", "notify"]);

        const wrong = interaction({ customId: `event-manage-form:l:${event.id}`, modal: true, options: { confirm: "ja", archive: "nein", notify: "nein" } });
        await formCommand.execute(wrong);
        expect(eventStore.getEvent(event.id)).not.toBeNull();
        expect(lastPayload(wrong.editReply).embeds[0].description).toMatch(/LÖSCHEN/);

        const i = interaction({ customId: `event-manage-form:l:${event.id}`, modal: true, options: { confirm: "löschen", archive: "nein", notify: "nein" } });
        await formCommand.execute(i);
        expect(eventStore.getEvent(event.id)).toBeNull();
        expect(signupStore.listSignups(event.id)).toEqual([]);
        expect(message.delete).toHaveBeenCalled();
        expect(sendDms).not.toHaveBeenCalled();
        const payload = lastPayload(i.editReply);
        expect(payload.embeds[0].title).toBe("SSC + TK gelöscht");
        expect(payload.embeds[0].description).toContain("1 Anmeldung entfernt");
        expect(payload.components).toEqual([]);
    });

    it("offers no DM in the delete modal for a cancelled event, and deletes a started raid once LÖSCHEN is typed", async () => {
        eventStore.setEventState(event.id, { status: "cancelled", cancel: { reason: "x" } });
        const modal = interaction({ customId: bot.manageId("l", event.id) });
        await stepCommand.execute(modal);
        expect(lastPayload(modal.showModal).toJSON().components.map((r) => r.components[0].custom_id)).toEqual(["confirm", "archive"]);

        eventStore.updateEvent(event.id, { startTime: Math.floor(Date.now() / 1000) - 3600 });
        const i = interaction({ customId: `event-manage-form:l:${event.id}`, modal: true, options: { confirm: "LÖSCHEN", archive: "nein" } });
        await formCommand.execute(i);
        expect(eventStore.getEvent(event.id)).toBeNull();
    });

    it("a click on an event that is gone, or of another server, says so", async () => {
        const i = interaction({ customId: bot.manageId("s", "eh-gone") });
        await stepCommand.execute(i);
        expect(lastPayload(i.update).content).toMatch(/gibt es nicht/);
    });
});
