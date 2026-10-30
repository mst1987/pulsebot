// "Früh gegangen" (#990): the log suggests, the orga confirms. A night the log
// counts as present carries a suggestion when the account is missing from the
// last N boss kills of the raid(s) it stood in - a twink in the kill counts,
// several logs of one raid are merged, a raid group's raids are tracks of their
// own, only kills count (wipes never reach report.kills) and nobody in no kill at
// all left early. The orga's "leftEarly" override counts as attended.
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [] }));
const mockLogs = [];
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => mockLogs }));
const mockReports = new Map();
// rosterAttendance caches a condensed report per id + generatedAt: every test gets fresh stamps
const mockStamp = { at: 0 };
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: () => [...mockReports.keys()].map((id, i) => ({ id, zone: "Black Temple", generatedAt: mockStamp.at * 100 + i })),
    getReport: (id) => {
        const r = mockReports.get(id);
        return r ? { zone: "Black Temple", roster: r.names.map((name) => ({ name })), ...(r.kills ? { kills: r.kills } : {}) } : null;
    },
}));
const mockEvents = [];
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (guildId, opts = {}) => mockEvents.filter((e) => opts.siblings === true || !(e.raidGroupId && e.raidGroupId !== e.id))
        .filter((e) => !opts.untilSeconds || e.startTime <= opts.untilSeconds),
    getEvent: (id) => mockEvents.find((e) => e.id === id) || null,
    isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
const mockSignups = {};
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: (id) => mockSignups[id] || [] }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    ...jest.requireActual("../../../src/stores/raiderCharactersStore"),
    listAllAssignments: () => ({}),
}));
jest.mock("../../../src/stores/availabilityStore", () => ({ listEntries: () => [] }));
const mockOverrides = {};
jest.mock("../../../src/stores/attendanceOverridesStore", () => ({
    ...jest.requireActual("../../../src/stores/attendanceOverridesStore"),
    listOverrides: () => mockOverrides,
}));

const { buildAttendanceContext, attendanceForAccounts, neutralNight, neutralAttendance } = require("../../../src/services/characters/rosterAttendance");
const { LEFT_EARLY_DISMISSED } = jest.requireActual("../../../src/stores/attendanceOverridesStore");

const NOW = Date.UTC(2026, 9, 10);
const START = Math.floor(NOW / 1000) - 86400;
const T0 = START * 1000;
const MIN = 60 * 1000;
const kill = (boss, minute, players) => ({ id: minute, encounterId: 600 + minute, boss, at: T0 + minute * MIN, players });
const sign = (userId, character) => ({ userId, character, spec: "Mage-Fire", role: "ranged", status: "signed" });

function raid(id, over = {}) {
    mockEvents.push({ id, guildId: "g1", categoryId: "cat", title: id, startTime: START, versionId: "tbc", ...over });
}
function log(eventId, reportId, names, kills) {
    mockReports.set(reportId, { names, kills });
    mockLogs.push({ eventId, reportRefId: reportId });
}
const ctxOf = () => buildAttendanceContext("g1", { now: NOW, versionId: "tbc" });
const nightOf = (result, userId) => result.get(userId).raids[0];
const run = (accounts, n = 2) => attendanceForAccounts(ctxOf(), "cat", accounts, { nights: true, suggestLeftEarly: n });

beforeEach(() => {
    mockEvents.length = 0;
    mockLogs.length = 0;
    mockReports.clear();
    mockStamp.at += 1;
    for (const k of Object.keys(mockSignups)) delete mockSignups[k];
    for (const k of Object.keys(mockOverrides)) delete mockOverrides[k];
});

