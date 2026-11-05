// The server-admin rank (#1073 part B) through the real router, the real auth and the real rights: what it
// may on its own server, what it may not on a foreign one, what stays with the full admin. The rank is a
// Discord administrator on a listed server - nobody vouches for them, so every "foreign" case below is an
// attack, not a misuse. Discord side effects are mocked; the rosters and the Kader planner are real.
jest.mock("axios");
jest.mock("../../../src/config/variables", () => ({
    discordClientId: "client-id-123",
    discordClientSecret: "secret-xyz",
    publicBaseUrl: "https://logs.example.com",
    logcheckAdminIds: [],
    adminRoleIds: [],
    guildId: "",
    devAutoLogin: false,
}));
jest.mock("../../../src/stores/settings/configStore", () => ({
    ...jest.requireActual("../../../src/stores/settings/configStore"),
    getConfig: jest.fn(),
}));
jest.mock("../../../src/services/discord/pug/pugInvites", () => ({
    ...jest.requireActual("../../../src/services/discord/pug/pugInvites"),
    inviteOverview: jest.fn(),
    reconcileInvites: jest.fn(async () => ({})),
    ensureLinkInvite: jest.fn(async () => ({ url: "link" })),
    regenerateLinkInvite: jest.fn(async () => ({ url: "link" })),
    ensureGeneralInvite: jest.fn(async () => ({ url: "general" })),
    regenerateGeneralInvite: jest.fn(async () => ({ url: "general" })),
}));
jest.mock("../../../src/services/discord/pug/pugOnboarding", () => ({
    ...jest.requireActual("../../../src/services/discord/pug/pugOnboarding"),
    firstPugServer: jest.fn(() => "100000000000000002"),
    overview: jest.fn(async () => ({ roles: [] })),
    apply: jest.fn(async () => ({ applied: true })),
}));
jest.mock("../../../src/services/talk/talkOverview", () => ({
    ...jest.requireActual("../../../src/services/talk/talkOverview"),
    overviewStatus: jest.fn(),
    currentPayload: jest.fn(async () => ({})),
    syncOverview: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../src/stores/discord/discordInviteStore", () => ({
    ...jest.requireActual("../../../src/stores/discord/discordInviteStore"),
    setInviteChannel: jest.fn(),
}));
jest.mock("../../../src/stores/roster/userNotesStore", () => ({
    ...jest.requireActual("../../../src/stores/roster/userNotesStore"),
    removeEntry: jest.fn(() => true),
}));
jest.mock("../../../src/services/roster/rosterTakeover", () => ({
    ...jest.requireActual("../../../src/services/roster/rosterTakeover"),
    precheck: jest.fn(async () => ({ canStart: true })),
    start: jest.fn(async () => ({ started: true })),
    pullRole: jest.fn(async () => ({ count: 0, away: 0 })),
}));
jest.mock("../../../src/services/roster/rosterRoleSync", () => ({
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, results: [] })),
    applyRoleChange: jest.fn(),
    setRoleLostHandler: jest.fn(),
    setRoleGainedHandler: jest.fn(),
    takeFailedPending: jest.fn(() => false),
}));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({
    ...jest.requireActual("../../../src/services/characters/rosterAttendance"),
    buildAttendanceContext: jest.fn(),
}));
// the rank and one more member (MEMBER below) are on the server; every other id is outside
jest.mock("../../../src/services/discord/members/serverMembers", () => ({
    ...jest.requireActual("../../../src/services/discord/members/serverMembers"),
    serverMemberIds: jest.fn(async () => new Set(["rank", "900000000000000002"])),
}));

