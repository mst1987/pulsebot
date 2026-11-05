// #1073 part B, section 2b: what the server-admin rank may read and write through the settings
// route. Through the real router, the real gate and the real config store: "nothing saved" means
// the file on disk did not change.
jest.mock("axios");
jest.mock("../../../src/config/variables", () => ({ discordClientId: "client-id-123", discordClientSecret: "secret-xyz", publicBaseUrl: "https://logs.example.com", logcheckAdminIds: [], adminRoleIds: [], guildId: "", devAutoLogin: false }));

const fs = require("fs");
const { ChannelType } = require("discord.js");
const axios = require("axios");
const configStore = require("../../../src/stores/settings/configStore");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const { SERVER_RANK_KEYS, SERVER_RIGHTS_KEYS } = require("../../../src/web/apiRoutes/system/settings");
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
    categoryReminders: { [CAT_FOREIGN]: { missingHours: 24, signedHours: 0 } },
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

const current = () => configStore.getConfig();

let ownRoster;
let foreignRoster;

beforeAll(() => rosterStore.useFile(tempStoreFile("rosters.json")));

beforeEach(() => {
    jest.clearAllMocks();
    file = tempStoreFile("config.json");
    seed(baseConfig());
    configStore.useFile(file);
    for (const roster of rosterStore.listRosters("")) rosterStore.deleteRoster(roster.id);
    const made = (input) => { const out = rosterStore.createRoster(input); return out.roster || out; };
    ownRoster = made({ guildId: OWN, name: "Eigen", categoryId: CAT_OWN, roleIds: [ROLE_OWN] });
    foreignRoster = made({ guildId: FOREIGN, name: "Fremd", categoryId: CAT_FOREIGN, roleIds: [ROLE_FOREIGN] });
});

afterEach(() => discord.setClient(null));
afterAll(() => {
    configStore.useFile(null);
    rosterStore.useFile(null);
});

