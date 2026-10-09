// "Für dich" on the start page: the raider's next raids, attendance, last raids
// with their evaluation, and the profile. The sources (event groups, attendance,
// stores) are mocked; what is tested is what the module makes of them.
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: [], error: null })) }));
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => ["r1"]) }));
jest.mock("../../../src/web/signups/signupView", () => ({ memberEventRows: jest.fn(() => []) }));
jest.mock("../../../src/web/availability/raiderAttendance", () => ({ raiderAttendance: jest.fn(() => ({ categories: [] })) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ getProfile: jest.fn(() => ({ characters: [] })) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ charactersForUser: jest.fn(() => []) }));
jest.mock("../../../src/stores/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../../src/stores/raidplanStore", () => ({ getPlan: jest.fn(() => null) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogsForEvent: jest.fn(() => []) }));
jest.mock("../../../src/stores/reportStore", () => ({ getReportHints: jest.fn(() => null) }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const discord = require("../../../src/services/discord/discord");
const { memberEventRows } = require("../../../src/web/signups/signupView");
const { raiderAttendance } = require("../../../src/web/availability/raiderAttendance");
const profiles = require("../../../src/stores/raiderProfileStore");
const { charactersForUser } = require("../../../src/stores/raiderCharactersStore");
const { getEventSoftres } = require("../../../src/stores/eventSoftresStore");
const { getPlan } = require("../../../src/stores/raidplanStore");
const { listLogsForEvent } = require("../../../src/stores/logStore");
const { getReportHints } = require("../../../src/stores/reportStore");
const { loadPersonal, upcomingRow, reportFor, profileFigures, characterNames } = require("../../../src/web/dashboard/dashboardPersonal");

const user = { id: "u1", name: "Heilbert" };

beforeEach(() => {
    jest.clearAllMocks();
    profiles.getProfile.mockReturnValue({ characters: [] });
    getEventSoftres.mockReturnValue(null);
    getPlan.mockReturnValue(null);
    listLogsForEvent.mockReturnValue([]);
    getReportHints.mockReturnValue(null);
    charactersForUser.mockReturnValue([]);
    memberEventRows.mockReturnValue([]);
    raiderAttendance.mockReturnValue({ categories: [] });
});

describe("upcomingRow", () => {
    it("carries the own signup, setup place, softres list and a published plan's token", () => {
        getEventSoftres.mockReturnValue({ url: "https://softres.it/raid/abc" });
        getPlan.mockReturnValue({ status: "published", publicToken: "tok" });
        const row = upcomingRow({
            id: "eh-1", source: "eventhelper", title: "Black Temple", startTime: 100, categoryName: "Pulse Fresh", instanceIcon: "achievement_boss_illidan",
            mine: { status: "signed", character: "Heilbert", specLabel: "Holy", specIcon: "spell_holy" }, placement: { group: 2, character: "Heilbert" },
            deadline: 90, deadlinePassed: false,
        });
        expect(row).toMatchObject({
            id: "eh-1", status: "signed", character: "Heilbert", spec: "Holy", placement: { group: 2 }, categoryName: "Pulse Fresh",
            icon: "achievement_boss_illidan", deadline: 90, softresUrl: "https://softres.it/raid/abc", planToken: "tok",
        });
    });

    it("leaves the status empty without a signup, and a draft plan without token", () => {
        getPlan.mockReturnValue({ status: "draft", publicToken: "tok" });
        const row = upcomingRow({ id: "rh-1", source: "raidhelper", title: "Hyjal", startTime: 100, mine: null });
        expect(row).toMatchObject({ status: "", placement: null, planToken: "", softresUrl: "", source: "raidhelper" });
        // a Raid-Helper row names the spec as specName
        expect(upcomingRow({ id: "rh-2", title: "x", mine: { status: "tentative", specName: "Holy1" } })).toMatchObject({ status: "tentative", spec: "Holy1" });
    });
});

describe("reportFor", () => {
    it("links the raider's own player page and counts the approved hints of all their characters", () => {
        listLogsForEvent.mockReturnValue([{ reportRefId: "aaa111" }, { reportRefId: "bbb222" }, { reportRefId: "" }]);
        getReportHints.mockImplementation((id) => (id === "bbb222"
            ? { id: "bbb222", generatedAt: 20, players: { heilbert: { name: "Heilbert", idx: 4, approved: 2 }, feuerfritz: { name: "Feuerfritz", idx: 7, approved: 1 } } }
            : { id: "aaa111", generatedAt: 10, players: {} }));
        // the newest evaluation of the night wins
        expect(reportFor("e1", ["heilbert", "feuerfritz"])).toEqual({ url: "/r/bbb222/p/4", hints: 3 });
    });

    it("links the report without a count when none of their characters was in it, and is null without one", () => {
        listLogsForEvent.mockReturnValue([{ reportRefId: "aaa111" }]);
        getReportHints.mockReturnValue({ id: "aaa111", generatedAt: 10, players: { other: { name: "Other", idx: 0, approved: 5 } } });
        expect(reportFor("e1", ["heilbert"])).toEqual({ url: "/r/aaa111", hints: null });
        listLogsForEvent.mockReturnValue([]);
        expect(reportFor("e1", ["heilbert"])).toBeNull();
    });
});

describe("profileFigures and characterNames", () => {
    it("says a profile without characters, or a character without a spec, is missing something", () => {
        expect(profileFigures({ characters: [] })).toEqual({ characters: 0, hints: [{ kind: "noCharacters", character: "" }] });
        expect(profileFigures({ characters: [{ name: "Heilbert", specs: [{ key: "holy" }] }, { name: "Feuerfritz", specs: [] }] }))
            .toEqual({ characters: 2, hints: [{ kind: "noSpec", character: "Feuerfritz" }] });
    });

    it("takes the profile's characters and the category assignments, lower-cased and once", () => {
        charactersForUser.mockReturnValue([{ character: "heilbert" }, { character: "Zauberix" }]);
        expect(characterNames("u1", { characters: [{ name: "Heilbert" }] })).toEqual(["heilbert", "zauberix"]);
    });
});

describe("loadPersonal", () => {
    it("asks the member's roles (not the orga's) and keeps the next four raids of the version", async () => {
        const rows = [1, 2, 3, 4, 5].map((n) => ({ id: `eh-${n}`, title: `Raid ${n}`, startTime: n, versionId: n === 2 ? "forever" : "tbc", mine: null }));
        memberEventRows.mockReturnValue(rows);
        const result = await loadPersonal("g1", user, { orga: false, config: {}, versionId: "tbc" });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "u1");
        expect(memberEventRows.mock.calls[0][1]).toMatchObject({ userId: "u1", guildId: "g1", roleIds: ["r1"], orga: false });
        expect(result.upcoming.map((r) => r.id)).toEqual(["eh-1", "eh-3", "eh-4", "eh-5"]);

        await loadPersonal("g1", user, { orga: true, config: {} });
        expect(discord.memberRoleIds).toHaveBeenCalledTimes(1);
        expect(memberEventRows.mock.calls[1][1]).toMatchObject({ roleIds: null, orga: true });
    });

    it("sums attendance over the counted categories and lists the newest nights with their evaluation", async () => {
        raiderAttendance.mockReturnValue({
            categories: [
                { id: "c1", name: "Pulse Fresh", attended: 3, total: 4, raids: [
                    { eventId: "a", title: "BT", startTime: 300, status: "present", attended: true },
                    { eventId: "b", title: "BT", startTime: 100, status: "noShow", attended: false },
                ] },
                { id: "c2", name: "Pulse Montag", attended: 2, total: 2, raids: [{ eventId: "c", title: "Hyjal", startTime: 200, status: "bench", attended: true }] },
                { id: "c3", name: "Leer", attended: 0, total: 0, raids: [] },
            ],
        });
        listLogsForEvent.mockImplementation((id) => (id === "a" ? [{ reportRefId: "aaa111" }] : []));
        getReportHints.mockReturnValue({ id: "aaa111", generatedAt: 1, players: { heilbert: { name: "Heilbert", idx: 2, approved: 0 } } });
        profiles.getProfile.mockReturnValue({ characters: [{ name: "Heilbert", specs: [{ key: "holy" }] }] });

        const { attendance, recent, profile } = await loadPersonal("g1", user, { orga: true, config: {} });

        expect(attendance).toMatchObject({ attended: 5, total: 6, bench: 1 });
        expect(attendance.last.map((n) => n.eventId)).toEqual(["a", "c", "b"]);
        expect(recent.map((n) => [n.eventId, n.categoryName, n.status])).toEqual([["a", "Pulse Fresh", "present"], ["c", "Pulse Montag", "bench"], ["b", "Pulse Fresh", "noShow"]]);
        expect(recent[0].report).toEqual({ url: "/r/aaa111/p/2", hints: 0 });
        expect(recent[1].report).toBeNull();
        expect(profile).toEqual({ characters: 1, hints: [] });
    });

    it("keeps the page alive when a source fails", async () => {
        loadEventGroups.mockRejectedValueOnce(new Error("Raid-Helper down"));
        raiderAttendance.mockImplementation(() => { throw new Error("broken store"); });
        const errors = jest.spyOn(console, "error").mockImplementation(() => {});
        const result = await loadPersonal("g1", user, { orga: true, config: {} });
        expect(result).toMatchObject({ upcoming: [], upcomingError: "Raid-Helper down", attendance: null, recent: [] });
        errors.mockRestore();
    });

    it("has no raids without a guild", async () => {
        raiderAttendance.mockReturnValue({ categories: [] });
        const result = await loadPersonal("", user, {});
        expect(result.upcoming).toEqual([]);
        expect(loadEventGroups).not.toHaveBeenCalled();
    });
});
