// /event anlegen: "Kanalname anpassen …" — the channel name typed as a pattern before the
// channel exists (eventDraft.js, commands/event/eventCreateStep.js).
jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(), listAllChannels: jest.fn() }));
jest.mock("../../../src/stores/channelArchiveStore", () => ({ getChannelConfig: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(), listRaidTemplates: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({ signupSourceFor: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ serverIds: jest.fn(() => []) }));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1 }));

const discord = require("../../../src/services/discord/discord");
const archiveStore = require("../../../src/stores/channelArchiveStore");
const settings = require("../../../src/stores/settingsStore");
const { signupSourceFor } = require("../../../src/services/events/eventSources");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { createEvent } = require("../../../src/services/events/eventCreate");
const draft = require("../../../src/services/events/eventDraft");
const channelNaming = require("../../../src/services/discord/channelNaming");
const stepCommand = require("../../../src/commands/event/eventCreateStep");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { cardText } = require("../../helpers/cardText");
const { knownChannels } = require("../../helpers/linkCheck");

const CAT = "100000000000000001";
const PREV = "300000000000000001";
const T5 = {
    id: "a1b2c3d4e5f6", name: "T5 25er", instanceIds: ["ssc", "tk"], size: 25,
    composition: { tank: 3, healer: 6, melee: null, ranged: null }, raidhelperTemplateId: "",
};
// 16.09.2026, 12:00 Berlin
const NOW = Date.UTC(2026, 8, 16, 10, 0);
const USER = "42";
const state = (over = {}) => ({ cat: CAT, tpl: T5.id, mode: "n", src: "e", ref: "", ann: "", ico: "", ...over });
const values = (over = {}) => ({ title: "SSC + TK", date: "24.09.", time: "19:30", comp: "25/3/6", description: "", ...over });
const build = (s, v = values()) => draft._internal.buildBody("g1", s, v, { userId: USER, now: NOW });
const buttonsOf = (payload) => payload.components[payload.components.length - 1].components;
const placeholders = (payload) => payload.components.map((r) => r.components[0].placeholder);

let channels;
beforeEach(() => {
    jest.clearAllMocks();
    knownChannels(PREV);
    draft.clearNamePattern(USER);
    // the previous event of the category: 09.09.2026, its channel named 🏔️👑》ssc-tk-09-sep
    channels = [{ id: PREV, name: "🏔️👑》ssc-tk-09-sep", parentId: CAT }];
    discord.listCategories.mockReturnValue([{ id: CAT, name: "Mittwoch-Raid" }]);
    discord.listAllChannels.mockImplementation(() => channels);
    archiveStore.getChannelConfig.mockReturnValue({ schemas: {} });
    settings.getConfig.mockReturnValue({ categoryIds: [CAT], categoryRaidTemplate: { [CAT]: T5.id } });
    settings.listRaidTemplates.mockReturnValue([T5]);
    settings.getRaidTemplate.mockImplementation((id) => (id === T5.id ? T5 : null));
    signupSourceFor.mockReturnValue("eventhelper");
    loadEventGroups.mockResolvedValue({
        groups: [{
            categoryId: CAT,
            events: [{ id: "eh-prev", title: "SSC + TK", channelId: PREV, startTime: Math.floor(Date.UTC(2026, 8, 9, 17, 30) / 1000), instanceIds: ["ssc", "tk"] }],
        }],
    });
});

