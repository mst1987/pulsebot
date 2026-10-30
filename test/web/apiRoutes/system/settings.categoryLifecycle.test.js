// Einstellungen → Kategorien over a category's life (#744): an empty active list
// is refused while raids exist, deactivating says what pauses, a category deleted
// in Discord is marked, and "Kategorie abschließen" closes it.
const { json, routerClient } = require("../../../helpers/http");

jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(), getRealUser: jest.fn(), setViewAs: jest.fn(() => true), csrfToken: jest.fn(), checkCsrf: jest.fn(), setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/services/discord/languageChange", () => ({ afterServerLangChange: jest.fn(async () => ({})) }));
jest.mock("../../../../src/services/signups/availabilityPanel", () => ({ refreshPanels: jest.fn(() => Promise.resolve({})) }));
jest.mock("../../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRaidsheets: jest.fn(() => []), saveRaidsheet: jest.fn(), deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []), getRaidTemplate: jest.fn(),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
jest.mock("../../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../../src/stores/rosterStore", () => ({ ...jest.requireActual("../../../../src/stores/rosterStore"), listRosters: jest.fn(() => []) }));
jest.mock("../../../../src/services/categories/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "mon", name: "Montag" }, { id: "gone", name: "TBC Montag" }]),
}));
jest.mock("../../../../src/services/discord/discord", () => require("../../../helpers/discordMock").withClientHelpers({
    getClient: jest.fn(() => ({ isReady: () => true })),
    getGuild: jest.fn((id) => (id === "g1" ? { id } : null)),
    listCategories: jest.fn(() => [{ id: "mon", name: "Montag" }]),
    listRoles: jest.fn(() => []), listTextChannels: jest.fn(() => []), listVoiceChannels: jest.fn(() => []), listGuilds: jest.fn(() => [{ id: "g1" }]),
    resolveUserNames: jest.fn(async () => ({})),
}));
jest.mock("../../../../src/services/versions/contentVersions", () => ({
    upcomingByVersion: jest.fn(() => ({})), versionsWithData: jest.fn(() => new Set()), archiveExport: jest.fn(), archiveCsv: jest.fn(),
}));
jest.mock("../../../../src/stores/eventSeriesStore", () => ({
    getSeries: jest.fn((id) => (id === "gone" ? { categoryId: "gone", enabled: true, weekdays: [1], time: "19:30" } : null)),
    listSeries: jest.fn(() => ({ gone: { categoryId: "gone", enabled: true } })),
    deleteSeries: jest.fn(() => true),
}));
jest.mock("../../../../src/stores/configStore", () => ({
    ...jest.requireActual("../../../../src/stores/configStore"),
    dropCategoryEntries: jest.fn(() => ({ config: {}, removed: ["categoryIds", "categoryReminders"] })),
}));
// #925: the stored name snapshot - "gone" (deleted in Discord) and "mon" on g1, "far" on another server
jest.mock("../../../../src/services/discord/serverOf", () => ({
    ...jest.requireActual("../../../../src/services/discord/serverOf"),
    storedCategoryGuilds: jest.fn(() => new Map([["mon", "g1"], ["gone", "g1"], ["far", "g2"]])),
}));
jest.mock("../../../../src/services/kader/kaderCategories", () => ({ kadersCountingCategory: jest.fn(() => []), dropAttendanceCategory: jest.fn(() => 1) }));

const auth = require("../../../../src/web/http/auth");
const settingsStore = require("../../../../src/stores/settingsStore");
const { listRaidEvents } = require("../../../../src/stores/raidEventStore");
const discord = require("../../../../src/services/discord/discord");
const seriesStore = require("../../../../src/stores/eventSeriesStore");
const configStore = require("../../../../src/stores/configStore");
const { storedCategoryGuilds } = require("../../../../src/services/discord/serverOf");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const rosterStore = require("../../../../src/stores/rosterStore");
const { post, patch, get } = routerClient(require("../../../../src/web/apiRoutes/system/settings"));

const CONFIG = {
    guildId: "g1", categoryIds: ["mon", "gone"], categoryVersion: { mon: "tbc", gone: "tbc" },
    categoryReminders: { gone: { missingHours: 24, signedHours: 0, target: "event" } },
};

