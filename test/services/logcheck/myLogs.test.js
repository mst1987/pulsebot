// "Nur meine Raids": the stores are stand-ins, the name matching
// (nameKey, charactersOfVersion) and the raid group readers are the real ones.
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({
    ...jest.requireActual("../../../src/stores/roster/raiderProfileStore"),
    getProfile: jest.fn(() => null),
}));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({
    charactersForUser: jest.fn(() => []),
}));
jest.mock("../../../src/stores/events/eventStore", () => ({
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    getEvent: jest.fn(() => null),
    listEvents: jest.fn(() => []),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({
    getSignup: jest.fn(() => null),
}));
jest.mock("../../../src/stores/events/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
}));
jest.mock("../../../src/services/events/eventServer", () => ({
    guildOfCategory: jest.fn(() => ""),
}));

const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../../src/stores/roster/raiderCharactersStore");
const eventStore = require("../../../src/stores/events/eventStore");
const { getSignup } = require("../../../src/stores/events/signupStore");
const { getRaidEvent } = require("../../../src/stores/events/raidEventStore");
const { guildOfCategory } = require("../../../src/services/events/eventServer");
const { mineFilter, attendedEvent } = require("../../../src/services/logcheck/myLogs");

const approvedSetup = (placed, bench = []) => ({
    status: "approved",
    approved: { groups: [{ slots: placed.map((userId) => ({ userId })) }], bench: bench.map((userId) => ({ userId })) },
});
const draftSetup = (placed) => ({ status: "draft", groups: [{ slots: placed.map((userId) => ({ userId })) }] });

// the report metadata as reportStore.listReports() carries it
const META = new Map([
    ["aaa111", { id: "aaa111", nameKeys: ["devi", "grom"] }],
    ["bbb222", { id: "bbb222", nameKeys: ["altchar"] }],
    ["ccc333", { id: "ccc333", nameKeys: ["fremder"] }],
]);
// c1 plays TBC on guild-1, c2 Forever on guild-1, c3 TBC on guild-2
const CONFIG = { mainVersion: "tbc", categoryVersion: { c1: "tbc", c2: "forever", c3: "tbc" } };
const GUILDS = { c1: "guild-1", c2: "guild-1", c3: "guild-2" };
const opts = (extra = {}) => ({ reportById: META, config: CONFIG, ...extra });
const row = (reportId, versionId = "tbc") => ({ id: `log-${reportId}`, versionId, report: reportId ? { id: reportId } : null });

const TEN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

