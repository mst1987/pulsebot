// #1073 part B, section 2b: what the server-admin rank may read and write through the settings
// route. Through the real router, the real gate and the real config store: "nothing saved" means
// the file on disk did not change.
jest.mock("axios");
jest.mock("../../../src/config/variables", () => ({ discordClientId: "client-id-123", discordClientSecret: "secret-xyz", publicBaseUrl: "https://logs.example.com", logcheckAdminIds: [], adminRoleIds: [], guildId: "", devAutoLogin: false }));

const fs = require("fs");
const { ChannelType } = require("discord.js");
const axios = require("axios");
const configStore = require("../../../src/stores/settings/configStore");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const discord = require("../../../src/services/discord/discord");
const { sharedDataAccess } = require("../../../src/services/discord/members/userAccess");
const botAccess = require("../../../src/services/discord/botAccess");
const { makeChannel, makeClient, makeGuild } = require("../../helpers/discordClient");
const { body: dataOf, jsonRequest, mockRes, status } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

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
const ACCOUNT = "500000000000000001";
const ALL = { read: true, write: true };

const baseConfig = (over = {}) => ({
    adminRoleIds: ["role-full"],
    categoryIds: [CAT_OWN, CAT_FOREIGN],
    categoryLanguage: { [CAT_OWN]: "de", [CAT_FOREIGN]: "en" },
    categoryRoles: { [CAT_OWN]: [ROLE_OWN], [CAT_FOREIGN]: [ROLE_FOREIGN] },
    categoryPlanning: { [CAT_FOREIGN]: "sheet" },
    categoryReminders: { [CAT_FOREIGN]: [] },
    anthropic: { apiKey: "anthropic-key" },
    warcraftlogsV2: { clientId: "wcl-id", clientSecret: "wcl-secret" },
    blizzard: { clientId: "blizzard-id", clientSecret: "blizzard-secret" },
    wclGuilds: { [FOREIGN]: "other-guild" },
    discordServers: {
        servers: [{ guildId: OWN, label: "Eigen" }, { guildId: FOREIGN, label: "Fremd", trusted: true }],
        links: [],
    },
    serverSettings: {
        [OWN]: { orgaRoleIds: [ROLE_OWN], officerRoleId: ROLE_OWN },
        [FOREIGN]: {
            orgaRoleIds: [ROLE_FOREIGN],
            officerRoleId: ROLE_FOREIGN,
            baseAccess: { raids: ALL },
            rolePermissions: { [ROLE_FOREIGN]: { settings: ALL } },
            userPermissions: { [ACCOUNT]: { raids: ALL } },
        },
    },
    ...over,
});

const member = (roleIds, administrator) => ({
    roles: { cache: { has: (id) => roleIds.includes(id), keys: () => roleIds[Symbol.iterator]() } },
    permissions: { has: () => administrator },
});

function guildOf(id, categoryId, textId, roleId, { adminOn, roleIds, ownRoleIds, stranger }) {
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
    guild.members.fetch = stranger
        ? jest.fn().mockRejectedValue(Object.assign(new Error("Unknown Member"), { code: 10007 }))
        : jest.fn().mockResolvedValue(member(id === OWN ? [...roleIds, ...ownRoleIds] : roleIds, adminOn.includes(id)));
    return guild;
}

async function login(id, { adminOn = [], roleIds = [], ownRoleIds = [], active = OWN, stranger = false } = {}) {
    const opts = { adminOn, roleIds, ownRoleIds, stranger };
    const guilds = [guildOf(OWN, CAT_OWN, TEXT_OWN, ROLE_OWN, opts), guildOf(FOREIGN, CAT_FOREIGN, TEXT_FOREIGN, ROLE_FOREIGN, opts)];
    discord.setClient(makeClient({ guilds, channels: guilds.flatMap((guild) => [...guild.channels.cache.values()]) }));
    axios.post.mockResolvedValue({ data: { access_token: "tok" } });
    axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
    const sid = await auth.completeLogin(`code-${id}`);
    const headers = { cookie: `sid=${sid}` };
    auth.setActiveGuild({ headers }, active);
    return { headers, csrf: auth.csrfToken({ headers }) };
}