describe("the rank's list", () => {
    it("is exactly this list: a new key is a decision, not a side effect", () => {
        expect([...SERVER_RIGHTS_KEYS]).toEqual(["baseAccess", "userPermissions", "rolePermissions", "botCommandAccess", "orgaRoleIds"]);
        expect([...SERVER_RANK_KEYS].sort()).toEqual([
            "baseAccess", "userPermissions", "rolePermissions", "botCommandAccess", "orgaRoleIds",
            "applicationChannelId", "officerRoleId", "raidDefaults", "botLanguage", "discordVisuals", "logChannels", "versionOverrides",
            "categoryIds", "categoryRoles", "categoryLootTool", "categoryLootSystem", "categorySignupSource", "categorySetupDms",
            "categoryLanguage", "categoryAttendance", "categoryDiscordEvent", "categoryServerOverview", "categoryVoiceChannel",
            "categoryTempVoice", "categoryMessageLook", "categoryAnnounce", "categorySignupNotes", "categorySignupNoteChannel",
            "categorySignupCharacters", "categorySheets", "categoryPlanning", "categoryRaidTemplate", "categoryVersion",
            "categoryReminders", "categorySwitchFixes", "serverSettingsGuildId",
        ].sort());
    });
});

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

    it.each([
        ["botLanguage", "en", "de"],
        ["discordVisuals", { setupImage: false }, { setupImage: true }],
    ])("takes %s as null back to the default for its own server only", async (key, own, global) => {
        seed(baseConfig({
            [key]: global,
            serverSettings: {
                ...baseConfig().serverSettings,
                [OWN]: { ...baseConfig().serverSettings[OWN], [key]: own },
                [FOREIGN]: { ...baseConfig().serverSettings[FOREIGN], [key]: own },
            },
        }));
        const globalBefore = current()[key];
        expect(globalBefore).toEqual(typeof global === "object" ? expect.objectContaining(global) : global);
        const res = await patch(await rank(), { [key]: null });
        expect(status(res)).toBe(200);
        const after = stored();
        expect(after.serverSettings[OWN][key]).toBeUndefined();
        expect(after.serverSettings[FOREIGN][key]).toEqual(own);
        expect(current()[key]).toEqual(globalBefore);
    });

    it("refuses null without an active server", async () => {
        const session = await rank();
        auth.setActiveGuild({ headers: session.headers }, "");
        const before = onDisk();
        const res = await send(session, "PATCH", "/api/settings", { botLanguage: null });
        expect(status(res)).toBeGreaterThanOrEqual(400);
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

    it("writes a setting to the other server once the session is on it and it is admin there", async () => {
        const res = await send(await rank({ adminOn: [OWN, FOREIGN], active: FOREIGN }), "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, botLanguage: "en" });
        expect(status(res)).toBe(200);
        expect(stored().serverSettings[FOREIGN].botLanguage).toBe("en");
        expect(stored().serverSettings[OWN].botLanguage).toBeUndefined();
    });

    describe("on a marked server: rights stay with full admins (decision A)", () => {
        const onForeign = () => rank({ adminOn: [OWN, FOREIGN], active: FOREIGN });
        const write = (session, body) => send(session, "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, ...body });

        it.each([
            ["baseAccess", { raids: ALL, kader: ALL }],
            ["userPermissions", { [ACCOUNT]: { settings: ALL } }],
            ["rolePermissions", { [ROLE_FOREIGN]: { raids: ALL } }],
            ["botCommandAccess", { setup: { mode: "everyone" } }],
            ["orgaRoleIds", [ROLE_FOREIGN]],
        ])("refuses %s alone and mixed, saving nothing", async (key, value) => {
            const before = onDisk();
            const session = await onForeign();
            expect(status(await write(session, { [key]: value }))).toBe(403);
            expect(status(await write(session, { botLanguage: "en", [key]: value }))).toBe(403);
            expect(onDisk()).toBe(before);
        });

        it("keeps the other keys of its list there", async () => {
            const res = await write(await onForeign(), { botLanguage: "en", categoryLanguage: { [CAT_FOREIGN]: "de" } });
            expect(status(res)).toBe(200);
            expect(stored().categoryLanguage[CAT_FOREIGN]).toBe("de");
        });

        it("does not show the rights there and says it may not manage them", async () => {
            const data = dataOf(await send(await onForeign(), "GET", "/api/settings"));
            expect(data.canManageServerAccess).toBe(false);
            for (const key of SERVER_RIGHTS_KEYS) expect(data.config[key]).toBeUndefined();
            expect(JSON.stringify(data)).not.toContain(ACCOUNT);
        });

        it("refuses the rights on a server missing from the list: only a surely unmarked server opens them", async () => {
            seed(baseConfig({ discordServers: { servers: [{ guildId: FOREIGN, label: "Fremd", trusted: true }], links: [] } }));
            const before = onDisk();
            const res = await patch(await rank(), { baseAccess: { raids: ALL } });
            expect(status(res)).toBe(403);
            expect(onDisk()).toBe(before);
        });

        it("refuses the rights when the server list cannot be read", async () => {
            seed(baseConfig({ discordServers: "broken" }));
            const before = onDisk();
            const res = await patch(await rank(), { baseAccess: { raids: ALL } });
            expect(status(res)).toBe(403);
            expect(onDisk()).toBe(before);
        });
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
        for (const key of ["adminRoleIds", "anthropic", "warcraftlogsV2", "github", "twitch", "discordServers", "wclGuilds", "roleSync", "raidhelperServerId", "addonDownloads", "versionLaunch", "dungeonRecords", "guildId"]) {
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

        it("still saves a server setting of its own server", async () => {
            const res = await patch(await roleUser(), { botLanguage: "en" });
            expect(status(res)).toBe(200);
            expect(stored().serverSettings[OWN].botLanguage).toBe("en");
        });
    });
});

// H: every category map of the list keeps the other server's entry, whatever the rank sends.
const CATEGORY_VALUES = [
    ["categoryRoles", [ROLE_FOREIGN], [ROLE_FREE]],
    ["categoryLootTool", "rclc", "gargul"],
    ["categoryLootSystem", "gdkp", "softres"],
    ["categorySignupSource", "eventhelper", "eventhelper"],
    ["categorySetupDms", true, true],
    ["categoryLanguage", "en", "en"],
    ["categoryAttendance", { show: false }, { show: false }],
    ["categoryDiscordEvent", true, true],
    ["categoryServerOverview", false, false],
    ["categoryTempVoice", { mode: "temp", leadMinutes: 15 }, { mode: "temp", leadMinutes: 15 }],
    ["categoryAnnounce", { enabled: true, target: "event" }, { enabled: true, target: "event" }],
    ["categorySignupNotes", "required", "none"],
    ["categorySignupNoteChannel", TEXT_FOREIGN, TEXT_OWN],
    ["categorySheets", { url: "https://docs.google.com/spreadsheets/d/fremd", name: "Fremd" }, { url: "https://docs.google.com/spreadsheets/d/eigen", name: "Eigen" }],
    ["categoryPlanning", "sheet", "sheet"],
    ["categoryReminders", { missingHours: 24, signedHours: 0 }, { missingHours: 12, signedHours: 0 }],
];
const CATEGORY_MAP_KEYS = [...SERVER_RANK_KEYS].filter((key) => key.startsWith("category") && key !== "categoryIds");

describe("PATCH /api/settings as the rank: each category map keeps the other server's entry", () => {
    it.each(CATEGORY_VALUES)("%s: an empty map keeps it", async (key, foreign) => {
        seed(baseConfig({ [key]: { [CAT_FOREIGN]: foreign } }));
        const before = current()[key][CAT_FOREIGN];
        const res = await patch(await rank(), { [key]: {} });
        expect(status(res)).toBe(200);
        expect(current()[key][CAT_FOREIGN]).toEqual(before);
    });

    it.each(CATEGORY_VALUES)("%s: a map of its own category keeps it", async (key, foreign, own) => {
        seed(baseConfig({ [key]: { [CAT_FOREIGN]: foreign } }));
        const before = current()[key][CAT_FOREIGN];
        const res = await patch(await rank(), { [key]: { [CAT_OWN]: own } });
        expect(status(res)).toBe(200);
        expect(current()[key][CAT_FOREIGN]).toEqual(before);
        expect(current()[key][CAT_OWN]).toBeDefined();
    });

    it("categoryVersion: an empty map is refused, a map of its own keeps the other entry", async () => {
        seed(baseConfig({ categoryVersion: { [CAT_OWN]: "tbc", [CAT_FOREIGN]: "tbc" } }));
        const session = await rank();
        expect(status(await patch(session, { categoryVersion: {} }))).toBe(400);
        expect(status(await patch(session, { categoryVersion: { [CAT_OWN]: "tbc" } }))).toBe(200);
        expect(current().categoryVersion[CAT_FOREIGN]).toBe("tbc");
    });

    it("lists every category map of the rank in the tables above", () => {
        const covered = new Set([...CATEGORY_VALUES.map(([key]) => key), "categoryVersion", "categorySwitchFixes", "categoryVoiceChannel", "categoryMessageLook", "categorySignupCharacters", "categoryRaidTemplate"]);
        expect(CATEGORY_MAP_KEYS.filter((key) => !covered.has(key))).toEqual([]);
    });
});

describe("PATCH /api/settings: a category map must be a map (B)", () => {
    it.each(CATEGORY_MAP_KEYS.flatMap((key) => [[key, null], [key, []]]))("%s as %p: 400 for the rank, nothing saved", async (key, value) => {
        const before = onDisk();
        const res = await patch(await rank(), { [key]: value });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("invalid_category_map");
        expect(onDisk()).toBe(before);
    });

    it.each([["categoryRoles", null], ["categoryRoles", []], ["categoryLanguage", null], ["categoryReminders", null]])("%s as %p: 400 for a full admin too", async (key, value) => {
        const before = onDisk();
        const res = await patch(await fullAdmin(), { [key]: value });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("invalid_category_map");
        expect(onDisk()).toBe(before);
    });

    it("categoryRoles null leaves every roster's roles alone", async () => {
        await patch(await rank(), { categoryRoles: null });
        await patch(await fullAdmin(), { categoryRoles: null });
        expect(rosterStore.getRoster(ownRoster.id).roleIds).toEqual([ROLE_OWN]);
        expect(rosterStore.getRoster(foreignRoster.id).roleIds).toEqual([ROLE_FOREIGN]);
    });

    it("a rank's roles reach only the roster of its own category", async () => {
        const res = await patch(await rank(), { categoryRoles: { [CAT_OWN]: [ROLE_FREE] } });
        expect(status(res)).toBe(200);
        expect(rosterStore.getRoster(ownRoster.id).roleIds).toEqual([ROLE_FREE]);
        expect(rosterStore.getRoster(foreignRoster.id).roleIds).toEqual([ROLE_FOREIGN]);
    });

    it("__proto__ inside a map neither crashes nor pollutes, at the top it is refused", async () => {
        const session = await rank();
        const inner = await patch(session, { categoryLanguage: JSON.parse("{\"__proto__\": {\"polluted\": 1}}") });
        expect(status(inner)).not.toBe(500);
        expect({}.polluted).toBeUndefined();
        const before = onDisk();
        const top = await send(session, "PATCH", "/api/settings", JSON.parse(`{"serverSettingsGuildId": "${OWN}", "__proto__": {"adminRoleIds": ["x"]}}`));
        expect(status(top)).toBe(403);
        expect(onDisk()).toBe(before);
        expect({}.adminRoleIds).toBeUndefined();
    });
});

describe("the category gates as the rank", () => {
    it("category-switch: a category of the other server is not found", async () => {
        const session = await rank();
        for (const version of ["tbc", "forever"]) {
            const res = await send(session, "GET", `/api/settings/category-switch?categoryId=${CAT_FOREIGN}&versionId=${version}`);
            expect(status(res)).toBe(404);
        }
    });

    it("category-close: the other server's category is not found, its own still there is a conflict", async () => {
        const session = await rank();
        expect(status(await send(session, "POST", "/api/settings/category-close", { categoryId: CAT_FOREIGN }))).toBe(404);
        expect(status(await send(session, "POST", "/api/settings/category-close", { categoryId: CAT_OWN }))).toBe(409);
        expect(current().categoryIds).toEqual(expect.arrayContaining([CAT_OWN, CAT_FOREIGN]));
    });

    it("category-deactivate: names nothing of the other server", async () => {
        const session = await rank();
        for (const guild of [OWN, FOREIGN]) {
            const res = await send(session, "GET", `/api/settings/category-deactivate?next=${CAT_OWN}&guild=${guild}`);
            expect(JSON.stringify(dataOf(res) || {})).not.toContain(CAT_FOREIGN);
        }
    });
});

describe("an account with settings through its server, without the rank (C)", () => {
    const viaRole = () => {
        seed(baseConfig({ serverSettings: { ...baseConfig().serverSettings, [OWN]: { rolePermissions: { [ROLE_FREE]: { settings: ALL } } } } }));
        return login("600000000000000003", { ownRoleIds: [ROLE_FREE] });
    };
    const viaBase = () => {
        seed(baseConfig({ serverSettings: { ...baseConfig().serverSettings, [OWN]: { baseAccess: { settings: ALL } } } }));
        return login("600000000000000004");
    };

    describe.each([["through rolePermissions", viaRole], ["through baseAccess", viaBase]])("%s on an unmarked server", (_label, enter) => {
        it("reads nothing of the other server and no rights", async () => {
            const data = dataOf(await send(await enter(), "GET", "/api/settings"));
            expect(data.canManageServerAccess).toBe(false);
            for (const key of ["baseAccess", "userPermissions", "rolePermissions", "botCommandAccess", "orgaRoleIds", "adminRoleIds", "wclGuilds", "raidhelperServerId", "discordServers"]) {
                expect(data.config[key]).toBeUndefined();
            }
            const text = JSON.stringify(data);
            for (const secret of [ROLE_FOREIGN, CAT_FOREIGN, TEXT_FOREIGN, ACCOUNT, "other-guild", "blizzard-secret", "wcl-secret"]) expect(text).not.toContain(secret);
        });

        it("keeps the other server's entry and roster when it saves its category roles", async () => {
            const session = await enter();
            expect(status(await patch(session, { categoryRoles: {} }))).toBe(200);
            expect(status(await patch(session, { categoryRoles: { [CAT_OWN]: [ROLE_FREE] } }))).toBe(200);
            expect(current().categoryRoles[CAT_FOREIGN]).toEqual([ROLE_FOREIGN]);
            expect(rosterStore.getRoster(foreignRoster.id).roleIds).toEqual([ROLE_FOREIGN]);
        });

        it.each([
            ["raidhelperServerId", OWN],
            ["wclGuilds", { [OWN]: "mine" }],
            ["baseAccess", { raids: ALL }],
            ["rolePermissions", { [ROLE_FREE]: { settings: ALL } }],
            ["categoryReminders", { [CAT_OWN]: { missingHours: 12, signedHours: 0 } }],
        ])("may not set %s", async (key, value) => {
            const session = await enter();
            const before = onDisk();
            expect(status(await patch(session, { [key]: value }))).toBe(403);
            expect(onDisk()).toBe(before);
        });

        it("may not name a category of the other server", async () => {
            const session = await enter();
            const before = onDisk();
            expect(status(await patch(session, { categoryLanguage: { [CAT_FOREIGN]: "de" } }))).toBe(403);
            expect(onDisk()).toBe(before);
        });
    });

    describe("the rank with a settings role on a marked server", () => {
        const both = () => rank({ adminOn: [FOREIGN], roleIds: [ROLE_FOREIGN], active: FOREIGN });
        const write = (session, body) => send(session, "PATCH", "/api/settings", { serverSettingsGuildId: FOREIGN, ...body });

        it("keeps what the role gave it before the rank existed", async () => {
            const res = await write(await both(), { wclGuilds: [{ versionId: "tbc", guildName: "Mine", realm: "Thunderstrike", region: "eu" }] });
            expect(status(res)).toBe(200);
            expect(stored().serverSettings[FOREIGN].wclGuilds).toEqual([expect.objectContaining({ guildName: "Mine" })]);
        });

        it("still does not reach the rights keys there", async () => {
            const before = onDisk();
            expect(status(await write(await both(), { baseAccess: { raids: ALL } }))).toBe(403);
            expect(onDisk()).toBe(before);
        });

        it("the rank alone there does not get the role's reach", async () => {
            const before = onDisk();
            const res = await write(await rank({ adminOn: [FOREIGN], active: FOREIGN }), { wclGuilds: { [FOREIGN]: "mine" } });
            expect(status(res)).toBe(403);
            expect(onDisk()).toBe(before);
        });
    });
});

describe("reminders of the rank's own server (D)", () => {
    it("GET /api/settings/reminders shows the rank only its own categories", async () => {
        seed(baseConfig({ categoryReminders: { [CAT_OWN]: { missingHours: 12, signedHours: 0 }, [CAT_FOREIGN]: { missingHours: 24, signedHours: 0 } } }));
        const res = await send(await rank(), "GET", "/api/settings/reminders");
        expect(status(res)).toBe(200);
        const data = dataOf(res);
        expect(Object.keys(data.categoryReminders)).toEqual([CAT_OWN]);
        expect(data.categories.map((c) => c.id)).toEqual([CAT_OWN]);
        expect(data.lastRun === null || Object.keys(data.lastRun).join() === "at").toBe(true);
        expect(JSON.stringify(data)).not.toContain(CAT_FOREIGN);
    });

    it("a full admin still sees every rule", async () => {
        seed(baseConfig({ categoryReminders: { [CAT_OWN]: { missingHours: 12, signedHours: 0 }, [CAT_FOREIGN]: { missingHours: 24, signedHours: 0 } } }));
        const data = dataOf(await send(await fullAdmin(), "GET", "/api/settings/reminders"));
        expect(Object.keys(data.categoryReminders).sort()).toEqual([CAT_OWN, CAT_FOREIGN].sort());
    });

    it("the rank sets its own rule and cannot touch the other server's", async () => {
        const session = await rank();
        expect(status(await patch(session, { categoryReminders: { [CAT_OWN]: { missingHours: 12, signedHours: 0 } } }))).toBe(200);
        expect(current().categoryReminders[CAT_OWN]).toBeDefined();
        expect(current().categoryReminders[CAT_FOREIGN]).toEqual({ missingHours: 24, signedHours: 0 });
        const before = onDisk();
        expect(status(await patch(session, { categoryReminders: { [CAT_FOREIGN]: { missingHours: 1, signedHours: 0 } } }))).toBe(403);
        expect(onDisk()).toBe(before);
    });
});

describe("other server's roles hidden in the switch fixes (F)", () => {
    it("refuses a role of the other server in categorySwitchFixes", async () => {
        const before = onDisk();
        const res = await patch(await rank(), { categorySwitchFixes: { [CAT_OWN]: { roster: { roleIds: [ROLE_FOREIGN] } } } });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("unknown_role");
        expect(onDisk()).toBe(before);
    });
});

describe("base access of an unmarked server counts only for its members (G)", () => {
    it("a stranger gets nothing through the base access the rank opened", async () => {
        expect(status(await patch(await rank(), { baseAccess: { signup: ALL, history: ALL } }))).toBe(200);
        const stranger = await login("600000000000000080", { stranger: true });
        for (const target of ["/api/addons", "/api/profile/sync-keys"]) {
            expect(status(await send(stranger, "GET", target))).not.toBe(200);
        }
    });
});

describe("small edges (I)", () => {
    it("answers 400 to a server id that is no string", async () => {
        const before = onDisk();
        const res = await send(await rank(), "PATCH", "/api/settings", { serverSettingsGuildId: 123, botLanguage: "en" });
        expect(status(res)).toBe(400);
        expect(dataOf(res).error.code).toBe("invalid_server");
        expect(onDisk()).toBe(before);
    });

    it("does not name the other server's categories when a version is missing", async () => {
        seed(baseConfig({ categoryVersion: { [CAT_OWN]: "tbc" } }));
        const res = await patch(await rank(), { categoryVersion: { [CAT_OWN]: "tbc" } });
        expect(status(res)).toBe(400);
        const message = dataOf(res).error.message;
        expect(message).toContain("eines anderen Servers");
        expect(message).not.toContain(CAT_FOREIGN);
    });
});
