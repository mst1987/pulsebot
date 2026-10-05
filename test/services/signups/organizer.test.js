// Die Daten hinter dem Raider-Organizer (src/services/signups/organizer.js): der nächste
// Raid einer Kategorie, die Zahl der Anmeldungen und die neueste Auswertung eines Raiders.
let mockReports = [];
jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: jest.fn(() => mockReports.map(({ id, title, generatedAt }) => ({ id, title, generatedAt }))),
    getReportRoster: jest.fn((id) => mockReports.find((r) => r.id === id) || null),
}));

const mocks = require("../../helpers/signupMocks");
const reportStore = require("../../../src/stores/reportStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const organizer = require("../../../src/services/signups/organizer");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const NOW_MS = 1900000000 * 1000;
const NOW = NOW_MS / 1000;
const HOUR = 3600;
const addEvent = (id, over = {}) => mocks.events.set(id, mocks.ownEvent({ id, categoryId: "cat1", startTime: NOW + 24 * HOUR, ...over }));
const addSignup = (eventId, userId, status = "signed") => mocks.signups.set(`${eventId}/${userId}`, { userId, status });

beforeAll(() => profiles.useFile(tempStoreFile("eh-organizer-profiles.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    mocks.reset();
    profiles.reset();
    mockReports = [];
    jest.clearAllMocks();
});

describe("nextRaid", () => {
    it("nimmt den frühesten künftigen Raid der Kategorie", () => {
        addEvent("eh-late", { startTime: NOW + 72 * HOUR });
        addEvent("eh-soon", { startTime: NOW + 24 * HOUR });
        addEvent("eh-mid", { startTime: NOW + 48 * HOUR });
        expect(organizer.nextRaid("cat1", { now: NOW_MS }).id).toBe("eh-soon");
    });

    it("überspringt abgesagte, vergangene, begonnene und fremde Raids", () => {
        addEvent("eh-past", { startTime: NOW - HOUR });
        addEvent("eh-now", { startTime: NOW });
        addEvent("eh-cancelled", { startTime: NOW + HOUR, status: "cancelled" });
        addEvent("eh-other", { startTime: NOW + 2 * HOUR, categoryId: "cat2" });
        addEvent("eh-nocat", { startTime: NOW + 3 * HOUR, categoryId: "" });
        addEvent("eh-ok", { startTime: NOW + 10 * HOUR });
        expect(organizer.nextRaid("cat1", { now: NOW_MS }).id).toBe("eh-ok");
        expect(organizer.nextRaid("cat2", { now: NOW_MS }).id).toBe("eh-other");
    });

    it("gibt null ohne passenden Raid oder ohne Kategorie", () => {
        addEvent("eh-other", { categoryId: "cat2" });
        expect(organizer.nextRaid("cat1", { now: NOW_MS })).toBeNull();
        expect(organizer.nextRaid("", { now: NOW_MS })).toBeNull();
        expect(organizer.nextRaid(undefined, { now: NOW_MS })).toBeNull();
    });
});

describe("nextRaidSummary", () => {
    it("nennt Beginn und zählt Konten, die dabei oder spät sind", () => {
        addEvent("eh-a", { startTime: NOW + HOUR });
        addEvent("eh-b", { startTime: NOW + 5 * HOUR });
        addSignup("eh-a", "u1", "signed");
        addSignup("eh-a", "u2", "late");
        addSignup("eh-a", "u3", "tentative");
        addSignup("eh-a", "u4", "bench");
        addSignup("eh-a", "u5", "absence");
        addSignup("eh-b", "u6", "signed");
        expect(organizer.nextRaidSummary("cat1", { now: NOW_MS })).toEqual({ startTime: NOW + HOUR, attending: 2 });
    });

    it("zeigt 0 Anmeldungen und null ohne Raid", () => {
        addEvent("eh-a", { startTime: NOW + HOUR });
        expect(organizer.nextRaidSummary("cat1", { now: NOW_MS })).toEqual({ startTime: NOW + HOUR, attending: 0 });
        expect(organizer.nextRaidSummary("cat9", { now: NOW_MS })).toBeNull();
    });
});

describe("signupOf", () => {
    it("gibt die Anmeldung des Raiders oder null", () => {
        addSignup("eh-a", ANNA, "late");
        expect(organizer.signupOf("eh-a", ANNA)).toMatchObject({ status: "late" });
        expect(organizer.signupOf("eh-a", "other")).toBeNull();
        expect(organizer.signupOf("eh-x", ANNA)).toBeNull();
    });
});

describe("latestReportFor", () => {
    const report = (id, generatedAt, names, title = `Log ${id}`) => ({ id, title, generatedAt, roster: names.map((name) => ({ name })) });
    const withChars = () => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }] });
    };

    it("findet die neueste Auswertung, in der einer der Charaktere steht, mit Platz im Roster", () => {
        withChars();
        mockReports = [
            report("aaaaaa", 3000, ["Tank", "Heiler"]),
            report("bbbbbb", 2000, ["Tank", "Zibbowar", "Zibbo"]),
            report("cccccc", 1000, ["Zibbo"]),
        ];
        expect(organizer.latestReportFor(ANNA)).toEqual({ id: "bbbbbb", title: "Log bbbbbb", generatedAt: 2000, character: "Zibbowar", idx: 1 });
    });

    it("erkennt den Namen unabhängig von Groß-/Kleinschreibung und Server-Zusatz", () => {
        withChars();
        mockReports = [report("aaaaaa", 1000, ["Tank", "ZIBBO-Thunderstrike"])];
        expect(organizer.latestReportFor(ANNA)).toMatchObject({ id: "aaaaaa", character: "ZIBBO-Thunderstrike", idx: 1 });
    });

    // A Forever character's profile key carries the version ("forever~devi res", #543), the log only the name.
    it("findet auch einen Charakter einer anderen Spielversion über seinen Namen", () => {
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", versionId: "forever", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const key = profiles.getProfile(ANNA).characters[0].key;
        expect(key).toMatch(/~/);
        mockReports = [report("aaaaaa", 1000, ["Tank", "Devi Res"])];
        expect(organizer.latestReportFor(ANNA)).toMatchObject({ id: "aaaaaa", character: "Devi Res", idx: 1 });
    });

    it("gibt null ohne Treffer", () => {
        withChars();
        mockReports = [report("aaaaaa", 3000, ["Tank"]), report("bbbbbb", 2000, [])];
        expect(organizer.latestReportFor(ANNA)).toBeNull();
        mockReports = [];
        expect(organizer.latestReportFor(ANNA)).toBeNull();
    });

    it("gibt null und liest keine Auswertung, wenn das Profil keine Charaktere hat", () => {
        mockReports = [report("aaaaaa", 3000, ["Zibbo"])];
        expect(organizer.latestReportFor(ANNA)).toBeNull();
        expect(organizer.latestReportFor("")).toBeNull();
        expect(reportStore.getReportRoster).not.toHaveBeenCalled();
    });

    it("schaut nur in die neuesten maxReports Auswertungen", () => {
        withChars();
        mockReports = [report("aaaaaa", 3000, ["Tank"]), report("bbbbbb", 2000, ["Tank"]), report("cccccc", 1000, ["Zibbo"])];
        expect(organizer.latestReportFor(ANNA, { maxReports: 2 })).toBeNull();
        expect(reportStore.getReportRoster).toHaveBeenCalledTimes(2);
        expect(organizer.latestReportFor(ANNA, { maxReports: 3 })).toMatchObject({ id: "cccccc" });
    });

    it("nimmt Titel und Zeit aus der Auswertung, wenn die Liste sie nicht kennt", () => {
        withChars();
        mockReports = [{ id: "aaaaaa", roster: [{ name: "Zibbo" }], title: "Aus dem Roster", generatedAt: 5 }];
        reportStore.listReports.mockReturnValueOnce([{ id: "aaaaaa" }]);
        expect(organizer.latestReportFor(ANNA)).toMatchObject({ title: "Aus dem Roster", generatedAt: 5 });
    });

    it("überspringt Auswertungen ohne lesbaren Roster", () => {
        withChars();
        mockReports = [{ id: "aaaaaa", generatedAt: 3000 }, report("bbbbbb", 2000, ["Zibbo"])];
        reportStore.getReportRoster.mockImplementationOnce(() => null);
        expect(organizer.latestReportFor(ANNA)).toMatchObject({ id: "bbbbbb" });
    });
});
