// The adapter: both sources in one shape. Stores mocked; the adapter is real.
jest.mock("../../src/stores/eventStore", () => ({
    listEvents: jest.fn(() => []),
    getEvent: jest.fn(() => null),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn(() => null) }));
jest.mock("../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const eventStore = require("../../src/stores/eventStore");
const { listSignups } = require("../../src/stores/signupStore");
const { listRaidEvents, getRaidEvent } = require("../../src/stores/raidEventStore");
const { getConfig } = require("../../src/stores/settingsStore");
const sources = require("../../src/web/eventSources");
const { specProfile } = require("../../src/utils/setup/setupView");
const { signupStatus } = require("../../src/utils/attendance");
const { buildClasses, CLASSES } = require("../../src/config/gameVersions/classes");

const { ownEvent: baseOwnEvent } = require("../factories/events");

const ownEvent = (over = {}) => baseOwnEvent({
    id: "eh-1", guildId: "g1", categoryId: "cat1", categoryName: "Raids",
    channelId: "c1", channelName: "kara-do", title: "Kara", description: "", leaderId: "u9",
    startTime: 2000000000, instanceIds: ["kara"], signupDeadline: 0, ...over,
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

    it("reads the source per category, else the configured default (#291)", () => {
        getConfig.mockReturnValue({ categorySignupSource: { cat1: "eventhelper", cat2: "bogus", cat4: "raidhelper" }, signupSourceDefault: "eventhelper" });
        expect(sources.signupSourceFor("cat1")).toBe("eventhelper");
        expect(sources.signupSourceFor("cat2")).toBe("eventhelper");
        expect(sources.signupSourceFor("cat3")).toBe("eventhelper");
        expect(sources.signupSourceFor("cat4")).toBe("raidhelper");
        // an older config without a default keeps Raid-Helper
        getConfig.mockReturnValue({ categorySignupSource: {} });
        expect(sources.signupSourceFor("cat3")).toBe("raidhelper");
        expect(sources.defaultSignupSource({ signupSourceDefault: "eventhelper" })).toBe("eventhelper");
    });

    describe("specKeyFromRaidHelper (#291)", () => {
        it("reads every Raid-Helper spec name back to its rule-set key, with and without the class", () => {
            for (const cls of buildClasses(CLASSES)) {
                for (const spec of cls.specs) {
                    const name = sources.specNameFor(spec.key);
                    expect(sources.specKeyFromRaidHelper("", name)).toBe(spec.key);
                    expect(sources.specKeyFromRaidHelper(spec.key.split("-")[0], name)).toBe(spec.key);
                }
            }
        });

        it("resolves classlist aliases and lets a real class decide an ambiguous name", () => {
            expect(sources.specKeyFromRaidHelper("Warlock", "Destro")).toBe("Warlock-Destruction");
            expect(sources.specKeyFromRaidHelper("Shaman", "RestoSham")).toBe("Shaman-Restoration");
            expect(sources.specKeyFromRaidHelper("Tank", "ProtPala")).toBe("Paladin-Protection");
            expect(sources.specKeyFromRaidHelper("Tank", "Protection")).toBe("Warrior-Protection");
            expect(sources.specKeyFromRaidHelper("Paladin", "Holy")).toBe("Paladin-Holy");
            expect(sources.specKeyFromRaidHelper("Priest", "Holy")).toBe("Priest-Holy");
            expect(sources.specKeyFromRaidHelper("Shaman", "Restoration")).toBe("Shaman-Restoration");
        });

        it("names no spec for sign-offs, unknown names and a class that does not fit", () => {
            expect(sources.specKeyFromRaidHelper("Absence", "Absence")).toBe("");
            expect(sources.specKeyFromRaidHelper("Bench", "Bench")).toBe("");
            expect(sources.specKeyFromRaidHelper("DK", "Unholy_DPS")).toBe("");
            expect(sources.specKeyFromRaidHelper("Mage", "Shadow")).toBe("");
            expect(sources.specKeyFromRaidHelper("", "")).toBe("");
        });
    });

    it("finds the own event of a channel: the next one first, cancelled ones last", () => {
        const now = 2000000000 * 1000;
        eventStore.listEvents.mockReturnValue([
            ownEvent({ id: "eh-3", startTime: 2000900000 }),
            ownEvent({ id: "eh-2", startTime: 2000500000 }),
            ownEvent({ id: "eh-1", startTime: 1999000000 }),
            ownEvent({ id: "eh-x", channelId: "other", startTime: 2000100000 }),
        ]);
        expect(sources.ownEventInChannel("c1", { now }).id).toBe("eh-2");
        eventStore.listEvents.mockReturnValue([ownEvent({ id: "eh-1", startTime: 1999000000 })]);
        expect(sources.ownEventInChannel("c1", { now }).id).toBe("eh-1");
        eventStore.listEvents.mockReturnValue([
            ownEvent({ id: "eh-c", startTime: 2000500000, status: "cancelled" }),
            ownEvent({ id: "eh-old", startTime: 1999000000 }),
        ]);
        expect(sources.ownEventInChannel("c1", { now }).id).toBe("eh-old");
        expect(sources.ownEventInChannel("nope", { now })).toBeNull();
        expect(sources.ownEventInChannel("", { now })).toBeNull();
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
