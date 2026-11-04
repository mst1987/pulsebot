// #1074 end to end: real logins, the real session, the real router and the real gate.
// guildChoice.test.js has the rule itself; here the question is what it does to a person:
// no foreign server in the list or as the active one, no rights sliding onto one - and the
// ways that never needed a server (direct links, "Alle Server" pages) stay open.
jest.mock("axios");
jest.mock("http", () => {
    const fakeServer = { on: jest.fn(), listen: jest.fn() };
    return { __fakeServer: fakeServer, createServer: jest.fn(() => fakeServer) };
});
jest.mock("../../../src/config/variables", () => ({
    ...jest.requireActual("../../../src/config/variables"),
    discordClientId: "client-id-123",
    discordClientSecret: "secret-xyz",
    publicBaseUrl: "https://logs.example.com",
    logcheckAdminIds: ["9000"],
    adminRoleIds: [],
    guildId: "",
    devAutoLogin: false,
}));
jest.mock("../../../src/web/http/jobs", () => ({ startJobs: jest.fn(), stopJobs: jest.fn() }));
jest.mock("../../../src/web/http/staticClient", () => ({ serve: jest.fn(async () => true) }));
jest.mock("../../../src/web/pages/eventPublicPage", () => ({ renderEventPage: jest.fn(() => "EVENT_PAGE") }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/events/eventStore"),
    getEvent: jest.fn(() => null),
}));

const http = require("http");
const axios = require("axios");
const discord = require("../../../src/services/discord/discord");
const configStore = require("../../../src/stores/settings/configStore");
const eventStore = require("../../../src/stores/events/eventStore");
const eventPublicPage = require("../../../src/web/pages/eventPublicPage");
const staticClient = require("../../../src/web/http/staticClient");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const { startWebServer } = require("../../../src/web/http/server");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { jsonRequest, mockRes, status, body } = require("../../helpers/http");
const { makeClient, makeGuild, makeMember, discordError } = require("../../helpers/discordClient");

const ADMIN = "9000";
const MEMBER = "1001";
const STRANGER = "1002";
const GRANTED = "1003";

const OWN = "111111111111111111";
const FOREIGN = "222222222222222222";

const SIGNUP = { signup: { read: true, write: true } };
// base access on both servers, the foreign one with a tempting amount of it. The foreign one
// comes first: getConfig().guildId reports the first server, so it is the default server.
const CONFIG = {
    discordServers: { servers: [{ guildId: FOREIGN, kind: "event" }, { guildId: OWN, kind: "event" }], links: [] },
    serverSettings: {
        [OWN]: { baseAccess: SIGNUP },
        [FOREIGN]: {
            baseAccess: { ...SIGNUP, settings: { read: true, write: true }, channels: { read: true, write: true } },
            userPermissions: { [GRANTED]: { raids: { read: true, write: false } } },
        },
    },
};

/** The bot on both servers; only `MEMBER` is a member, of OWN. */
function botOnline(memberFetch) {
    const own = makeGuild({ id: OWN, name: "Eigener Server", members: [makeMember({ id: MEMBER })] });
    const foreign = makeGuild({ id: FOREIGN, name: "Fremder Server" });
    if (memberFetch) {
        own.members.fetch = memberFetch;
        foreign.members.fetch = memberFetch;
    } else {
        foreign.members.fetch = jest.fn(async () => { throw discordError("member"); });
    }
    discord.setClient(makeClient({ guilds: [own, foreign] }));
}

async function login(id) {
    axios.post.mockResolvedValue({ data: { access_token: "t" } });
    axios.get.mockResolvedValue({ data: { id, username: `u${id}` } });
    return auth.completeLogin(`code-${id}`);
}

/** One request through the real router, the way a browser with this session sends it. */
async function call(sid, method, path, { query, payload } = {}) {
    const req = jsonRequest(method, path, payload === undefined ? {} : payload, { cookie: `sid=${sid}` });
    req.headers["x-csrf-token"] = auth.csrfToken(req);
    const res = mockRes();
    await handle(path, req, res, new URL(`http://localhost${path}${query ? `?${new URLSearchParams(query)}` : ""}`));
    return res;
}

const reqOf = (sid) => ({ headers: { cookie: `sid=${sid}` } });
const session = async (sid) => body(await call(sid, "GET", "/api/session"));
const listed = async (sid) => (await session(sid)).guilds.map((g) => g.id);
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    jest.clearAllMocks();
    configStore.writeStored(CONFIG);
    botOnline();
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    jest.restoreAllMocks();
    discord.setClient(null);
});

