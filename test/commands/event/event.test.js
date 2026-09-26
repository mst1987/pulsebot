jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(), listAllChannels: jest.fn(), fetchGuildMembersCached: jest.fn() }));
jest.mock("../../../src/stores/channelArchiveStore", () => ({ getChannelConfig: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(), listRaidTemplates: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({ signupSourceFor: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "") }));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const { MessageFlags } = require("discord.js");
const discord = require("../../../src/services/discord/discord");
const archiveStore = require("../../../src/stores/channelArchiveStore");
const settings = require("../../../src/stores/settingsStore");
const { signupSourceFor } = require("../../../src/services/events/eventSources");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { eventGuildId } = require("../../../src/services/discord/guildRoles");
const { createEvent } = require("../../../src/services/events/eventCreate");
const { guardInteraction } = require("../../../src/services/discord/botAccess");
const draft = require("../../../src/services/events/eventDraft");
const eventCommand = require("../../../src/commands/event/event");
const stepCommand = require("../../../src/commands/event/eventCreateStep");
const formCommand = require("../../../src/commands/event/eventCreateModal");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const CAT_EH = "100000000000000001";
const CAT_RH = "100000000000000002";
const ORGA = "900000000000000001";
const T5 = {
    id: "a1b2c3d4e5f6", name: "T5 25er", instanceIds: ["ssc", "tk"], size: 25,
    composition: { tank: 3, healer: 6 }, raidhelperTemplateId: "",
};
const RH = { id: "rh-37", name: "Raid-Helper Standard", instanceIds: [], size: null, composition: { tank: 0, healer: 0 }, raidhelperTemplateId: "37" };
const commands = new Map([eventCommand, stepCommand, formCommand].map((c) => [c.name, c]));
const lastPayload = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];
const future = () => {
    const d = new Date(Date.now() + 10 * 86400000);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

beforeEach(() => {
    jest.clearAllMocks();
    discord.listCategories.mockReturnValue([{ id: CAT_EH, name: "Mittwoch-Raid" }, { id: CAT_RH, name: "PuG" }]);
    discord.listAllChannels.mockReturnValue([{ id: "200000000000000001", name: "mi-17-09-ssc-tk" }]);
    archiveStore.getChannelConfig.mockReturnValue({ schemas: {} });
    settings.getConfig.mockReturnValue({ categoryIds: [CAT_EH, CAT_RH], categoryRaidTemplate: { [CAT_EH]: T5.id } });
    settings.listRaidTemplates.mockReturnValue([T5, RH]);
    settings.getRaidTemplate.mockImplementation((id) => [T5, RH].find((t) => t.id === id) || null);
    signupSourceFor.mockImplementation((cat) => (cat === CAT_EH ? "eventhelper" : "raidhelper"));
    loadEventGroups.mockResolvedValue({ groups: [] });
    eventGuildId.mockReturnValue("");
});

describe("/event anlegen — access", () => {
    it("is for admins by default; its selects, buttons and modal inherit it", () => {
        expect(eventCommand).toMatchObject({ group: "raids", defaultAccess: "admins" });
        expect(stepCommand.accessOf).toBe("event");
        expect(formCommand.accessOf).toBe("event");
        expect(memberMayRun(eventCommand)).toBe(false);
    });

    it("the router guard refuses a member without the role on every step, and lets the orga role through", async () => {
        const state = draft.initialState("guild-1", CAT_EH);
        for (const [command, customId, modal] of [
            [eventCommand, undefined, false], [stepCommand, draft._internal.stepId("k", state), false],
            [formCommand, draft._internal.formId(state), false], [formCommand, draft._internal.formId(state), true],
        ]) {
            const i = mockInteraction({ commandName: customId ? undefined : "event", customId, modal });
            expect(await guardInteraction(i, command, commands)).toBe(false);
            expect(i.reply).toHaveBeenCalledWith({ content: "This is reserved for admins.", flags: MessageFlags.Ephemeral });
            expect(i.showModal).not.toHaveBeenCalled();
        }

        settings.getConfig.mockReturnValue({ categoryIds: [CAT_EH], botCommandAccess: { event: { mode: "roles", roleIds: [ORGA] } } });
        eventGuildId.mockReturnValue("guild-1");
        const orga = mockInteraction({ customId: draft._internal.formId(state) });
        orga.member = { roles: [ORGA] };
        expect(await guardInteraction(orga, formCommand, commands)).toBe(true);
    });
});

describe("/event anlegen — step 1", () => {
    it("answers only the user, starting in the category of the channel", async () => {
        const i = mockInteraction({ commandName: "event", options: { __subcommand: "anlegen" }, channel: { id: "c", parentId: CAT_RH } });
        await eventCommand.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const payload = lastPayload(i.editReply);
        expect(payload.embeds[0].description).toContain("**Kategorie:** PuG");
        expect(payload.embeds[0].description).toContain("**Anmeldung über:** Raid-Helper");
        expect(payload.embeds[0].footer.text).toBe("Schritt 1 von 2");
    });

    it("refuses outside the event server", async () => {
        eventGuildId.mockReturnValue("other-guild");
        const i = mockInteraction({ commandName: "event", options: { __subcommand: "anlegen" } });
        await eventCommand.execute(i);
        expect(i.reply).toHaveBeenCalledWith({ content: "Events legst du auf dem Event-Server an.", flags: MessageFlags.Ephemeral });
    });

    it("a select redraws the message with the choice in every customId", async () => {
        const state = draft.initialState("guild-1", CAT_EH);
        const i = mockInteraction({ customId: draft._internal.stepId("c", state), values: [CAT_RH] });
        await stepCommand.execute(i);
        expect(i.deferUpdate).toHaveBeenCalled();
        const payload = lastPayload(i.editReply);
        const weiter = payload.components[payload.components.length - 1].components[0];
        expect(draft.parseCustomId(weiter.custom_id).state).toEqual({ cat: CAT_RH, tpl: RH.id, mode: "n", src: "r", ref: "", ann: "" });
    });

    it("switches the channel mode, the source, and cancels", async () => {
        const state = draft.initialState("guild-1", CAT_EH);
        const mode = mockInteraction({ customId: draft._internal.stepId("k", state), values: ["e"] });
        await stepCommand.execute(mode);
        expect(lastPayload(mode.editReply).components[3].components[0].type).toBe(8);

        const src = mockInteraction({ customId: draft._internal.stepId("s", state) });
        await stepCommand.execute(src);
        expect(lastPayload(src.editReply).embeds[0].description).toContain("**Anmeldung über:** Raid-Helper");

        const cancel = mockInteraction({ customId: draft._internal.stepId("x", state) });
        await stepCommand.execute(cancel);
        expect(cancel.update).toHaveBeenCalledWith({ content: "Abgebrochen.", embeds: [], components: [] });
    });
});

describe("/event anlegen — step 2", () => {
    it("Weiter opens the modal at once (no defer), prefilled from the template", async () => {
        const state = draft.initialState("guild-1", CAT_EH);
        const i = mockInteraction({ customId: draft._internal.formId(state) });
        await formCommand.execute(i);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        const json = i.showModal.mock.calls[0][0].toJSON();
        expect(json.custom_id).toBe(draft._internal.formId(state));
        const comp = json.components.map((r) => r.components[0]).find((c) => c.custom_id === "comp");
        expect(comp.value).toBe("25/3/6");
    });

    it("submitting creates the event and shows the confirmation in place of step 1", async () => {
        createEvent.mockResolvedValue({ status: 201, body: { id: "eh-abc", event: { id: "eh-abc", channelId: "555", size: 25 }, messageError: null } });
        const state = draft.initialState("guild-1", CAT_EH);
        const i = mockInteraction({
            customId: draft._internal.formId(state), modal: true,
            options: { title: "SSC + TK", date: future(), time: "1930", comp: "25/3/6", description: "" },
        });
        await formCommand.execute(i);
        expect(i.deferUpdate).toHaveBeenCalled();
        expect(createEvent.mock.calls[0][0].body).toMatchObject({ signupSource: "eventhelper", time: "19:30", newChannel: expect.objectContaining({ categoryId: CAT_EH }) });
        const payload = lastPayload(i.editReply);
        expect(payload.embeds[0].title).toBe("Event angelegt · SSC + TK");
        expect(payload.components[0].components.map((b) => b.label)).toEqual(["Zum Kanal", "Im Web bearbeiten", "Ankündigung pingen"]);
    });

    it("a Raid-Helper category creates through Raid-Helper with its linked template", async () => {
        createEvent.mockResolvedValue({ status: 201, body: { id: "1234567890", channelId: "200000000000000001" } });
        const state = { ...draft.initialState("guild-1", CAT_RH), mode: "e", ref: "200000000000000001" };
        const i = mockInteraction({ customId: draft._internal.formId(state), modal: true, options: { title: "Kara", date: future(), time: "20:00", description: "" } });
        await formCommand.execute(i);
        expect(createEvent.mock.calls[0][0].body).toMatchObject({ signupSource: "raidhelper", templateId: "37", channelId: "200000000000000001" });
        expect(lastPayload(i.editReply).embeds[0].description).toContain("Kanal <#200000000000000001> gewählt");
    });

    it("an error offers Nochmal, which reopens the modal with what was typed", async () => {
        discord.listAllChannels.mockReturnValue([{ id: "1", name: "x" }]);
        const state = draft.initialState("guild-1", CAT_EH);
        const typed = { title: "Vashj Progress", date: "01.01.2020", time: "19:30", comp: "25/4/7", description: "P2 üben" };
        const submit = mockInteraction({ customId: draft._internal.formId(state), modal: true, options: typed, userId: "77" });
        await formCommand.execute(submit);
        const payload = lastPayload(submit.editReply);
        expect(payload.embeds[0].description).toContain("Vergangenheit");
        expect(createEvent).not.toHaveBeenCalled();
        const [again, back] = payload.components[0].components;
        expect(back.label).toBe("Zurück");

        const click = mockInteraction({ customId: again.custom_id, userId: "77" });
        await formCommand.execute(click);
        const fields = Object.fromEntries(click.showModal.mock.calls[0][0].toJSON().components.map((r) => [r.components[0].custom_id, r.components[0].value]));
        expect(fields).toEqual({ title: "Vashj Progress", date: "01.01.2020", time: "19:30", comp: "25/4/7", description: "P2 üben" });

        const backClick = mockInteraction({ customId: back.custom_id });
        await stepCommand.execute(backClick);
        expect(lastPayload(backClick.editReply).embeds[0].title).toBe("Neues Event");
    });
});