describe("services/logcheck/myLogs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        profiles.getProfile.mockReturnValue(null);
        charactersForUser.mockReturnValue([]);
        eventStore.getEvent.mockReturnValue(null);
        eventStore.listEvents.mockReturnValue([]);
        getSignup.mockReturnValue(null);
        getRaidEvent.mockReturnValue(null);
        guildOfCategory.mockImplementation((id) => GUILDS[id] || "");
    });

    describe("attendedEvent", () => {
        it("own event with an approved setup: placed in a group counts, the bench does not", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: approvedSetup(["u1"], ["u2"]) });
            getSignup.mockReturnValue({ userId: "u2", status: "signed" });
            expect(attendedEvent("eh-1", "u1")).toBe(true);
            expect(attendedEvent("eh-1", "u2")).toBe(false);
        });

        it("own event with an approved setup: a placed tentative counts", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: approvedSetup(["u1"]) });
            getSignup.mockReturnValue({ userId: "u1", status: "tentative" });
            expect(attendedEvent("eh-1", "u1")).toBe(true);
        });

        it.each([
            ["signed", true], ["late", true], ["tentative", false], ["bench", false], ["absence", false],
        ])("own event without an approved setup: status %s -> %s", (status, expected) => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: draftSetup(["u1"]) });
            getSignup.mockReturnValue({ userId: "u1", status });
            expect(attendedEvent("eh-1", "u1")).toBe(expected);
        });

        it("a further raid of a raid group reads the signup of its first raid", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-2", raidGroupId: "eh-1" });
            getSignup.mockImplementation((eventId) => (eventId === "eh-1" ? { userId: "u1", status: "signed" } : null));
            expect(attendedEvent("eh-2", "u1")).toBe(true);
            expect(getSignup).toHaveBeenCalledWith("eh-1", "u1");
        });

        describe("raid group: each raid has its own setup and approval", () => {
            // ZA 1 is the primary (the signup sits there), ZA 2 a further raid
            const group = (setup1, setup2) => {
                const za1 = { id: "eh-1", guildId: "guild-1", raidGroupId: "eh-1", raidGroupIndex: 1, setup: setup1 };
                const za2 = { id: "eh-2", guildId: "guild-1", raidGroupId: "eh-1", raidGroupIndex: 2, setup: setup2 };
                const byId = { "eh-1": za1, "eh-2": za2 };
                eventStore.getEvent.mockImplementation((id) => byId[id] || null);
                eventStore.listEvents.mockReturnValue([za1, za2]);
                getSignup.mockImplementation((eventId, uid) => (eventId === "eh-1" ? { userId: uid, status: "signed" } : null));
            };

            it("ZA 1 approved with A-J, ZA 2 a draft: ZA 2 is not A's, but K's who stands in no raid", () => {
                group(approvedSetup(TEN), draftSetup(["K"]));
                expect(attendedEvent("eh-2", "A")).toBe(false);
                expect(attendedEvent("eh-2", "K")).toBe(true);
                // ZA 1 itself still reads its approval
                expect(attendedEvent("eh-1", "A")).toBe(true);
                expect(attendedEvent("eh-1", "K")).toBe(false);
            });

            it("the other way round: ZA 2 approved with A-J, ZA 1 a draft", () => {
                group(draftSetup(["K"]), approvedSetup(TEN));
                expect(attendedEvent("eh-1", "A")).toBe(false);
                expect(attendedEvent("eh-1", "K")).toBe(true);
                expect(attendedEvent("eh-2", "A")).toBe(true);
                expect(attendedEvent("eh-2", "K")).toBe(false);
            });

            it("another raid's draft does not take anybody out", () => {
                group(draftSetup(["A"]), draftSetup(["K"]));
                expect(attendedEvent("eh-2", "A")).toBe(true);
            });
        });

        it.each([
            ["signed", true], ["late", true], ["tentative", false], ["bench", false], ["absence", false],
        ])("Raid-Helper event: snapshot status %s -> %s", (status, expected) => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u2", status: "signed" }, { userId: "u1", status }] });
            expect(attendedEvent("123", "u1")).toBe(expected);
        });

        it("is false without a signup, an unknown event or no ids", () => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u2", status: "signed" }] });
            expect(attendedEvent("123", "u1")).toBe(false);
            expect(attendedEvent("eh-9", "u1")).toBe(false);
            expect(attendedEvent("", "u1")).toBe(false);
            expect(attendedEvent("123", "")).toBe(false);
        });
    });

    describe("mineFilter", () => {
        it("matches a row whose report lists a profile character of the row's version", () => {
            profiles.getProfile.mockReturnValue({ characters: [{ key: "grom", name: "Grom", versionId: "tbc" }] });
            const mine = mineFilter("u1", opts());
            expect(mine(row("aaa111"))).toBe(true);
            expect(mine(row("ccc333"))).toBe(false);
        });

        it("ignores a profile character of another version", () => {
            profiles.getProfile.mockReturnValue({ characters: [{ key: "forever~devi", name: "Devi", versionId: "forever" }] });
            const mine = mineFilter("u1", opts());
            expect(mine(row("aaa111", "tbc"))).toBe(false);
            expect(mine(row("aaa111", "forever"))).toBe(true);
        });

        it("counts the characters the categories assign to the account, case-insensitive", () => {
            charactersForUser.mockReturnValue([{ character: "ALTCHAR", categoryIds: ["c1"] }]);
            expect(mineFilter("u1", opts())(row("bbb222"))).toBe(true);
        });

        it("counts an assigned character only through a category of the row's version", () => {
            charactersForUser.mockReturnValue([{ character: "Altchar", categoryIds: ["c2"] }]);
            const mine = mineFilter("u1", opts());
            expect(mine(row("bbb222", "tbc"))).toBe(false);
            expect(mine(row("bbb222", "forever"))).toBe(true);
        });

        it("with an active server, counts an assigned character only through a category of that server", () => {
            charactersForUser.mockReturnValue([{ character: "Altchar", categoryIds: ["c3", "c9"] }]);
            expect(mineFilter("u1", opts({ guildId: "guild-1" }))(row("bbb222"))).toBe(false);
            expect(mineFilter("u1", opts({ guildId: "guild-2" }))(row("bbb222"))).toBe(true);
            // c9's server is unknown: it counts on no server
            charactersForUser.mockReturnValue([{ character: "Altchar", categoryIds: ["c9"] }]);
            expect(mineFilter("u1", opts({ guildId: "guild-1" }))(row("bbb222"))).toBe(false);
        });

        it("never matches a row without a report (a log that was not evaluated)", () => {
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            expect(mineFilter("u1", opts())(row(null))).toBe(false);
        });

        it("never matches a report the metadata does not know or that lists nobody", () => {
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            const mine = mineFilter("u1", opts({ reportById: new Map([["ddd444", { id: "ddd444" }]]) }));
            expect(mine(row("aaa111"))).toBe(false);
            expect(mine(row("ddd444"))).toBe(false);
            expect(mineFilter("u1")(row("aaa111"))).toBe(false);
        });

        it("matches nothing for an account without characters or without an id", () => {
            expect(mineFilter("u1", opts())(row("aaa111"))).toBe(false);
            expect(mineFilter("", opts())(row("aaa111"))).toBe(false);
            expect(profiles.getProfile).not.toHaveBeenCalledWith("");
        });

        it("matches a row through its raid event without characters or a report", () => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u1", status: "late" }] });
            const mine = mineFilter("u1", opts());
            expect(mine({ ...row(null), eventId: "123" })).toBe(true);
            expect(mine({ ...row(null), eventId: "" })).toBe(false);
        });

        it("matches a row through the report even when the raid event says no", () => {
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u1", status: "absence" }] });
            expect(mineFilter("u1", opts())({ ...row("aaa111"), eventId: "123" })).toBe(true);
            expect(mineFilter("u1", opts())({ ...row("ccc333"), eventId: "123" })).toBe(false);
        });

        it("asks the raid event first and leaves the names alone when it says yes", () => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u1", status: "signed" }] });
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            expect(mineFilter("u1", opts())({ ...row("aaa111"), eventId: "123" })).toBe(true);
            expect(guildOfCategory).not.toHaveBeenCalled();
        });

        it("reads each raid event once per filter", () => {
            const mine = mineFilter("u1", opts());
            mine({ ...row(null), eventId: "123" });
            mine({ ...row(null), eventId: "123" });
            expect(getRaidEvent).toHaveBeenCalledTimes(1);
        });

        it("asks for each category's server once per filter", () => {
            charactersForUser.mockReturnValue([{ character: "Fremder", categoryIds: ["c1"] }]);
            const mine = mineFilter("u1", opts({ guildId: "guild-1" }));
            mine(row("ccc333"));
            mine(row("aaa111"));
            expect(guildOfCategory).toHaveBeenCalledTimes(1);
        });
    });
});
