// #291: the switch-over checklist — every item, what blocks the switch, and the switch itself.
// #927: both per Discord server; the switch is serverSettings[guildId].raidhelper.enabled.
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
}));
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(() => null), isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
// the upcoming events come from the server's synced list, never from raid-helper.xyz
const mockGetAllEvents = jest.fn(async () => []);
const mockCreateClient = jest.fn(() => ({ getAllEvents: mockGetAllEvents }));
jest.mock("../../../src/utils/raidhelper/client", () => ({
    ...jest.requireActual("../../../src/utils/raidhelper/client"),
    createRaidhelperClient: (...args) => mockCreateClient(...args),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    getChannelCategoryMap: jest.fn(() => ({})),
    botPermissionsIn: jest.fn(() => null),
    botCanManageEvents: jest.fn(() => null),
    listCategories: jest.fn(() => []),
}));
jest.mock("../../../src/services/categories/categoryNames", () => ({ listKnownCategories: jest.fn(() => []) }));
jest.mock("../../../src/stores/specHistoryStore", () => ({ importStatus: jest.fn(() => ({ importedEvents: 0, users: 0, lastRun: null })) }));

const { getConfig, saveConfig } = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { listKnownCategories } = require("../../../src/services/categories/categoryNames");
const specHistory = require("../../../src/stores/specHistoryStore");
const appEmojis = require("../../../src/services/discord/appEmojis");
const { buildChecklist, loadChecklist, setRaidhelperDisabled } = require("../../../src/web/events/raidhelperRetirement");

const baseInputs = (over = {}) => ({
    disabled: false,
    categories: [{ id: "c1", name: "Mittwoch", source: "eventhelper" }, { id: "c2", name: "Sonntag", source: "eventhelper" }],
    upcoming: { events: [], error: null },
    history: { importedEvents: 12, users: 20, lastRun: { at: 1, byName: "Orga" } },
    emojis: { loaded: true, total: 46, missing: [] },
    permissions: [{ key: "ManageChannels", label: "Kanäle verwalten", ok: true }],
    // #305: no category asks for a Discord event by default.
    discordEvents: { categories: [], canManage: null },
    ...over,
});
const item = (list, id) => list.items.find((i) => i.id === id);