const { ChannelType } = require("discord.js");
const axios = require("axios");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const { findPageRoute } = require("../../../src/web/http/pageRoutes");
const discord = require("../../../src/services/discord/discord");
const pugInvites = require("../../../src/services/discord/pug/pugInvites");
const pugOnboarding = require("../../../src/services/discord/pug/pugOnboarding");
const talkOverview = require("../../../src/services/talk/talkOverview");
const inviteStore = require("../../../src/stores/discord/discordInviteStore");
const notes = require("../../../src/stores/roster/userNotesStore");
const rosterTakeover = require("../../../src/services/roster/rosterTakeover");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const raiderProfileStore = require("../../../src/stores/roster/raiderProfileStore");
const kaderStore = require("../../../src/stores/roster/kaderStore");
const tokens = require("../../../src/stores/loot/ingestTokenStore");
const stockStore = require("../../../src/stores/loot/guildBankStockStore");
const attendance = require("../../../src/services/characters/rosterAttendance");
const { serverMemberIds } = require("../../../src/services/discord/members/serverMembers");
const { makeChannel, makeClient, makeGuild } = require("../../helpers/discordClient");
const { body: dataOf, json, jsonRequest, mockRes, status } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const { getConfig } = settingsStore;
const OWN = "100000000000000001";
const FOREIGN = "100000000000000002";
const CAT_OWN = "200000000000000001";
const CAT_FOREIGN = "200000000000000002";
const CAT_FREE = "200000000000000003";
const TEXT_OWN = "300000000000000001";
const TEXT_FOREIGN = "300000000000000002";
const ROLE_OWN = "400000000000000001";
const ROLE_FOREIGN = "400000000000000002";
const ROLE_FREE = "400000000000000003";
const LINK = `${OWN}:${FOREIGN}`;
const ALL = { read: true, write: true };

const config = (trusted = false) => ({
    adminRoleIds: ["role-full"],
    discordServers: {
        servers: [{ guildId: OWN, label: "", trusted }, { guildId: FOREIGN, label: "", trusted }],
        links: [{ from: OWN, to: FOREIGN, channelId: TEXT_FOREIGN }],
    },
    serverSettings: {
        [OWN]: { orgaRoleIds: ["role-orga"], rolePermissions: { "role-orga": { rosters: ALL, settings: ALL, kader: ALL } } },
    },
});

const member = (roleIds, administrator) => ({
    roles: { cache: { has: (id) => roleIds.includes(id), keys: () => roleIds[Symbol.iterator]() } },
    permissions: { has: () => administrator },
});

function guildOf(id, categoryId, textId, roleId, { adminOn, roleIds }) {
    const guild = makeGuild({
        id,
        channels: [
            makeChannel({ id: categoryId, name: `Kategorie ${categoryId}`, type: ChannelType.GuildCategory, guildId: id }),
            makeChannel({ id: id === OWN ? CAT_FREE : `${categoryId}9`, name: "Frei", type: ChannelType.GuildCategory, guildId: id }),
            makeChannel({ id: textId, name: `text-${textId}`, guildId: id, permissionsFor: () => ({ has: () => true }) }),
        ],
        roles: [roleId, id === OWN ? ROLE_FREE : `${roleId}9`].map((role) => ({ id: role, name: `Rolle ${role}`, position: 1, permissions: { has: () => false } })),
    });
    guild.emojis = { cache: new Map() };
    guild.members.fetch = jest.fn().mockResolvedValue(member(id === OWN ? roleIds : [], adminOn.includes(id)));
    return guild;
}

/** A session: Discord administrator on `adminOn`, `roleIds` on the own server, `active` the server in the session. */
async function login(id, { adminOn = [], roleIds = [], active = OWN } = {}) {
    discord.setClient(makeClient({ guilds: [guildOf(OWN, CAT_OWN, TEXT_OWN, ROLE_OWN, { adminOn, roleIds }), guildOf(FOREIGN, CAT_FOREIGN, TEXT_FOREIGN, ROLE_FOREIGN, { adminOn, roleIds })] }));
    axios.post.mockResolvedValue({ data: { access_token: "tok" } });
    axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
    const sid = await auth.completeLogin(`code-${id}`);
    const headers = { cookie: `sid=${sid}` };
    auth.setActiveGuild({ headers }, active);
    return { headers, csrf: auth.csrfToken({ headers }) };
}

const rank = (over = {}) => login("rank", { adminOn: [OWN], ...over });
const plain = () => login("plain");
const fullAdmin = () => login("full", { roleIds: ["role-full"] });

async function send(session, method, target, body) {
    const url = new URL(`http://localhost${target}`);
    const req = jsonRequest(method, url.pathname, body, { ...session.headers, "x-csrf-token": session.csrf });
    const res = mockRes();
    await handle(url.pathname, req, res, url);
    return res;
}

let ownRoster;
let foreignRoster;

