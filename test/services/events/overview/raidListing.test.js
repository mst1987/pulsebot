jest.mock("../../../../src/stores/events/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../../../src/services/events/raidEventScan", () => ({ scanRaidEvents: jest.fn(() => Promise.resolve({ error: null })) }));
jest.mock("../../../../src/services/logcheck/logAutoLink", () => ({ autoLinkLogs: jest.fn(() => Promise.resolve()) }));
jest.mock("../../../../src/stores/loot/lootStore", () => ({ listByEvent: jest.fn(() => []) }));
jest.mock("../../../../src/stores/events/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../../../src/stores/loot/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../../src/services/logcheck/reportList", () => ({ logPostedAt: jest.fn((l) => l.postedAt || 0) }));

const { cancelFields } = require("../../../../src/services/events/eventSources");
const { raidContentIds, raidSize, upcomingRows, loadPastRaids } = require("../../../../src/services/events/overview/raidListing");
const { listRaidEvents } = require("../../../../src/stores/events/raidEventStore");
const { scanRaidEvents } = require("../../../../src/services/events/raidEventScan");
const { autoLinkLogs } = require("../../../../src/services/logcheck/logAutoLink");
const { listByEvent } = require("../../../../src/stores/loot/lootStore");
const { getEventSoftres } = require("../../../../src/stores/events/eventSoftresStore");
const { listLogs } = require("../../../../src/stores/loot/logStore");

