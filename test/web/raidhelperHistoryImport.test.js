// #291: the Raid-Helper signups as spec history — mapping, idempotence, dry run.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
jest.mock("../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
jest.mock("../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(() => null), isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
const mockGetPastEvents = jest.fn();
const mockClient = { getPastEvents: (...a) => mockGetPastEvents(...a) };
jest.mock("../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: jest.fn(() => mockClient) }));
jest.mock("../../src/services/discord/discord", () => ({ getChannelCategoryMap: jest.fn(() => ({})) }));

const fs = require("fs");
const { listRaidEvents } = require("../../src/stores/raidEventStore");
const { createRaidhelperClient } = require("../../src/utils/raidhelper/client");
const discord = require("../../src/services/discord/discord");
const specHistory = require("../../src/stores/specHistoryStore");
const { planImport, runImport, perCategoryOf } = require("../../src/web/raidhelperHistoryImport");

const NOW = 2000000000 * 1000;
const rhEvent = (id, startTime, categoryId, signUps, over = {}) => ({
    id, title: `Raid ${id}`, startTime, categoryId, categoryName: `Kat ${categoryId}`, signUps, ...over,
});

describe("web/raidhelperHistoryImport", () => {
    beforeEach(() => {
        fs.__store.clear();
        jest.clearAllMocks();
        listRaidEvents.mockReturnValue([]);
        mockGetPastEvents.mockResolvedValue([]);
        createRaidhelperClient.mockReturnValue(mockClient);
    });

    describe("planImport", () => {
        it("maps className/specName onto rule-set keys and skips sign-offs, pseudo specs and duplicates", () => {
            const plan = planImport([
                rhEvent("1", 1999000000, "c1", [
                    { userId: "u1", className: "Priest", specName: "Shadow", name: "Zibbo" },
                    { userId: "u1", className: "Priest", specName: "Shadow", name: "Zibbo" },
                    { userId: "u2", className: "Tank", specName: "Protection1" },
                    { userId: "u3", className: "Absence", specName: "Absence" },
                    { userId: "u4", className: "Bench", specName: "Bench" },
                    { userId: "u5", className: "DK", specName: "Unholy_DPS" },
                    { userId: "", specName: "Fire" },
                ]),
            ], { now: NOW });
            expect(plan.entries).toEqual([
                { userId: "u1", spec: "Priest-Shadow", eventId: "1", at: 1999000000 * 1000, character: "Zibbo" },
                { userId: "u2", spec: "Paladin-Protection", eventId: "1", at: 1999000000 * 1000, character: "" },
            ]);
            expect(plan.summary).toMatchObject({ events: 1, entries: 2, users: 2, unmapped: { Unholy_DPS: 1 } });
        });

        it("takes the last N events per category, only raids that took place, never own events", () => {
            const events = [
                rhEvent("a1", 1999000001, "c1", [{ userId: "u1", specName: "Fire" }]),
                rhEvent("a2", 1999000002, "c1", [{ userId: "u1", specName: "Frost" }]),
                rhEvent("a3", 1999000003, "c1", [{ userId: "u1", specName: "Arcane" }]),
                rhEvent("b1", 1999000001, "c2", [{ userId: "u2", specName: "Fury" }]),
                rhEvent("future", 2100000000, "c1", [{ userId: "u1", specName: "Fire" }]),
                rhEvent("eh-1", 1999000004, "c1", [{ userId: "u1", specName: "Fire" }]),
            ];
            const plan = planImport(events, { perCategory: 2, now: NOW });
            expect(plan.eventIds).toEqual(["a3", "a2", "b1"]);
            expect(plan.categories.map((c) => [c.categoryId, c.events])).toEqual([["c1", 2], ["c2", 1]]);
        });

        it("counts already imported events as skipped", () => {
            const plan = planImport([rhEvent("1", 1999000000, "c1", [{ userId: "u1", specName: "Fire" }])], { imported: new Set(["1"]), now: NOW });
            expect(plan.entries).toEqual([]);
            expect(plan.summary).toMatchObject({ events: 0, skippedEvents: 1 });
        });

        it("clamps the number per category", () => {
            expect(perCategoryOf("5")).toBe(5);
            expect(perCategoryOf(0)).toBe(10);
            expect(perCategoryOf("x")).toBe(10);
            expect(perCategoryOf(500)).toBe(50);
        });
    });

    describe("runImport", () => {
        const snapshot = [
            rhEvent("1", 1999000000, "c1", [{ userId: "u1", specName: "Shadow", status: "signed" }]),
            rhEvent("2", 1999500000, "c1", [{ userId: "u1", specName: "HolyPriest", status: "signed" }, { userId: "u2", specName: "Absence", status: "absence" }]),
        ];

        it("stores nothing on a dry run", async () => {
            listRaidEvents.mockReturnValue(snapshot);
            const result = await runImport({ guildId: "g1", dryRun: true, live: false, now: NOW });
            expect(result.dryRun).toBe(true);
            expect(result.stored).toBeNull();
            expect(result.summary).toMatchObject({ events: 2, entries: 2, users: 1 });
            expect(specHistory.specHistoryOf("u1")).toEqual([]);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it("stores once and is idempotent: a second run adds nothing, a new raid is added", async () => {
            listRaidEvents.mockReturnValue(snapshot);
            const first = await runImport({ guildId: "g1", dryRun: false, live: false, byName: "Orga", now: NOW });
            expect(first.stored).toEqual({ events: 2, entries: 2, users: 1 });
            expect(specHistory.specHistoryOf("u1").map((s) => [s.spec, s.count])).toEqual([["Priest-Holy", 1], ["Priest-Shadow", 1]]);
            expect(specHistory.lastImportedSpecOf("u1")).toMatchObject({ spec: "Priest-Holy", eventId: "2" });

            const second = await runImport({ guildId: "g1", dryRun: false, live: false, now: NOW });
            expect(second.stored).toEqual({ events: 0, entries: 0, users: 0 });
            expect(second.summary.skippedEvents).toBe(2);

            listRaidEvents.mockReturnValue([...snapshot, rhEvent("3", 1999900000, "c1", [{ userId: "u1", specName: "Shadow" }])]);
            const third = await runImport({ guildId: "g1", dryRun: false, live: false, now: NOW });
            expect(third.stored).toEqual({ events: 1, entries: 1, users: 1 });
            expect(specHistory.specHistoryOf("u1")[0]).toMatchObject({ spec: "Priest-Shadow", count: 2 });
            expect(specHistory.importStatus()).toMatchObject({ importedEvents: 3, users: 1 });
            expect(specHistory.importStatus().lastRun).toMatchObject({ events: 1, entries: 1 });
        });

        it("reads the live list where Raid-Helper answers (class and name) and keeps the snapshot otherwise", async () => {
            listRaidEvents.mockReturnValue([rhEvent("1", 1999000000, "c1", [{ userId: "u1", specName: "Holy" }])]);
            discord.getChannelCategoryMap.mockReturnValue({ ch5: { categoryId: "c5", categoryName: "Neu", name: "raid" } });
            mockGetPastEvents.mockResolvedValue([
                { id: "1", channelId: "gone", startTime: 1999000000, signUps: [{ userId: "u1", className: "Paladin", specName: "Holy", name: "Lichtbringer" }] },
                { id: "5", channelId: "ch5", startTime: 1999100000, signUps: [{ userId: "u9", className: "Warrior", specName: "Fury" }] },
                { id: "6", channelId: "elsewhere", startTime: 1999100000, signUps: [{ userId: "u9", specName: "Fury" }] },
            ]);
            const result = await runImport({ guildId: "g1", dryRun: true, now: NOW });
            expect(result.liveError).toBeNull();
            expect(result.categories.map((c) => c.categoryId).sort()).toEqual(["c1", "c5"]);
            expect(result.summary).toMatchObject({ events: 2, entries: 2 });

            mockGetPastEvents.mockRejectedValue(new Error("HTTP 404"));
            const offline = await runImport({ guildId: "g1", dryRun: true, now: NOW });
            expect(offline.liveError).toBe("HTTP 404");
            expect(offline.summary).toMatchObject({ events: 1, entries: 1 });
        });

        it("does not ask a switched-off Raid-Helper", async () => {
            createRaidhelperClient.mockReturnValue({ disabled: true, getPastEvents: mockGetPastEvents });
            listRaidEvents.mockReturnValue(snapshot);
            const result = await runImport({ guildId: "g1", dryRun: true, now: NOW });
            expect(mockGetPastEvents).not.toHaveBeenCalled();
            expect(result.summary.events).toBe(2);
        });
    });
});