describe("the log's \"left early\" suggestion", () => {
    beforeEach(() => {
        raid("eh-bt");
        mockSignups["eh-bt"] = [sign("u1", "Alpha"), sign("u2", "Bravo")];
        log("eh-bt", "r1", ["Alpha", "Bravo"], [
            kill("Naj'entus", 10, ["Alpha", "Bravo"]),
            kill("Supremus", 40, ["Alpha", "Bravo"]),
            kill("Akama", 80, ["Alpha"]),
            kill("Teron", 120, ["Alpha"]),
        ]);
    });

    it("suggests it for somebody missing from the last N kills, never for who stayed", () => {
        const result = run([{ userId: "u1", chars: [{ name: "Alpha" }] }, { userId: "u2", chars: [{ name: "Bravo" }] }]);
        expect(nightOf(result, "u1")).not.toHaveProperty("suggestion");
        expect(nightOf(result, "u2")).toMatchObject({
            status: "present", detail: "inLog", attended: true,
            suggestion: { kind: "leftEarly", missedKills: 2, bosses: ["Akama", "Teron"] },
        });
        // the suggestion changes nothing about the quota
        expect(result.get("u2")).toMatchObject({ attended: 1, total: 1, pct: 100 });
    });

    it("follows the setting: with N = 3 the raider was still in one of the last three kills", () => {
        const result = run([{ userId: "u2", chars: [{ name: "Bravo" }] }], 3);
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
    });

    it("is never asked for without suggestLeftEarly (the raider's own views, the setup, the Kaderplaner)", () => {
        const result = attendanceForAccounts(ctxOf(), "cat", [{ userId: "u2", chars: [{ name: "Bravo" }] }], { nights: true });
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
    });

    it("counts a twink of the same person in the last kills as still there", () => {
        mockReports.get("r1").kills[2].players.push("Bravotwink");
        mockReports.get("r1").kills[3].players.push("Bravotwink");
        const result = run([{ userId: "u2", chars: [{ name: "Bravo" }, { name: "Bravotwink" }] }]);
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
    });

    it("suggests nothing for somebody in the log but in no kill at all", () => {
        mockReports.get("r1").names.push("Charlie");
        const result = run([{ userId: "u3", chars: [{ name: "Charlie" }] }]);
        expect(nightOf(result, "u3")).toMatchObject({ status: "present", detail: "inLog" });
        expect(nightOf(result, "u3")).not.toHaveProperty("suggestion");
    });

    it("suggests nothing over the orga's override - a confirmed one counts as attended, a dismissed one stays present", () => {
        mockOverrides["eh-bt"] = { u2: { status: "leftEarly", reason: "", by: "m1", byName: "Marc", at: 1 } };
        let result = run([{ userId: "u2", chars: [{ name: "Bravo" }] }]);
        expect(nightOf(result, "u2")).toMatchObject({ status: "leftEarly", detail: "override", attended: true, reason: "früh gegangen (von Hand)" });
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
        expect(result.get("u2")).toMatchObject({ attended: 1, total: 1, pct: 100, missed: [] });

        mockOverrides["eh-bt"] = { u2: { status: "present", reason: LEFT_EARLY_DISMISSED, by: "m1", byName: "Marc", at: 2 } };
        result = run([{ userId: "u2", chars: [{ name: "Bravo" }] }]);
        expect(nightOf(result, "u2")).toMatchObject({ status: "present", detail: "override" });
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
    });
});

describe("several logs of one raid", () => {
    beforeEach(() => {
        raid("eh-bt");
        // two raiders logged: the Akama kill is in both logs (a minute apart), Teron only in the second
        log("eh-bt", "r1", ["Alpha", "Bravo"], [kill("Naj'entus", 10, ["Alpha", "Bravo"]), kill("Akama", 80, ["Alpha"])]);
        log("eh-bt", "r2", ["Bravo"], [kill("Akama", 81, ["Bravo"]), kill("Teron", 120, ["Bravo"])]);
    });

    it("merges them: one Akama kill with both raiders, so missing only Teron is no suggestion at N = 2", () => {
        const result = run([{ userId: "u1", chars: [{ name: "Alpha" }] }]);
        expect(nightOf(result, "u1")).not.toHaveProperty("suggestion");
    });

    it("still sees the last kill missing at N = 1", () => {
        const result = run([{ userId: "u1", chars: [{ name: "Alpha" }] }], 1);
        expect(nightOf(result, "u1").suggestion).toEqual({ kind: "leftEarly", missedKills: 1, bosses: ["Teron"] });
    });

    it("suggests nothing when one of the logs was evaluated before the kills were kept", () => {
        mockReports.get("r2").kills = undefined;
        const result = run([{ userId: "u1", chars: [{ name: "Alpha" }] }], 1);
        expect(nightOf(result, "u1")).not.toHaveProperty("suggestion");
    });
});