beforeEach(() => {
    jest.clearAllMocks();
    auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
    auth.checkCsrf.mockReturnValue(true);
    settingsStore.getConfig.mockReturnValue(CONFIG);
    listRaidEvents.mockReturnValue([{ id: "r1", categoryId: "mon", startTime: 1 }]);
    discord.getClient.mockReturnValue({ isReady: () => true });
    discord.listGuilds.mockReturnValue([{ id: "g1" }]);
    discord.listCategories.mockImplementation(() => [{ id: "mon", name: "Montag" }]);
    discord.getGuild.mockImplementation((id) => (id === "g1" ? { id } : null));
    activeGuildFor.mockReturnValue("g1");
    rosterStore.listRosters.mockReturnValue([]);
    // #926: "gone" was seen on g1 - only then may it read as deleted
    // #925: and "mon" on g1, "far" on another server
    storedCategoryGuilds.mockReturnValue(new Map([["mon", "g1"], ["gone", "g1"], ["far", "g2"]]));
});

describe("web/apiRoutes/settings: categories per server (#925)", () => {
    const LIMITED = { id: "7", name: "Bob", isAdmin: false, access: { settings: { read: true, write: true } } };
    const FOREIGN = {
        ...CONFIG, categoryIds: ["mon", "gone", "far"], categoryVersion: { mon: "tbc", gone: "tbc", far: "tbc" },
        categoryReminders: { ...CONFIG.categoryReminders, far: { missingHours: 12, signedHours: 0, target: "event" } },
    };

    it("lets a limited settings user change nothing of a category on another server", async () => {
        settingsStore.getConfig.mockReturnValue(FOREIGN);
        auth.getUser.mockReturnValue(LIMITED);
        const tries = [
            { categoryPlanning: { far: "sheet" } },
            { categoryIds: ["mon", "gone"], serverSettingsGuildId: "g1" },
            { categoryIds: ["mon", "gone", "far", "unknown"], categoryVersion: { ...FOREIGN.categoryVersion, unknown: "tbc" }, serverSettingsGuildId: "g1" },
            { categoryVersion: { mon: "tbc", gone: "tbc" } },
        ];
        for (const body of tries) {
            const res = await patch("/api/settings", body);
            expect([res.writeHead.mock.calls[0][0], json(res).error.code]).toEqual([403, "other_server"]);
        }
        // #957: the reminder rules are full admins' only - even its own server's
        const reminders = await patch("/api/settings", { categoryReminders: FOREIGN.categoryReminders });
        expect([reminders.writeHead.mock.calls[0][0], json(reminders).error.code]).toEqual([403, "forbidden"]);
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
        // its own server's categories - and the whole maps sent back unchanged - are fine
        settingsStore.saveConfig.mockReturnValue(FOREIGN);
        const own = await patch("/api/settings", { categoryPlanning: { mon: "sheet" }, categoryVersion: FOREIGN.categoryVersion });
        expect(own.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenCalledTimes(1);
    });

    it("writes a category's game version for categories of the active server only (#961)", async () => {
        settingsStore.getConfig.mockReturnValue(FOREIGN);
        auth.getUser.mockReturnValue(LIMITED);
        // another server's category: 403 other_server, nothing saved
        const foreign = await patch("/api/settings", { categoryVersion: { ...FOREIGN.categoryVersion, far: "forever" } });
        expect([foreign.writeHead.mock.calls[0][0], json(foreign).error.code]).toEqual([403, "other_server"]);
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
        // its own server's category goes through
        settingsStore.saveConfig.mockReturnValue(FOREIGN);
        const own = await patch("/api/settings", { categoryVersion: { ...FOREIGN.categoryVersion, mon: "forever" } });
        expect(own.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig.mock.calls[0][0].categoryVersion).toMatchObject({ mon: "forever", far: "tbc" });
        // a full admin may change every server's category
        settingsStore.saveConfig.mockClear();
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        const admin = await patch("/api/settings", { categoryVersion: { ...FOREIGN.categoryVersion, far: "forever" } });
        expect(admin.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig.mock.calls[0][0].categoryVersion).toMatchObject({ far: "forever" });
    });

    it("closes and previews the active server's categories only, a full admin all of them", async () => {
        settingsStore.getConfig.mockReturnValue(FOREIGN);
        auth.getUser.mockReturnValue(LIMITED);
        const close = await post("/api/settings/category-close", { categoryId: "far" });
        expect([close.writeHead.mock.calls[0][0], json(close).error.code]).toEqual([404, "not_found"]);
        expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
        const sw = await get("/api/settings/category-switch", { categoryId: "far", versionId: "tbc" });
        expect(sw.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        const deact = json(await get("/api/settings/category-deactivate", { next: "mon", guild: "g1" })).data.categories.map((c) => c.categoryId);
        expect(deact).not.toContain("far");
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        expect(json(await get("/api/settings/category-deactivate", { next: "mon", guild: "g1" })).data.categories.map((c) => c.categoryId)).toContain("far");
        expect((await get("/api/settings/category-switch", { categoryId: "far", versionId: "tbc" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });
});

describe("web/apiRoutes/settings: a category's life (#744)", () => {
    it("refuses to take the last active category away while raids exist", async () => {
        const res = await patch("/api/settings", { categoryIds: [], serverSettingsGuildId: "g1" });
        expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        expect(json(res).error.code).toBe("categories_empty");
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });

    it("lets an install without raids, or one that never picked a category, keep an empty list", async () => {
        listRaidEvents.mockReturnValue([]);
        expect((await patch("/api/settings", { categoryIds: [], serverSettingsGuildId: "g1" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        listRaidEvents.mockReturnValue([{ id: "r1" }]);
        settingsStore.getConfig.mockReturnValue({ ...CONFIG, categoryIds: [] });
        expect((await patch("/api/settings", { categoryIds: [], serverSettingsGuildId: "g1" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    it("answers a save with what deactivating paused, without deleting a setting", async () => {
        const res = await patch("/api/settings", { categoryIds: ["mon"], serverSettingsGuildId: "g1" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["mon"] });
        expect(json(res).data.deactivatedCategories).toEqual([
            { categoryId: "gone", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 0 },
        ]);
        expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
    });

    it("previews what a save would pause, with names", async () => {
        const res = await get("/api/settings/category-deactivate", { next: "mon", guild: "g1" });
        expect(json(res).data).toEqual({
            categories: [{ categoryId: "gone", name: "TBC Montag", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 0 }],
            emptyBlocked: false,
        });
        const empty = await get("/api/settings/category-deactivate", { next: "", guild: "g1" });
        expect(json(empty).data.emptyBlocked).toBe(true);
    });

    it("marks a configured category Discord no longer has on the settings page", async () => {
        const res = await get("/api/settings");
        const missing = json(res).data.missingCategories;
        expect(missing.map((c) => [c.categoryId, c.name])).toEqual([["gone", "TBC Montag"]]);
        expect(missing[0]).toMatchObject({ active: true, reminders: true, series: { enabled: true } });
        // the bot offline: nothing is marked
        discord.getClient.mockReturnValue(null);
        expect(json(await get("/api/settings")).data.missingCategories).toEqual([]);
    });

    it("closes a category deleted in Discord, and refuses one Discord still has", async () => {
        const res = await post("/api/settings/category-close", { categoryId: "gone" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(json(res).data).toMatchObject({ ok: true, name: "TBC Montag", removed: { series: true, reminders: true, active: true, kaders: 1 } });
        expect(seriesStore.deleteSeries).toHaveBeenCalledWith("gone");
        expect(configStore.dropCategoryEntries).toHaveBeenCalledWith("gone", expect.arrayContaining(["categoryReminders", "categoryRoles"]));

        const still = await post("/api/settings/category-close", { categoryId: "mon" });
        expect(still.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(still).error.code).toBe("category_exists");
    });

    // #925: the answer carries the config like GET does - a limited settings user
    // never sees the rights of any server, a full admin those of the active one only.
    it("answers a close with the config as the caller may see it (#925)", async () => {
        settingsStore.getConfig.mockReturnValue({
            ...CONFIG, adminRoleIds: ["adm"],
            serverSettings: { g1: { orgaRoleIds: ["o1"] }, g2: { orgaRoleIds: ["o2"], userPermissions: { u9: { loot: { read: true } } } } },
        });
        auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { settings: { read: true, write: true } } });
        const limited = json(await post("/api/settings/category-close", { categoryId: "gone" })).data.config;
        expect(limited.adminRoleIds).toBeUndefined();
        expect(limited.orgaRoleIds).toBeUndefined();
        expect(JSON.stringify(limited.serverSettings)).not.toMatch(/o1|o2|u9/);

        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        const full = json(await post("/api/settings/category-close", { categoryId: "gone" })).data.config;
        expect(full.orgaRoleIds).toEqual(["o1"]);
        expect(JSON.stringify(full.serverSettings)).not.toMatch(/o2|u9/);
    });

    it("shows a limited settings user the settings of the active server only, a full admin those of all (#925)", async () => {
        const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
        settingsStore.getConfig.mockReturnValue({
            ...CONFIG,
            serverSettings: {
                g1: { logChannels: [{ channelId: "log-a", versionId: "tbc" }], raidhelper: { serverId: "rh-a", apiKey: "k-a" } },
                g2: { logChannels: [{ channelId: "log-b", versionId: "tbc" }], raidhelper: { serverId: "rh-b", apiKey: "k-b" } },
            },
        });
        // rights on B only, B active: nothing of A
        activeGuildFor.mockReturnValue("g2");
        auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { settings: { read: true, write: true } } });
        const limited = json(await get("/api/settings")).data.config.serverSettings;
        expect(Object.keys(limited)).toEqual(["g2"]);
        expect(JSON.stringify(limited)).not.toMatch(/log-a|rh-a|k-a|k-b/);
        expect(limited.g2.raidhelper).toEqual({ serverId: "rh-b", hasKey: true });
        // no active server: no server's settings at all
        activeGuildFor.mockReturnValue("");
        expect(json(await get("/api/settings")).data.config.serverSettings).toEqual({});
        // a full admin sees every server, keys still masked
        activeGuildFor.mockReturnValue("g2");
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        const full = json(await get("/api/settings")).data.config.serverSettings;
        expect(Object.keys(full).sort()).toEqual(["g1", "g2"]);
        expect(JSON.stringify(full)).not.toMatch(/k-a|k-b/);
        activeGuildFor.mockReturnValue("g1");
    });

    it("needs settings write for closing", async () => {
        auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { settings: { read: true, write: false } } });
        const res = await post("/api/settings/category-close", { categoryId: "gone" });
        expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
    });

    it("never reads a category as deleted without a proven server", async () => {
        storedCategoryGuilds.mockReturnValue(new Map());
        const data = json(await get("/api/settings")).data;
        expect(data.missingCategories).toEqual([]);
        expect(data.unprovenCategoryIds).toEqual(["gone"]);
        const res = await post("/api/settings/category-close", { categoryId: "gone" });
        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(res).error.code).toBe("category_server_unknown");
        expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
        expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
    });
});

// #926: config.categoryIds is one list over every server - each server sees and edits only its part.
describe("web/apiRoutes/settings: raid categories per server (#926)", () => {
    const TWO = {
        guildId: "A",
        discordServers: { servers: [{ guildId: "A" }, { guildId: "B" }], links: [] },
        categoryIds: ["a1", "b1", "bx"],
        categoryVersion: { a1: "tbc", a2: "tbc", b1: "tbc", bx: "tbc" },
    };
    beforeEach(() => {
        settingsStore.getConfig.mockReturnValue(TWO);
        listRaidEvents.mockReturnValue([]);
        discord.listGuilds.mockReturnValue([{ id: "A" }, { id: "B" }]);
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.listCategories.mockImplementation((id) => (id === "A" ? [{ id: "a1" }, { id: "a2" }] : id === "B" ? [{ id: "b1" }] : []));
        // bx was seen on B and is gone there now
        storedCategoryGuilds.mockReturnValue(new Map([["bx", "B"]]));
    });

    it("lists only the active server's categories and its deleted ones", async () => {
        activeGuildFor.mockReturnValue("A");
        const onA = json(await get("/api/settings")).data;
        expect(onA.serverCategoryIds).toEqual(["a1"]);
        // "gone" is configured only by its series and seen nowhere: shown on the first server, unproven
        expect(onA.unprovenCategoryIds).toEqual(["gone"]);
        expect(onA.serverListed).toBe(true);
        expect(onA.missingCategories).toEqual([]);
        expect(onA.otherServerCategoryIds).toEqual(expect.arrayContaining(["b1", "bx"]));
        expect(onA.otherServerCategoryIds).not.toContain("a1");
        activeGuildFor.mockReturnValue("B");
        const onB = json(await get("/api/settings")).data;
        expect(onB.serverCategoryIds).toEqual(["b1", "bx"]);
        expect(onB.otherServerCategoryIds).toEqual(expect.arrayContaining(["a1"]));
        expect(onB.missingCategories.map((c) => [c.categoryId, c.guildId])).toEqual([["bx", "B"]]);
    });

    it("a save on A never removes or adds a category of B", async () => {
        activeGuildFor.mockReturnValue("A");
        // A takes a1 out, adds a2, and a list naming b1 cannot reach B
        let res = await patch("/api/settings", { categoryIds: ["a2", "b1"], serverSettingsGuildId: "A" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["b1", "bx", "a2"] });
        // B empties its list: A's stay
        activeGuildFor.mockReturnValue("B");
        res = await patch("/api/settings", { categoryIds: [], serverSettingsGuildId: "B" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["a1"] });
    });

    it("refuses a tab loaded on A saving after the session switched to B: B's categories stay", async () => {
        // tab 1 loaded A; tab 2 switched the session to B; tab 1 saves its A list
        activeGuildFor.mockReturnValue("B");
        const res = await patch("/api/settings", { categoryIds: ["a1", "a2"], serverSettingsGuildId: "A", officerRoleId: "r9" });
        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(res).error.code).toBe("server_switched");
        // nothing at all is saved, not even the other fields
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
        // no server sent at all while one is active: refused as well
        const none = await patch("/api/settings", { categoryIds: [] });
        expect(none.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });

    it("without an active server, a save edits the first server's part", async () => {
        activeGuildFor.mockReturnValue("");
        const res = await patch("/api/settings", { categoryIds: ["a2"], serverSettingsGuildId: "" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["b1", "bx", "a2"] });
        // a tab that still names a server while the session has none: refused
        const stale = await patch("/api/settings", { categoryIds: ["a2"], serverSettingsGuildId: "A" });
        expect(stale.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    });

    it("previews a deactivation only for the active server's categories", async () => {
        activeGuildFor.mockReturnValue("A");
        const res = await get("/api/settings/category-deactivate", { next: "", guild: "A" });
        expect(json(res).data.categories.map((c) => c.categoryId)).toEqual(["a1"]);
        expect(json(res).data.emptyBlocked).toBe(false);
    });

    it("refuses a deactivation preview for a tab left on another server", async () => {
        activeGuildFor.mockReturnValue("B");
        const res = await get("/api/settings/category-deactivate", { next: "", guild: "A" });
        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(res).error.code).toBe("server_switched");
        const missing = await get("/api/settings/category-deactivate", { next: "" });
        expect(missing.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    });

    it("closes a category deleted on B, and answers with B's list", async () => {
        activeGuildFor.mockReturnValue("B");
        const res = await post("/api/settings/category-close", { categoryId: "bx" });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(json(res).data.serverCategoryIds).toEqual(["b1", "bx"]);
        // A cannot close B's category
        activeGuildFor.mockReturnValue("A");
        const fromA = await post("/api/settings/category-close", { categoryId: "bx" });
        expect(fromA.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(fromA).error.code).toBe("category_other_server");
    });

    it("a Discord outage on B (cached, available false, no channels): nothing deleted, closing refused", async () => {
        discord.getGuild.mockImplementation((id) => (id === "B" ? { id, available: false } : { id }));
        discord.listCategories.mockImplementation((id) => (id === "A" ? [{ id: "a1" }] : []));
        activeGuildFor.mockReturnValue("B");
        const data = json(await get("/api/settings")).data;
        expect(data.missingCategories).toEqual([]);
        expect(data.unprovenCategoryIds).toEqual(expect.arrayContaining(["bx"]));
        const res = await post("/api/settings/category-close", { categoryId: "bx" });
        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(res).error.code).toBe("category_server_unknown");
        expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
    });

    it("a server listing no category although the snapshot knows some: closing refused", async () => {
        discord.listCategories.mockImplementation((id) => (id === "A" ? [{ id: "a1" }] : []));
        activeGuildFor.mockReturnValue("B");
        expect(json(await get("/api/settings")).data.missingCategories).toEqual([]);
        const res = await post("/api/settings/category-close", { categoryId: "bx" });
        expect(json(res).error.code).toBe("category_server_unknown");
        expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
    });

    it("a roster's guildId shows a category on its server, but never proves it deleted", async () => {
        storedCategoryGuilds.mockReturnValue(new Map());
        rosterStore.listRosters.mockReturnValue([{ id: "ros1", guildId: "B", categoryId: "bx" }]);
        activeGuildFor.mockReturnValue("B");
        const data = json(await get("/api/settings")).data;
        expect(data.serverCategoryIds).toEqual(["b1", "bx"]);
        expect(data.missingCategories).toEqual([]);
        expect(data.unprovenCategoryIds).toEqual(["bx"]);
        const res = await post("/api/settings/category-close", { categoryId: "bx" });
        expect(json(res).error.code).toBe("category_server_unknown");
        expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
    });

    it("says when the active server is not in the server list", async () => {
        activeGuildFor.mockReturnValue("C");
        expect(json(await get("/api/settings")).data.serverListed).toBe(false);
    });

    describe("regression: prod 2026-10-27, a server missing from the server list", () => {
        // Only the PuG server P is listed; Pulse Fresh F (with its raid categories f1, f2) is not.
        const PROD = {
            guildId: "P",
            discordServers: { servers: [{ guildId: "P" }], links: [] },
            categoryIds: ["p1", "f1", "f2"],
            categoryVersion: { p1: "forever", f1: "tbc", f2: "tbc" },
        };
        beforeEach(() => {
            settingsStore.getConfig.mockReturnValue(PROD);
            activeGuildFor.mockReturnValue("P");
            listRaidEvents.mockReturnValue([{ id: "r1", guildId: "F", categoryId: "f2", startTime: 1 }]);
            discord.listCategories.mockImplementation((id) => (id === "P" ? [{ id: "p1" }] : id === "F" ? [{ id: "f1" }] : []));
            storedCategoryGuilds.mockReturnValue(new Map([["f1", "F"]]));
        });

        it("bot on F: nothing reads as deleted, nothing can be closed", async () => {
            discord.listGuilds.mockReturnValue([{ id: "P" }, { id: "F" }]);
            const data = json(await get("/api/settings")).data;
            expect(data.missingCategories).toEqual([]);
            // F's categories show on the first server, marked as without proven server
            expect(data.serverCategoryIds).toEqual(["p1", "f1", "f2"]);
            expect(data.unprovenCategoryIds).toEqual(["f1", "f2", "gone"]);
            const live = await post("/api/settings/category-close", { categoryId: "f1" });
            expect(live.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(live).error.code).toBe("category_exists");
            const known = await post("/api/settings/category-close", { categoryId: "f2" });
            expect(json(known).error.code).toBe("category_server_unknown");
            expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
            expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
        });

        it("bot not on F: still nothing reads as deleted or can be closed", async () => {
            discord.listGuilds.mockReturnValue([{ id: "P" }]);
            expect(json(await get("/api/settings")).data.missingCategories).toEqual([]);
            for (const categoryId of ["f1", "f2"]) {
                const res = await post("/api/settings/category-close", { categoryId });
                expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                expect(json(res).error.code).toBe("category_server_unknown");
            }
            expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
        });
    });
});
