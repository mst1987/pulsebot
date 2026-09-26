jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(), listAllChannels: jest.fn() }));
jest.mock("../../../src/stores/channelArchiveStore", () => ({ getChannelConfig: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(), listRaidTemplates: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({ signupSourceFor: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "") }));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1 }));

const discord = require("../../../src/services/discord/discord");
const archiveStore = require("../../../src/stores/channelArchiveStore");
const settings = require("../../../src/stores/settingsStore");
const { signupSourceFor } = require("../../../src/services/events/eventSources");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { eventGuildId } = require("../../../src/services/discord/guildRoles");
const { createEvent } = require("../../../src/services/events/eventCreate");
const draft = require("../../../src/services/events/eventDraft");

const CAT_EH = "100000000000000001";
const CAT_RH = "100000000000000002";
const T5 = {
    id: "a1b2c3d4e5f6", name: "T5 25er", instanceIds: ["ssc", "tk"], size: 25,
    composition: { tank: 3, healer: 6, melee: null, ranged: { min: 5, max: null } }, raidhelperTemplateId: "",
};
const RH = { id: "rh-37", name: "Raid-Helper Standard", instanceIds: [], size: null, composition: { tank: 0, healer: 0 }, raidhelperTemplateId: "37" };
// 16.09.2026, 12:00 Berlin
const NOW = Date.UTC(2026, 8, 16, 10, 0);
const values = (over = {}) => ({ title: "SSC + TK", date: "24.09.", time: "19:30", comp: "25/3/6", description: "Flasks Pflicht", ...over });
const state = (over = {}) => ({ cat: CAT_EH, tpl: T5.id, mode: "n", src: "e", ref: "", ann: "", ...over });

beforeEach(() => {
    jest.clearAllMocks();
    discord.listCategories.mockReturnValue([{ id: CAT_EH, name: "Mittwoch-Raid" }, { id: CAT_RH, name: "PuG" }, { id: "100000000000000009", name: "Archiv" }]);
    discord.listAllChannels.mockReturnValue([{ id: "200000000000000001", name: "mi-17-09-ssc-tk" }]);
    archiveStore.getChannelConfig.mockReturnValue({ schemas: {} });
    settings.getConfig.mockReturnValue({ categoryIds: [CAT_EH, CAT_RH], categoryRaidTemplate: { [CAT_EH]: T5.id } });
    settings.listRaidTemplates.mockReturnValue([T5, RH]);
    settings.getRaidTemplate.mockImplementation((id) => [T5, RH].find((t) => t.id === id) || null);
    signupSourceFor.mockImplementation((cat) => (cat === CAT_EH ? "eventhelper" : "raidhelper"));
    loadEventGroups.mockResolvedValue({ groups: [] });
    eventGuildId.mockReturnValue("");
});

describe("services/events/eventDraft — the state in the customId", () => {
    it("round-trips a state and drops what is not an id", () => {
        const s = state({ mode: "d", ref: "eh-mfx1k2abc123" });
        expect(draft.parseCustomId(draft._internal.stepId("c", s))).toEqual({ prefix: "event-new", field: "c", state: s, token: "" });
        expect(draft.parseCustomId(draft._internal.formId(s, "0a1b2c3d"))).toMatchObject({ prefix: "event-form", state: s, token: "0a1b2c3d" });
        expect(draft.parseCustomId("event-form:12:<script>:z:q:../x:nope").state).toEqual({ cat: "", tpl: "", mode: "n", src: "", ref: "", ann: "" });
    });

    it("stays within Discord's 100 characters in the worst case", () => {
        const worst = { cat: "12345678901234567890", tpl: "x".repeat(24), mode: "d", src: "r", ref: "y".repeat(24), ann: "1" };
        for (const id of [draft._internal.stepId("c", worst), draft._internal.stepId("b", worst), draft._internal.formId(worst, "0a1b2c3d")]) {
            expect({ id, fits: id.length <= draft._internal.CUSTOM_ID_MAX }).toEqual({ id, fits: true });
        }
        // an id longer than that is never carried
        expect(draft._internal.cleanState({ ...worst, tpl: "x".repeat(25) }).tpl).toBe("");
    });
});