beforeAll(() => {
    rosterStore.useFile(tempStoreFile("rosters.json"));
    raiderProfileStore.useFile(tempStoreFile("raiderProfiles.json"));
    kaderStore.useFile(tempStoreFile("kader.json"));
});

afterAll(() => {
    rosterStore.useFile(null);
    raiderProfileStore.useFile(null);
    kaderStore.useFile(null);
});

function storedRoster(input) {
    const made = rosterStore.createRoster(input);
    return made.roster || made;
}

beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockReset();
    getConfig.mockReturnValue(config());
    pugInvites.inviteOverview.mockReturnValue({
        links: [{ from: OWN, to: FOREIGN }],
        servers: [{ guildId: OWN }, { guildId: FOREIGN }],
    });
    talkOverview.overviewStatus.mockReturnValue([{ key: LINK, guildId: OWN, from: OWN, to: FOREIGN }]);
    for (const roster of rosterStore.listRosters("")) rosterStore.deleteRoster(roster.id);
    ownRoster = storedRoster({ guildId: OWN, name: "Eigen", categoryId: CAT_OWN, roleIds: [ROLE_OWN] });
    foreignRoster = storedRoster({ guildId: FOREIGN, name: "Fremd", categoryId: CAT_FOREIGN, roleIds: [ROLE_FOREIGN] });
    kaderStore.writePlanner(OWN, { v: 2, accounts: [], assignments: {}, kaders: [{ id: "k1", name: "Kader", versionId: ownRoster.versionId, leads: [], questions: [], players: {} }] });
});

afterEach(() => discord.setClient(null));

// three entries each: jest passes `done` as the third argument of a shorter row
const OWN_SERVER_ROUTES = [
    ["GET", "/api/bot-commands", null],
    ["GET", "/api/settings/pug-invites", null],
    ["POST", "/api/settings/pug-invites", () => ({ guildId: OWN })],
    ["POST", "/api/settings/pug-invites/channel", () => ({ guildId: OWN, channelId: TEXT_OWN })],
    ["GET", `/api/discord/pug-onboarding?guildId=${OWN}`, null],
    ["POST", "/api/discord/pug-onboarding", () => ({ guildId: OWN, fingerprint: "f" })],
    ["GET", "/api/settings/talk-overview", null],
    ["POST", "/api/vermerke/delete", () => ({ userId: "u1", id: "n1", serverSettingsGuildId: OWN })],
    ["GET", "/api/rosters/options", null],
    ["POST", "/api/rosters/create", () => ({ name: "Neu", categoryId: CAT_FREE, roleIds: [ROLE_FREE] })],
    ["POST", "/api/rosters/update", () => ({ rosterId: ownRoster.id, name: "Anders" })],
    ["POST", "/api/rosters/delete", () => ({ rosterId: ownRoster.id })],
    ["POST", "/api/kader/roster/link", () => ({ kaderId: "k1", rosterId: ownRoster.id })],
    ["POST", "/api/kader/takeover", () => ({ kaderId: "k1", confirm: true })],
];

