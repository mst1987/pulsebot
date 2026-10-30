// /event anlegen: templates of the category's version, the template's melee/ranged
// maxima, the remembered time and the channel icon (Kanal-Icon).
jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(), listAllChannels: jest.fn() }));
jest.mock("../../../src/stores/discord/channelArchiveStore", () => ({ getChannelConfig: jest.fn() }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(), listRaidTemplates: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../../src/services/events/eventSources", () => ({ signupSourceFor: jest.fn() }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ serverIds: jest.fn(() => []) }));
jest.mock("../../../src/services/events/eventCreate", () => ({ createEvent: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.test", embedAccentColor: 1 }));

const discord = require("../../../src/services/discord/discord");
const archiveStore = require("../../../src/stores/discord/channelArchiveStore");
const settings = require("../../../src/stores/settings/settingsStore");
const { signupSourceFor } = require("../../../src/services/events/eventSources");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const draft = require("../../../src/services/events/eventDraft");
const eventStore = require("../../../src/stores/events/eventStore");
const { templateVersionProblem } = require("../../../src/services/categories/categoryEras");

const CAT_EH = "100000000000000001";
const CAT_FOREVER = "100000000000000003";
const T5 = {
    id: "a1b2c3d4e5f6", name: "T5 25er", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
    composition: { tank: 3, healer: 6, melee: { min: 4, max: 8 }, ranged: { min: 5, max: null } }, raidhelperTemplateId: "",
};
const FOREVER = {
    id: "f0f0f0f0f0f0", name: "Forever Hyjal", versionId: "forever", instanceIds: ["forever-hyjal"], size: 20,
    composition: { tank: 2, healer: 5 }, raidhelperTemplateId: "",
};
const NOW = Date.UTC(2026, 8, 16, 10, 0);
const values = (over = {}) => ({ title: "SSC + TK", date: "24.09.", time: "19:30", comp: "25/3/6", description: "", ...over });
const state = (over = {}) => ({ cat: CAT_EH, tpl: T5.id, mode: "n", src: "e", ref: "", ann: "", ico: "", ...over });
const build = (s, v = values()) => draft._internal.buildBody("g1", s, v, { userId: "42", now: NOW });
const rowsOf = (payload) => payload.components.map((r) => r.components);

let config;
let schemas;
beforeEach(() => {
    jest.clearAllMocks();
    schemas = {};
    config = {
        categoryIds: [CAT_EH, CAT_FOREVER], categoryRaidTemplate: { [CAT_EH]: T5.id, [CAT_FOREVER]: T5.id },
        categoryVersion: { [CAT_EH]: "tbc", [CAT_FOREVER]: "forever" },
    };
    discord.listCategories.mockReturnValue([{ id: CAT_EH, name: "Mittwoch-Raid" }, { id: CAT_FOREVER, name: "Forever" }]);
    discord.listAllChannels.mockReturnValue([]);
    archiveStore.getChannelConfig.mockImplementation(() => ({ schemas }));
    settings.getConfig.mockImplementation(() => config);
    settings.listRaidTemplates.mockReturnValue([T5, FOREVER]);
    settings.getRaidTemplate.mockImplementation((id) => [T5, FOREVER].find((t) => t.id === id) || null);
    signupSourceFor.mockReturnValue("eventhelper");
    loadEventGroups.mockResolvedValue({ groups: [] });
});

describe("eventDraft — templates of the category's version", () => {
    const offered = async (s) => {
        const { payload } = await draft.stepMessage("g1", s);
        return rowsOf(payload)[1][0].options.map((o) => o.value);
    };

    it("offers only the templates createEvent would accept for the category", async () => {
        expect(await offered(state())).toEqual([T5.id]);
        expect(await offered(state({ cat: CAT_FOREVER, tpl: "" }))).toEqual([FOREVER.id]);
        for (const [cat, tpl] of [[CAT_EH, T5], [CAT_FOREVER, FOREVER]]) {
            expect(templateVersionProblem({ template: tpl, categoryId: cat, config })).toBe("");
        }
        expect(templateVersionProblem({ template: T5, categoryId: CAT_FOREVER, config })).not.toBe("");
    });

    it("preselects the category default when it fits, else the first that fits", () => {
        expect(draft.initialState("g1", CAT_EH).tpl).toBe(T5.id);
        // the default of the Forever category is a TBC template: refused by createEvent, so not preselected
        expect(draft.initialState("g1", CAT_FOREVER).tpl).toBe(FOREVER.id);
        config.categoryRaidTemplate[CAT_FOREVER] = FOREVER.id;
        expect(draft.initialState("g1", CAT_FOREVER).tpl).toBe(FOREVER.id);
    });

    it("re-fits the template when the category changes", () => {
        const forever = draft.applyStep(state(), "c", CAT_FOREVER);
        expect(forever).toMatchObject({ cat: CAT_FOREVER, tpl: FOREVER.id });
        expect(draft.applyStep(forever, "c", CAT_EH)).toMatchObject({ cat: CAT_EH, tpl: T5.id });
    });

    it("has no template to offer when none fits the version", async () => {
        settings.listRaidTemplates.mockReturnValue([T5]);
        const { state: shown, payload } = await draft.stepMessage("g1", state({ cat: CAT_FOREVER, tpl: "" }));
        expect(shown.tpl).toBe("");
        expect(rowsOf(payload).some((r) => r[0].placeholder === "Raid-Vorlage")).toBe(false);
    });
});

describe("eventDraft — the template's melee/ranged ranges", () => {
    it("sends the maxima along, so Discord stores what the web dialog stores", async () => {
        const { body, error } = await build(state());
        expect(error).toBeUndefined();
        expect(body.composition).toEqual({ tank: 3, healer: 6, melee: 4, ranged: 5 });
        expect(body.compositionMax).toEqual({ melee: 8, ranged: null });

        // The web dialog sends the template as ranges ({ min, max }) in composition.
        const web = { versionId: "tbc", instanceIds: T5.instanceIds, size: 25, composition: { tank: 3, healer: 6, melee: { min: 4, max: 8 }, ranged: { min: 5, max: null } } };
        const viaWeb = eventStore.normalizePlan(web);
        const viaDiscord = eventStore.normalizePlan({ versionId: "tbc", instanceIds: T5.instanceIds, size: body.size, composition: body.composition, compositionMax: body.compositionMax });
        expect(viaDiscord.error).toBeUndefined();
        expect(viaDiscord.value).toEqual(viaWeb.value);
        expect(viaDiscord.value.compositionMax).toEqual({ melee: 8, ranged: null });
    });

    it("leaves compositionMax out when the template has no maximum, and caps it at the size", async () => {
        settings.getRaidTemplate.mockImplementation((id) => (id === T5.id ? { ...T5, composition: { tank: 3, healer: 6, melee: { min: 4, max: null }, ranged: null } } : null));
        expect((await build(state())).body.compositionMax).toBeUndefined();
        settings.getRaidTemplate.mockImplementation((id) => (id === T5.id ? { ...T5, composition: { tank: 3, healer: 6, melee: { min: 4, max: 30 } } } : null));
        expect((await build(state(), values({ comp: "10/1/1" }))).body.compositionMax).toEqual({ melee: 10, ranged: null });
    });
});

describe("eventDraft — the remembered time", () => {
    const timeOf = (modal) => modal.toJSON().components.map((r) => r.components[0]).find((f) => f.custom_id === "time");

    it("prefills Uhrzeit with the time the category's quick-create remembers", () => {
        schemas[CAT_EH] = { schema: "", time: "20:15" };
        expect(timeOf(draft.formModal(state(), { guildId: "g1" })).value).toBe("20:15");
        // a category without one, or an unreadable one, stays empty
        expect(timeOf(draft.formModal(state({ cat: CAT_FOREVER }), { guildId: "g1" })).value).toBeUndefined();
        schemas[CAT_EH] = { time: "abends" };
        expect(timeOf(draft.formModal(state(), { guildId: "g1" })).value).toBeUndefined();
        archiveStore.getChannelConfig.mockImplementation(() => { throw new Error("kaputt"); });
        expect(timeOf(draft.formModal(state(), { guildId: "g1" })).value).toBeUndefined();
    });

    it("lets what was typed win over the remembered time", () => {
        schemas[CAT_EH] = { time: "20:15" };
        expect(timeOf(draft.formModal(state(), { guildId: "g1", values: { time: "21:00" } })).value).toBe("21:00");
    });
});

describe("eventDraft — Kanal-Icon", () => {
    const CHANNELS = [
        { id: "301", name: "🔥・mi-16-09-ssc-tk", parentId: CAT_EH },
        { id: "302", name: "🔥・mi-09-09-ssc-tk", parentId: CAT_EH },
        { id: "303", name: "💀・do-10-09-bt", parentId: CAT_EH },
        { id: "304", name: "🐍・other-category", parentId: CAT_FOREVER },
    ];
    beforeEach(() => {
        discord.listAllChannels.mockReturnValue(CHANNELS);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: CAT_EH, events: [
            { id: "eh-new1", title: "SSC + TK", instanceIds: ["ssc", "tk"], channelId: "301", startTime: Date.UTC(2026, 8, 16, 17, 30) / 1000 },
        ] }] });
    });

    const iconRow = async (s) => rowsOf((await draft.stepMessage("g1", s)).payload).find((r) => r[0].placeholder === "Kanal-Icon");

    it("offers last / raid / category / none, each with its emoji and no emoji twice", async () => {
        const [select] = await iconRow(state());
        const opts = select.options;
        expect(opts[0]).toMatchObject({ label: "Wie zuletzt", value: "w", default: true, emoji: { name: "🔥" } });
        // SSC + TK suggestions without the 🔥 the name already has
        expect(opts.filter((o) => o.label === "Passt zu SSC + TK").map((o) => o.emoji.name)).toEqual(["🐍", "🌊", "🐙", "🐟", "🦅", "☄️", "🌌"]);
        expect(opts.filter((o) => o.label === "In dieser Kategorie").map((o) => o.emoji.name)).toEqual(["💀"]);
        expect(opts[opts.length - 1]).toEqual({ label: "Kein Icon", value: "x", default: false });
        const emojis = opts.map((o) => o.emoji && o.emoji.name).filter(Boolean);
        expect(new Set(emojis).size).toBe(emojis.length);
        expect(opts.length).toBeLessThanOrEqual(25);
        expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
    });

    it("gives every option one emoji only, a lead of several goes into the description", async () => {
        // the PuG category's real names start with two emojis: two in emoji.name made Discord refuse the step
        discord.listAllChannels.mockReturnValue([
            { id: "305", name: "🏔️👑》hyjal-bt-18-oct", parentId: CAT_EH },
            { id: "306", name: "🌴》za-24-oct", parentId: CAT_EH },
        ]);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: CAT_EH, events: [
            { id: "eh-new2", title: "Hyjal + BT", instanceIds: ["hyjal", "bt"], channelId: "305", startTime: Date.UTC(2026, 9, 18, 17, 0) / 1000 },
        ] }] });
        const [select] = await iconRow(state());
        const graphemes = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length;
        for (const o of select.options.filter((x) => x.emoji)) expect(graphemes(o.emoji.name)).toBe(1);
        expect(select.options[0]).toMatchObject({ label: "Wie zuletzt", emoji: { name: "🏔️" }, description: "🏔️👑" });
    });

    it("does not offer the select where no channel is created", async () => {
        expect(await iconRow(state({ mode: "e" }))).toBeUndefined();
    });

    it("applies the pick: replaces the lead emoji and keeps the separator; none strips it", async () => {
        const raid = await build(state({ ico: "r0" }), values({ date: "23.09." }));
        expect(raid.body.newChannel.name).toBe("🐍・mi-23-09-ssc-tk");
        // c0 is the 🔥 the name already starts with, so it is not offered twice: the codes keep their place in the list
        expect((await build(state({ ico: "c1" }), values({ date: "23.09." }))).body.newChannel.name).toBe("💀・mi-23-09-ssc-tk");
        expect((await build(state({ ico: "x" }), values({ date: "23.09." }))).body.newChannel.name).toBe("mi-23-09-ssc-tk");
        expect((await build(state(), values({ date: "23.09." }))).body.newChannel.name).toBe("🔥・mi-23-09-ssc-tk");
        // the success line names the channel with the icon
        expect(raid.naming.name).toBe("🐍・mi-23-09-ssc-tk");
    });

    it("gives a name without an emoji the pick and the category's separator", async () => {
        discord.listAllChannels.mockReturnValue([{ id: "301", name: "mi-16-09-ssc-tk", parentId: CAT_EH }, { id: "303", name: "💀│do-10-09", parentId: CAT_EH }]);
        const built = await build(state({ ico: "c0" }), values({ date: "23.09." }));
        expect(built.body.newChannel.name).toBe("💀│mi-23-09-ssc-tk");
    });

    it("never trusts the code: an unknown or out-of-range one falls back to 'Wie zuletzt'", async () => {
        for (const ico of ["r9", "c7", "<script>", "rr", "x1"]) {
            const clean = draft._internal.cleanState({ ...state(), ico });
            expect(draft.parseCustomId(draft._internal.stepId("i", { ...state(), ico })).state.ico).toBe(clean.ico);
            expect((await build(clean, values({ date: "23.09." }))).body.newChannel.name).toBe("🔥・mi-23-09-ssc-tk");
        }
        expect(draft.applyStep(state(), "i", "w").ico).toBe("");
        expect(draft.applyStep(state(), "i", "r2").ico).toBe("r2");
    });

    it("shows the icon and a preview in the channel line of step 1", async () => {
        const { payload } = await draft.stepMessage("g1", state({ ico: "r0" }));
        expect(payload.embeds[0].description).toContain("**Kanal-Icon:** 🐍 Passt zu SSC + TK · `🐍・mi-16-09-ssc-tk`");
        const none = await draft.stepMessage("g1", state({ ico: "x" }));
        expect(none.payload.embeds[0].description).toContain("**Kanal-Icon:** Kein Icon · `mi-16-09-ssc-tk`");
    });

    it("keeps every customId within 100 characters, also with an icon", async () => {
        const worst = { cat: "12345678901234567890", tpl: "x".repeat(24), mode: "d", src: "r", ref: "y".repeat(24), ann: "1", ico: "r12" };
        for (const id of [draft._internal.stepId("c", worst), draft._internal.formId(worst, "0a1b2c3d")]) {
            expect({ id, fits: id.length <= draft._internal.CUSTOM_ID_MAX }).toEqual({ id, fits: true });
        }
        const { payload } = await draft.stepMessage("g1", state({ ico: "r0" }));
        for (const r of payload.components) for (const c of r.components) expect(c.custom_id.length).toBeLessThanOrEqual(100);
        expect(payload.components.length).toBeLessThanOrEqual(5);
    });

    it("a template or category change drops the pick (the suggestions belong to the raid)", () => {
        expect(draft.applyStep(state({ ico: "r2" }), "t", T5.id).ico).toBe("");
        expect(draft.applyStep(state({ ico: "r2" }), "c", CAT_FOREVER).ico).toBe("");
        expect(draft.applyStep(state({ ico: "r2" }), "s").ico).toBe("");
    });

    it("duplicate mode: five rows only, a button cycles through the same options", async () => {
        const dup = state({ mode: "d", ref: "eh-new1" });
        const { payload } = await draft.stepMessage("g1", dup);
        expect(payload.components).toHaveLength(5);
        const buttons = payload.components[4].components;
        const cycle = buttons.find((b) => b.label.startsWith("Icon:"));
        expect(cycle.label).toBe("Icon: 🔥");
        // the button's customId already carries the next choice
        const next = draft.parseCustomId(cycle.custom_id);
        expect(next).toMatchObject({ field: "j", state: { ico: "r0" } });
        expect(draft.applyStep(next.state, "j")).toEqual(next.state);
        // wrapping around: after "Kein Icon" comes "Wie zuletzt" again
        const last = await draft.stepMessage("g1", { ...dup, ico: "x" });
        const wrap = last.payload.components[4].components.find((b) => b.label.startsWith("Icon:"));
        expect(wrap.label).toBe("Icon: Kein Icon");
        expect(draft.parseCustomId(wrap.custom_id).state.ico).toBe("");
        // and the chosen icon ends up in the duplicated channel's name
        expect((await build({ ...dup, ico: "r0" }, values({ date: "23.09." }))).body.channelName).toBe("🐍・mi-23-09-ssc-tk");
    });
});
