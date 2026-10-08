// The orga's overview of absences (src/services/signups/absenceOverview.js):
// periods as bars, single sign-offs as dots, the raids with who is away and the
// gap in tanks and healers, the four figures of the head, the hints and one
// raider's detail.
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    listEvents: (_guildId, { sinceSeconds = 0 } = {}) => [...mockEvents.values()].filter((e) => e.startTime >= sinceSeconds),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => ({
    getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
    listSignups: (eventId) => [...mockSignups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v),
}));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const store = require("../../../src/stores/availabilityStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const overview = require("../../../src/services/signups/absenceOverview");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");

// Thursday 2030-03-21, 12:00 server time (CET): this week's Monday is 2030-03-18
const NOW = Date.UTC(2030, 2, 21, 11, 0);
const at = (iso, hour = 20) => Math.floor(Date.parse(`${iso}T${String(hour - 1).padStart(2, "0")}:00:00Z`) / 1000);
const raid = (id, day, over = {}) => ownEvent({ id, title: id, startTime: at(day), categoryId: "mon", composition: { tank: 2, healer: 5 }, size: 25, ...over });
const signup = (eventId, userId, status, spec = "Druid-Restoration", character = userId) => {
    const role = profiles.specInfo(spec).role;
    mockSignups.set(`${eventId}/${userId}`, { userId, status, character, spec, role, characters: [{ character, spec }] });
};
const entry = (userId, from, to, over = {}) => store.addEntry({ userId, kind: "absence", from, to, comment: "Urlaub", createdBy: userId, ...over }, { now: NOW }).entry;

beforeAll(() => {
    store.useFile(tempStoreFile("eh-absence-overview.json"));
    profiles.useFile(tempStoreFile("eh-absence-overview-profiles.json"));
});
afterAll(() => {
    store.useFile(null);
    profiles.useFile(null);
});
beforeEach(() => {
    for (const e of store.listEntries()) store.removeEntry(e.id);
    profiles.reset();
    mockEvents.clear();
    mockSignups.clear();
    mockConfig = { categoryIds: ["mon", "wed"] };
});

