// The adapter: both sources in one shape. Stores mocked; the adapter is real.
jest.mock("../../src/web/eventStore", () => ({
    listEvents: jest.fn(() => []),
    getEvent: jest.fn(() => null),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/web/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../src/web/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const eventStore = require("../../src/web/eventStore");
const { listSignups } = require("../../src/web/signupStore");
const { listRaidEvents, getRaidEvent } = require("../../src/web/raidEventStore");
const { getConfig } = require("../../src/web/settingsStore");
const sources = require("../../src/web/eventSources");
const { specProfile } = require("../../src/utils/setupView");
const { signupStatus } = require("../../src/utils/attendance");
const { buildClasses, CLASSES } = require("../../src/config/gameVersions/classes");

const ownEvent = (over = {}) => ({
    id: "eh-1", source: "eventhelper", guildId: "g1", categoryId: "cat1", categoryName: "Raids",
    channelId: "c1", channelName: "kara-do", title: "Kara", description: "", leaderId: "u9",
    startTime: 2000000000, versionId: "tbc", instanceIds: ["kara"], size: 10,
    composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, signupDeadline: 0, ...over,
});

describe("web/eventSources", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        listSignups.mockReturnValue([]);
        eventStore.listEvents.mockReturnValue([]);
    });

    it("maps every rule-set spec onto a Raid-Helper spec name the readers resolve", () => {
        for (const cls of buildClasses(CLASSES)) {
            for (const spec of cls.specs) {
                const name = sources.specNameFor(spec.key);
                expect(name).toBeTruthy();
                const profile = specProfile(name);
                expect(profile).not.toBeNull();
                expect(profile.className).toBe(spec.classId);
            }
        }
        expect(sources.specNameFor("Nope-Nope")).toBe("");
    });

    it("hands out an own signup in the shape of a normalised Raid-Helper signup", () => {
        const signed = sources.toSignUpShape({ userId: "u1", spec: "Paladin-Protection", role: "tank", status: "signed", character: "Tanky" });
        expect(signed).toMatchObject({ userId: "u1", specName: "Protection1", className: "Paladin", status: "signed", character: "Tanky" });
        expect(signupStatus(signed)).toBe("signed");
        const off = sources.toSignUpShape({ userId: "u2", status: "absence" });
        expect(off).toMatchObject({ specName: "Absence", className: "Absence", status: "absence" });
        expect(signupStatus(off)).toBe("absence");
        const bench = sources.toSignUpShape({ userId: "u3", spec: "Mage-Fire", status: "bench" });
        expect(signupStatus(bench)).toBe("bench");
        // several characters (#293): the Raid-Helper shape is the first choice, the list rides along
        const multi = sources.toSignUpShape({
            userId: "u4", status: "signed", character: "Zibbo", spec: "Priest-Holy", role: "healer",
            characters: [{ character: "Zibbo", spec: "Priest-Holy", role: "healer" }, { character: "Zibbowar", spec: "Warrior-Protection", role: "tank" }],
        });
        expect(multi).toMatchObject({ specName: "HolyPriest", className: "Priest", character: "Zibbo", role: "healer" });
        expect(multi.characters.map((c) => c.character)).toEqual(["Zibbo", "Zibbowar"]);
    });

    it("gives an own event the same group-row keys a Raid-Helper row has, plus its plan", () => {
        listSignups.mockReturnValue([
            { userId: "u1", spec: "Mage-Fire", role: "ranged", status: "signed" },
            { userId: "u2", status: "absence" },
        ]);
        eventStore.listEvents.mockReturnValue([ownEvent()]);
        const catMap = { c1: { name: "kara-live", categoryId: "cat1", categoryName: "Raids live" } };
        const [{ categoryId, categoryName, row }] = sources.ownEventGroupRows("g1", { catMap });
        const rhKeys = ["id", "source", "title", "startTime", "leaderId", "channelId", "channelName", "categoryId",
            "templateId", "description", "signupCount", "signUps", "signUpsFromSnapshot"];
        for (const key of rhKeys) expect(row).toHaveProperty(key);
        expect(row).toMatchObject({
            id: "eh-1", source: "eventhelper", channelName: "kara-live", signupCount: 1, signUpsFromSnapshot: false,
            size: 10, instanceIds: ["kara"],
        });
        expect(categoryId).toBe("cat1");
        expect(categoryName).toBe("Raids live");
    });

    it("asks the store for upcoming events by default and for the lookback when given", () => {
        sources.ownEventGroupRows("g1", { now: 1000 * 1000 });
        expect(eventStore.listEvents).toHaveBeenCalledWith("g1", { sinceSeconds: 1000 });
        sources.ownEventGroupRows("g1", { sinceSeconds: 5 });
        expect(eventStore.listEvents).toHaveBeenLastCalledWith("g1", { sinceSeconds: 5 });
        expect(sources.ownEventGroupRows("")).toEqual([]);
    });

    it("merges stored events of both sources, newest first, own ones only once started", () => {
        listRaidEvents.mockReturnValue([{ id: "111", guildId: "g1", startTime: 1500, signUps: [], categoryId: "cat1" }]);
        eventStore.listEvents.mockReturnValue([ownEvent({ startTime: 1800 })]);
        const stored = sources.listStoredEvents("g1", { now: 2000 * 1000 });
        expect(eventStore.listEvents).toHaveBeenCalledWith("g1", { untilSeconds: 2000 });
        expect(stored.map((e) => [e.id, e.source])).toEqual([["eh-1", "eventhelper"], ["111", "raidhelper"]]);
        expect(stored[0]).toMatchObject({ categoryId: "cat1", categoryName: "Raids", channelName: "kara-do", setup: [] });
    });

    it("resolves a stored event by id from the right source", () => {
        getRaidEvent.mockReturnValue({ id: "111", title: "RH" });
        expect(sources.getStoredEvent("111")).toMatchObject({ id: "111", source: "raidhelper" });
        eventStore.getEvent.mockReturnValue(ownEvent());
        expect(sources.getStoredEvent("eh-1")).toMatchObject({ id: "eh-1", source: "eventhelper" });
        expect(sources.sourceOfEventId("eh-1")).toBe("eventhelper");
        expect(sources.sourceOfEventId("111")).toBe("raidhelper");
    });

    it("reads the default source per category, Raid-Helper unless switched", () => {
        getConfig.mockReturnValue({ categorySignupSource: { cat1: "eventhelper", cat2: "bogus" } });
        expect(sources.signupSourceFor("cat1")).toBe("eventhelper");
        expect(sources.signupSourceFor("cat2")).toBe("raidhelper");
        expect(sources.signupSourceFor("cat3")).toBe("raidhelper");
    });

    it("lists own raids for matching and upcoming ones in Raid-Helper's raw shape", () => {
        eventStore.listEvents.mockReturnValue([ownEvent()]);
        expect(sources.ownMatchableEvents("g1", 100, { now: 3000000000 * 1000 })).toEqual([{
            id: "eh-1", source: "eventhelper", title: "Kara", startTime: 2000000000, channelId: "c1",
            channelName: "kara-do", categoryId: "cat1", categoryName: "Raids",
        }]);
        expect(eventStore.listEvents).toHaveBeenCalledWith("g1", { sinceSeconds: 100, untilSeconds: 3000000000 });
        const raw = sources.ownUpcomingRaw("g1", { categoryId: "cat1" });
        expect(raw[0]).toMatchObject({ id: "eh-1", source: "eventhelper", channelId: "c1", leaderId: "u9", signUps: [] });
        expect(sources.ownUpcomingRaw("g1", { categoryId: "other" })).toEqual([]);
    });
});