describe("a raid group (one night, a kill track per raid)", () => {
    beforeEach(() => {
        raid("eh-za", { raidGroupId: "eh-za", raidGroupIndex: 1 });
        raid("eh-za2", { raidGroupId: "eh-za", raidGroupIndex: 2 });
        mockSignups["eh-za"] = [sign("u1", "Alpha"), sign("u2", "Bravo")];
        log("eh-za", "r1", ["Alpha"], [kill("Nalorakk", 10, ["Alpha"]), kill("Akil'zon", 30, ["Alpha"])]);
        // Raid 2 kills later in the evening - Bravo left after its first boss
        log("eh-za2", "r2", ["Bravo", "Echo"], [
            kill("Nalorakk", 20, ["Bravo", "Echo"]), kill("Akil'zon", 60, ["Echo"]), kill("Jan'alai", 90, ["Echo"]),
        ]);
    });

    it("judges each raider by the kills of their own raid only", () => {
        const result = run([{ userId: "u1", chars: [{ name: "Alpha" }] }, { userId: "u2", chars: [{ name: "Bravo" }] }]);
        expect(nightOf(result, "u1")).not.toHaveProperty("suggestion");
        expect(nightOf(result, "u2").suggestion).toEqual({ kind: "leftEarly", missedKills: 2, bosses: ["Akil'zon", "Jan'alai"] });
    });
});

describe("only kills count", () => {
    it("ignores wipes at the end of the night: they never reach report.kills", () => {
        raid("eh-bt");
        // the raid wiped on Illidan after its last kill - report.kills (killRoster) holds the kills only
        log("eh-bt", "r1", ["Alpha", "Bravo"], [kill("Naj'entus", 10, ["Alpha", "Bravo"]), kill("Supremus", 40, ["Alpha", "Bravo"])]);
        const result = run([{ userId: "u2", chars: [{ name: "Bravo" }] }]);
        expect(nightOf(result, "u2")).not.toHaveProperty("suggestion");
    });
});

describe("neutralNight (the raider's own view)", () => {
    const base = { eventId: "e1", title: "BT", startTime: 1, attended: true, status: "leftEarly", detail: "override", reason: "früh gegangen (von Hand)" };

    it("shows a night set to \"left early\" as plainly present, without the override", () => {
        expect(neutralNight({ ...base, override: { status: "leftEarly", reason: "nach Kael weg" } }))
            .toEqual({ eventId: "e1", title: "BT", startTime: 1, attended: true, status: "present", detail: "inLog", reason: "im Log" });
    });

    it("hides a dismissed suggestion too, and leaves every other night alone", () => {
        const dismissed = { ...base, status: "present", reason: "anwesend (von Hand)", override: { status: "present", reason: LEFT_EARLY_DISMISSED } };
        expect(neutralNight(dismissed)).not.toHaveProperty("override");
        const other = { ...base, status: "bench", override: { status: "bench", reason: "hat gewartet" } };
        expect(neutralNight(other)).toBe(other);
        const plain = { eventId: "e2", attended: false, status: "noShow", detail: "notInLog", reason: "nicht im Log" };
        expect(neutralNight(plain)).toBe(plain);
    });

    it("never hands a raider an open suggestion", () => {
        const suggested = { eventId: "e3", attended: true, status: "present", detail: "inLog", reason: "im Log", suggestion: { kind: "leftEarly", missedKills: 2, bosses: ["A", "B"] } };
        expect(neutralNight(suggested)).toEqual({ eventId: "e3", attended: true, status: "present", detail: "inLog", reason: "im Log" });
        expect(neutralNight(null)).toBeNull();
    });
});

