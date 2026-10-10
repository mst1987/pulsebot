// The subscription calendar and game versions (#743): hidden versions are left out, `?version=` narrows.
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example" }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/signupStore", () => ({ signupsOfUser: jest.fn(() => ({})) }));

const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const tokens = require("../../../src/stores/calendarTokenStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { event: baseEvent, signup: baseSignup } = require("../../factories/events");
const { feedFor, collectEntries, clearCache } = require("../../../src/web/pages/calendarFeed");

const NOW = Date.UTC(2026, 8, 20, 12, 0);
const start = Math.floor(NOW / 1000) + 4 * 86400;
const USER = "111111111111111111";
const ev = (id, versionId) => baseEvent({ id, versionId, title: id, startTime: start, durationMinutes: 180, updatedAt: NOW - 1000 });

beforeEach(() => {
    jest.clearAllMocks();
    tokens.useFile(tempStoreFile("calendar-versions-tokens.json"));
    clearCache();
    eventStore.listEvents.mockReturnValue([ev("tbc-raid", "tbc"), ev("forever-raid", "forever")]);
    signupStore.signupsOfUser.mockReturnValue({
        "tbc-raid": baseSignup({ userId: USER, at: NOW - 5000 }),
        "forever-raid": baseSignup({ userId: USER, at: NOW - 5000 }),
    });
});

describe("collectEntries and versions", () => {
    it("lists every version while none is hidden", () => {
        expect(collectEntries(USER, { now: NOW, config: {} }).map((e) => e.event.id).sort()).toEqual(["forever-raid", "tbc-raid"]);
    });

    it("leaves out a hidden version", () => {
        const ids = collectEntries(USER, { now: NOW, config: { hideOtherVersions: true, mainVersion: "tbc" } }).map((e) => e.event.id);
        expect(ids).toEqual(["tbc-raid"]);
    });

    it("narrows to one version with versionId", () => {
        expect(collectEntries(USER, { now: NOW, versionId: "forever", config: {} }).map((e) => e.event.id)).toEqual(["forever-raid"]);
    });
});

describe("feedFor with ?version=", () => {
    it("builds and caches a feed per version", () => {
        const { token } = tokens.createToken(USER);
        const all = feedFor(token, { now: NOW });
        const forever = feedFor(token, { now: NOW, version: "forever" });
        expect(all.body).toContain("tbc-raid");
        expect(forever.body).toContain("forever-raid");
        expect(forever.body).not.toContain("tbc-raid");
        expect(feedFor(token, { now: NOW, version: "forever" }).cached).toBe(true);
        expect(feedFor(token, { now: NOW }).cached).toBe(true);
    });

    it("ignores an unknown version like none", () => {
        const { token } = tokens.createToken(USER);
        expect(feedFor(token, { now: NOW, version: "nope" }).body).toContain("tbc-raid");
    });
});