describe("the rank on its own server", () => {
    it.each(OWN_SERVER_ROUTES)("%s %s is open to the rank", async (method, target, body) => {
        const res = await send(await rank(), method, target, body ? body() : undefined);
        expect(status(res)).toBe(200);
    });

    it.each(OWN_SERVER_ROUTES)("%s %s is closed to a plain member", async (method, target, body) => {
        const res = await send(await plain(), method, target, body ? body() : undefined);
        expect(status(res)).toBe(403);
    });

    it.each(OWN_SERVER_ROUTES)("%s %s is closed while another server is active", async (method, target, body) => {
        const res = await send(await rank({ active: FOREIGN }), method, target, body ? body() : undefined);
        expect(status(res)).toBe(403);
    });

    it("writes where it was asked to: vermerke on the active server, a channel on the named one", async () => {
        const session = await rank();
        await send(session, "POST", "/api/vermerke/delete", { userId: "u1", id: "n1", serverSettingsGuildId: OWN });
        expect(notes.removeEntry).toHaveBeenCalledWith(OWN, "u1", "n1");
        await send(session, "POST", "/api/settings/pug-invites/channel", { guildId: OWN, channelId: TEXT_OWN });
        expect(inviteStore.setInviteChannel).toHaveBeenCalledWith(OWN, TEXT_OWN);
        await send(session, "POST", "/api/discord/pug-onboarding", { guildId: OWN, fingerprint: "f" });
        expect(pugOnboarding.apply).toHaveBeenCalledWith(OWN, expect.anything());
    });

    it("creates a roster on the active server, whatever the body names", async () => {
        const res = await send(await rank(), "POST", "/api/rosters/create", { guildId: FOREIGN, name: "Neu", categoryId: CAT_FREE, roleIds: [ROLE_FREE] });
        expect(status(res)).toBe(200);
        const created = rosterStore.listRosters(OWN).find((r) => r.name === "Neu");
        expect(created).toBeTruthy();
        expect(rosterStore.listRosters(FOREIGN).map((r) => r.id)).toEqual([foreignRoster.id]);
    });

    it("takes a Kader over and pulls the role through the checked path", async () => {
        const session = await rank();
        expect(status(await send(session, "GET", "/api/kader/takeover?kader=k1"))).toBe(200);
        expect(rosterTakeover.precheck).toHaveBeenCalledWith(OWN, "k1", { withCategories: true });
        await send(session, "POST", "/api/kader/roster/link", { kaderId: "k1", rosterId: ownRoster.id });
        expect(status(await send(session, "POST", "/api/kader/takeover/role", { kaderId: "k1" }))).toBe(200);
        expect(rosterTakeover.pullRole).toHaveBeenCalledWith(OWN, "k1", expect.anything());
    });
});

describe("the rank against a foreign server", () => {
    it.each([
        ["POST", "/api/settings/pug-invites", { guildId: FOREIGN }, 403],
        ["POST", "/api/settings/pug-invites/channel", { guildId: FOREIGN, channelId: TEXT_FOREIGN }, 403],
        ["GET", `/api/discord/pug-onboarding?guildId=${FOREIGN}`, undefined, 403],
        ["POST", "/api/discord/pug-onboarding", { guildId: FOREIGN, fingerprint: "f" }, 403],
    ])("%s %s %j is %i", async (method, target, body, expected) => {
        const res = await send(await rank(), method, target, body);
        expect(status(res)).toBe(expected);
        expect(json(res).error.code).toBe("other_server");
        expect(pugInvites.ensureGeneralInvite).not.toHaveBeenCalled();
        expect(inviteStore.setInviteChannel).not.toHaveBeenCalled();
        expect(pugOnboarding.overview).not.toHaveBeenCalled();
        expect(pugOnboarding.apply).not.toHaveBeenCalled();
    });

    it("does not touch a roster of another server", async () => {
        const session = await rank();
        expect(status(await send(session, "POST", "/api/rosters/update", { rosterId: foreignRoster.id, name: "Gekapert" }))).toBe(404);
        expect(status(await send(session, "POST", "/api/rosters/delete", { rosterId: foreignRoster.id }))).toBe(404);
        const kept = rosterStore.getRoster(foreignRoster.id);
        expect(kept.name).toBe("Fremd");
    });

    it.each([
        ["create", "/api/rosters/create", () => ({ name: "Neu", categoryId: CAT_FOREIGN, roleIds: [] })],
        ["update", "/api/rosters/update", () => ({ rosterId: ownRoster.id, categoryId: CAT_FOREIGN })],
    ])("cannot %s a roster with a category of another server", async (_name, target, body) => {
        const res = await send(await rank(), "POST", target, body());
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(rosterStore.getRoster(ownRoster.id).categoryId).toBe(CAT_OWN);
    });

    it("does not link a Kader to a roster of another server", async () => {
        const res = await send(await rank(), "POST", "/api/kader/roster/link", { kaderId: "k1", rosterId: foreignRoster.id });
        expect(status(res)).not.toBe(200);
        expect(rosterStore.getRoster(foreignRoster.id).kaderId || "").toBe("");
    });

    it("sees only its own server and no foreign link in the invite overview, and starts no reconcile", async () => {
        const res = await send(await rank(), "GET", "/api/settings/pug-invites");
        expect(status(res)).toBe(200);
        expect(dataOf(res).links).toEqual([]);
        expect(dataOf(res).servers).toEqual([{ guildId: OWN }]);
        expect(pugInvites.reconcileInvites).not.toHaveBeenCalled();
    });

    it("gets no foreign entry in the talk overview list", async () => {
        const res = await send(await rank(), "GET", "/api/settings/talk-overview");
        expect(dataOf(res).statuses).toEqual([]);
    });
});