describe("Kanalname anpassen — the button and the modal", () => {
    it("is in the button row of a new channel, within the five buttons of a row", async () => {
        const { payload } = await draft.stepMessage("g1", state(), { userId: USER });
        expect(buttonsOf(payload).map((b) => b.label)).toEqual(["Weiter", "Anmeldung über Raid-Helper", "Ankündigung: aus", "Kanalname anpassen …", "Abbrechen"]);
        expect(buttonsOf(payload)[3].custom_id).toBe(draft._internal.stepId("n", state()));
    });

    it("duplicating has six candidates for the row: the cancel button gives way, the icon button stays", async () => {
        const s = state({ mode: "d", ref: "eh-prev" });
        const { payload } = await draft.stepMessage("g1", s, { userId: USER });
        const labels = buttonsOf(payload).map((b) => b.label);
        expect(labels).toHaveLength(5);
        expect(labels).toEqual(expect.arrayContaining(["Weiter", "Kanalname anpassen …"]));
        expect(labels.some((l) => l.startsWith("Icon:"))).toBe(true);
        for (const r of payload.components) expect(r.components.length).toBeLessThanOrEqual(5);
        expect(payload.components.length).toBeLessThanOrEqual(5);
    });

    it("an existing channel has nothing to name", async () => {
        const { payload } = await draft.stepMessage("g1", state({ mode: "e", ref: PREV }), { userId: USER });
        expect(buttonsOf(payload).map((b) => b.label)).not.toContain("Kanalname anpassen …");
    });

    it("opens with the pattern of the derived name: the date as placeholders, the raid as {raid}", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        expect(draft.namePrefill(USER, state())).toBe("🏔️👑》{raid}-{dd}-{mon}");
        const json = draft.nameModal(state(), draft.namePrefill(USER, state())).toJSON();
        const field = json.components[0].components[0];
        expect(json.custom_id).toBe(draft._internal.stepId("n", state()));
        expect(json.components).toHaveLength(1);
        expect(field).toMatchObject({ custom_id: "name", value: "🏔️👑》{raid}-{dd}-{mon}", required: false });
        expect(field.label).toContain("{dd}");
        expect(field.label.length).toBeLessThanOrEqual(45);
        expect(field.placeholder.length).toBeLessThanOrEqual(100);
    });

    it("applies the current icon pick to the prefilled pattern (placeholders survive)", async () => {
        await draft.stepMessage("g1", state({ ico: "x" }), { userId: USER });
        expect(draft.namePrefill(USER, state({ ico: "x" }))).toBe("{raid}-{dd}-{mon}");
        await draft.stepMessage("g1", state({ ico: "c0" }), { userId: USER });
        const prefill = draft.namePrefill(USER, state({ ico: "c0" }));
        expect(prefill).toMatch(/\{raid\}-\{dd\}-\{mon\}$/);
    });

    it("the button opens the modal at once, without deferring", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        const i = mockInteraction({ userId: USER, customId: draft._internal.stepId("n", state()) });
        i.guild.id = "g1";
        await stepCommand.execute(i);
        expect(i.deferUpdate).not.toHaveBeenCalled();
        const field = i.showModal.mock.calls[0][0].toJSON().components[0].components[0];
        expect(field.value).toBe("🏔️👑》{raid}-{dd}-{mon}");
    });

    it("the submit keeps the pattern, redraws step 1 with it and hides the icon choice", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        const i = mockInteraction({ userId: USER, customId: draft._internal.stepId("n", state()), modal: true, options: { name: "🏔️👑》hyjal-bt-{dd}-{mon}" } });
        i.guild.id = "g1";
        await stepCommand.execute(i);
        expect(i.deferUpdate).toHaveBeenCalled();
        const payload = i.editReply.mock.calls[0][0];
        expect(payload.embeds[0].description).toContain("neu · Name `🏔️👑》hyjal-bt-{dd}-{mon}` · von Hand angepasst");
        expect(payload.embeds[0].description).toContain("**Kanal-Icon:** steckt im Namen von Hand");
        expect(placeholders(payload)).not.toContain("Kanal-Icon");
        expect(buttonsOf(payload).map((b) => b.label)).toContain("Kanalname: von Hand …");
        expect(i.followUp).not.toHaveBeenCalled();
    });

    it("refuses a placeholder that does not exist and keeps the earlier name", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        draft.submitNamePattern(USER, state(), "raid-{dd}");
        const i = mockInteraction({ userId: USER, customId: draft._internal.stepId("n", state()), modal: true, options: { name: "raid-{datum}" } });
        i.guild.id = "g1";
        await stepCommand.execute(i);
        expect(cardText(i.followUp.mock.calls[0][0])).toContain("{datum}");
        expect(draft.getNamePattern(USER, state())).toBe("raid-{dd}");
        expect(draft.submitNamePattern(USER, state(), "!!!")).toEqual({ error: "Daraus ergibt sich kein gültiger Kanalname." });
    });

    it("an empty submit goes back to the derived name", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        draft.submitNamePattern(USER, state(), "raid-{dd}");
        expect(draft.submitNamePattern(USER, state(), "  ")).toEqual({ cleared: true });
        expect(draft.getNamePattern(USER, state())).toBe("");
        const { payload } = await draft.stepMessage("g1", state(), { userId: USER });
        expect(payload.embeds[0].description).not.toContain("von Hand");
        expect(placeholders(payload)).toContain("Kanal-Icon");
    });

    it("belongs to one category/template/mode: choosing another drops it; cancelling forgets it", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        draft.submitNamePattern(USER, state(), "raid-{dd}");
        expect(draft.getNamePattern(USER, state({ mode: "d", ref: "eh-prev" }))).toBe("");
        await draft.stepMessage("g1", state({ mode: "d", ref: "eh-prev" }), { userId: USER });
        expect(draft.getNamePattern(USER, state())).toBe("");

        draft.submitNamePattern(USER, state({ mode: "d", ref: "eh-prev" }), "raid-{dd}");
        const x = mockInteraction({ userId: USER, customId: draft._internal.stepId("x", state({ mode: "d", ref: "eh-prev" })) });
        await stepCommand.execute(x);
        expect(draft.getNamePattern(USER, state({ mode: "d", ref: "eh-prev" }))).toBe("");
    });

    it("is kept per user, and for half an hour", async () => {
        await draft.stepMessage("g1", state(), { userId: USER });
        draft.submitNamePattern(USER, state(), "raid-{dd}", NOW);
        expect(draft.getNamePattern("43", state(), NOW)).toBe("");
        expect(draft.getNamePattern(USER, state(), NOW + 29 * 60 * 1000)).toBe("raid-{dd}");
        expect(draft.getNamePattern(USER, state(), NOW + 31 * 60 * 1000)).toBe("");
    });

    it("needs no room in the customId: the worst case of every id still fits 100 characters", async () => {
        const worst = { cat: "12345678901234567890", tpl: "x".repeat(24), mode: "d", src: "r", ref: "y".repeat(24), ann: "1", ico: "r12" };
        for (const id of [draft._internal.stepId("n", worst), draft._internal.formId(worst, "0a1b2c3d")]) expect(id.length).toBeLessThanOrEqual(100);
        expect(draft.nameModal(worst, "x").toJSON().custom_id.length).toBeLessThanOrEqual(100);
    });
});