describe("web/events/raidhelperRetirement", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        appEmojis.resetAppEmojis();
    });

    describe("buildChecklist", () => {
        it("is ready and all green when everything is done; every item says why and where", () => {
            const list = buildChecklist(baseInputs());
            expect(list.ready).toBe(true);
            expect(list.items.map((i) => i.id)).toEqual(["categories", "upcoming", "history", "emojis", "discordevent", "commands", "permissions"]);
            expect(list.done).toBe(list.total);
            expect(list.total).toBe(5); // the command hint cannot be checked
            for (const i of list.items) {
                expect(i.why).toBeTruthy();
                expect(i.link || i.action || i.hint).toBeTruthy();
            }
            expect(list.items.filter((i) => i.required).map((i) => i.id)).toEqual(["categories", "upcoming"]);
        });

        it("names the categories still on Raid-Helper and blocks the switch", () => {
            const list = buildChecklist(baseInputs({
                categories: [{ id: "c1", name: "Mittwoch", source: "eventhelper" }, { id: "c2", name: "Sonntag", source: "raidhelper" }],
            }));
            expect(item(list, "categories")).toMatchObject({ status: "bad", value: "1 / 2", detail: ["Sonntag – noch Raid-Helper"] });
            expect(list.ready).toBe(false);
            expect(list.blockers).toEqual(["categories"]);
        });

        it("lists upcoming Raid-Helper events and blocks; a Raid-Helper that does not answer is shown, not blocking", () => {
            const blocked = buildChecklist(baseInputs({ upcoming: { events: [{ id: "9", title: "Kara", startTime: 2000000000, channelName: "kara" }], error: null } }));
            expect(item(blocked, "upcoming")).toMatchObject({ status: "bad", value: "1 geplant" });
            expect(item(blocked, "upcoming").detail[0]).toMatch(/^Kara · .* · #kara$/);
            expect(blocked.ready).toBe(false);

            const unknown = buildChecklist(baseInputs({ upcoming: { events: [], error: "Unerwartete Antwort von Raid-Helper (HTTP 404)" } }));
            expect(item(unknown, "upcoming")).toMatchObject({ status: "unknown", value: "nicht prüfbar", detail: ["Unerwartete Antwort von Raid-Helper (HTTP 404)"] });
            expect(unknown.ready).toBe(true);
        });

        it("cannot call a list without event categories done", () => {
            const list = buildChecklist(baseInputs({ categories: [] }));
            expect(item(list, "categories").status).toBe("unknown");
            expect(list.ready).toBe(false);
        });

        it("shows the recommendations without blocking: import, emojis, permissions", () => {
            const list = buildChecklist(baseInputs({
                history: { importedEvents: 0, users: 0, lastRun: null },
                emojis: { loaded: true, total: 46, missing: ["eh_priest_shadow"] },
                permissions: [{ key: "ManageChannels", label: "Kanäle verwalten", ok: false }, { key: "SendMessages", label: "Nachrichten senden", ok: true }],
            }));
            expect(item(list, "history")).toMatchObject({ status: "mid", value: "noch nicht", action: "import" });
            expect(item(list, "emojis")).toMatchObject({ status: "mid", value: "45 / 46", detail: ["eh_priest_shadow"] });
            expect(item(list, "permissions")).toMatchObject({ status: "bad", value: "1 / 2", detail: ["fehlt: Kanäle verwalten"] });
            expect(list.ready).toBe(true);
        });

        it("reads unknown, not missing, while the bot is offline", () => {
            const list = buildChecklist(baseInputs({ emojis: { loaded: false, total: 46, missing: [] }, permissions: null }));
            expect(item(list, "emojis").status).toBe("unknown");
            expect(item(list, "permissions").status).toBe("unknown");
        });

        // #305: Discord-Events are optional — the line is a reminder, never a blocker
        it("is a hint while no category wants a Discord event, and names the missing right once one does", () => {
            const off = buildChecklist(baseInputs());
            expect(item(off, "discordevent")).toMatchObject({ status: "info", value: "aus", required: false });
            expect(off.total).toBe(5); // an info item is not counted

            const on = buildChecklist(baseInputs({ discordEvents: { categories: [{ id: "c1", name: "Mittwoch" }], canManage: true } }));
            expect(item(on, "discordevent")).toMatchObject({ status: "ok", value: "1 Kategorie", detail: ["Mittwoch"] });
            expect(on.ready).toBe(true);

            const missing = buildChecklist(baseInputs({ discordEvents: { categories: [{ id: "c1", name: "Mittwoch" }], canManage: false } }));
            expect(item(missing, "discordevent")).toMatchObject({ status: "bad", value: "Recht fehlt" });
            expect(item(missing, "discordevent").detail[0]).toContain("Events verwalten");
            // a red recommendation still does not block the switch
            expect(missing.ready).toBe(true);

            const offline = buildChecklist(baseInputs({ discordEvents: { categories: [{ id: "c1", name: "" }], canManage: null } }));
            expect(item(offline, "discordevent").status).toBe("unknown");
        });

        it("says Raid-Helper is no longer asked once switched off", () => {
            const list = buildChecklist(baseInputs({ disabled: true, disabledAt: 5, disabledBy: "Orga" }));
            expect(list).toMatchObject({ disabled: true, disabledAt: 5, disabledBy: "Orga" });
            expect(item(list, "upcoming")).toMatchObject({ status: "ok", value: "nicht mehr abgefragt" });
        });
    });

    describe("loadChecklist", () => {
        const G1 = "111111111111111111";
        const G2 = "222222222222222222";
        // G1 with Raid-Helper switched on, G2 without
        const config = (extra = {}, raidhelper = { enabled: true, apiKey: "fake-key-for-tests" }) => ({
            discordServers: { servers: [{ guildId: G1 }, { guildId: G2 }] },
            serverSettings: { [G1]: { raidhelper } },
            ...extra,
        });

        it("gathers categories with names and sources, upcoming events, emojis and rights", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1", "c2"], categorySignupSource: { c1: "eventhelper" }, signupSourceDefault: "eventhelper" }));
            listKnownCategories.mockReturnValue([{ id: "c1", name: "Mittwoch" }, { id: "c2", name: "Sonntag" }]);
            mockGetAllEvents.mockResolvedValue([{ id: "7", title: "SSC", startTime: 4000000000, channelId: "ch" }, { id: "8", title: "alt", startTime: 1 }]);
            discord.getChannelCategoryMap.mockReturnValue({ ch: { name: "ssc-mi" } });
            discord.botPermissionsIn.mockReturnValue([{ key: "SendMessages", label: "Nachrichten senden", ok: true }]);
            appEmojis.setAppEmojis([{ id: "1", name: "eh_priest_shadow" }]);

            const list = await loadChecklist();
            expect(mockCreateClient).toHaveBeenCalledWith({ guildId: G1 });
            expect(item(list, "categories")).toMatchObject({ status: "ok", value: "2 / 2" });
            expect(item(list, "upcoming")).toMatchObject({ status: "bad", value: "1 geplant" });
            expect(item(list, "upcoming").detail[0]).toMatch(/#ssc-mi/);
            expect(item(list, "emojis").status).toBe("mid");
            expect(item(list, "emojis").value).toMatch(/^1 \/ \d+$/);
            expect(item(list, "permissions").status).toBe("ok");
            expect(discord.botPermissionsIn).toHaveBeenCalledWith(G1);
            // #305: no category wants a Discord event here
            expect(item(list, "discordevent").status).toBe("info");
        });

        it("reads the categories that want a Discord event and the right for it (#305)", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], signupSourceDefault: "eventhelper", categoryDiscordEvent: { c1: true, c2: false } }));
            listKnownCategories.mockReturnValue([{ id: "c1", name: "Mittwoch" }]);
            discord.botCanManageEvents.mockReturnValue(true);
            const list = await loadChecklist();
            expect(item(list, "discordevent")).toMatchObject({ status: "ok", value: "1 Kategorie", detail: ["Mittwoch"] });
            expect(discord.botCanManageEvents).toHaveBeenCalledWith(G1);
        });

        it("does not ask Raid-Helper once it is switched off, and names who did", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], signupSourceDefault: "eventhelper" }, { enabled: false, apiKey: "fake-key-for-tests", at: 9, byName: "Orga" }));
            const list = await loadChecklist();
            expect(mockCreateClient).not.toHaveBeenCalled();
            expect(list).toMatchObject({ disabled: true, disabledAt: 9, disabledBy: "Orga" });
        });

        it("checks a server without Raid-Helper without a request (#927)", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"] }));
            const list = await loadChecklist({ guildId: G2 });
            expect(mockCreateClient).not.toHaveBeenCalled();
            expect(list.disabled).toBe(true);
            expect(item(list, "upcoming")).toMatchObject({ status: "ok", value: "nicht mehr abgefragt" });
            expect(discord.botPermissionsIn).toHaveBeenCalledWith(G2);
        });

        it("reports an unreachable Raid-Helper as not checkable", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], signupSourceDefault: "eventhelper" }));
            mockGetAllEvents.mockRejectedValue(new Error("Unerwartete Antwort von Raid-Helper (HTTP 404)"));
            const list = await loadChecklist();
            expect(item(list, "upcoming").status).toBe("unknown");
            expect(list.ready).toBe(true);
        });
    });

    describe("setRaidhelperDisabled", () => {
        const G1 = "111111111111111111";
        const on = { enabled: true, apiKey: "fake-key-for-tests", serverId: "333333333333333333" };
        const config = (extra = {}, raidhelper = on) => ({
            discordServers: { servers: [{ guildId: G1 }] },
            serverSettings: { [G1]: { raidhelper } },
            ...extra,
        });

        it("refuses to switch off while a required item is open, and saves nothing", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], categorySignupSource: { c1: "raidhelper" } }));
            const result = await setRaidhelperDisabled(true, { guildId: G1, byName: "Orga" });
            expect(result).toMatchObject({ code: "not_ready", blockers: ["categories"] });
            expect(saveConfig).not.toHaveBeenCalled();
        });

        it("switches the server off when ready and back on at any time; key and server id stay", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], signupSourceDefault: "eventhelper" }));
            const off = await setRaidhelperDisabled(true, { guildId: G1, byName: "Orga", now: 77 });
            expect(saveConfig).toHaveBeenCalledWith({ serverSettings: { [G1]: { raidhelper: { ...on, enabled: false, at: 77, byName: "Orga" } } } });
            expect(off.checklist).toBeDefined();

            getConfig.mockReturnValue(config({ categoryIds: ["c1"], categorySignupSource: { c1: "raidhelper" } }, { ...on, enabled: false }));
            await setRaidhelperDisabled(false, { guildId: G1, byName: "Orga", now: 78 });
            expect(saveConfig).toHaveBeenLastCalledWith({ serverSettings: { [G1]: { raidhelper: { ...on, enabled: true, at: 78, byName: "Orga" } } } });
            expect(specHistory.importStatus).toHaveBeenCalled();
        });

        it("takes the first server when none is named, and refuses without any", async () => {
            getConfig.mockReturnValue(config({ categoryIds: ["c1"], signupSourceDefault: "eventhelper" }));
            await setRaidhelperDisabled(true, { now: 5 });
            expect(Object.keys(saveConfig.mock.calls[0][0].serverSettings)).toEqual([G1]);
            getConfig.mockReturnValue({});
            await expect(setRaidhelperDisabled(true)).resolves.toMatchObject({ code: "no_server" });
        });
    });
});