describe("services/events/eventDraft — step 1", () => {
    it("starts in the channel's category with its template and source", () => {
        expect(draft.initialState("g1", CAT_RH)).toEqual({ cat: CAT_RH, tpl: RH.id, mode: "n", src: "r", ref: "", ann: "" });
        expect(draft.initialState("g1", "elsewhere")).toEqual({ cat: CAT_EH, tpl: T5.id, mode: "n", src: "e", ref: "", ann: "" });
    });

    it("offers only the event categories and the templates that fit the source", async () => {
        const { payload } = await draft.stepMessage("g1", state());
        const [cats, tpls, modes, buttons] = payload.components.map((r) => r.components);
        expect(cats[0].options.map((o) => o.label)).toEqual(["Mittwoch-Raid", "PuG"]);
        expect(tpls[0].options).toEqual([expect.objectContaining({ value: T5.id, default: true, description: "SSC + TK · 25er · 3 T / 6 H / 16 DPS" })]);
        expect(modes[0].options.map((o) => o.value)).toEqual(["n", "d", "e"]);
        expect(buttons.map((b) => b.label)).toEqual(["Weiter", "Anmeldung über Raid-Helper", "Ankündigung: aus", "Abbrechen"]);
        expect(buttons[0]).toMatchObject({ custom_id: draft._internal.formId(state()), disabled: false });
        expect(payload.embeds[0].description).toContain("neu nach Standard-Schema `{tag}-{dd}-{mm}-{raid}`");
        expect(payload.embeds[0].description).toContain("**Anmeldung über:** EventHelper");
        for (const row of payload.components) for (const c of row.components) expect(c.custom_id.length).toBeLessThanOrEqual(100);
    });

    it("zeigt und schaltet die Ankündigung, vorbelegt aus der Kategorie (#306)", async () => {
        // Kategorie aus: die Zeile sagt "aus", der Knopf schaltet an.
        const off = await draft.stepMessage("g1", state());
        expect(off.payload.embeds[0].description).toContain("**Ankündigung:** aus");
        expect(draft.applyStep(state(), "a").ann).toBe("1");

        // Kategorie an: die Zeile nennt das Ziel, der Knopf schaltet aus.
        settings.getConfig.mockReturnValue({
            categoryIds: [CAT_EH, CAT_RH], categoryRaidTemplate: { [CAT_EH]: T5.id },
            categoryAnnounce: { [CAT_EH]: { enabled: true, target: "both" } },
        });
        const on = await draft.stepMessage("g1", state());
        expect(on.payload.embeds[0].description).toContain("**Ankündigung:** Raider-Rolle pingen (beide Server)");
        const buttons = on.payload.components[on.payload.components.length - 1].components;
        expect(buttons.map((b) => b.label)).toContain("Ankündigung: an");
        expect(draft.applyStep(state(), "a").ann).toBe("0");

        // Für ein Raid-Helper-Event gibt es den Schalter nicht.
        const rh = await draft.stepMessage("g1", state({ cat: CAT_RH, tpl: RH.id, src: "r" }));
        expect(rh.payload.embeds[0].description).not.toContain("Ankündigung");
    });

    it("changing the category proposes its source and template again, the toggle switches the source", () => {
        expect(draft.applyStep(state({ ref: "x" }), "c", CAT_RH)).toEqual({ cat: CAT_RH, tpl: RH.id, mode: "n", src: "r", ref: "", ann: "" });
        expect(draft.applyStep(state(), "s")).toMatchObject({ src: "r", tpl: RH.id });
        expect(draft.applyStep(state(), "k", "e")).toMatchObject({ mode: "e", ref: "" });
        expect(draft.applyStep(state(), "t", "../evil")).toMatchObject({ tpl: "" });
    });

    it("lists the category's events to duplicate, newest first, and picks the newest", async () => {
        loadEventGroups.mockResolvedValue({ groups: [
            { categoryId: CAT_EH, events: [
                { id: "1100", title: "SSC alt", channelId: "300", channelName: "mi-10-09-ssc", startTime: 1757000000 },
                { id: "eh-new1", title: "SSC neu", channelId: "301", channelName: "mi-17-09-ssc", startTime: 1758100000 },
            ] },
            { categoryId: CAT_RH, events: [{ id: "9", title: "Kara", channelId: "302", startTime: 1758200000 }] },
        ] });
        const { state: shown, payload } = await draft.stepMessage("g1", state({ mode: "d" }));
        expect(shown.ref).toBe("eh-new1");
        const refRow = payload.components[3].components[0];
        expect(refRow.options.map((o) => o.value)).toEqual(["eh-new1", "1100"]);
        expect(payload.embeds[0].description).toContain("Kanal von **SSC neu** duplizieren");
    });

    it("names the new channel like the category's previous one and says so in step 1 and the confirmation (#285)", async () => {
        discord.listAllChannels.mockReturnValue([{ id: "301", name: "🔥・mi-16-09-ssc-tk", parentId: CAT_EH }]);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: CAT_EH, events: [
            { id: "eh-new1", title: "SSC + TK", instanceIds: ["ssc", "tk"], channelId: "301", startTime: Date.UTC(2026, 8, 16, 17, 30) / 1000 },
        ] }] });
        const { payload } = await draft.stepMessage("g1", state());
        expect(payload.embeds[0].description).toContain("**Kanal:** neu wie #🔥・mi-16-09-ssc-tk — Wochentag, Datum und Raid werden ersetzt");

        const built = await draft._internal.buildBody("g1", state(), values({ date: "23.09." }), { userId: "42", now: NOW });
        expect(built.body.newChannel).toEqual({ name: "🔥・mi-23-09-ssc-tk", categoryId: CAT_EH, templateChannelId: "301" });

        const dup = await draft._internal.buildBody("g1", state({ mode: "d", ref: "eh-new1" }), values({ date: "23.09." }), { userId: "42", now: NOW });
        expect(dup.body).toMatchObject({ sourceEventId: "eh-new1", channelName: "🔥・mi-23-09-ssc-tk" });
        const dupStep = await draft.stepMessage("g1", state({ mode: "d", ref: "eh-new1" }));
        expect(dupStep.payload.embeds[0].description).toContain("Kanal von **SSC + TK** duplizieren · Name wie #🔥・mi-16-09-ssc-tk");

        createEvent.mockResolvedValue({ status: 201, body: { id: "eh-x", event: { id: "eh-x", channelId: "556", channelName: "🔥・mi-23-09-ssc-tk" } } });
        const done = await draft.submitForm("g1", state(), values({ date: "23.09." }), { userId: "42", now: NOW });
        const lines = done.payload.embeds[0].description.split("\n");
        expect(lines[1]).toBe("Name: `🔥・mi-23-09-ssc-tk` · abgeleitet aus #🔥・mi-16-09-ssc-tk (Datum 16-09 → 23-09)");
        expect(lines[2]).toBe("Rechte und Thema von #🔥・mi-16-09-ssc-tk");
    });

    it("uses a channel select for an existing channel and keeps Weiter off until one is picked", async () => {
        const { payload } = await draft.stepMessage("g1", state({ mode: "e" }));
        expect(payload.components[3].components[0]).toMatchObject({ type: 8, channel_types: [0] });
        expect(payload.components[4].components[0].disabled).toBe(true);
        const picked = await draft.stepMessage("g1", state({ mode: "e", ref: "200000000000000001" }));
        expect(picked.payload.components[3].components[0].default_values).toEqual([{ id: "200000000000000001", type: "channel" }]);
        expect(picked.payload.components[4].components[0].disabled).toBe(false);
    });

    it("says so when the server has no event category", async () => {
        discord.listCategories.mockReturnValue([]);
        const { payload } = await draft.stepMessage("g1", state());
        expect(payload.embeds[0].description).toContain("Keine Event-Kategorie");
    });

    it("refuses another server than the event server", () => {
        eventGuildId.mockReturnValue("g-event");
        expect(draft.guildFor({ guild: { id: "g-talk" } }).error).toContain("Event-Server");
        expect(draft.guildFor({ guild: { id: "g-event" } })).toEqual({ guildId: "g-event" });
        expect(draft.guildFor({}).error).toBeTruthy();
    });
});