describe("Kanalname anpassen — when the channel is created", () => {
    it("a typed pattern wins over the derived name and the icon pick, filled with the event's date and raid", async () => {
        draft.submitNamePattern(USER, state({ ico: "x" }), "🏔️👑》hyjal-bt-{dd}-{mon}");
        const { body, naming, error } = await build(state({ ico: "x" }));
        expect(error).toBeUndefined();
        expect(body.newChannel).toMatchObject({ name: "🏔️👑》hyjal-bt-24-sep", categoryId: CAT });
        expect(naming).toMatchObject({ source: "manual", label: "von Hand angepasst" });

        // {raid} is the raid tag of the template, {tag} the weekday
        draft.submitNamePattern(USER, state(), "{tag}-{raid}-{dd}.{mm}");
        expect((await build(state())).body.newChannel.name).toBe("do-ssc-tk-2409");
    });

    it("a pattern without placeholders is used literally, normalised like Discord does", async () => {
        draft.submitNamePattern(USER, state(), "Raid Abend!");
        expect((await build(state())).body.newChannel.name).toBe("raid-abend");
    });

    it("duplicating uses it as the new channel's name", async () => {
        const s = state({ mode: "d", ref: "eh-prev" });
        await draft.stepMessage("g1", s, { userId: USER });
        draft.submitNamePattern(USER, s, "neu-{dd}-{mm}");
        const { body } = await build(s);
        expect(body).toMatchObject({ sourceEventId: "eh-prev", channelName: "neu-24-09" });
    });

    it("refuses a name an existing channel has, saying where to change it, and keeps the pattern for another go", async () => {
        channels.push({ id: "300000000000000009", name: "raid-24-09", parentId: CAT });
        draft.submitNamePattern(USER, state(), "raid-{dd}-{mm}");
        const first = await build(state());
        expect(first.error).toContain("raid-24-09");
        expect(first.error).toContain("Kanalname anpassen");
        // "Nochmal": the same state, the pattern is still there; another date works
        expect((await build(state(), values({ date: "25.09." }))).body.newChannel.name).toBe("raid-25-09");
    });

    it("refuses a pattern that ends up as nothing (no date, only placeholders of the date)", async () => {
        draft.submitNamePattern(USER, state(), "{raid}");
        settings.getRaidTemplate.mockImplementation((id) => (id === T5.id ? { ...T5, instanceIds: [] } : null));
        expect((await build(state())).error).toContain("kein Kanalname");
    });

    it("a successful create forgets it, so the next event starts with the derived name", async () => {
        draft.submitNamePattern(USER, state(), "raid-{dd}");
        createEvent.mockResolvedValue({ body: { id: "eh-new", event: { id: "eh-new", channelId: PREV, channelName: "raid-24" } } });
        const done = await draft.submitForm("g1", state(), values(), { userId: USER, now: NOW });
        expect(done.ok).toBe(true);
        expect(createEvent.mock.calls[0][0].body.newChannel.name).toBe("raid-24");
        expect(draft.getNamePattern(USER, state())).toBe("");
        expect(done.payload.embeds[0].description).toContain("von Hand angepasst");
    });

    it("without a typed pattern nothing changes: derived name plus icon", async () => {
        const { body } = await build(state());
        expect(body.newChannel.name).toBe("🏔️👑》ssc-tk-24-sep");
    });
});