describe("neutralAttendance (a whole summary for the raider)", () => {
    it("puts every night of raids and missed through neutralNight and keeps the quota", () => {
        const left = { eventId: "e1", attended: true, status: "leftEarly", detail: "override", reason: "x", override: { status: "leftEarly", reason: "weg" } };
        const missed = { eventId: "e2", status: "noShow", detail: "notInLog", reason: "nicht im Log" };
        const summary = { attended: 1, total: 2, pct: 50, raids: [left, { ...missed, attended: false }], missed: [missed] };
        const out = neutralAttendance(summary);
        expect(out).toMatchObject({ attended: 1, total: 2, pct: 50 });
        expect(out.raids[0]).toMatchObject({ status: "present", attended: true });
        expect(out.raids[0]).not.toHaveProperty("override");
        expect(out.missed).toEqual([missed]);
        expect(summary.raids[0].override).toBeDefined();
        expect(neutralAttendance(null)).toBeNull();
        expect(neutralAttendance({ attended: 0, total: 0, pct: null })).toEqual({ attended: 0, total: 0, pct: null, raids: [], missed: [] });
    });
});

// "Left early", a dismissed suggestion and an open suggestion are the orga's (#990): a raider never sees
// them on a night of their own. Every module that builds night-by-night attendance is listed here with the
// reason it is safe; a new one is a decision, not an accident - send the raider's own view through
// neutralNight / neutralAttendance (or raiderAttendance's `neutral`) and add it with its reason.
describe("who builds night-by-night attendance (#990)", () => {
    const fs = require("fs");
    const path = require("path");
    const SRC = path.join(__dirname, "..", "..", "..", "src");
    const SAFE = {
        "services/characters/attendanceLookup.js": "/anwesenheit + /anwesenheit-raider: quota and missed nights only (left early never misses)",
        "services/characters/rosterAttendance.js": "the builder itself",
        "services/setup/setupInput.js": "the setup proposal: the quota (pct) only",
        "web/apiRoutes/events/availability.js": "GET /api/attendance: neutral when the caller looks at their own nights; /overview/raider is orga_only",
        "web/apiRoutes/roster/roster.js": "GET /api/roster/char: orga, or the own player through neutralAttendance",
        "web/availability/raiderAttendance.js": "the builder of the raider view; its callers pass `neutral`",
        "web/characters/roster.js": "buildRoster (orga_only) and rosterCharacter (filtered in apiRoutes/roster/roster.js)",
        "web/dashboard/dashboardPersonal.js": "the raider's own dashboard: always neutral",
        "web/kader/kaderSource.js": "the kader planner: admins and the kader area only",
        "web/roster/rosterView.js": "the roster grid: a non-orga caller gets the composition only",
        "web/setup/setupAttendance.js": "the setup editor: orga only",
    };
    function modulesMatching(re) {
        const out = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "web-client" && entry.name !== "node_modules") walk(full);
                } else if (entry.name.endsWith(".js") && re.test(fs.readFileSync(full, "utf8"))) {
                    out.push(path.relative(SRC, full).split(path.sep).join("/"));
                }
            }
        };
        walk(SRC);
        return out.sort();
    }

    it("is done by the reviewed modules alone", () => {
        expect(modulesMatching(/\b(attendanceFor|attendanceForAccounts|raiderAttendance|rosterCharacter)\(/)).toEqual(Object.keys(SAFE).sort());
    });

    it("the character page filters the own player's view", () => {
        const route = fs.readFileSync(path.join(SRC, "web/apiRoutes/roster/roster.js"), "utf8");
        expect(route).toMatch(/neutralAttendance\(/);
    });
});
