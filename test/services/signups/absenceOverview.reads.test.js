// The absence overview over the real stores: it looks the same raids up per
// raider, per role and per raid, which used to parse signups.json again for
// every single lookup - quadratic in raids, seconds on a season of data. Now
// every event's signups are asked of the store once per overview, and the
// store parses its file once per change (jsonStore cache).
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({ categoryIds: ["mon"] }) }));

const fs = require("fs");
const availability = require("../../../src/stores/availabilityStore");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const overview = require("../../../src/services/signups/absenceOverview");
const { tempStoreFile } = require("../../helpers/tempStore");

// Thursday 2030-03-21, 12:00 server time: this week's Monday is 2030-03-18
const NOW = Date.UTC(2030, 2, 21, 11, 0);
const DAY = 86400;
const RAIDS = 30;
const RAIDERS = 25;
const raiderId = (i) => `1000000000000000${String(i).padStart(2, "0")}`;

const files = {};

beforeAll(() => {
    files.events = tempStoreFile("eh-reads-events.json");
    files.signups = tempStoreFile("eh-reads-signups.json");
    eventStore.useFile(files.events);
    signupStore.useFile(files.signups);
    availability.useFile(tempStoreFile("eh-reads-availability.json"));
    profiles.useFile(tempStoreFile("eh-reads-profiles.json"));

    // RAIDS raids every other day, from four weeks back to eight weeks ahead
    const start = Math.floor(NOW / 1000) - 28 * DAY + 19 * 3600;
    const events = Array.from({ length: RAIDS }, (_, i) => ({
        id: `eh-r${i}`, guildId: "g1", categoryId: "mon", channelId: `c${i}`, title: `Raid ${i}`,
        startTime: start + i * 3 * DAY, versionId: "tbc", size: 25, composition: { tank: 2, healer: 5 },
    }));
    const signups = {};
    for (const [i, ev] of events.entries()) {
        signups[ev.id] = {};
        for (let r = 0; r < RAIDERS; r += 1) {
            const uid = raiderId(r);
            const spec = r % 3 === 0 ? "Warrior-Protection" : "Druid-Restoration";
            const status = (i + r) % 4 === 0 ? "absence" : "signed";
            signups[ev.id][uid] = { userId: uid, character: `Char${r}`, spec, role: r % 3 === 0 ? "tank" : "healer", status, at: r };
        }
    }
    fs.writeFileSync(files.events, JSON.stringify({ events }));
    fs.writeFileSync(files.signups, JSON.stringify({ signups }));
    for (let r = 0; r < 5; r += 1) {
        availability.addEntry({ userId: raiderId(r), kind: "absence", from: "2030-03-25", to: "2030-04-10", comment: "Urlaub", createdBy: raiderId(r) }, { now: NOW });
    }
});

afterAll(() => {
    eventStore.useFile(null);
    signupStore.useFile(null);
    availability.useFile(null);
    profiles.useFile(null);
});

afterEach(() => jest.restoreAllMocks());

const parsesOf = (spy, file) => spy.mock.calls.filter(([p]) => p === file).length;

describe("absenceOverview reads", () => {
    it("parses signups.json at most once for the whole overview, and not at all while it does not change", () => {
        const read = jest.spyOn(fs, "readFileSync");
        const first = overview.buildOverview({ now: NOW, weeks: 13 });
        expect(first.raids.length).toBeGreaterThan(10);
        expect(first.raiders.length).toBeGreaterThan(5);
        expect(parsesOf(read, files.signups)).toBeLessThanOrEqual(1);
        expect(parsesOf(read, files.events)).toBeLessThanOrEqual(1);
        read.mockClear();
        const again = overview.buildOverview({ now: NOW, weeks: 13 });
        expect(parsesOf(read, files.signups)).toBe(0);
        expect(parsesOf(read, files.events)).toBe(0);
        expect(again).toEqual(first);
    });

    it("asks the store for each raid's signups once, however many raiders and roles look them up", () => {
        const list = jest.spyOn(signupStore, "listSignups");
        const get = jest.spyOn(signupStore, "getSignup");
        const view = overview.buildOverview({ now: NOW, weeks: 13 });
        const asked = list.mock.calls.map(([id]) => id);
        expect(new Set(asked).size).toBe(asked.length);
        // every raid of the weeks plus the last few of the hints, never more than all raids
        expect(asked.length).toBeGreaterThanOrEqual(view.raids.length);
        expect(asked.length).toBeLessThanOrEqual(RAIDS);
        const pairs = get.mock.calls.map(([e, u]) => `${e}/${u}`);
        expect(new Set(pairs).size).toBe(pairs.length);
    });

    it("looks one raider's raids up once each in the detail, too", () => {
        const read = jest.spyOn(fs, "readFileSync");
        const get = jest.spyOn(signupStore, "getSignup");
        const detail = overview.raiderDetail(raiderId(1), { now: NOW });
        expect(detail.history.length).toBeGreaterThan(0);
        expect(parsesOf(read, files.signups)).toBeLessThanOrEqual(1);
        const pairs = get.mock.calls.map(([e, u]) => `${e}/${u}`);
        expect(new Set(pairs).size).toBe(pairs.length);
    });
});