const rank = (over = {}) => login("600000000000000001", { adminOn: [OWN], ...over });
const fullAdmin = () => login("600000000000000002", { roleIds: ["role-full"] });

async function send(session, method, target, body) {
    const url = new URL(`http://localhost${target}`);
    const req = jsonRequest(method, url.pathname, body, { ...session.headers, "x-csrf-token": session.csrf });
    const res = mockRes();
    await handle(url.pathname, req, res, url);
    return res;
}

let file;
const onDisk = () => fs.readFileSync(file, "utf8");
const stored = () => JSON.parse(onDisk());
const seed = (config) => fs.writeFileSync(file, JSON.stringify(config));
const patch = (session, body) => send(session, "PATCH", "/api/settings", { serverSettingsGuildId: OWN, ...body });

beforeEach(() => {
    jest.clearAllMocks();
    file = tempStoreFile("config.json");
    seed(baseConfig());
    configStore.useFile(file);
});

afterEach(() => discord.setClient(null));
afterAll(() => configStore.useFile(null));

describe("PATCH /api/settings as the server-admin rank: its rights, on the active server", () => {
    it.each([
        ["baseAccess", { raids: { read: true, write: false } }, { raids: { read: true, write: false } }],
        ["userPermissions", { [ACCOUNT]: { raids: ALL } }, { [ACCOUNT]: { raids: ALL } }],
        ["rolePermissions", { [ROLE_FREE]: { raids: ALL } }, { [ROLE_FREE]: { raids: ALL } }],
        ["orgaRoleIds", [ROLE_OWN, ROLE_FREE], [ROLE_OWN, ROLE_FREE]],
        ["botCommandAccess", { setup: { mode: "roles", roleIds: [ROLE_FREE] } }, { setup: { mode: "roles", roleIds: [ROLE_FREE] } }],
    ])("sets %s for its own server and leaves the other server alone", async (key, value, expected) => {
        const foreignBefore = stored().serverSettings[FOREIGN];
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(200);
        const after = stored();
        expect(after.serverSettings[OWN][key]).toEqual(expected);
        expect(after.serverSettings[FOREIGN]).toEqual(foreignBefore);
        expect(after[key]).toBeUndefined();
    });
});

describe("PATCH /api/settings as the rank: the other keys of its list", () => {
    it.each([
        ["applicationChannelId", TEXT_OWN],
        ["officerRoleId", ROLE_FREE],
        ["raidDefaults", { channelId: TEXT_OWN }],
        ["botLanguage", "en"],
        ["discordVisuals", { setupImage: false }],
        ["logChannels", [{ channelId: TEXT_OWN }]],
    ])("stores %s in its own block", async (key, value) => {
        const foreignBefore = stored().serverSettings[FOREIGN];
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(200);
        const after = stored();
        expect(after.serverSettings[OWN][key]).toBeDefined();
        expect(after.serverSettings[FOREIGN]).toEqual(foreignBefore);
    });

    it.each([
        ["categoryLanguage", { [CAT_OWN]: "en" }, "en"],
        ["categoryPlanning", { [CAT_OWN]: "sheet" }, "sheet"],
        ["categoryRoles", { [CAT_OWN]: [ROLE_FREE] }, [ROLE_FREE]],
    ])("changes %s of its own category and keeps the entry of the other server", async (key, value, expected) => {
        const foreignBefore = stored()[key][CAT_FOREIGN];
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(200);
        expect(stored()[key][CAT_OWN]).toEqual(expected);
        expect(stored()[key][CAT_FOREIGN]).toEqual(foreignBefore);
    });

    it("cannot change a category of the other server through a category map", async () => {
        const before = onDisk();
        const session = await rank();
        const res = await patch(session, { categoryLanguage: { [CAT_FOREIGN]: "de" } });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });

    it("keeps the other server's categories when it saves its active list", async () => {
        seed(baseConfig({ categoryVersion: { [CAT_OWN]: "tbc", [CAT_FOREIGN]: "tbc" } }));
        const res = await patch(await rank(), { categoryIds: [CAT_OWN, CAT_FREE], categoryVersion: { [CAT_OWN]: "tbc", [CAT_FREE]: "tbc" } });
        expect(status(res)).toBe(200);
        expect(stored().categoryIds).toEqual(expect.arrayContaining([CAT_OWN, CAT_FREE, CAT_FOREIGN]));
        expect(stored().categoryVersion).toEqual({ [CAT_OWN]: "tbc", [CAT_FREE]: "tbc", [CAT_FOREIGN]: "tbc" });
    });
});

