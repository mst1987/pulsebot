// The server-admin rank (#1072, docs/permissions.md) on a route marked `sharedData`, through the
// real router, the real gate, the real session (auth.js) and the real handler: such a route
// handles data of every server, so only the rights from roles count there - at the gate and at
// the handler's userIsOrga alike. Everywhere else the rank stays.
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
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settings/settingsStore"),
    getConfig: jest.fn(),
}));
jest.mock("../../../src/stores/roster/rosterHiddenStore", () => ({
    ...jest.requireActual("../../../src/stores/roster/rosterHiddenStore"),
    hide: jest.fn(() => ({ reason: "" })),
    unhide: jest.fn(() => true),
}));
jest.mock("../../../src/services/events/eventServer", () => ({
    ...jest.requireActual("../../../src/services/events/eventServer"),
    guildOfCategory: jest.fn(() => "guild-1"),
}));

const axios = require("axios");
const { getConfig } = require("../../../src/stores/settings/settingsStore");
const rosterHidden = require("../../../src/stores/roster/rosterHiddenStore");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const discord = require("../../../src/services/discord/discord");
const { makeClient, makeGuild } = require("../../helpers/discordClient");
const { json, jsonRequest, mockRes, status } = require("../../helpers/http");

const ROSTER_WRITE = { roster: { read: true, write: true } };
const CONFIG = {
    adminRoleIds: ["role-full"],
    discordServers: { servers: [{ guildId: "guild-1", label: "" }], links: [] },
    serverSettings: {
        "guild-1": {
            orgaRoleIds: ["role-orga"],
            rolePermissions: { "role-orga": ROSTER_WRITE, "role-area": ROSTER_WRITE },
        },
    },
};

const HIDE = "/api/roster/hide";
const HIDE_BODY = { character: "Elesham", hide: true };

/** A member of guild-1 with the given roles; `administrator` is the Discord right. */
const member = (roleIds, administrator) => ({
    roles: { cache: { has: (id) => roleIds.includes(id), keys: () => roleIds[Symbol.iterator]() } },
    permissions: { has: () => administrator },
});

async function login(id, roleIds, administrator) {
    const guild = makeGuild({ id: "guild-1" });
    guild.members.fetch = jest.fn().mockResolvedValue(member(roleIds, administrator));
    discord.setClient(makeClient({ guilds: [guild] }));
    axios.post.mockResolvedValue({ data: { access_token: "tok" } });
    axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
    const sid = await auth.completeLogin(`code-${id}`);
    const headers = { cookie: `sid=${sid}` };
    auth.setActiveGuild({ headers }, "guild-1");
    return { headers, csrf: auth.csrfToken({ headers }) };
}

async function send(session, method, pathname, { body, query = "" } = {}) {
    const req = jsonRequest(method, pathname, body, { ...session.headers, "x-csrf-token": session.csrf });
    const res = mockRes();
    await handle(pathname, req, res, new URL(`http://localhost${pathname}${query}`));
    return res;
}

describe("web/http/apiRouter: routes marked sharedData (#1072)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getConfig.mockReturnValue(CONFIG);
    });
    afterEach(() => discord.setClient(null));

    it("lets a Discord admin holding the orga role through, on the role's rights", async () => {
        const session = await login("901", ["role-orga"], true);
        const res = await send(session, "POST", HIDE, { body: HIDE_BODY });
        expect(status(res)).toBe(200);
        expect(rosterHidden.hide).toHaveBeenCalled();
    });

    it("refuses a Discord admin without any role at the gate", async () => {
        const session = await login("902", [], true);
        const res = await send(session, "POST", HIDE, { body: HIDE_BODY });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("forbidden");
        expect(rosterHidden.hide).not.toHaveBeenCalled();
    });

    it("stops a Discord admin with an area role but no orga role at the handler's userIsOrga", async () => {
        const session = await login("903", ["role-area"], true);
        const res = await send(session, "POST", HIDE, { body: HIDE_BODY });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("orga_only");
        expect(rosterHidden.hide).not.toHaveBeenCalled();
    });

    it("treats a member with the same role alike, with or without the Discord right", async () => {
        const res = await send(await login("904", ["role-orga"], false), "POST", HIDE, { body: HIDE_BODY });
        expect(status(res)).toBe(200);
    });

    it("leaves a full admin untouched", async () => {
        const res = await send(await login("905", ["role-full"], false), "POST", HIDE, { body: HIDE_BODY });
        expect(status(res)).toBe(200);
        expect(rosterHidden.hide).toHaveBeenCalled();
    });

    it("keeps the rank on a route without the mark", async () => {
        const session = await login("906", [], true);
        const res = await send(session, "GET", "/api/raider-characters", { query: "?category=cat-1" });
        expect(status(res)).toBe(200);
        // and the mark of one request does not stick to the session
        expect(status(await send(session, "POST", HIDE, { body: HIDE_BODY }))).toBe(403);
        expect(status(await send(session, "GET", "/api/raider-characters", { query: "?category=cat-1" }))).toBe(200);
    });
});
