// Einstellungen → Kategorien over a category's life (#744): an empty active list
// is refused while raids exist, deactivating says what pauses, a category deleted
// in Discord is marked, and "Kategorie abschließen" closes it.
const { json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(), getRealUser: jest.fn(), setViewAs: jest.fn(() => true), csrfToken: jest.fn(), checkCsrf: jest.fn(), setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/services/discord/languageChange", () => ({ afterServerLangChange: jest.fn(async () => ({})) }));
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ refreshPanels: jest.fn(() => Promise.resolve({})) }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRaidsheets: jest.fn(() => []), saveRaidsheet: jest.fn(), deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []), getRaidTemplate: jest.fn(),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "mon", name: "Montag" }, { id: "gone", name: "TBC Montag" }]),
}));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({
    getClient: jest.fn(() => ({ isReady: () => true })),
    getGuild: jest.fn((id) => (id === "g1" ? { id } : null)),
    listCategories: jest.fn(() => [{ id: "mon", name: "Montag" }]),
    listRoles: jest.fn(() => []), listTextChannels: jest.fn(() => []), listVoiceChannels: jest.fn(() => []), listGuilds: jest.fn(() => []),
    resolveUserNames: jest.fn(async () => ({})),
}));
jest.mock("../../../src/services/events/contentVersions", () => ({
    upcomingByVersion: jest.fn(() => ({})), versionsWithData: jest.fn(() => new Set()), archiveExport: jest.fn(), archiveCsv: jest.fn(),
}));
jest.mock("../../../src/stores/eventSeriesStore", () => ({
    getSeries: jest.fn((id) => (id === "gone" ? { categoryId: "gone", enabled: true, weekdays: [1], time: "19:30" } : null)),
    listSeries: jest.fn(() => ({ gone: { categoryId: "gone", enabled: true } })),
    deleteSeries: jest.fn(() => true),
}));
jest.mock("../../../src/stores/configStore", () => ({
    ...jest.requireActual("../../../src/stores/configStore"),
    dropCategoryEntries: jest.fn(() => ({ config: {}, removed: ["categoryIds", "categoryReminders"] })),
}));
jest.mock("../../../src/services/kader/kaderCategories", () => ({ kadersCountingCategory: jest.fn(() => []), dropAttendanceCategory: jest.fn(() => 1) }));

const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { listRaidEvents } = require("../../../src/stores/raidEventStore");
const discord = require("../../../src/services/discord/discord");
const seriesStore = require("../../../src/stores/eventSeriesStore");
const configStore = require("../../../src/stores/configStore");
const { post, patch, get } = routerClient(require("../../../src/web/apiRoutes/settings"));

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
});

describe("web/apiRoutes/settings: a category's life (#744)", () => {
    it("refuses to take the last active category away while raids exist", async () => {
        const res = await patch("/api/settings", { categoryIds: [] });
        expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        expect(json(res).error.code).toBe("categories_empty");
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });

    it("lets an install without raids, or one that never picked a category, keep an empty list", async () => {
        listRaidEvents.mockReturnValue([]);
        expect((await patch("/api/settings", { categoryIds: [] })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        listRaidEvents.mockReturnValue([{ id: "r1" }]);
        settingsStore.getConfig.mockReturnValue({ ...CONFIG, categoryIds: [] });
        expect((await patch("/api/settings", { categoryIds: [] })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    it("answers a save with what deactivating paused, without deleting a setting", async () => {
        const res = await patch("/api/settings", { categoryIds: ["mon"] });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["mon"] });
        expect(json(res).data.deactivatedCategories).toEqual([
            { categoryId: "gone", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 0 },
        ]);
        expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
    });

    it("previews what a save would pause, with names", async () => {
        const res = await get("/api/settings/category-deactivate", { next: "mon" });
        expect(json(res).data).toEqual({
            categories: [{ categoryId: "gone", name: "TBC Montag", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 0 }],
            emptyBlocked: false,
        });
        const empty = await get("/api/settings/category-deactivate", { next: "" });
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

    it("needs settings write for closing", async () => {
        auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { settings: { read: true, write: false } } });
        const res = await post("/api/settings/category-close", { categoryId: "gone" });
        expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
    });
});