describe("PATCH /api/settings as the rank: what stays with full admins", () => {
    const REFUSED = [
        ["adminRoleIds", [ROLE_FREE]],
        ["anthropic", { apiKey: "mine" }],
        ["warcraftlogsV2", { clientId: "mine", clientSecret: "mine" }],
        ["github", { token: "mine" }],
        ["twitch", { clientId: "mine" }],
        ["trustedServers", { [OWN]: true }],
        ["raidhelper", { apiKey: "mine" }],
        ["raidhelperServerId", OWN],
        ["wclGuilds", { [OWN]: "mine" }],
        ["blizzard", { clientId: "mine" }],
        ["mainVersion", "classic"],
        ["hideOtherVersions", true],
        ["versionSettings", { classic: { x: 1 } }],
        ["dungeonRecords", { post: true }],
        ["guildId", OWN],
        ["versionLaunch", {}],
        ["serverPlans", { [OWN]: "pro" }],
        ["plan", "pro"],
        ["discordServers", { servers: [{ guildId: OWN, trusted: true }] }],
        ["roleSync", []],
        ["addonDownloads", []],
        ["addonDownloadsReset", true],
        ["categoryReminders", {}],
        ["categoryEras", {}],
        ["aKeyNobodyHasDecidedYet", 1],
    ];

    it.each(REFUSED)("refuses %s alone and saves nothing", async (key, value) => {
        const before = onDisk();
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });

    it.each(REFUSED)("refuses %s beside an allowed key and saves neither", async (key, value) => {
        const before = onDisk();
        const res = await patch(await rank(), { baseAccess: { raids: ALL }, [key]: value });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });

    it.each(["botLanguage", "discordVisuals"])("refuses %s as null: that is a global default's way", async (key) => {
        const before = onDisk();
        const res = await patch(await rank(), { [key]: null });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });
});

