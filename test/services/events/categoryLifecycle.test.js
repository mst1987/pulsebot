// categoryLifecycle (#744): active, deactivated, deleted in Discord and closed.
jest.mock("../../../src/services/discord/discord", () => ({ isOnline: jest.fn(() => true), getGuild: jest.fn(), listCategories: jest.fn() }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../src/stores/eventSeriesStore", () => ({ getSeries: jest.fn(), listSeries: jest.fn(() => ({})), deleteSeries: jest.fn(() => true) }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/rosterStore", () => ({ listRosters: jest.fn(() => []) }));
jest.mock("../../../src/stores/councilProfilesStore", () => ({
    categoryProfiles: jest.fn(() => ({})), categoryProfileId: jest.fn(() => ""), setCategoryProfile: jest.fn(),
}));
jest.mock("../../../src/services/kader/kaderCategories", () => ({ kadersCountingCategory: jest.fn(() => []), dropAttendanceCategory: jest.fn(() => 0) }));
jest.mock("../../../src/stores/configStore", () => ({ dropCategoryEntries: jest.fn(() => ({ config: {}, removed: [] })) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../../src/services/discord/discord");
const seriesStore = require("../../../src/stores/eventSeriesStore");
const eventStore = require("../../../src/stores/eventStore");
const { listRaidEvents } = require("../../../src/stores/raidEventStore");
const rosterStore = require("../../../src/stores/rosterStore");
const councilProfiles = require("../../../src/stores/councilProfilesStore");
const kaderCategories = require("../../../src/services/kader/kaderCategories");
const configStore = require("../../../src/stores/configStore");
const settingsStore = require("../../../src/stores/settingsStore");
const lifecycle = require("../../../src/services/events/categoryLifecycle");

const NOW = Date.UTC(2026, 9, 11);
const SERIES = { categoryId: "mon", enabled: true, weekdays: [1], time: "19:30" };

beforeEach(() => {
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockImplementation((id) => (id === "g1" ? { id } : null));
    discord.listCategories.mockReturnValue([{ id: "mon", name: "Montag" }, { id: "thu", name: "Donnerstag" }]);
    seriesStore.getSeries.mockImplementation((id) => (id === "mon" ? SERIES : null));
    seriesStore.listSeries.mockReturnValue({ mon: SERIES });
    eventStore.listEvents.mockReturnValue([]);
    listRaidEvents.mockReturnValue([]);
});

describe("services/events/categoryLifecycle", () => {
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

        it("knows Discord's categories only when the bot sees every event server", () => {
            expect([...lifecycle.discordCategoryIds(config)]).toEqual(["mon", "thu"]);
            discord.isOnline.mockReturnValue(false);
            expect(lifecycle.discordCategoryIds(config)).toBeNull();
            discord.isOnline.mockReturnValue(true);
            discord.getGuild.mockReturnValue(null);
            expect(lifecycle.discordCategoryIds(config)).toBeNull();
        });

        it("marks every configured category Discord no longer has, with what closing removes", () => {
            councilProfiles.categoryProfiles.mockReturnValue({ council: "p1" });
            rosterStore.listRosters.mockReturnValue([{ id: "ros1", name: "Gone-Roster", categoryId: "gone" }, { id: "ros2", name: "Mo", categoryId: "mon" }]);
            kaderCategories.kadersCountingCategory.mockImplementation((id) => (id === "gone" ? [{ guildId: "g1", kaderId: "k1", name: "Kader" }] : []));
            const out = lifecycle.missingCategories({ config, nameOf: (id) => (id === "gone" ? "TBC Montag" : "") });
            expect(out.map((c) => c.categoryId).sort()).toEqual(["council", "gone", "old"]);
            const gone = out.find((c) => c.categoryId === "gone");
            expect(gone).toMatchObject({
                name: "TBC Montag", active: true, series: null, reminders: true, settings: ["categoryRoles", "categoryReminders"],
                councilProfile: false, kaders: [{ kaderId: "k1", name: "Kader" }], rosters: [{ id: "ros1", name: "Gone-Roster" }],
            });
        });

        it("guesses nothing while Discord's state is unknown", () => {
            discord.isOnline.mockReturnValue(false);
            expect(lifecycle.missingCategories({ config })).toEqual([]);
        });
    });

    describe("closeCategory", () => {
        it("refuses a category Discord still has, and one whose state is unknown", () => {
            expect(lifecycle.closeCategory("mon", { config: {} }).error).toMatchObject({ status: 409, code: "category_exists" });
            discord.isOnline.mockReturnValue(false);
            expect(lifecycle.closeCategory("gone", { config: {} }).error).toMatchObject({ status: 503, code: "bot_offline" });
            expect(lifecycle.closeCategory("", { config: {} }).error).toMatchObject({ status: 400 });
            expect(seriesStore.deleteSeries).not.toHaveBeenCalled();
            expect(configStore.dropCategoryEntries).not.toHaveBeenCalled();
        });

        it("deletes the series, the settings and reminders, the council profile entry and the Kader entries", () => {
            seriesStore.getSeries.mockReturnValue({ ...SERIES, categoryId: "gone" });
            councilProfiles.categoryProfileId.mockReturnValue("p1");
            kaderCategories.dropAttendanceCategory.mockReturnValue(2);
            rosterStore.listRosters.mockReturnValue([{ id: "ros1", name: "Gone-Roster", categoryId: "gone" }]);
            configStore.dropCategoryEntries.mockReturnValue({ config: {}, removed: ["categoryIds", "categoryRoles", "categoryReminders"] });

            const out = lifecycle.closeCategory("gone", { config: { categoryIds: ["gone"] } });

            expect(seriesStore.deleteSeries).toHaveBeenCalledWith("gone");
            expect(configStore.dropCategoryEntries).toHaveBeenCalledWith("gone", lifecycle.SETTINGS_KEYS);
            expect(councilProfiles.setCategoryProfile).toHaveBeenCalledWith("gone", "");
            expect(kaderCategories.dropAttendanceCategory).toHaveBeenCalledWith("gone");
            expect(out).toEqual({
                ok: true,
                removed: { series: true, reminders: true, settings: ["categoryRoles", "categoryReminders"], active: true, councilProfile: true, kaders: 2 },
                rosters: [{ id: "ros1", name: "Gone-Roster" }],
            });
        });

        it("keeps what the history reads (version and sections), and drops what would keep it offered", () => {
            for (const key of ["categoryVersion", "categoryEras"]) expect(lifecycle.SETTINGS_KEYS).not.toContain(key);
            for (const key of ["categoryLootSystem", "categoryAttendance", "categoryReminders", "categoryRoles"]) expect(lifecycle.SETTINGS_KEYS).toContain(key);
        });
    });
});