describe("services/events/eventDraft — the modal", () => {
    it("is prefilled from the template, composition only for EventHelper", () => {
        const json = draft.formModal(state()).toJSON();
        expect(json.title).toBe("SSC + TK anlegen");
        const fields = Object.fromEntries(json.components.map((r) => [r.components[0].custom_id, r.components[0]]));
        expect(Object.keys(fields)).toEqual(["title", "date", "time", "comp", "description"]);
        expect(fields.title.value).toBe("SSC + TK");
        expect(fields.comp.value).toBe("25/3/6");
        const rh = draft.formModal(state({ cat: CAT_RH, tpl: RH.id, src: "r" })).toJSON();
        expect(rh.components.map((r) => r.components[0].custom_id)).toEqual(["title", "date", "time", "description"]);
    });

    it("parses Größe/T/H", () => {
        expect(draft.parseComposition("40/4/10")).toEqual({ size: 40, tank: 4, healer: 10 });
        expect(draft.parseComposition(" 25 / 3 / 6 ")).toEqual({ size: 25, tank: 3, healer: 6 });
        expect(draft.parseComposition("10")).toEqual({ size: 10 });
        expect(draft.parseComposition("")).toBeNull();
        expect(draft.parseComposition("40-4").error).toContain("Größe/T/H");
        expect(draft.parseComposition("10/5/6").error).toContain("passen nicht");
        expect(draft.parseComposition("41/4/10").error).toContain("zwischen 1 und 40");
    });

    // #305: a Discord modal takes five fields, so the duration rides in this one
    it("takes the duration as a fourth part of Größe/T/H", () => {
        expect(draft.parseComposition("25/3/6/240")).toEqual({ size: 25, tank: 3, healer: 6, durationMinutes: 240 });
        expect(draft.parseComposition(" 40 / 4 / 10 / 300 ")).toEqual({ size: 40, tank: 4, healer: 10, durationMinutes: 300 });
        // without it the template's duration stands
        expect(draft.parseComposition("25/3/6").durationMinutes).toBeUndefined();
        expect(draft.parseComposition("25/3/6/20").error).toContain("Dauer");
        expect(draft.parseComposition("25/3/6/900").error).toContain("Dauer");
        expect(draft.parseComposition("25/3/6/240/9").error).toContain("Größe/T/H/Dauer");
        // the field is prefilled from the template, duration included
        expect(draft._internal.compositionOf({ size: 25, composition: { tank: 3, healer: 6 }, durationMinutes: 240 })).toBe("25/3/6/240");
        expect(draft._internal.compositionOf({ size: 25, composition: { tank: 3, healer: 6 } })).toBe("25/3/6");
    });
});