describe("the servers a person gets to see (#1074)", () => {
    it("shows a member their server, not the foreign one", async () => {
        const sid = await login(MEMBER);
        const data = await session(sid);
        expect(data.guilds.map((g) => g.id)).toEqual([OWN]);
        expect(JSON.stringify(data)).not.toContain("Fremder Server");
        // the configured default is foreign to them: not the one they land on
        expect(data.activeGuildId).toBe(OWN);
    });

    it("lists nothing and activates nothing on the base access alone", async () => {
        const sid = await login(STRANGER);
        const data = await session(sid);
        expect(data.guilds).toEqual([]);
        expect(data.activeGuildId).toBe("");
        expect(JSON.stringify(data)).not.toContain("Fremder Server");
    });

    it("counts a grant of the person's own, without a membership", async () => {
        const sid = await login(GRANTED);
        expect(await listed(sid)).toEqual([FOREIGN]);
    });

    it("leaves a full admin every server of the bot", async () => {
        const sid = await login(ADMIN);
        const data = await session(sid);
        expect(data.guilds.map((g) => g.id).sort()).toEqual([OWN, FOREIGN]);
        expect(data.activeGuildId).toBe(FOREIGN);
    });
});

describe("switching the server (#1074)", () => {
    it("refuses a foreign server with 403 and leaves the choice alone", async () => {
        const sid = await login(MEMBER);
        const res = await call(sid, "POST", "/api/session/guild", { payload: { guildId: FOREIGN } });
        expect(status(res)).toBe(403);
        expect(body(res).error.code).toBe("other_server");
        expect((await session(sid)).activeGuildId).toBe(OWN);
    });

    it("refuses it on the base access alone", async () => {
        const sid = await login(STRANGER);
        expect(status(await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } }))).toBe(403);
        expect((await session(sid)).activeGuildId).toBe("");
    });

    it("lets a member switch to their own server", async () => {
        const sid = await login(MEMBER);
        expect(status(await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } }))).toBe(200);
        expect(auth.getActiveGuild(reqOf(sid))).toBe(OWN);
    });

    it("lets a full admin switch anywhere", async () => {
        const sid = await login(ADMIN);
        expect(status(await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } }))).toBe(200);
        expect((await session(sid)).activeGuildId).toBe(OWN);
    });

    it("falls back from a stale choice without overwriting it", async () => {
        const sid = await login(MEMBER);
        // what the session may have stored from before the rule, or from before leaving the server
        auth.setActiveGuild(reqOf(sid), FOREIGN);
        expect((await session(sid)).activeGuildId).toBe(OWN);
        expect(auth.getActiveGuild(reqOf(sid))).toBe(FOREIGN);
    });
});

describe("no rights slide onto a foreign server (#1074)", () => {
    // the foreign server hands settings and channels to everybody; without a way in they do not count
    it.each([
        ["GET", "/api/settings", undefined],
        ["PATCH", "/api/settings", { payload: { guildId: FOREIGN } }],
        ["GET", "/api/discord/overview", undefined],
        ["GET", "/api/discord/overview", { query: { guildId: FOREIGN } }],
        ["GET", "/api/discord/roles", { query: { guildId: FOREIGN } }],
        ["GET", "/api/signups", { query: { event: "eh-1" } }],
    ])("refuses %s %s %j to someone without an active server", async (method, path, options) => {
        const sid = await login(STRANGER);
        expect(activeGuildFor(reqOf(sid))).toBe("");
        expect(status(await call(sid, method, path, options))).toBe(403);
    });

    it("gives a member the rights of their own server, not the foreign one's, on a stale choice", async () => {
        const sid = await login(MEMBER);
        auth.setActiveGuild(reqOf(sid), FOREIGN);
        const user = auth.getUser(reqOf(sid));
        expect(user.guildId).toBe(OWN);
        expect(user.access.settings.read).toBe(false);
        expect(status(await call(sid, "GET", "/api/settings"))).toBe(403);
        expect(status(await call(sid, "GET", "/api/discord/roles", { query: { guildId: FOREIGN } }))).toBe(403);
    });
});