describe("PATCH /api/settings as the rank: no other server", () => {
    it.each([
        ["a right", { baseAccess: { raids: ALL } }],
        ["a setting that is no right", { officerRoleId: ROLE_FREE }],
        ["its own server through the block", null],
    ])("refuses serverSettings naming %s", async (_label, block) => {
        const before = onDisk();
        const target = block === null ? OWN : FOREIGN;
        const res = await patch(await rank(), { serverSettings: { [target]: block || { baseAccess: { raids: ALL } } } });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });

    it("refuses the other server's block although it is admin there too and the tab names its own", async () => {
        const before = onDisk();
        const res = await patch(await rank({ adminOn: [OWN, FOREIGN] }), { serverSettings: { [FOREIGN]: { botLanguage: "en" } } });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });

    it("answers 409 when the tab shows another server than the active one", async () => {
        const before = onDisk();
        const res = await send(await rank({ adminOn: [OWN, FOREIGN] }), "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, baseAccess: { raids: ALL } });
        expect(status(res)).toBe(409);
        expect(onDisk()).toBe(before);
    });

    it("writes to the other server once the session is on it and it is admin there", async () => {
        const res = await send(await rank({ adminOn: [OWN, FOREIGN], active: FOREIGN }), "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, baseAccess: { raids: ALL, kader: ALL } });
        expect(status(res)).toBe(200);
        expect(stored().serverSettings[FOREIGN].baseAccess.kader).toEqual(ALL);
        expect(stored().serverSettings[OWN].baseAccess).toBeUndefined();
    });

    it("answers 409 to a tab without a server: a rank without a choice lands on a server it may enter", async () => {
        const before = onDisk();
        const session = await rank({ active: "" });
        for (const body of [{ baseAccess: { raids: ALL } }, { botLanguage: "en" }, { discordVisuals: { setupImage: false } }]) {
            const res = await send(session, "PATCH", "/api/settings", { serverSettingsGuildId: "", ...body });
            expect(status(res)).toBe(409);
        }
        expect(onDisk()).toBe(before);
    });

    it("has no rank and moves nothing global for an account on no server at all", async () => {
        const before = onDisk();
        const session = await rank({ active: "", stranger: true });
        for (const body of [{ baseAccess: { raids: ALL } }, { botLanguage: "en" }, { botLanguage: null }, { discordVisuals: { setupImage: false } }]) {
            const res = await send(session, "PATCH", "/api/settings", { serverSettingsGuildId: "", ...body });
            expect(status(res)).toBe(403);
        }
        expect(onDisk()).toBe(before);
    });

    it("has no rank on a server where it is no admin", async () => {
        const before = onDisk();
        const res = await send(await rank({ active: FOREIGN }), "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, baseAccess: { raids: ALL } });
        expect(status(res)).toBe(403);
        expect(onDisk()).toBe(before);
    });
});

describe("PATCH /api/settings as the rank: what its values may name", () => {
    it.each([
        ["orgaRoleIds", [ROLE_FOREIGN]],
        ["rolePermissions", { [ROLE_FOREIGN]: { raids: ALL } }],
        ["botCommandAccess", { setup: { mode: "roles", roleIds: [ROLE_FOREIGN] } }],
        ["officerRoleId", ROLE_FOREIGN],
        ["categoryRoles", { [CAT_OWN]: [ROLE_FOREIGN] }],
    ])("refuses a role of the other server in %s", async (key, value) => {
        const before = onDisk();
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("unknown_role");
        expect(onDisk()).toBe(before);
    });

    it.each([
        ["applicationChannelId", TEXT_FOREIGN],
        ["raidDefaults", { channelId: TEXT_FOREIGN }],
        ["logChannels", [{ channelId: TEXT_FOREIGN }]],
        ["categorySignupNoteChannel", { [CAT_OWN]: TEXT_FOREIGN }],
        ["categoryVoiceChannel", { [CAT_OWN]: TEXT_FOREIGN }],
    ])("refuses a channel of the other server in %s", async (key, value) => {
        const before = onDisk();
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(403);
        expect(dataOf(res).error.code).toBe("other_server");
        expect(onDisk()).toBe(before);
    });

    it("keeps accepting a role already stored, which may have been deleted on Discord since", async () => {
        const gone = "400000000000000009";
        seed(baseConfig({ serverSettings: { [OWN]: { orgaRoleIds: [gone] } } }));
        const res = await patch(await rank(), { orgaRoleIds: [gone, ROLE_FREE] });
        expect(status(res)).toBe(200);
        expect(stored().serverSettings[OWN].orgaRoleIds).toEqual([gone, ROLE_FREE]);
    });

    it("refuses an account that is no Discord id", async () => {
        const before = onDisk();
        const res = await patch(await rank(), { userPermissions: { "not-an-id": { raids: ALL } } });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("invalid_account");
        expect(onDisk()).toBe(before);
    });

    it("refuses lists past the limits", async () => {
        const before = onDisk();
        const session = await rank();
        const accounts = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [String(700000000000000000n + BigInt(i)), { raids: ALL }]));
        const roles = Array.from({ length: 251 }, () => ROLE_OWN).map((id, i) => `${id}${i}`);
        expect(dataOf(await patch(session, { userPermissions: accounts })).error.code).toBe("too_many");
        expect(dataOf(await patch(session, { orgaRoleIds: roles })).error.code).toBe("too_many");
        expect(dataOf(await patch(session, { categoryRoles: { [CAT_OWN]: roles } })).error.code).toBe("too_many");
        expect(onDisk()).toBe(before);
    });
});

describe("GET /api/settings as the rank", () => {
    it("shows the rights of the active server under canManageServerAccess, canManageAccess stays a full admin's", async () => {
        seed(baseConfig({ serverSettings: { ...baseConfig().serverSettings, [OWN]: { orgaRoleIds: [ROLE_OWN], baseAccess: { raids: ALL }, rolePermissions: { [ROLE_OWN]: { raids: ALL } }, userPermissions: { [ACCOUNT]: { raids: ALL } }, botCommandAccess: { setup: { mode: "everyone" } } } } }));
        const res = await send(await rank(), "GET", "/api/settings");
        expect(status(res)).toBe(200);
        const data = dataOf(res);
        expect(data.canManageAccess).toBe(false);
        expect(data.canManageServerAccess).toBe(true);
        expect(data.config.orgaRoleIds).toEqual([ROLE_OWN]);
        expect(data.config.baseAccess).toEqual(expect.objectContaining({ raids: ALL }));
        expect(data.config.rolePermissions).toEqual({ [ROLE_OWN]: { raids: ALL } });
        expect(data.config.userPermissions).toEqual({ [ACCOUNT]: { raids: ALL } });
        expect(data.config.botCommandAccess).toEqual(expect.objectContaining({ setup: expect.objectContaining({ mode: "everyone" }) }));
    });

    it("sees nothing global and nothing of the other server", async () => {
        const data = dataOf(await send(await rank(), "GET", "/api/settings"));
        for (const key of ["servers", "adminRoles", "roleOrigins", "raidhelper"]) expect(Object.keys(data[key] || {})).toEqual([]);
        for (const key of ["adminRoleIds", "anthropic", "warcraftlogsV2", "github", "twitch", "discordServers", "wclGuilds", "roleSync", "categoryReminders", "raidhelperServerId", "addonDownloads", "versionLaunch", "dungeonRecords", "guildId"]) {
            expect(data.config[key]).toBeUndefined();
        }
        expect(data.config.blizzard).toEqual({});
        expect(Object.keys(data.config.serverSettings || {})).not.toContain(FOREIGN);
        expect(data.otherServerCategoryIds).toEqual([]);
        expect(data.upcomingByVersion).toEqual({});

        const text = JSON.stringify(data);
        for (const secret of [ROLE_FOREIGN, CAT_FOREIGN, TEXT_FOREIGN, FOREIGN, ACCOUNT, "role-full", "anthropic-key", "wcl-secret", "wcl-id", "blizzard-id", "blizzard-secret", "other-guild"]) {
            expect(text).not.toContain(secret);
        }
    });

    it("answers a PATCH with the same narrow view, not the whole config", async () => {
        const data = dataOf(await patch(await rank(), { botLanguage: "en" }));
        expect(data.config.adminRoleIds).toBeUndefined();
        expect(data.config.discordServers).toBeUndefined();
        expect(data.otherServerCategoryIds).toEqual([]);
        const text = JSON.stringify(data);
        for (const secret of [ROLE_FOREIGN, CAT_FOREIGN, "role-full", "blizzard-id", "wcl-id"]) expect(text).not.toContain(secret);
    });
});

describe("what the rank sets does not reach past its server", () => {
    it("opens no shared data on an unmarked server: the shared route stays shut for the account it gave itself rights", async () => {
        const self = "600000000000000001";
        const session = await rank();
        const res = await patch(session, { userPermissions: { [self]: { settings: ALL, raids: ALL, recruitment: ALL } }, baseAccess: { settings: ALL } });
        expect(status(res)).toBe(200);
        const denied = await send(session, "POST", "/api/settings/raidsheets", { name: "x", url: "https://example.com" });
        expect(status(denied)).toBe(403);
        const guildAccess = { guilds: { [OWN]: { admin: false, administrator: true, access: { settings: ALL } } } };
        const shared = sharedDataAccess(guildAccess, self, configStore.getConfig());
        expect(shared.trustedOnly).toBe(true);
        expect(Object.values(shared.guilds[OWN].access).some((level) => level && (level.read || level.write))).toBe(false);
    });

    it("cannot raise itself to a full admin by naming a role in the rights keys", async () => {
        const session = await rank({ ownRoleIds: [ROLE_FREE] });
        const res = await patch(session, { rolePermissions: { [ROLE_FREE]: { settings: ALL } }, orgaRoleIds: [ROLE_FREE] });
        expect(status(res)).toBe(200);
        expect(stored().adminRoleIds).toEqual(["role-full"]);
        const again = await rank({ ownRoleIds: [ROLE_FREE] });
        expect(dataOf(await send(again, "GET", "/api/session")).user.isAdmin).toBeFalsy();
    });

    it("a rule it sets does not lift the lock on a command over shared data", async () => {
        const session = await rank();
        const res = await patch(session, { botCommandAccess: { recruitment: { mode: "everyone" } } });
        expect(status(res)).toBe(200);
        expect(stored().serverSettings[OWN].botCommandAccess.recruitment.mode).toBe("everyone");
        const reply = jest.fn();
        const allowed = await botAccess.guardInteraction({
            commandName: "recruitment",
            guildId: OWN,
            user: { id: ACCOUNT },
            member: member([], false),
            isChatInputCommand: () => true,
            isAutocomplete: () => false,
            replied: false,
            deferred: false,
            reply,
            locale: "de",
        }, { name: "recruitment", sharedData: true }, new Map([["recruitment", { name: "recruitment", sharedData: true }]]));
        expect(allowed).toBe(false);
        expect(reply).toHaveBeenCalled();
    });
});

describe("the others stay as they were", () => {
    it("a full admin still reads and writes everything", async () => {
        const session = await fullAdmin();
        const data = dataOf(await send(session, "GET", "/api/settings"));
        expect(data.canManageAccess).toBe(true);
        expect(data.canManageServerAccess).toBe(true);
        expect(data.config.adminRoleIds).toEqual(["role-full"]);
        expect(data.config.discordServers).toBeDefined();
        expect(data.config.blizzard.clientId).toBe("blizzard-id");
        expect(data.servers).toBeDefined();
        const res = await patch(session, { adminRoleIds: ["role-full", ROLE_FREE], wclGuilds: { [OWN]: "mine" }, orgaRoleIds: ["free-text-role"] });
        expect(status(res)).toBe(200);
        expect(stored().adminRoleIds).toEqual(["role-full", ROLE_FREE]);
        expect(stored().serverSettings[OWN].orgaRoleIds).toEqual(["free-text-role"]);
    });

    it("a full admin takes nothing along through a serverSettings block either: only the flat keys are saved", async () => {
        const foreignBefore = stored().serverSettings[FOREIGN];
        const res = await patch(await fullAdmin(), { serverSettings: { [FOREIGN]: { botLanguage: "en" } } });
        expect(status(res)).toBe(200);
        expect(stored().serverSettings[FOREIGN]).toEqual(foreignBefore);
    });

    describe("a role with settings write and no rank", () => {
        const roleUser = () => login("600000000000000003", { ownRoleIds: [ROLE_FREE] });
        beforeEach(() => seed(baseConfig({ serverSettings: { ...baseConfig().serverSettings, [OWN]: { rolePermissions: { [ROLE_FREE]: { settings: ALL } } } } })));

        it("reads what it read before, without the rights fields of the rank", async () => {
            const data = dataOf(await send(await roleUser(), "GET", "/api/settings"));
            expect(data.canManageAccess).toBe(false);
            expect(data.canManageServerAccess).toBe(false);
            for (const key of ["baseAccess", "userPermissions", "rolePermissions", "botCommandAccess", "orgaRoleIds", "adminRoleIds"]) {
                expect(data.config[key]).toBeUndefined();
            }
        });

        it.each([
            ["baseAccess", { raids: ALL }],
            ["userPermissions", { [ACCOUNT]: { raids: ALL } }],
            ["rolePermissions", { [ROLE_FREE]: { raids: ALL } }],
            ["orgaRoleIds", [ROLE_FREE]],
            ["botCommandAccess", { setup: { mode: "everyone" } }],
        ])("may not set %s", async (key, value) => {
            const before = onDisk();
            const res = await patch(await roleUser(), { [key]: value });
            expect(status(res)).toBe(403);
            expect(onDisk()).toBe(before);
        });

        it("still saves a server setting, without the rank's limits on what it names", async () => {
            const res = await patch(await roleUser(), { botLanguage: "en" });
            expect(status(res)).toBe(200);
            expect(stored().serverSettings[OWN].botLanguage).toBe("en");
        });
    });
});