describe("services/events/eventDraft — building the create body", () => {
    const build = async (s, v, now = NOW) => draft._internal.buildBody("g1", s, v, { userId: "42", now });

    it("schickt die Ankündigung nur mit, wenn sie hier entschieden wurde (#306)", async () => {
        expect((await build(state(), values())).body.announce).toBeUndefined();
        expect((await build(state({ ann: "1" }), values())).body.announce).toBe(true);
        expect((await build(state({ ann: "0" }), values())).body.announce).toBe(false);
    });

    it("new by schema: a channel from the category's schema, the composition from the modal", async () => {
        archiveStore.getChannelConfig.mockReturnValue({ schemas: { [CAT_EH]: { schema: "{tag}-{dd}-{mm}-{raid}", raid: "", templateChannelId: "400" } } });
        const { body, error } = await build(state(), values({ comp: "25/4/7" }));
        expect(error).toBeUndefined();
        expect(body).toEqual({
            title: "SSC + TK", date: "2026-09-24", time: "19:30", description: "Flasks Pflicht", leaderId: "42",
            raidTemplateId: T5.id, templateId: "", signupSource: "eventhelper",
            size: 25, composition: { tank: 4, healer: 7, melee: 0, ranged: 5 },
            newChannel: { name: "do-24-09-ssc-tk", categoryId: CAT_EH, templateChannelId: "400" },
        });
    });

    it("duplicate: the source event and the schema's name", async () => {
        const { body } = await build(state({ mode: "d", ref: "eh-new1" }), values({ comp: "" }));
        expect(body).toMatchObject({ sourceEventId: "eh-new1", channelName: "do-24-09-ssc-tk" });
        expect(body.size).toBeUndefined();
        expect((await build(state({ mode: "d" }), values())).error).toContain("Kein Event");
    });

    it("existing channel: only one that is on the server", async () => {
        expect((await build(state({ mode: "e", ref: "200000000000000001" }), values())).body.channelId).toBe("200000000000000001");
        expect((await build(state({ mode: "e", ref: "200000000000000099" }), values())).error).toContain("nicht (mehr)");
    });

    it("Raid-Helper category: the linked Raid-Helper template, no composition", async () => {
        const { body } = await build(state({ cat: CAT_RH, tpl: RH.id, src: "r" }), values({ comp: "" }));
        expect(body).toMatchObject({ signupSource: "raidhelper", templateId: "37", raidTemplateId: RH.id });
        expect(body.composition).toBeUndefined();
        expect((await build(state({ cat: CAT_RH, tpl: T5.id, src: "r" }), values())).error).toContain("Raid-Helper-Vorlage");
    });

    it("refuses past dates, bad input, a taken channel name and vanished choices", async () => {
        expect((await build(state(), values({ date: "15.09." }))).error).toContain("Vergangenheit");
        expect((await build(state(), values({ date: "16.09.", time: "11:00" }))).error).toContain("Vergangenheit");
        expect((await build(state(), values({ date: "morgen" }))).error).toContain("kein Datum");
        expect((await build(state(), values({ time: "abends" }))).error).toContain("keine Uhrzeit");
        expect((await build(state(), values({ title: "" }))).error).toContain("Titel");
        expect((await build(state(), values({ comp: "10/9/9" }))).error).toContain("passen nicht");
        discord.listAllChannels.mockReturnValue([{ id: "1", name: "do-24-09-ssc-tk" }]);
        expect((await build(state(), values())).error).toContain("Einen Kanal **do-24-09-ssc-tk** gibt es schon (Standard-Schema");
        expect((await build(state({ cat: "100000000000000009" }), values())).error).toContain("Kategorie");
        expect((await build(state({ tpl: "deadbeef0000" }), values())).error).toContain("Vorlage gibt es nicht mehr");
    });

    it("hands the duration of the composition field on to createEvent (#305)", async () => {
        const withDuration = await build(state(), values({ comp: "25/4/7/240" }));
        expect(withDuration.body).toMatchObject({ size: 25, durationMinutes: 240 });
        // without a fourth part nothing is sent, so the template's duration stands
        const without = await build(state(), values({ comp: "25/4/7" }));
        expect(without.body.durationMinutes).toBeUndefined();
        expect((await build(state(), values({ comp: "25/4/7/10" }))).error).toContain("Dauer");
    });
});