describe("services/events/overview/raidListing", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("raidContentIds", () => {
        it("recognises a combined night from the title, in raid order", () => {
            expect(raidContentIds({ title: "Black Temple + Hyjal" })).toEqual({ contentIds: ["hyjal", "bt"], sources: ["title"] });
            expect(raidContentIds({ title: "SSC/TK Farm" }).contentIds).toEqual(["ssc", "tk"]);
            expect(raidContentIds({ title: "Gruul + Magtheridon" }).contentIds).toEqual(["gruul", "mag"]);
        });

        it("gives no content for a title it does not recognise instead of a wrong one", () => {
            expect(raidContentIds({ title: "Donnerstagsraid", categoryName: "T6 Main" })).toEqual({ contentIds: [], sources: [] });
            // "BT" only as a whole word — not inside another one
            expect(raidContentIds({ title: "Debt collection" }).contentIds).toEqual([]);
        });

        it("falls back to the category, then the channel, only when the title names nothing", () => {
            expect(raidContentIds({ title: "GDKP", categoryName: "Kara GDKP" })).toEqual({ contentIds: ["kara"], sources: ["category"] });
            expect(raidContentIds({ title: "GDKP", categoryName: "Mittwoch", channelName: "ssc-mi-23-09" }))
                .toEqual({ contentIds: ["ssc"], sources: ["channel"] });
            // a recognised title is not widened by its category
            expect(raidContentIds({ title: "Karazhan", categoryName: "Gruul Twinks" }).contentIds).toEqual(["kara"]);
        });

        it("keeps the planned instances of every version (#749)", () => {
            expect(raidContentIds({ title: "Mittwoch", instanceIds: ["forever-ony"] })).toEqual({ contentIds: ["forever-ony"], sources: ["event"] });
            expect(raidContentIds({ title: "Kara", instanceIds: ["mc", "forever-hyjal", "hyjal"] }).contentIds).toEqual(["hyjal", "mc", "forever-hyjal"]);
            // an id no rule set knows is dropped, the title speaks
            expect(raidContentIds({ title: "Kara", instanceIds: ["nope"] })).toEqual({ contentIds: ["kara"], sources: ["title"] });
        });

        it("reads the wording only within the event's version (#749)", () => {
            expect(raidContentIds({ title: "Hyjal Summit (Forever)", versionId: "forever" }).contentIds).toEqual(["forever-hyjal"]);
            expect(raidContentIds({ title: "Archimonde night, Hyjal", versionId: "forever" }).contentIds).toEqual(["forever-hyjal"]);
            expect(raidContentIds({ title: "Hyjal", versionId: "tbc" }).contentIds).toEqual(["hyjal"]);
            expect(raidContentIds({ title: "Kara", versionId: "forever" }).contentIds).toEqual([]);
            expect(raidContentIds({ title: "T6", zones: ["Hyjal Summit"], versionId: "forever" }).contentIds).toEqual(["forever-hyjal"]);
        });

        it("adds what a past raid's logs and loot prove", () => {
            const r = raidContentIds({
                title: "T6 Main", zones: ["Hyjal Summit"],
                lootContentIds: ["bt", "bt", "hyjal", "kara", ""],
            });
            // one stray Karazhan item does not make it a Karazhan night
            expect(r).toEqual({ contentIds: ["hyjal", "bt"], sources: ["logs", "loot"] });
        });
    });

    describe("raidSize", () => {
        it("is 10 only when every content is a ten-player raid", () => {
            expect(raidSize(["kara"])).toEqual({ size: 10, known: true });
            expect(raidSize(["za"])).toEqual({ size: 10, known: true });
            expect(raidSize(["kara", "gruul"])).toEqual({ size: 25, known: true });
            expect(raidSize(["hyjal", "bt"])).toEqual({ size: 25, known: true });
        });

        it("reads the size of an instance of any version (#749)", () => {
            expect(raidSize(["forever-hyjal"])).toEqual({ size: 20, known: true });
            expect(raidSize(["forever-ony"])).toEqual({ size: 40, known: true });
        });

        it("defaults to 25 and says so when the content is unknown", () => {
            expect(raidSize([])).toEqual({ size: 25, known: false });
        });
    });

    describe("upcomingRows", () => {
        it("flattens the groups and keeps the category on each row", () => {
            getEventSoftres.mockImplementation((id) => (id === "e2" ? { url: "https://softres.it/raid/abc", editUrl: "k" } : null));
            const rows = upcomingRows([
                { categoryId: "c1", categoryName: "Kara GDKP", events: [{ id: "e1", title: "Montag", startTime: 10, channelId: "ch1", channelName: "mo", signupCount: 7 }] },
                { categoryId: "", categoryName: "Ohne Kategorie", events: [{ id: "e2", title: "Hyjal/BT", startTime: 20 }] },
            ]);
            expect(rows).toEqual([
                expect.objectContaining({ id: "e1", categoryId: "c1", categoryName: "Kara GDKP", contentIds: ["kara"], raidSize: 10, signupCount: 7, softres: null }),
                expect.objectContaining({ id: "e2", categoryId: "", contentIds: ["hyjal", "bt"], raidSize: 25, signupCount: 0, softres: { url: "https://softres.it/raid/abc" } }),
            ]);
            expect(rows[1]).not.toHaveProperty("signUps");
        });

        it("takes an own event's planned instances and size over the wording", () => {
            const rows = upcomingRows([
                { categoryId: "c1", categoryName: "Donnerstag", events: [
                    { id: "eh-1", source: "eventhelper", title: "Hyjal Farm", instanceIds: ["gruul", "mag"], size: 20, signupCount: 3 },
                    { id: "e2", title: "Kara" },
                ] },
            ]);
            expect(rows[0]).toMatchObject({
                id: "eh-1", source: "eventhelper", contentIds: ["gruul", "mag"], contentSources: ["event"], raidSize: 20, raidSizeKnown: true,
            });
            expect(rows[1]).toMatchObject({ id: "e2", source: "raidhelper", contentIds: ["kara"], contentSources: ["title"] });
        });

        it("carries the game version (#545): an own event's own, else the main version (a Raid-Helper event has none)", () => {
            const rows = upcomingRows([
                { categoryId: "c1", categoryName: "Donnerstag", events: [
                    { id: "eh-1", source: "eventhelper", title: "Forever", versionId: "forever" },
                    { id: "e2", title: "Kara" },
                ] },
            ]);
            expect(rows[0].versionId).toBe("forever");
            expect(rows[1].versionId).toBe("tbc");
        });
    });

    describe("cancelled raids (Event verwalten, #288)", () => {
        const cancelled = { id: "eh-1", source: "eventhelper", title: "Hyjal", status: "cancelled", cancel: { reason: "Tank fehlt", at: 1700000000000, by: "u1", byName: "Anna", archived: false } };

        it("marks a cancelled own event with its reason and author", () => {
            expect(cancelFields(cancelled)).toEqual({ cancelled: true, cancelReason: "Tank fehlt", cancelledAt: 1700000000000, cancelledByName: "Anna" });
        });

        it("leaves an active own event and a Raid-Helper event unmarked", () => {
            const none = { cancelled: false, cancelReason: "", cancelledAt: 0, cancelledByName: "" };
            expect(cancelFields({ id: "eh-2", source: "eventhelper", status: "active", cancel: null })).toEqual(none);
            expect(cancelFields({ id: "111", source: "raidhelper", status: "cancelled", cancel: cancelled.cancel })).toEqual(none);
            expect(cancelFields(null)).toEqual(none);
        });

        it("rides on the coming rows next to the raid group fields", () => {
            const rows = upcomingRows([{ categoryId: "c1", categoryName: "PUG", events: [
                { ...cancelled, raidGroupId: "eh-1", raidGroupIndex: 1 },
                { id: "eh-3", source: "eventhelper", title: "Kara", status: "active" },
                { id: "222", title: "Kara" },
            ] }]);
            expect(rows[0]).toMatchObject({ id: "eh-1", cancelled: true, cancelReason: "Tank fehlt", cancelledByName: "Anna", raidGroupId: "eh-1" });
            expect(rows[1]).toMatchObject({ cancelled: false, cancelReason: "" });
            expect(rows[2]).toMatchObject({ cancelled: false });
        });

        it("rides on the past rows too (false for a Raid-Helper raid)", async () => {
            const now = Date.UTC(2026, 8, 14, 12);
            listRaidEvents.mockReturnValue([{ id: "p", title: "Kara", startTime: Math.floor(Date.UTC(2026, 8, 9, 18) / 1000) }]);
            const { events } = await loadPastRaids("g1", { now });
            expect(events[0]).toMatchObject({ id: "p", cancelled: false, cancelReason: "" });
        });
    });

    describe("loadPastRaids", () => {
        const now = Date.UTC(2026, 8, 14, 12);
        const at = (d, h) => Math.floor(Date.UTC(2026, 8, d, h) / 1000);

        it("returns nothing without a guild and touches no store", async () => {
            expect(await loadPastRaids("")).toEqual({ events: [], error: null });
            expect(scanRaidEvents).not.toHaveBeenCalled();
        });

        it("scans, links logs and annotates each past raid newest first", async () => {
            listRaidEvents.mockReturnValue([
                { id: "a", title: "SSC + TK", startTime: at(9, 18), channelName: "t5", categoryId: "c5", categoryName: "T5 Farm" },
                { id: "b", title: "Black Temple", startTime: at(13, 17), channelName: "bt", categoryId: "c6", categoryName: "T6 Main" },
                { id: "c", title: "Hyjal", startTime: at(20, 17) }, // still to come
            ]);
            listLogs.mockReturnValue([
                { id: "l1", guildId: "g1", title: "BT Teil 1", eventId: "b", status: "done", reportRefId: "r1", zone: "Black Temple", postedAt: at(13, 18) * 1000 },
                { id: "l2", guildId: "g1", title: "BT Teil 2", postedAt: at(13, 19) * 1000 },
                { id: "l3", title: "fremd", guildId: "other", eventId: "b", postedAt: at(13, 19) * 1000 },
            ]);
            listByEvent.mockImplementation((id) => (id === "b" ? [{ contentId: "bt" }, { contentId: "bt" }] : []));

            const { events, error } = await loadPastRaids("g1", { now });

            expect(scanRaidEvents).toHaveBeenCalledWith("g1");
            expect(autoLinkLogs).toHaveBeenCalledWith("g1");
            expect(error).toBeNull();
            expect(events.map((e) => e.id)).toEqual(["b", "a"]);
            expect(events[0]).toEqual(expect.objectContaining({
                categoryId: "c6", categoryName: "T6 Main", contentIds: ["bt"], lootCount: 2, pendingLogCount: 1,
                logs: [expect.objectContaining({ title: "BT Teil 1", status: "done", reportRefId: "r1", zone: "Black Temple" })],
                pendingLogs: [{ title: "BT Teil 2", alsoFits: [], alsoFitsCategoryIds: [] }],
            }));
            expect(events[1]).toEqual(expect.objectContaining({ contentIds: ["ssc", "tk"], logs: [], lootCount: 0, pendingLogCount: 0 }));
        });

        it("names the other raids an unassigned log would also fit", async () => {
            listRaidEvents.mockReturnValue([
                { id: "x", title: "Kara", startTime: at(13, 17) },
                { id: "y", title: "Gruul", startTime: at(13, 18), categoryId: "c-mi" },
            ]);
            listLogs.mockReturnValue([{ id: "l", guildId: "g1", title: "Abendlog", postedAt: at(13, 19) * 1000 }]);
            const { events } = await loadPastRaids("g1", { now });
            // with their categories, so the route can tell a category's orga only of its own raids (#729)
            expect(events.find((e) => e.id === "x").pendingLogs).toEqual([{ title: "Abendlog", alsoFits: ["Gruul"], alsoFitsCategoryIds: ["c-mi"] }]);
        });

        it("reports the scan error only when nothing is stored yet", async () => {
            scanRaidEvents.mockResolvedValueOnce({ error: "Raid-Helper down" });
            listRaidEvents.mockReturnValue([]);
            expect(await loadPastRaids("g1", { now })).toEqual({ events: [], error: "Raid-Helper down" });
        });
    });
});
