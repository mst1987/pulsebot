// categoryLifecycle (#744): active, deactivated, deleted in Discord and closed.
// #926: "deleted" only with a proven, configured, reachable server (categoryGuild.js, real here).
jest.mock("../../../src/services/discord/discord", () => ({ isOnline: jest.fn(() => true), getGuild: jest.fn(), listCategories: jest.fn(), listGuilds: jest.fn() }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../src/services/discord/servers/serverOf", () => ({ storedCategoryGuilds: jest.fn(() => new Map()), firstServerId: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/eventSeriesStore", () => ({ getSeries: jest.fn(), listSeries: jest.fn(() => ({})), deleteSeries: jest.fn(() => true) }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/rosterStore", () => ({
    listRosters: jest.fn(() => []),
    closeRoster: jest.fn((id) => ({ id, closedAt: "2026-10-11T00:00:00.000Z" })),
}));
jest.mock("../../../src/stores/councilProfilesStore", () => ({
    categoryProfiles: jest.fn(() => ({})), categoryProfileId: jest.fn(() => ""), setCategoryProfile: jest.fn(),
}));
jest.mock("../../../src/services/kader/kaderCategories", () => ({ kadersCountingCategory: jest.fn(() => []), dropAttendanceCategory: jest.fn(() => 0) }));
jest.mock("../../../src/stores/configStore", () => ({ dropCategoryEntries: jest.fn(() => ({ config: {}, removed: [] })) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../../src/services/discord/discord");
const guildRoles = require("../../../src/services/discord/roles/guildRoles");
const serverOf = require("../../../src/services/discord/servers/serverOf");
const seriesStore = require("../../../src/stores/eventSeriesStore");
const eventStore = require("../../../src/stores/eventStore");
const { listRaidEvents } = require("../../../src/stores/raidEventStore");
const rosterStore = require("../../../src/stores/rosterStore");
const councilProfiles = require("../../../src/stores/councilProfilesStore");
const kaderCategories = require("../../../src/services/kader/kaderCategories");
const configStore = require("../../../src/stores/configStore");
const settingsStore = require("../../../src/stores/settingsStore");
const lifecycle = require("../../../src/services/categories/categoryLifecycle");

const NOW = Date.UTC(2026, 9, 11);
const SERIES = { categoryId: "mon", enabled: true, weekdays: [1], time: "19:30" };

beforeEach(() => {
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockImplementation((id) => (id === "g1" ? { id } : null));
    discord.listGuilds.mockReturnValue([{ id: "g1", name: "Gilde" }]);
    discord.listCategories.mockImplementation((id) => (id === "g1" ? [{ id: "mon", name: "Montag" }, { id: "thu", name: "Donnerstag" }] : []));
    guildRoles.eventGuildIds.mockReturnValue(["g1"]);
    // the name snapshot proves the server of the categories Discord no longer has
    serverOf.storedCategoryGuilds.mockReturnValue(new Map([["gone", "g1"], ["old", "g1"], ["council", "g1"]]));
    seriesStore.getSeries.mockImplementation((id) => (id === "mon" ? SERIES : null));
    seriesStore.listSeries.mockReturnValue({ mon: SERIES });
    eventStore.listEvents.mockReturnValue([]);
    listRaidEvents.mockReturnValue([]);
    rosterStore.listRosters.mockReturnValue([]);
});

describe("services/categories/categoryLifecycle", () => {
    describe("active categories", () => {
        it("reads the stored list, each id once", () => {
            expect(lifecycle.activeCategoryIds({ categoryIds: ["mon", " mon", "thu", ""] })).toEqual(["mon", "thu"]);
            expect(lifecycle.isCategoryActive("mon", { categoryIds: ["mon"] })).toBe(true);
            expect(lifecycle.isCategoryActive("thu", { categoryIds: ["mon"] })).toBe(false);
        });

        it("reads an empty list as every category (an install that never picked one)", () => {
            expect(lifecycle.isCategoryActive("thu", { categoryIds: [] })).toBe(true);
            settingsStore.getConfig.mockReturnValueOnce({ categoryIds: ["mon"] });
            expect(lifecycle.isCategoryActive("thu")).toBe(false);
        });

        it("blocks an empty list only while raids exist", () => {
            expect(lifecycle.emptyListBlocked([])).toBe(false);
            listRaidEvents.mockReturnValue([{ id: "r1" }]);
            expect(lifecycle.emptyListBlocked([])).toBe(true);
            expect(lifecycle.emptyListBlocked(["mon"])).toBe(false);
            listRaidEvents.mockImplementation(() => { throw new Error("broken"); });
            expect(lifecycle.hasRaidData()).toBe(true);
        });
    });

    describe("deactivationPreview", () => {
        it("lists what pauses for each category taken out: series, reminders, coming raids", () => {
            eventStore.listEvents.mockReturnValue([
                { id: "e1", categoryId: "mon", status: "active" },
                { id: "e2", categoryId: "mon", status: "cancelled" },
                { id: "e3", categoryId: "thu", status: "active" },
            ]);
            const config = { categoryIds: ["mon", "thu"], categoryReminders: { mon: { missingHours: 24 } } };
            const out = lifecycle.deactivationPreview({ config, nextIds: ["thu"], now: NOW });
            expect(out).toEqual({
                categories: [{ categoryId: "mon", series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: true, upcoming: 1 }],
                emptyBlocked: false,
            });
            expect(eventStore.listEvents).toHaveBeenCalledWith("", { sinceSeconds: Math.floor(NOW / 1000) });
        });

        it("says when the list would be empty although raids exist", () => {
            eventStore.listEvents.mockReturnValue([{ id: "e1", categoryId: "mon" }]);
            const out = lifecycle.deactivationPreview({ config: { categoryIds: ["mon"] }, nextIds: [] });
            expect(out.emptyBlocked).toBe(true);
            expect(out.categories.map((c) => c.categoryId)).toEqual(["mon"]);
        });
    });

    describe("deleted in Discord", () => {
        const config = {
            categoryIds: ["mon", "gone"],
            categoryRoles: { gone: ["r1"], old: ["r2"] },
            categoryReminders: { gone: { missingHours: 24 } },
            // history only: never makes a category "configured"
            categoryVersion: { past: "tbc" },
        };

        it("marks every configured category Discord no longer has, with what closing removes", () => {
            councilProfiles.categoryProfiles.mockReturnValue({ council: "p1" });
            rosterStore.listRosters.mockReturnValue([{ id: "ros1", name: "Gone-Roster", categoryId: "gone" }, { id: "ros2", name: "Mo", categoryId: "mon" }]);
            kaderCategories.kadersCountingCategory.mockImplementation((id) => (id === "gone" ? [{ guildId: "g1", kaderId: "k1", name: "Kader" }] : []));
            const out = lifecycle.missingCategories({ config, nameOf: (id) => (id === "gone" ? "TBC Montag" : "") });
            expect(out.map((c) => c.categoryId).sort()).toEqual(["council", "gone", "old"]);
            const gone = out.find((c) => c.categoryId === "gone");
            expect(gone).toMatchObject({
                name: "TBC Montag", guildId: "g1", active: true, series: null, reminders: true, settings: ["categoryRoles", "categoryReminders"],
                councilProfile: false, kaders: [{ kaderId: "k1", name: "Kader" }], rosters: [{ id: "ros1", name: "Gone-Roster", versionId: "", closed: false }],
            });
        });

        it("guesses nothing while Discord's state is unknown", () => {
            discord.isOnline.mockReturnValue(false);
            expect(lifecycle.missingCategories({ config })).toEqual([]);
        });

        it("filters by server and names the server of each", () => {
            expect(lifecycle.missingCategories({ config, guildId: "g1" }).map((c) => c.guildId)).toEqual(["g1", "g1", "g1"]);
            expect(lifecycle.missingCategories({ config, guildId: "g2" })).toEqual([]);
        });

        it("never marks a category whose server is unproven, not configured or not reachable", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map([["gone", "g2"]]));
            expect(lifecycle.missingCategories({ config })).toEqual([]); // old, council: no server; gone: g2 not configured
            guildRoles.eventGuildIds.mockReturnValue(["g1", "g2"]);
            expect(lifecycle.missingCategories({ config })).toEqual([]); // g2 configured, but the bot has not cached it
            discord.getGuild.mockImplementation((id) => ({ id }));
            discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
            discord.listCategories.mockImplementation((id) => (id === "g2" ? [{ id: "other" }] : [{ id: "mon" }]));
            expect(lifecycle.missingCategories({ config }).map((c) => c.categoryId)).toEqual(["gone"]);
        });

        it("never marks a category of an unavailable server (Discord outage) and refuses to close it", () => {
            // discord.js v14 keeps the server cached with available === false and no channels
            discord.getGuild.mockImplementation((id) => (id === "g1" ? { id, available: false } : null));
            discord.listCategories.mockReturnValue([]);
            expect(lifecycle.missingCategories({ config })).toEqual([]);
            const out = lifecycle.closeCategory("gone", { config });
            expect(out.error).toMatchObject({ status: 409, code: "category_server_unknown" });
            expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
        });

        it("never marks a category of a server that lists no category at all", () => {
            discord.listCategories.mockReturnValue([]);
            expect(lifecycle.missingCategories({ config })).toEqual([]);
            expect(lifecycle.closeCategory("gone", { config }).error).toMatchObject({ status: 409, code: "category_server_unknown" });
        });

        it("places a category by raids and rosters, but never reads it as deleted from them", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map());
            eventStore.listEvents.mockReturnValue([{ id: "e1", guildId: "g1", categoryId: "gone" }]);
            listRaidEvents.mockReturnValue([{ id: "r1", guildId: "g1", categoryId: "old" }]);
            rosterStore.listRosters.mockReturnValue([{ id: "ros1", guildId: "g1", categoryId: "council" }]);
            expect(lifecycle.missingCategories({ config })).toEqual([]);
            expect(lifecycle.closeCategory("council", { config }).error).toMatchObject({ status: 409, code: "category_server_unknown" });
        });

        // Prod 2026-10-27: discordServers.servers held only the PuG server B; the
        // categories of Pulse Fresh (A) read as deleted and closing wiped them.
        describe("regression: a server missing from the server list", () => {
            const prod = { categoryIds: ["catA"], categoryRoles: { catA: ["r1"] }, categoryReminders: { catA: { missingHours: 24 } } };
            beforeEach(() => {
                guildRoles.eventGuildIds.mockReturnValue(["B"]);
                discord.getGuild.mockImplementation((id) => ({ id }));
                discord.listCategories.mockImplementation((id) => (id === "A" ? [{ id: "catA", name: "TBC Montag" }] : id === "B" ? [{ id: "catB", name: "PuGs" }] : []));
                serverOf.storedCategoryGuilds.mockReturnValue(new Map([["catA", "A"], ["catB", "B"]]));
            });

            it("bot still on A: the category is live, not missing, and closing is refused", () => {
                discord.listGuilds.mockReturnValue([{ id: "A", name: "Pulse Fresh" }, { id: "B", name: "PuGs" }]);
                expect(lifecycle.missingCategories({ config: prod })).toEqual([]);
                expect(lifecycle.closeCategory("catA", { config: prod }).error).toMatchObject({ status: 409, code: "category_exists" });
                expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
            });

            it("bot not on A (or A not cached): unknown, never missing, closing is refused and nothing is deleted", () => {
                discord.listGuilds.mockReturnValue([{ id: "B", name: "PuGs" }]);
                expect(lifecycle.missingCategories({ config: prod })).toEqual([]);
                const out = lifecycle.closeCategory("catA", { config: prod, actor: "u1" });
                expect(out.error).toMatchObject({ status: 409, code: "category_server_unknown" });
                expect(out.error.message).toMatch(/Discord-Server/);
                expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
                expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
                expect(councilProfiles.setCategoryProfile).not.toHaveBeenCalled();
                expect(kaderCategories.dropAttendanceCategory).not.toHaveBeenCalled();
                expect(rosterStore.closeRoster).not.toHaveBeenCalled();
            });
        });
    });

    describe("closeCategory", () => {
        it("refuses a category Discord still has, and one whose state is unknown", () => {
            expect(lifecycle.closeCategory("mon", { config: {} }).error).toMatchObject({ status: 409, code: "category_exists" });
            discord.isOnline.mockReturnValue(false);
            expect(lifecycle.closeCategory("gone", { config: {} }).error).toMatchObject({ status: 503, code: "bot_offline" });
            expect(lifecycle.closeCategory("", { config: {} }).error).toMatchObject({ status: 400 });
            discord.isOnline.mockReturnValue(true);
            serverOf.storedCategoryGuilds.mockReturnValue(new Map());
            expect(lifecycle.closeCategory("gone", { config: {} }).error).toMatchObject({ status: 409, code: "category_server_unknown" });
            expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
            expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
        });

        it("deletes the series, the settings and reminders, the council profile entry and the Kader entries", () => {
            seriesStore.getSeries.mockReturnValue({ ...SERIES, categoryId: "gone" });
            councilProfiles.categoryProfileId.mockReturnValue("p1");
            kaderCategories.dropAttendanceCategory.mockReturnValue(2);
            rosterStore.listRosters.mockReturnValue([
                { id: "ros1", name: "Gone-Roster", categoryId: "gone", versionId: "forever", closedAt: null },
                { id: "ros0", name: "Gone-Alt", categoryId: "gone", versionId: "tbc", closedAt: "2026-09-01T00:00:00.000Z" },
            ]);
            configStore.dropCategoryEntries.mockReturnValue({ config: {}, removed: ["categoryIds", "categoryRoles", "categoryReminders"] });

            const out = lifecycle.closeCategory("gone", { config: { categoryIds: ["gone"] }, actor: "u1" });

            // #739: the open roster is closed with the reason and the caller, a closed one stays as it is
            expect(rosterStore.closeRoster).toHaveBeenCalledTimes(1);
            expect(rosterStore.closeRoster).toHaveBeenCalledWith("ros1", { reason: "category_closed", actor: "u1" });

            expect(seriesStore.deleteSeries).toHaveBeenCalledWith("gone");
            expect(configStore.dropCategoryEntries).toHaveBeenCalledWith("gone", lifecycle.SETTINGS_KEYS);
            expect(councilProfiles.setCategoryProfile).toHaveBeenCalledWith("gone", "");
            expect(kaderCategories.dropAttendanceCategory).toHaveBeenCalledWith("gone");
            expect(out).toEqual({
                ok: true,
                removed: { series: true, reminders: true, settings: ["categoryRoles", "categoryReminders"], active: true, councilProfile: true, kaders: 2 },
                rosters: [
                    { id: "ros1", name: "Gone-Roster", versionId: "forever", closed: true },
                    { id: "ros0", name: "Gone-Alt", versionId: "tbc", closed: true },
                ],
            });
        });

        it("keeps what the history reads (version and sections), and drops what would keep it offered", () => {
            for (const key of ["categoryVersion", "categoryEras"]) expect(lifecycle.SETTINGS_KEYS).not.toContain(key);
            for (const key of ["categoryLootSystem", "categoryAttendance", "categoryReminders", "categoryRoles", "categoryServerOverview"]) expect(lifecycle.SETTINGS_KEYS).toContain(key);
        });
    });
});