describe("services/events/eventDraft — submit", () => {
    it("creates through eventCreate and answers with the three links", async () => {
        createEvent.mockResolvedValue({ status: 201, body: { id: "eh-abc", source: "eventhelper", event: { id: "eh-abc", channelId: "555", size: 25 }, messageError: null } });
        const { ok, payload } = await draft.submitForm("g1", state(), values(), { userId: "42", now: NOW });
        expect(ok).toBe(true);
        expect(createEvent).toHaveBeenCalledWith({ guildId: "g1", user: { id: "42" }, body: expect.objectContaining({ title: "SSC + TK" }) });
        expect(payload.embeds[0].title).toBe("Event angelegt · SSC + TK");
        expect(payload.embeds[0].description.split("\n")[0]).toBe("Do 24.09. · 19:30 · 25er · Kanal <#555> angelegt");
        expect(payload.components[0].components.map((b) => [b.label, b.url])).toEqual([
            ["Zum Kanal", "https://discord.com/channels/g1/555"],
            ["Im Web bearbeiten", "https://eh.test/raids/detail?event=eh-abc"],
            ["Ankündigung pingen", "https://eh.test/raids/detail?event=eh-abc&tab=actions"],
        ]);
    });

    it("answers a refusal with Nochmal, and keeps the typed values for this user only", async () => {
        createEvent.mockResolvedValue({ error: { status: 400, code: "create_failed", message: "Raid-Helper hat abgelehnt." } });
        const typed = values({ description: "Bitte pünktlich" });
        const { ok, payload } = await draft.submitForm("g1", state(), typed, { userId: "42", now: NOW });
        expect(ok).toBe(false);
        expect(payload.embeds[0]).toMatchObject({ title: "Nicht angelegt", description: "Raid-Helper hat abgelehnt." });
        const again = payload.components[0].components[0];
        expect(again.label).toBe("Nochmal");
        const { token, state: kept } = draft.parseCustomId(again.custom_id);
        expect(kept).toEqual(state());
        expect(draft.getDraft(token, "42", NOW)).toEqual(typed);
        expect(draft.getDraft(token, "someone-else", NOW)).toBeNull();
        expect(draft.getDraft(token, "42", NOW + 31 * 60 * 1000)).toBeNull();

        const json = draft.formModal(kept, { values: draft.getDraft(token, "42", NOW) }).toJSON();
        const byId = Object.fromEntries(json.components.map((r) => [r.components[0].custom_id, r.components[0].value]));
        expect(byId).toMatchObject({ date: "24.09.", time: "19:30", description: "Bitte pünktlich" });
    });

    it("does not call eventCreate when the input is already wrong", async () => {
        const { ok } = await draft.submitForm("g1", state(), values({ date: "01.01.2020" }), { userId: "42", now: NOW });
        expect(ok).toBe(false);
        expect(createEvent).not.toHaveBeenCalled();
    });
});
