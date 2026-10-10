// Switching a category to another version (#738): what the dialog lists, which
// categories a save switches, the series fix and the hook #739 builds on.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const eventStore = require("../../../src/stores/eventStore");
const raidEventStore = require("../../../src/stores/raidEventStore");
const seriesStore = require("../../../src/stores/eventSeriesStore");
const {
    switchPreview, versionSwitches, applySeriesFix, onCategoryVersionSwitch, notifyCategoryVersionSwitch,
} = require("../../../src/services/events/categorySwitch");

const G = "1100000000000000001";
const NOW = Date.UTC(2026, 9, 10, 12);
const SEC = Math.floor(NOW / 1000);
const DAY = 86400;
const TEMPLATES = [
    { id: "t-tbc", name: "SSC + TK", versionId: "tbc" },
    { id: "t-fe", name: "Onyxia 40", versionId: "forever" },
    { id: "t-fe2", name: "MC 40", versionId: "forever" },
];
const listTemplates = () => TEMPLATES;
const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) || null;
const config = { categoryIds: ["mon"], mainVersion: "tbc", categoryVersion: { mon: "tbc" }, categoryRaidTemplate: { mon: "t-tbc" } };

beforeEach(() => {
    fs.__store.clear();
});

describe("services/events/categorySwitch", () => {
    describe("switchPreview", () => {
        it("lists the coming raids that keep the old version, the unfitting series and default, the fitting templates", () => {
            eventStore.createEvent({ guildId: G, channelId: "c1", categoryId: "mon", title: "Kara", startTime: SEC + DAY, versionId: "tbc" });
            eventStore.createEvent({ guildId: G, channelId: "c2", categoryId: "mon", title: "Früher", startTime: SEC - DAY, versionId: "tbc" });
            eventStore.createEvent({ guildId: G, channelId: "c3", categoryId: "fri", title: "Andere Kategorie", startTime: SEC + DAY, versionId: "tbc" });
            eventStore.createEvent({ guildId: G, channelId: "c4", categoryId: "mon", title: "Schon Forever", startTime: SEC + 2 * DAY, versionId: "forever" });
            raidEventStore.saveRaidEvents([{ id: "rh-1", guildId: G, title: "Gruul", categoryId: "mon", startTime: SEC + 3 * DAY, versionId: "tbc" }]);
            seriesStore.saveSeries({ categoryId: "mon", enabled: true, raidTemplateId: "" });

            const preview = switchPreview({ categoryId: "mon", versionId: "forever", config, listTemplates, now: NOW });
            expect(preview).toMatchObject({
                categoryId: "mon",
                from: { id: "tbc", label: "TBC Anniversary" },
                to: { id: "forever", label: "WoW Forever" },
                switching: true,
                eras: [{ versionId: "tbc", from: 0, name: "" }],
                series: { enabled: true, usesDefault: true, template: { id: "t-tbc", versionId: "tbc" }, fits: false },
                defaultTemplate: { id: "t-tbc", name: "SSC + TK", fits: false },
                templates: [{ id: "t-fe", name: "Onyxia 40" }, { id: "t-fe2", name: "MC 40" }],
            });
            expect(preview.upcoming.map((r) => [r.title, r.versionId, r.source])).toEqual([["Kara", "tbc", "eventhelper"], ["Gruul", "tbc", "raidhelper"]]);
        });

        it("has nothing to warn about without series, default or coming raids", () => {
            const preview = switchPreview({ categoryId: "mon", versionId: "forever", config: { categoryVersion: { mon: "tbc" } }, listTemplates, now: NOW });
            expect(preview).toMatchObject({ switching: true, upcoming: [], series: null, defaultTemplate: null });
            expect(switchPreview({ categoryId: "mon", versionId: "tbc", config, listTemplates, now: NOW }).switching).toBe(false);
        });
    });

    describe("versionSwitches", () => {
        it("switches an active category, writes its history with today's name", () => {
            const { switches, categoryEras } = versionSwitches({
                before: config, categoryVersion: { mon: "forever" }, nameOf: (id) => (id === "mon" ? "TBC Montag" : ""), now: NOW,
            });
            expect(switches).toEqual([{ categoryId: "mon", fromVersion: "tbc", toVersion: "forever", at: NOW, name: "TBC Montag" }]);
            expect(categoryEras).toEqual({ mon: [{ versionId: "tbc", from: 0, name: "TBC Montag" }, { versionId: "forever", from: NOW, name: "TBC Montag" }] });
        });

        it("leaves an unchanged, a newly activated and an unknown version alone", () => {
            const { switches, categoryEras } = versionSwitches({
                before: config, categoryVersion: { mon: "tbc", newcat: "forever", fri: "wotlk" }, now: NOW,
            });
            expect(switches).toEqual([]);
            expect(categoryEras).toBeNull();
        });

        it("reads a category without its own version as the main version it played", () => {
            const { switches } = versionSwitches({ before: { categoryIds: ["mon"], mainVersion: "forever" }, categoryVersion: { mon: "forever" }, now: NOW });
            expect(switches).toEqual([]);
        });

        it("switches an inactive category that already has sections", () => {
            const before = { categoryIds: [], categoryVersion: { mon: "forever" }, categoryEras: { mon: [{ versionId: "tbc", from: 0, name: "A" }, { versionId: "forever", from: 5, name: "A" }] } };
            const { switches, categoryEras } = versionSwitches({ before, categoryVersion: { mon: "tbc" }, now: NOW });
            expect(switches).toHaveLength(1);
            expect(categoryEras.mon.map((e) => e.versionId)).toEqual(["tbc", "forever", "tbc"]);
        });
    });

    describe("applySeriesFix", () => {
        beforeEach(() => seriesStore.saveSeries({ categoryId: "mon", enabled: true, raidTemplateId: "t-tbc", weekdays: [1], time: "19:30" }));

        it("pauses the series", () => {
            expect(applySeriesFix({ categoryId: "mon", fix: "pause", toVersion: "forever", getTemplate, user: { id: "7", name: "Orga" }, now: NOW })).toBe("paused");
            expect(seriesStore.getSeries("mon")).toMatchObject({ enabled: false, raidTemplateId: "t-tbc", updatedBy: "7", updatedByName: "Orga", updatedAt: NOW });
        });

        it("gives it a template of the new version", () => {
            expect(applySeriesFix({ categoryId: "mon", fix: "t-fe", toVersion: "forever", getTemplate, now: NOW })).toBe("template");
            expect(seriesStore.getSeries("mon")).toMatchObject({ enabled: true, raidTemplateId: "t-fe" });
        });

        it("changes nothing for an unfitting or unknown template, no choice or no series", () => {
            expect(applySeriesFix({ categoryId: "mon", fix: "t-tbc", toVersion: "forever", getTemplate })).toBe("");
            expect(applySeriesFix({ categoryId: "mon", fix: "gone", toVersion: "forever", getTemplate })).toBe("");
            expect(applySeriesFix({ categoryId: "mon", fix: "", toVersion: "forever", getTemplate })).toBe("");
            expect(applySeriesFix({ categoryId: "none", fix: "pause", toVersion: "forever", getTemplate })).toBe("");
            expect(seriesStore.getSeries("mon")).toMatchObject({ enabled: true, raidTemplateId: "t-tbc" });
        });
    });

    describe("onCategoryVersionSwitch", () => {
        it("calls every listener once per switch, survives a failing one and can be unregistered", async () => {
            const seen = [];
            const off = onCategoryVersionSwitch((sw, ctx) => { seen.push([sw.categoryId, sw.toVersion, ctx.user.id]); });
            const offBroken = onCategoryVersionSwitch(() => { throw new Error("kaputt"); });
            const warn = jest.fn();
            const switches = [{ categoryId: "mon", fromVersion: "tbc", toVersion: "forever" }, { categoryId: "fri", fromVersion: "tbc", toVersion: "forever" }];
            await notifyCategoryVersionSwitch(switches, { user: { id: "7" } }, { warn });
            expect(seen).toEqual([["mon", "forever", "7"], ["fri", "forever", "7"]]);
            expect(warn).toHaveBeenCalledWith("[categorySwitch] mon tbc → forever: kaputt");
            off();
            offBroken();
            await notifyCategoryVersionSwitch(switches, { user: { id: "7" } }, { warn });
            expect(seen).toHaveLength(2);
            expect(onCategoryVersionSwitch(null)()).toBeUndefined();
        });
    });
});