describe("buildOverview", () => {
    it("starts this Monday, draws periods as bars and lists the longest first, away today on top", () => {
        entry("long", "2030-03-25", "2030-04-20");
        entry("short", "2030-03-26", "2030-03-28");
        entry("today", "2030-03-20", "2030-03-22", { comment: "krank" });
        const view = overview.buildOverview({ now: NOW, weeks: 8, withReasons: true });
        expect(view).toMatchObject({ from: "2030-03-18", to: "2030-05-12", today: "2030-03-21", weeks: 8 });
        expect(view.raiders.map((r) => r.userId)).toEqual(["today", "long", "short"]);
        const long = view.raiders.find((r) => r.userId === "long");
        expect(long).toMatchObject({ longest: 27, long: true, awayToday: false });
        expect(long.periods[0]).toMatchObject({ from: "2030-03-25", to: "2030-04-20", days: 27, comment: "Urlaub", state: "planned" });
        expect(view.raiders[0].periods[0].state).toBe("running");
        expect(view.tiles.today).toEqual(["today"]);
        expect(view.tiles.nextWeek.sort()).toEqual(["long", "short"]);
        expect(view.tiles.long).toEqual(["long"]);
    });

    it("keeps the reasons for the raid lead only", () => {
        entry("a", "2030-03-25", "2030-03-27");
        expect(overview.buildOverview({ now: NOW, withReasons: false }).raiders[0].periods[0].comment).toBe("");
    });

    it("shows a single raid signed off from as a dot, and a period's sign-off as part of the bar", () => {
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25"));
        signup("eh-1", "single", "absence");
        signup("eh-1", "covered", "absence");
        entry("covered", "2030-03-24", "2030-03-30");
        const view = overview.buildOverview({ now: NOW });
        expect(view.raiders.find((r) => r.userId === "single").singles).toEqual([{ eventId: "eh-1", day: "2030-03-25", title: "eh-1" }]);
        expect(view.raiders.find((r) => r.userId === "covered").singles).toEqual([]);
        expect(view.raids[0].absent.map((a) => [a.userId, a.how])).toEqual([["single", "single"], ["covered", "period"]]);
    });

    it("counts who is away from a raid — also a raider a period covers who has no signup there — and the gap in tanks and healers", () => {
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25"));
        signup("eh-1", "t1", "signed", "Warrior-Protection");
        signup("eh-1", "h1", "signed", "Priest-Holy");
        signup("eh-1", "h2", "absence", "Druid-Restoration");
        // signed up for another raid with a healer, away from this one without a signup
        mockEvents.set("eh-0", raid("eh-0", "2030-03-19"));
        signup("eh-0", "h3", "signed", "Paladin-Holy");
        entry("h3", "2030-03-24", "2030-03-26");
        const r = overview.buildOverview({ now: NOW }).raids.find((x) => x.id === "eh-1");
        expect(r).toMatchObject({ signed: 2, away: 2, size: 25 });
        expect(r.roles).toEqual({ tank: { need: 2, have: 1, away: 0 }, healer: { need: 5, have: 1, away: 2 } });
        expect(r.absent.find((a) => a.userId === "h3")).toMatchObject({ how: "period", until: "2030-03-26" });
    });

    it("leaves out cancelled raids, inactive categories and, filtered, the other categories", () => {
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25"));
        mockEvents.set("eh-2", raid("eh-2", "2030-03-26", { categoryId: "other" }));
        mockEvents.set("eh-3", raid("eh-3", "2030-03-27", { status: "cancelled" }));
        mockEvents.set("eh-4", raid("eh-4", "2030-03-27", { categoryId: "wed" }));
        expect(overview.buildOverview({ now: NOW }).raids.map((r) => r.id)).toEqual(["eh-1", "eh-4"]);
        expect(overview.buildOverview({ now: NOW, categoryId: "wed" }).raids.map((r) => r.id)).toEqual(["eh-4"]);
        // an entry of another category drops out of the filtered view, one for every category stays
        entry("x", "2030-03-25", "2030-03-26", { categoryId: "mon" });
        entry("y", "2030-03-25", "2030-03-26");
        expect(overview.buildOverview({ now: NOW, categoryId: "wed" }).raiders.map((r) => r.userId)).toEqual(["y"]);
    });

    it("shows several picked categories at once and keeps offering every category of the weeks", () => {
        mockConfig = { categoryIds: ["mon", "wed", "fri"] };
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25", { categoryName: "Montag" }));
        mockEvents.set("eh-2", raid("eh-2", "2030-03-27", { categoryId: "wed", categoryName: "Mittwoch" }));
        mockEvents.set("eh-3", raid("eh-3", "2030-03-29", { categoryId: "fri", categoryName: "Freitag" }));
        for (const [i, day] of ["2030-02-22", "2030-03-01", "2030-03-08", "2030-03-15"].entries()) {
            mockEvents.set(`eh-f${i}`, raid(`eh-f${i}`, day, { categoryId: "fri" }));
            signup(`eh-f${i}`, "often", "absence");
        }
        entry("onlyFri", "2030-03-29", "2030-03-29", { categoryId: "fri" });
        const view = overview.buildOverview({ now: NOW, categoryId: "mon,wed" });
        expect(view.raids.map((r) => r.id)).toEqual(["eh-1", "eh-2"]);
        expect(view.categories.map((c) => c.id)).toEqual(["mon", "wed", "fri"]);
        expect(view.picked).toEqual(["mon", "wed"]);
        expect(view.raiders.map((r) => r.userId)).toEqual([]);
        expect(view.hints).toEqual([]);
        // a list works as well, and nothing picked is all of them
        expect(overview.buildOverview({ now: NOW, categoryId: ["fri"] }).hints.map((h) => h.userId)).toEqual(["often"]);
        expect(overview.buildOverview({ now: NOW }).raids.map((r) => r.id)).toEqual(["eh-1", "eh-2", "eh-3"]);
    });

    it("leaves out a category switched off for the overview: its raids, its entries and its hints", () => {
        mockConfig = { categoryIds: ["mon", "wed"], categoryAttendance: { wed: { absences: false } } };
        for (const [i, day] of ["2030-02-27", "2030-03-06", "2030-03-13", "2030-03-20"].entries()) {
            mockEvents.set(`eh-w${i}`, raid(`eh-w${i}`, day, { categoryId: "wed" }));
            signup(`eh-w${i}`, "often", "absence");
        }
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25"));
        mockEvents.set("eh-2", raid("eh-2", "2030-03-27", { categoryId: "wed" }));
        entry("x", "2030-03-25", "2030-03-26", { categoryId: "wed" });
        entry("y", "2030-03-25", "2030-03-26");
        const view = overview.buildOverview({ now: NOW });
        expect(view.raids.map((r) => r.id)).toEqual(["eh-1"]);
        expect(view.categories.map((c) => c.id)).toEqual(["mon"]);
        expect(view.raiders.map((r) => r.userId)).toEqual(["y"]);
        expect(view.hints).toEqual([]);
        expect(overview.raiderDetail("often", { now: NOW }).history).toEqual([]);
    });

    it("names a category after its Discord category, else after the name its raids were created with", () => {
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25", { categoryName: "Montag alt" }));
        mockEvents.set("eh-2", raid("eh-2", "2030-03-27", { categoryId: "wed", categoryName: "Mittwoch alt" }));
        const view = overview.buildOverview({ now: NOW, categoryNames: { mon: "TBC Montag" } });
        expect(view.categories).toEqual([{ id: "mon", name: "TBC Montag" }, { id: "wed", name: "Mittwoch alt" }]);
        expect(view.raids.map((r) => r.categoryName)).toEqual(["TBC Montag", "Mittwoch alt"]);
    });

    it("names the coming raid with the most away, with its healers", () => {
        mockEvents.set("eh-1", raid("eh-1", "2030-03-25"));
        mockEvents.set("eh-2", raid("eh-2", "2030-03-27", { categoryId: "wed" }));
        signup("eh-1", "a", "absence");
        signup("eh-2", "b", "absence");
        signup("eh-2", "c", "absence", "Mage-Arcane");
        expect(overview.buildOverview({ now: NOW }).tiles.biggest).toMatchObject({ raidId: "eh-2", away: 2, healers: 1 });
    });

    it("gives a hint for 3 of the last 4 raids of a category signed off one by one — never for ones a period covers", () => {
        for (const [i, day] of ["2030-02-25", "2030-03-04", "2030-03-11", "2030-03-18"].entries()) mockEvents.set(`eh-p${i}`, raid(`eh-p${i}`, day));
        for (const i of [0, 1, 3]) signup(`eh-p${i}`, "often", "absence", "Paladin-Protection");
        signup("eh-p2", "often", "signed", "Paladin-Protection");
        for (const i of [0, 1, 2]) signup(`eh-p${i}`, "holiday", "absence");
        entry("holiday", "2030-02-24", "2030-03-12");
        const view = overview.buildOverview({ now: NOW, categoryNames: { mon: "TBC Montag" } });
        expect(view.hints).toEqual([expect.objectContaining({ userId: "often", categoryName: "TBC Montag", count: 3, of: 4, days: ["2030-02-25", "2030-03-04", "2030-03-18"] })]);
        // named after the character of their sign-offs, without the signup itself
        expect(view.hints[0]).toMatchObject({ character: "often", spec: "Paladin-Protection", role: "tank", classId: "Paladin" });
        expect(view.hints[0]).not.toHaveProperty("signup");
    });
});