describe("links need the rank on both servers", () => {
    const LINK_ROUTES = [
        ["POST", "/api/settings/pug-invites", { key: LINK }],
        ["GET", `/api/settings/talk-overview?key=${LINK}&preview=0`, undefined],
        ["POST", "/api/settings/talk-overview", { key: LINK }],
    ];

    it.each(LINK_ROUTES)("%s %s is closed with the rank on one end", async (method, target, body) => {
        const res = await send(await rank(), method, target, body);
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(pugInvites.ensureLinkInvite).not.toHaveBeenCalled();
        expect(talkOverview.syncOverview).not.toHaveBeenCalled();
    });

    it.each(LINK_ROUTES)("%s %s is open with the rank on both ends", async (method, target, body) => {
        const res = await send(await rank({ adminOn: [OWN, FOREIGN] }), method, target, body);
        expect(status(res)).toBe(200);
    });

    it("keeps the link in the lists for the rank on both ends", async () => {
        const session = await rank({ adminOn: [OWN, FOREIGN] });
        expect(dataOf(await send(session, "GET", "/api/settings/pug-invites")).links).toEqual([{ from: OWN, to: FOREIGN }]);
        expect(dataOf(await send(session, "GET", "/api/settings/talk-overview")).statuses.map((s) => s.key)).toEqual([LINK]);
    });
});

describe.each([[false], [true]])("full-admin routes stay closed to the rank (marked server: %s)", (trusted) => {
    beforeEach(() => getConfig.mockReturnValue(config(trusted)));

    it.each([
        ["GET", "/api/system/status", undefined],
        ["GET", "/api/system/backup", undefined],
        ["POST", "/api/system/backup/snapshot", {}],
        ["GET", "/api/addon-center", undefined],
        ["PUT", "/api/addon-center", {}],
        ["POST", "/api/addon-center", {}],
        ["DELETE", "/api/addon-center", {}],
        ["GET", "/api/settings/server-plans", undefined],
        ["PUT", "/api/settings/server-plans", {}],
        ["GET", "/api/settings/version-launch", undefined],
        ["POST", "/api/settings/version-launch", {}],
        ["GET", "/api/settings/raidhelper-retirement", undefined],
        ["POST", "/api/settings/raidhelper-retirement", {}],
        ["POST", "/api/settings/raidhelper-history-import", {}],
        ["GET", "/api/settings/raidhelper-sync", undefined],
        ["POST", "/api/settings/raidhelper-sync", {}],
        ["POST", "/api/session/view-as", { roleIds: [] }],
    ])("%s %s", async (method, target, body) => {
        const res = await send(await rank(), method, target, body);
        expect(status(res)).toBe(403);
    });
});

describe("reaching beyond the own server stays with the full admin", () => {
    it("names no category of another server in a channel batch", async () => {
        const res = await send(await rank(), "POST", "/api/channels/batch", { categoryId: CAT_FOREIGN, raid: "Kara" });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
    });

    it.each([
        ["/api/raidplan/templates"],
        ["/api/raid-templates"],
    ])("reads no library of another server (%s)", async (path) => {
        const res = await send(await rank(), "GET", `${path}?guildId=${FOREIGN}`);
        expect(status(res)).toBe(404);
    });

    it("revokes no sync key of somebody else", async () => {
        jest.spyOn(tokens, "getToken").mockReturnValue({ id: "key-1", ownerId: "someone" });
        const revoke = jest.spyOn(tokens, "revokeToken").mockReturnValue(true);
        const res = await send(await rank(), "POST", "/api/profile/sync-keys/delete", { id: "key-1" });
        expect(status(res)).toBe(404);
        expect(revoke).not.toHaveBeenCalled();
        jest.restoreAllMocks();
    });

    it("deletes no guild bank of another server", async () => {
        const bank = jest.spyOn(stockStore, "getBank").mockReturnValue({ key: "b1", guildId: FOREIGN });
        const res = await send(await rank(), "POST", "/api/settings/guild-banks/delete", { key: "b1" });
        expect(status(res)).toBe(404);
        bank.mockRestore();
    });

    it("deletes no report page", async () => {
        const session = await rank();
        const res = mockRes();
        const hit = findPageRoute("DELETE", "/r/abc");
        await hit.route.handler({ req: { headers: session.headers }, res, params: hit.params });
        expect(status(res)).toBe(403);
    });
});