describe("the ways that need no server stay open (#1074)", () => {
    describe.each([["a member", MEMBER], ["someone without a server", STRANGER]])("for %s", (_name, id) => {
        it.each([
            ["/api/profile", undefined],
            ["/api/addons", undefined],
        ])("%s (under \"Alle Server\")", async (path, query) => {
            const sid = await login(id);
            expect(status(await call(sid, "GET", path, { query }))).toBe(200);
        });

        it.each([
            ["/api/raidplan/public", { token: "does-not-exist" }],
            ["/api/addons/name", { addon: "does-not-exist" }],
        ])("%s (no login needed) answers no 401 or 403", async (path, query) => {
            const sid = await login(id);
            expect([401, 403]).not.toContain(status(await call(sid, "GET", path, { query })));
        });
    });

    describe("direct links through the real web server", () => {
        // created once, and beforeEach clears the mock's calls: keep the handler
        startWebServer();
        const serve = http.createServer.mock.calls[0][0];

        const open = async (sid, url) => {
            const res = { ...mockRes(), headersSent: false, getHeader: jest.fn() };
            serve({ url, method: "GET", headers: { cookie: `sid=${sid}`, host: "localhost" } }, res);
            // the handler runs detached, the way node:http calls it
            for (let i = 0; i < 5; i++) await flush();
            return res;
        };

        it("opens /e/<id> without a server of one's own, knowing who looks", async () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", guildId: FOREIGN });
            const sid = await login(STRANGER);
            const res = await open(sid, "/e/eh-1");
            expect(status(res)).toBe(200);
            expect(eventPublicPage.renderEventPage.mock.calls[0][1].viewer).toEqual(expect.objectContaining({ loggedIn: true, userId: STRANGER }));
        });

        it("hands /p/<token> to the client without a server of one's own", async () => {
            const sid = await login(STRANGER);
            await open(sid, "/p/some-plan");
            expect(staticClient.serve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "/p/some-plan");
        });
    });
});

describe("\"Ansicht als Rolle\" stays as it was (#1074)", () => {
    it("keeps a full admin's list and active server while viewing with only the base access", async () => {
        const sid = await login(ADMIN);
        await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } });
        const before = await session(sid);

        auth.setViewAs(reqOf(sid), []);
        expect(auth.getUser(reqOf(sid)).isAdmin).toBe(false);
        expect(auth.getRealUser(reqOf(sid)).isAdmin).toBe(true);

        const during = await session(sid);
        expect(during.guilds.map((g) => g.id).sort()).toEqual(before.guilds.map((g) => g.id).sort());
        expect(during.activeGuildId).toBe(OWN);
        expect(during.user.viewAs).toBeDefined();
    });

    it("lets the viewing admin switch to a server the viewed role is not on", async () => {
        const sid = await login(ADMIN);
        auth.setViewAs(reqOf(sid), []);
        expect(status(await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } }))).toBe(200);
        expect((await session(sid)).activeGuildId).toBe(OWN);
    });
});

describe("Discord gives no answer (#1074)", () => {
    const outage = () => jest.fn(async () => { throw new Error("gateway timeout"); });

    it("never shows all servers after a login during an outage", async () => {
        botOnline(outage());
        const sid = await login(MEMBER);
        const data = await session(sid);
        expect(data.guilds).toEqual([]);
        expect(data.activeGuildId).toBe("");
    });

    it("still shows the server of a grant of one's own during an outage", async () => {
        botOnline(outage());
        const sid = await login(GRANTED);
        expect(await listed(sid)).toEqual([FOREIGN]);
    });

    it("does the same without a bot at all", async () => {
        discord.setClient(null);
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([]);
        expect((await session(sid)).activeGuildId).toBe("");
    });

    it("finds the server again once Discord answers, with no new login", async () => {
        botOnline(outage());
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([]);

        botOnline();
        const realNow = Date.now();
        jest.spyOn(Date, "now").mockReturnValue(realNow + auth.MEMBERSHIP_RETRY_MS + 1);
        expect(await listed(sid)).toEqual([OWN]);
        expect((await session(sid)).activeGuildId).toBe(OWN);
    });

    it("does not ask again before the retry time", async () => {
        const fetch = outage();
        botOnline(fetch);
        const sid = await login(MEMBER);
        const asked = fetch.mock.calls.length;
        await session(sid);
        await session(sid);
        expect(fetch.mock.calls.length).toBe(asked);
    });

    it("keeps the membership it knows when a later re-check gets no answer", async () => {
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([OWN]);

        botOnline(outage());
        const realNow = Date.now();
        jest.spyOn(Date, "now").mockReturnValue(realNow + 5 * 60 * 1000 + 1);
        await listed(sid); // sets off the re-check in the background
        await flush();
        expect(await listed(sid)).toEqual([OWN]);
        expect((await session(sid)).activeGuildId).toBe(OWN);
    });
});