describe("raiderDetail", () => {
    it("lists every entry with what it did and the last raids of their categories: in, off, no answer", () => {
        const days = ["2030-02-25", "2030-03-04", "2030-03-11", "2030-03-18"];
        days.forEach((day, i) => mockEvents.set(`eh-${i}`, raid(`eh-${i}`, day)));
        mockEvents.set("eh-other", raid("eh-other", "2030-03-13", { categoryId: "wed" }));
        signup("eh-0", "u1", "signed");
        signup("eh-1", "u1", "absence");
        signup("eh-3", "u1", "late");
        const e = entry("u1", "2030-03-25", "2030-04-05");
        store.markApplied(e.id, "eh-x", { ok: true }, { now: NOW });
        const detail = overview.raiderDetail("u1", { now: NOW, withReasons: true });
        expect(detail.entries).toEqual([expect.objectContaining({ from: "2030-03-25", days: 12, done: 1, state: "planned", comment: "Urlaub" })]);
        // eh-other is a category u1 never raided in
        expect(detail.history.map((h) => [h.eventId, h.status])).toEqual([["eh-0", "in"], ["eh-1", "off"], ["eh-2", "none"], ["eh-3", "in"]]);
        expect(detail.counts).toEqual({ in: 2, off: 1, none: 1, other: 0 });
        expect(detail).toMatchObject({ userId: "u1", character: "u1", role: "healer", classId: "Druid", classColor: "#FF7D0A", specIcon: expect.stringMatching(/^[a-z_]+$/) });
    });
});