describe("the rank lowers nothing", () => {
    it("leaves a full admin free on either server", async () => {
        const session = await fullAdmin();
        expect(status(await send(session, "POST", "/api/settings/pug-invites", { guildId: FOREIGN }))).toBe(200);
        expect(pugInvites.ensureGeneralInvite).toHaveBeenCalledWith(FOREIGN);
        auth.setActiveGuild({ headers: session.headers }, FOREIGN);
        expect(status(await send(session, "POST", "/api/rosters/update", { rosterId: foreignRoster.id, name: "Admin" }))).toBe(200);
    });

    it("gives the rank nothing through the session switch: it stays no full admin", async () => {
        const session = await rank();
        expect(auth.getUser({ headers: session.headers }).isAdmin).toBeFalsy();
        expect(auth.getUser({ headers: session.headers }).isServerAdmin).toBe(true);
    });
});

// The bulk ways into a roster (docs/permissions.md, "Aufnahme ins Roster"): addMember checks no server and
// copies the first profile character, so without the limit a rank would learn the characters of any account.
describe("the bulk ways into a roster", () => {
    const VICTIM = "900000000000000001";
    const MEMBER = "900000000000000002";
    const SECRET_CHAR = "Geheimchar";
    const MEMBER_CHAR = "Mitgliedchar";

    const trustedWithRole = () => ({
        ...config(true),
        serverSettings: { [OWN]: { orgaRoleIds: ["role-orga"], rolePermissions: { "role-orga": { roster: ALL, kader: ALL } } } },
    });
    const rankWithRole = () => rank({ roleIds: ["role-orga"] });

    async function putOnKader(session, kaderId = "k1") {
        const add = await send(session, "POST", "/api/kader/players/add", { kaderId, players: [VICTIM, MEMBER].map((userId) => ({ userId, displayName: "x" })) });
        expect(status(add)).toBe(200);
        const answers = [add];
        for (const to of ["selected", "provisional", "roster"]) {
            const state = await send(session, "POST", "/api/kader/players/state", { kaderId, userIds: [VICTIM, MEMBER], to });
            expect(status(state)).toBe(200);
            answers.push(state);
        }
        return answers;
    }

    function nightsWithBoth() {
        const { nameKey } = raiderProfileStore;
        attendance.buildAttendanceContext.mockReturnValue({
            versionId: ownRoster.versionId,
            raidsByCategory: new Map(),
            allRaidsByCategory: new Map([[CAT_FREE, [
                { id: "e1", startTime: 2, signUps: [], logs: [{ keys: new Set([nameKey(SECRET_CHAR), nameKey(MEMBER_CHAR)]) }] },
                { id: "e2", startTime: 1, signUps: [{ userId: VICTIM, status: "signed" }], logs: [] },
            ]]]),
            roleByKey: {},
        });
    }

    const createFromKader = (session) => send(session, "POST", "/api/rosters/create", { name: "Aus Kader", source: "kader", kaderId: "k1" });
    const createLinked = (session) => send(session, "POST", "/api/rosters/create", { name: "Verknuepft", source: "none", versionId: ownRoster.versionId, kaderId: "k1" });
    const createFromRaids = (session) => send(session, "POST", "/api/rosters/create", { categoryId: CAT_FREE, name: "Aus Raids", source: "raids", versionId: ownRoster.versionId });

    // each way: what the answer says, the roster it wrote and the whole answer
    const WAYS = [
        ["a new roster from a Kader", async (session) => {
            await putOnKader(session);
            const res = await createFromKader(session);
            expect(status(res)).toBe(200);
            return { res, counts: dataOf(res).initial, rosterId: dataOf(res).roster.id };
        }],
        ["the sync of a linked Kader", async (session) => {
            const made = await createLinked(session);
            expect(status(made)).toBe(200);
            await putOnKader(session);
            const res = await send(session, "POST", "/api/kader/roster/sync", { kaderId: "k1" });
            expect(status(res)).toBe(200);
            return { res, counts: dataOf(res), rosterId: dataOf(made).roster.id };
        }],
        ["a new roster from the last raids", async (session) => {
            nightsWithBoth();
            const res = await createFromRaids(session);
            expect(status(res)).toBe(200);
            return { res, counts: dataOf(res).initial, rosterId: dataOf(res).roster.id };
        }],
    ];

    beforeEach(() => {
        raiderProfileStore.reset();
        raiderProfileStore.addCharacter(VICTIM, { name: SECRET_CHAR, className: "Mage", specs: ["Mage-Frost"], versionId: ownRoster.versionId });
        raiderProfileStore.addCharacter(MEMBER, { name: MEMBER_CHAR, className: "Priest", specs: ["Priest-Holy"], versionId: ownRoster.versionId });
    });

    describe.each([["without the mark", false], ["with the mark", true]])("the rank alone on a server %s", (_label, trusted) => {
        beforeEach(() => getConfig.mockReturnValue(config(trusted)));

        it.each(WAYS)("%s takes the member and counts the other account", async (_way, run) => {
            const { res, counts, rosterId } = await run(await rank());
            const { members } = rosterStore.getRoster(rosterId);
            expect(Object.keys(members)).toEqual([MEMBER]);
            expect(members[MEMBER].chars).toEqual([raiderProfileStore.nameKey(MEMBER_CHAR)]);
            expect(counts).toEqual(expect.objectContaining({ added: 1, skipped: 1, outsideServer: 1 }));
            const answer = JSON.stringify(json(res));
            expect(answer).not.toContain(VICTIM);
            expect(answer.toLowerCase()).not.toContain(SECRET_CHAR.toLowerCase());
        });
    });

    it("the hand way answers the same account with not_on_server", async () => {
        const session = await rank();
        const res = await send(session, "POST", "/api/rosters/members", { rosterId: ownRoster.id, userId: VICTIM });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("not_on_server");
    });

    it("the Kader takes any id but shows nothing of its profile", async () => {
        const session = await rank();
        const answers = await putOnKader(session);
        answers.push(await send(session, "GET", "/api/kader/kader?kader=k1"));
        for (const res of answers) {
            expect(status(res)).toBe(200);
            expect(JSON.stringify(json(res)).toLowerCase()).not.toContain(SECRET_CHAR.toLowerCase());
        }
    });

    describe("rank and role on a marked server", () => {
        beforeEach(() => getConfig.mockReturnValue(trustedWithRole()));

        it.each(WAYS)("%s keeps its way", async (_way, run) => {
            const { counts, rosterId } = await run(await rankWithRole());
            expect(Object.keys(rosterStore.getRoster(rosterId).members).sort()).toEqual([VICTIM, MEMBER]);
            expect(counts).toEqual(expect.objectContaining({ added: 2, skipped: 0, outsideServer: 0 }));
        });

        it("hands the takeover no limit", async () => {
            const res = await send(await rankWithRole(), "POST", "/api/kader/takeover", { kaderId: "k1", confirm: true });
            expect(status(res)).toBe(200);
            expect(rosterTakeover.start.mock.calls[0][3].mayTakeIn).toBeNull();
        });
    });

    describe("a full admin", () => {
        it.each(WAYS)("%s stays as it was", async (_way, run) => {
            const { counts, rosterId } = await run(await fullAdmin());
            expect(Object.keys(rosterStore.getRoster(rosterId).members).sort()).toEqual([VICTIM, MEMBER]);
            expect(counts).toEqual(expect.objectContaining({ added: 2, skipped: 0, outsideServer: 0 }));
            expect(serverMemberIds).not.toHaveBeenCalled();
        });

        it("hands the takeover and the role pull no limit", async () => {
            const session = await fullAdmin();
            expect(status(await send(session, "POST", "/api/kader/takeover", { kaderId: "k1", confirm: true }))).toBe(200);
            expect(rosterTakeover.start.mock.calls[0][3].mayTakeIn).toBeNull();
            await send(session, "POST", "/api/kader/roster/link", { kaderId: "k1", rosterId: ownRoster.id });
            expect(status(await send(session, "POST", "/api/kader/takeover/role", { kaderId: "k1" }))).toBe(200);
            expect(rosterTakeover.pullRole.mock.calls[0][2].mayTakeIn).toBeNull();
            expect(serverMemberIds).not.toHaveBeenCalled();
        });
    });

    describe("the takeover", () => {
        const refusesVictim = (mayTakeIn) => {
            expect(mayTakeIn(VICTIM)).toBe(false);
            expect(mayTakeIn(MEMBER)).toBe(true);
        };

        it("hands the limit of the rank alone to the start and the role pull", async () => {
            const session = await rank();
            expect(status(await send(session, "POST", "/api/kader/takeover", { kaderId: "k1", confirm: true }))).toBe(200);
            refusesVictim(rosterTakeover.start.mock.calls[0][3].mayTakeIn);
            await send(session, "POST", "/api/kader/roster/link", { kaderId: "k1", rosterId: ownRoster.id });
            expect(status(await send(session, "POST", "/api/kader/takeover/role", { kaderId: "k1" }))).toBe(200);
            refusesVictim(rosterTakeover.pullRole.mock.calls[0][2].mayTakeIn);
        });

        it("answers 503 before anything happens while the member list cannot be read", async () => {
            const session = await rank();
            serverMemberIds.mockResolvedValueOnce(null);
            const started = await send(session, "POST", "/api/kader/takeover", { kaderId: "k1", confirm: true });
            expect(status(started)).toBe(503);
            expect(json(started).error.code).toBe("members_unavailable");
            expect(rosterTakeover.start).not.toHaveBeenCalled();
            await send(session, "POST", "/api/kader/roster/link", { kaderId: "k1", rosterId: ownRoster.id });
            serverMemberIds.mockResolvedValueOnce(null);
            const pulled = await send(session, "POST", "/api/kader/takeover/role", { kaderId: "k1" });
            expect(status(pulled)).toBe(503);
            expect(rosterTakeover.pullRole).not.toHaveBeenCalled();
        });
    });

    describe("while the member list cannot be read", () => {
        it("creates no roster from a Kader or from raids", async () => {
            const session = await rank();
            await putOnKader(session);
            nightsWithBoth();
            for (const create of [createFromKader, createFromRaids]) {
                serverMemberIds.mockResolvedValueOnce(null);
                const res = await create(session);
                expect(status(res)).toBe(503);
                expect(json(res).error.code).toBe("members_unavailable");
            }
            expect(rosterStore.listRosters(OWN).map((r) => r.id)).toEqual([ownRoster.id]);
        });

        it("syncs nobody", async () => {
            const session = await rank();
            const made = await createLinked(session);
            await putOnKader(session);
            serverMemberIds.mockResolvedValueOnce(null);
            const res = await send(session, "POST", "/api/kader/roster/sync", { kaderId: "k1" });
            expect(status(res)).toBe(503);
            expect(rosterStore.getRoster(dataOf(made).roster.id).members).toEqual({});
        });

        it("does not matter to a roster without a source of accounts", async () => {
            const res = await send(await rank(), "POST", "/api/rosters/create", { name: "Leer", source: "none", versionId: ownRoster.versionId });
            expect(status(res)).toBe(200);
            expect(serverMemberIds).not.toHaveBeenCalled();
        });
    });

    describe("the Kader named on create", () => {
        it.each([["none", {}], ["kader", {}]])("refuses a Kader of another server (source %s)", async (source) => {
            kaderStore.writePlanner(FOREIGN, { v: 2, accounts: [], assignments: {}, kaders: [{ id: "kf", name: "Fremd", versionId: ownRoster.versionId, leads: [], questions: [], players: {} }] });
            const res = await send(await rank(), "POST", "/api/rosters/create", { name: "Fremdkader", source, versionId: ownRoster.versionId, kaderId: "kf" });
            expect(status(res)).toBe(404);
            expect(json(res).error.code).toBe("kader_not_found");
            expect(rosterStore.listRosters(OWN).map((r) => r.id)).toEqual([ownRoster.id]);
        });

        it("refuses it for a full admin too", async () => {
            const res = await send(await fullAdmin(), "POST", "/api/rosters/create", { name: "Unbekannt", source: "none", versionId: ownRoster.versionId, kaderId: "nope" });
            expect(status(res)).toBe(404);
            expect(json(res).error.code).toBe("kader_not_found");
        });
    });
});
