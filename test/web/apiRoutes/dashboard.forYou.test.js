// "Für dich" on the start page through the real route, the real list
// (signupView.memberEventList) and the real rule (signupAccess.js): a raider
// sees the raids they may sign up for, plus the ones they signed up for.
//
// The report (Oct 2026): "Mo Raider" — a raider role that reads the raids —
// saw the Wednesday raid of "TBC Mittwoch" as their next raid, a category whose
// raider role they lack and whose channels they cannot even see. The route
// treated `raids` read as "sees every category" (seesAllRaids → orga), and in
// "Ansicht als Rolle" it asked Discord for the admin's own roles instead of the
// roles looked at.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockGroups = [];
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: mockGroups, error: null })) }));
let mockRoleIds = null;
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => mockRoleIds),
    listGuilds: () => [{ id: "g1", name: "Pulse" }],
    listCategories: () => [],
}));
jest.mock("../../../src/web/dashboard/dashboardData", () => ({
    loadNextRaids: jest.fn(async () => ({ raids: [], error: null })),
    loadNextRaidDetails: jest.fn(),
    loadLatestReport: jest.fn(() => null),
    loadRosterFigures: jest.fn(() => null),
    loadInbox: jest.fn(() => []),
    loadNewLoot: jest.fn(() => ({ count: 0, since: 0 })),
    loadRecentEvents: jest.fn(async () => ({ events: [], error: null })),
    loadTopLoot: jest.fn(() => ({ items: [], configured: 0 })),
    loadChannelArchive: jest.fn(() => null),
    loadMissingChannels: jest.fn(async () => []),
    loadTrialEndings: jest.fn(async () => []),
    dashboardVersions: jest.fn(() => ({ mainVersion: "tbc", versions: [] })),
}));
jest.mock("../../../src/web/availability/raiderAttendance", () => ({ raiderAttendance: jest.fn(() => ({ categories: [] })) }));
jest.mock("../../../src/web/http/deployStatus", () => ({ deployStatus: jest.fn(async () => null) }));

const { json, routerClient } = require("../../helpers/http");
const { knownChannels } = require("../../helpers/linkCheck");
const memberRoleMemory = require("../../../src/services/discord/memberRoleMemory");
const { get } = routerClient(require("../../../src/web/apiRoutes/dashboard"));

const MO_ROLE = "300000000000000001";
const MI_ROLE = "300000000000000002";
const ADMIN_ROLE = "300000000000000009";
const ADMIN_ID = "200000000000000009";
const RAIDER_ID = "200000000000000001";
const future = Math.floor(Date.now() / 1000) + 2 * 86400;

// "Mo Raider": signs up for raids, and the role reads the raids (raid pages) - which makes nobody orga
const MO_RAIDER_ACCESS = { dashboard: { read: true, write: false }, signup: { read: true, write: true }, raids: { read: true, write: false } };

function raid(id, categoryId, categoryName, dayOffset, signUps = []) {
    return {
        categoryId, categoryName,
        events: [{ id, source: "raidhelper", title: `${categoryName} raid`, startTime: future + dayOffset * 86400, channelId: `ch-${categoryId}`, signUps, signupCount: signUps.length }],
    };
}

beforeEach(() => {
    memberRoleMemory._resetForTests();
    knownChannels("ch-mi", "ch-mo", "ch-pug");
    mockConfig = { categoryIds: ["mi", "mo", "pug"], categoryRoles: { mo: [MO_ROLE], mi: [MI_ROLE] } };
    // Wednesday first: it would be "Dein nächster Raid"
    mockGroups = [
        raid("1400000000000000001", "mi", "TBC Mittwoch", 0),
        raid("1400000000000000002", "mo", "TBC Montag", 1),
        raid("1400000000000000003", "pug", "PUG Raids", 2),
    ];
});

async function forYou(user) {
    mockUser = user;
    return json(await get("/api/dashboard")).data.personal;
}

describe("\"Für dich\" lists only the raids one may sign up for", () => {
    it("hides a category whose raider role the member lacks, even when their role reads the raids", async () => {
        mockRoleIds = [MO_ROLE];
        const personal = await forYou({ id: RAIDER_ID, name: "Mo", isAdmin: false, access: MO_RAIDER_ACCESS });
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Montag", "PUG Raids"]);
        expect(personal.upcomingRolesUnknown).toBe(false);
    });

    it("\"Ansicht als\" Mo Raider counts with the roles looked at, not with the admin's own", async () => {
        // the admin holds every raider role himself
        mockRoleIds = [MO_ROLE, MI_ROLE, ADMIN_ROLE];
        const viewing = { id: ADMIN_ID, name: "Admin", isAdmin: false, access: MO_RAIDER_ACCESS, viewAs: { roleIds: [MO_ROLE], at: Date.now() } };
        const personal = await forYou(viewing);
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Montag", "PUG Raids"]);
    });

    it("shows a raid one already signed up for, whatever the roles", async () => {
        mockRoleIds = [MO_ROLE];
        mockGroups[0].events[0].signUps = [{ userId: RAIDER_ID, specName: "Arcane", status: "signed" }];
        const personal = await forYou({ id: RAIDER_ID, name: "Mo", isAdmin: false, access: MO_RAIDER_ACCESS });
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Mittwoch", "TBC Montag", "PUG Raids"]);
    });

    it("is personal for the orga too: an admin sees the raids of their own roles in \"Für dich\"", async () => {
        mockRoleIds = [MI_ROLE];
        const personal = await forYou({ id: ADMIN_ID, name: "Admin", isAdmin: true });
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Mittwoch", "PUG Raids"]);
    });

    it("marks only the category open to everyone as PuG", async () => {
        mockRoleIds = [MO_ROLE];
        const personal = await forYou({ id: RAIDER_ID, name: "Mo", isAdmin: false, access: MO_RAIDER_ACCESS });
        expect(personal.upcoming.map((r) => [r.categoryName, r.openToAll])).toEqual([["TBC Montag", false], ["PUG Raids", true]]);
    });

    it("roles that cannot be read show only the PuG raids and own signups, and say so", async () => {
        mockRoleIds = null;
        mockGroups[1].events[0].signUps = [{ userId: RAIDER_ID, specName: "Arcane", status: "signed" }];
        const personal = await forYou({ id: RAIDER_ID, name: "Mo", isAdmin: false, access: MO_RAIDER_ACCESS });
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Montag", "PUG Raids"]);
        expect(personal.upcomingRolesUnknown).toBe(true);
    });

    it("a short Discord hiccup keeps the roles read a moment ago", async () => {
        const user = { id: RAIDER_ID, name: "Mo", isAdmin: false, access: MO_RAIDER_ACCESS };
        mockRoleIds = [MO_ROLE];
        await forYou(user);
        mockRoleIds = null;
        const personal = await forYou(user);
        expect(personal.upcoming.map((r) => r.categoryName)).toEqual(["TBC Montag", "PUG Raids"]);
        expect(personal.upcomingRolesUnknown).toBe(false);
    });
});