describe("the next raid of the same kind inherits the new pattern", () => {
    it("deriveChannelName picks up a channel named with the typed pattern", async () => {
        draft.submitNamePattern(USER, state(), "🐍》{tag}-{raid}-{dd}-{mon}");
        const { body } = await build(state());
        const name = body.newChannel.name;
        expect(name).toBe("🐍》do-ssc-tk-24-sep");

        // That channel now exists, with its event: the category's latest channel for the next week
        channels = [{ id: "300000000000000002", name, parentId: CAT }];
        loadEventGroups.mockResolvedValue({
            groups: [{
                categoryId: CAT,
                events: [{ id: "eh-hyjal", title: "Hyjal", channelId: "300000000000000002", startTime: Math.floor(Date.UTC(2026, 8, 24, 17, 30) / 1000), instanceIds: ["ssc", "tk"] }],
            }],
        });
        const next = await channelNaming.deriveChannelName({ guildId: "g1", categoryId: CAT, date: "2026-10-01", instanceIds: ["ssc", "tk"] });
        expect(next.source).toBe("previous");
        expect(next.fromChannel).toBe(name);
        expect(next.name).toBe("🐍》do-ssc-tk-01-oct");
        expect(next.patternText).toBe("🐍》{tag}-{raid}-{dd}-{mon}");
    });
});

describe("the steps acknowledge first (no more \"Interaction failed\")", () => {
    const { serverIds } = require("../../../src/services/discord/roles/guildRoles");
    const formCommand = require("../../../src/commands/event/eventCreateModal");

    it("a select defers before it even looks at the server, and a refusal edits the message", async () => {
        serverIds.mockReturnValue(["other-guild"]);
        const i = mockInteraction({ userId: USER, customId: draft._internal.stepId("c", state()), values: [CAT] });
        i.guild.id = "g1";
        i.deferUpdate.mockImplementation(async () => {
            expect(i.editReply).not.toHaveBeenCalled();
            expect(i.update).not.toHaveBeenCalled();
        });
        await stepCommand.execute(i);
        expect(i.deferUpdate).toHaveBeenCalledTimes(1);
        expect(cardText(i.editReply.mock.calls[0][0])).toContain("Raid-Server");
        expect(i.update).not.toHaveBeenCalled();
        serverIds.mockReturnValue([]);
    });

    it("the form submit defers first; the Weiter button opens the modal without deferring", async () => {
        const order = [];
        const submit = mockInteraction({ userId: USER, customId: draft._internal.formId(state()), modal: true, options: { title: "x" } });
        submit.guild.id = "g1";
        submit.deferUpdate.mockImplementation(async () => { order.push("defer"); });
        submit.editReply.mockImplementation(async () => { order.push("edit"); });
        await formCommand.execute(submit);
        expect(order[0]).toBe("defer");
        expect(order).toContain("edit");

        const weiter = mockInteraction({ userId: USER, customId: draft._internal.formId(state()) });
        weiter.guild.id = "g1";
        await formCommand.execute(weiter);
        expect(weiter.deferUpdate).not.toHaveBeenCalled();
        expect(weiter.showModal).toHaveBeenCalledTimes(1);
    });

    it("a refused server on the Weiter button is a reply, never a modal", async () => {
        serverIds.mockReturnValue(["other-guild"]);
        const weiter = mockInteraction({ userId: USER, customId: draft._internal.formId(state()) });
        weiter.guild.id = "g1";
        await formCommand.execute(weiter);
        expect(weiter.showModal).not.toHaveBeenCalled();
        expect(weiter.reply).toHaveBeenCalled();
        serverIds.mockReturnValue([]);
    });
});
