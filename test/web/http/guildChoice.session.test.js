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
const signupStore = require("../../../src/stores/events/signupStore");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const eventPublicPage = require("../../../src/web/pages/eventPublicPage");
const staticClient = require("../../../src/web/http/staticClient");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const { startWebServer } = require("../../../src/web/http/server");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { _resetForTests: _resetRoleMemory } = require("../../../src/services/discord/roles/memberRoleMemory");
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
    categoryIds: [], // every category is an event category; the default names real ones
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
const FIVE_MINUTES = 5 * 60 * 1000 + 1;
const laterBy = (ms) => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now + ms);
};
/** CONFIG with rules for the Discord roles: a login then needs Discord's answer (answerRequired). */
const withRoleRules = () => ({
    ...CONFIG,
    serverSettings: { ...CONFIG.serverSettings, [OWN]: { ...CONFIG.serverSettings[OWN], rolePermissions: { 777: SIGNUP } } },
});

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

    it("keeps the known membership when only fetching the server fails, and stays open to a retry", async () => {
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([OWN]);

        // the bot's cache lost the server and Discord does not hand it out right now
        const client = makeClient({ guilds: [makeGuild({ id: FOREIGN, name: "Fremder Server" })] });
        client.guilds.fetch = jest.fn(async () => { throw new Error("temporary 503"); });
        discord.setClient(client);
        laterBy(FIVE_MINUTES);
        await listed(sid);
        await flush();

        const entry = auth.guildViewerOf(reqOf(sid)).guildAccess.guilds[OWN];
        expect(entry.membershipUnknown).toBe(true);
        expect(entry.isMember).toBe(true);
    });

    it("answers the same with role rules, where a login needs Discord's answer", async () => {
        configStore.writeStored(withRoleRules());
        botOnline(outage());
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([]);
        expect((await session(sid)).activeGuildId).toBe("");

        const granted = await login(GRANTED);
        expect(await listed(granted)).toEqual([FOREIGN]);
    });

    it("finds the server with role rules too once Discord answers again", async () => {
        configStore.writeStored(withRoleRules());
        botOnline(outage());
        const sid = await login(MEMBER);
        expect(await listed(sid)).toEqual([]);

        botOnline();
        laterBy(auth.MEMBERSHIP_RETRY_MS + 1);
        expect(await listed(sid)).toEqual([OWN]);
    });
});

describe("leaving a server (#1074)", () => {
    it.each([
        ["without role rules", () => CONFIG],
        ["with role rules", withRoleRules],
    ])("takes it off the list at the next re-check %s", async (_name, config) => {
        configStore.writeStored(config());
        const sid = await login(MEMBER);
        auth.setActiveGuild(reqOf(sid), OWN);
        expect(await listed(sid)).toEqual([OWN]);

        botOnline(jest.fn(async () => { throw discordError("member"); }));
        laterBy(FIVE_MINUTES);
        await listed(sid); // sets off the re-check in the background
        await flush();

        const after = await session(sid);
        expect(after.guilds).toEqual([]);
        expect(after.activeGuildId).toBe("");
    });
});

describe("a session from before the per-server rights (#1074)", () => {
    it("gets its servers on the first request instead of the base access of a foreign one", async () => {
        const fs = require("fs");
        const read = fs.readFileSync;
        // the session file of an older version: logged in, but neither rights nor memberships
        jest.spyOn(fs, "readFileSync").mockImplementation((file, ...rest) => (String(file).endsWith("sessions.json")
            ? JSON.stringify({ "old-session": { id: MEMBER, name: "Alt", createdAt: Date.now() } })
            : read(file, ...rest)));
        let fresh;
        let freshDiscord;
        let freshConfig;
        jest.isolateModules(() => {
            fresh = require("../../../src/web/http/auth");
            freshDiscord = require("../../../src/services/discord/discord");
            freshConfig = require("../../../src/stores/settings/configStore");
        });
        fs.readFileSync.mockRestore();
        freshConfig.writeStored(CONFIG);
        freshDiscord.setClient(makeClient({ guilds: [
            makeGuild({ id: OWN, name: "Eigener Server", members: [makeMember({ id: MEMBER })] }),
            makeGuild({ id: FOREIGN, name: "Fremder Server" }),
        ] }));

        const req = reqOf("old-session");
        expect(fresh.guildViewerOf(req).guildAccess.guilds).toEqual({});
        await fresh.ensureAccess(req);

        const { guilds } = fresh.guildViewerOf(req).guildAccess;
        expect(guilds[OWN].isMember).toBe(true);
        expect(guilds[FOREIGN].isMember).toBeFalsy();
        // and only once: the next request has nothing left to settle
        const asked = freshDiscord.getClient().guilds.fetch.mock.calls.length;
        await fresh.ensureAccess(req);
        expect(freshDiscord.getClient().guilds.fetch.mock.calls.length).toBe(asked);
    });
});

describe("the one raid behind a signup link (#1074)", () => {
    const BOTH = "1004"; // on both servers, so a signup of theirs can go through
    const FUTURE = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const NEW_CHARACTER = { newCharacter: { name: "Nerathil", spec: "Mage-Frost" }, status: "signed" };

    /** The bot on both servers, with `BOTH` on each of them. */
    function botOnBoth() {
        discord.setClient(makeClient({ guilds: [
            makeGuild({ id: OWN, name: "Eigener Server", members: [makeMember({ id: MEMBER }), makeMember({ id: BOTH })] }),
            makeGuild({ id: FOREIGN, name: "Fremder Server", members: [makeMember({ id: BOTH })] }),
        ] }));
    }

    const raidOn = (guildId, over = {}) => eventStore.createEvent({
        guildId, channelId: "555", channelName: "geheimer-kanal", title: "Karazhan", startTime: FUTURE, ...over,
    }).event;

    const openRaid = (sid, id) => call(sid, "GET", "/api/signups/raid", { query: { event: id } });
    const saveRaid = (sid, payload) => call(sid, "PUT", "/api/signups/raid", { payload });

    beforeEach(() => {
        eventStore.useFile(tempStoreFile("signup-link-events.json"));
        signupStore.useFile(tempStoreFile("signup-link-signups.json"));
        profiles.useFile(tempStoreFile("signup-link-profiles.json"));
        eventStore.getEvent.mockReset();
        eventStore.getEvent.mockImplementation(jest.requireActual("../../../src/stores/events/eventStore").getEvent);
    });

    describe("reading", () => {
        it("opens the raid for someone without an active server, and leaves them without one", async () => {
            const raid = raidOn(FOREIGN);
            const sid = await login(STRANGER);
            const res = await openRaid(sid, raid.id);
            expect(status(res)).toBe(200);
            expect(body(res).events.map((e) => e.id)).toEqual([raid.id]);
            const after = await session(sid);
            expect(after.activeGuildId).toBe("");
            expect(after.guilds).toEqual([]);
        });

        it("opens a raid of server A for a member of server B without switching", async () => {
            const raid = raidOn(FOREIGN);
            const sid = await login(MEMBER);
            expect(status(await openRaid(sid, raid.id))).toBe(200);
            const after = await session(sid);
            expect(after.activeGuildId).toBe(OWN);
            expect(after.guilds.map((g) => g.id)).toEqual([OWN]);
            expect(status(await call(sid, "POST", "/api/session/guild", { payload: { guildId: FOREIGN } }))).toBe(403);
        });

        it("answers with that raid only, nothing of the server around it", async () => {
            const raid = raidOn(FOREIGN);
            raidOn(FOREIGN, { title: "Gruul" });
            const sid = await login(MEMBER);
            const data = body(await openRaid(sid, raid.id));
            expect(data.events).toHaveLength(1);
            const text = JSON.stringify(data);
            expect(text).not.toContain("Gruul");
            expect(text).not.toContain("Fremder Server");
            expect(text).not.toContain("geheimer-kanal");
            expect(data.events[0].discordUrl).toBe("");
            expect(data.events[0].categoryId).toBe("");
            expect(data.canShowAll).toBe(false);
        });

        it("still refuses the signup page itself without a server", async () => {
            const raid = raidOn(FOREIGN);
            const sid = await login(STRANGER);
            expect(status(await call(sid, "GET", "/api/signups", { query: { event: raid.id } }))).toBe(403);
            expect(status(await call(sid, "GET", "/api/signups"))).toBe(403);
            expect(status(await call(sid, "PUT", "/api/signups", { payload: { eventId: raid.id, ...NEW_CHARACTER } }))).toBe(403);
        });

        it("wants a login", async () => {
            const raid = raidOn(FOREIGN);
            expect(status(await openRaid("no-such-session", raid.id))).toBe(401);
            expect(status(await saveRaid("no-such-session", { eventId: raid.id, ...NEW_CHARACTER }))).toBe(401);
        });
    });

    describe("refusals read the same, whatever the reason", () => {
        const withoutBase = () => ({
            ...CONFIG,
            serverSettings: { ...CONFIG.serverSettings, [FOREIGN]: { userPermissions: CONFIG.serverSettings[FOREIGN].userPermissions } },
        });

        it("answers an unknown raid and a raid of a server without base access alike", async () => {
            configStore.writeStored(withoutBase());
            const raid = raidOn(FOREIGN);
            const sid = await login(MEMBER);

            const closed = await openRaid(sid, raid.id);
            const unknown = await openRaid(sid, "eh-does-not-exist");
            expect(status(closed)).toBe(403);
            expect(body(closed).error.code).toBe("raid_unavailable");
            expect(status(unknown)).toBe(status(closed));
            expect(body(unknown)).toEqual(body(closed));

            const savedClosed = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            const savedUnknown = await saveRaid(sid, { eventId: "eh-does-not-exist", ...NEW_CHARACTER });
            expect(status(savedClosed)).toBe(403);
            expect(body(savedClosed)).toEqual(body(closed));
            expect(body(savedUnknown)).toEqual(body(closed));
        });

        it("answers no raid named at all the same way", async () => {
            const sid = await login(MEMBER);
            const res = await call(sid, "GET", "/api/signups/raid");
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("raid_unavailable");
        });

        it("answers a Raid-Helper id the same way: only own events have a signup here", async () => {
            const sid = await login(MEMBER);
            const res = await openRaid(sid, "1234567890");
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("raid_unavailable");
        });

        it("counts a grant of one's own on a server without base access", async () => {
            configStore.writeStored({
                ...CONFIG,
                serverSettings: { ...CONFIG.serverSettings, [FOREIGN]: { userPermissions: { [STRANGER]: SIGNUP } } },
            });
            const raid = raidOn(FOREIGN);
            const sid = await login(STRANGER);
            expect(status(await openRaid(sid, raid.id))).toBe(200);
        });
    });

    describe("the rules of the raid's server", () => {
        it("hides a raid of a category with raider roles from someone without them", async () => {
            configStore.writeStored({ ...CONFIG, categoryRoles: { 777: ["888"] } });
            const raid = raidOn(FOREIGN, { categoryId: "777" });
            const sid = await login(MEMBER);
            const res = await openRaid(sid, raid.id);
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("raid_unavailable");
            // the category is what refuses: the same person opens a raid of a category without roles
            expect(status(await openRaid(sid, raidOn(FOREIGN, { categoryId: "778" }).id))).toBe(200);
        });

        it("keeps the PuG rule: a non-member gets the hint and no signup", async () => {
            const raid = raidOn(FOREIGN);
            const sid = await login(MEMBER);

            const [row] = body(await openRaid(sid, raid.id)).events;
            expect(row.membersOnly).toBe(true);
            expect(row).toHaveProperty("inviteUrl");

            const res = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("pug_members_only");
            expect(body(res).error).toHaveProperty("inviteUrl");
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        });

        it("lets a holder of a signup change it without being a member", async () => {
            const raid = raidOn(FOREIGN);
            botOnBoth();
            const sid = await login(BOTH);
            expect(status(await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER }))).toBe(200);

            // has left the server since, the signup stays theirs
            botOnline();
            expect(status(await saveRaid(sid, { eventId: raid.id, character: "Nerathil", spec: "Mage-Frost", status: "absence" }))).toBe(200);
            expect(signupStore.listSignups(raid.id).map((s) => s.status)).toEqual(["absence"]);
        });
    });

    describe("writing", () => {
        it("saves the caller's own signup with another server active, and only that", async () => {
            const raid = raidOn(FOREIGN);
            raidOn(FOREIGN, { title: "Gruul" });
            botOnBoth();
            const sid = await login(BOTH);
            await call(sid, "POST", "/api/session/guild", { payload: { guildId: OWN } });

            const res = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(res)).toBe(200);
            expect(signupStore.listSignups(raid.id).map((s) => s.userId)).toEqual([BOTH]);
            expect(auth.getActiveGuild(reqOf(sid))).toBe(OWN);
        });

        it("ignores an account named in the body", async () => {
            const raid = raidOn(FOREIGN);
            botOnBoth();
            const sid = await login(BOTH);
            const res = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER, userId: STRANGER, discordId: STRANGER, user: { id: STRANGER } });
            expect(status(res)).toBe(200);
            expect(signupStore.listSignups(raid.id).map((s) => s.userId)).toEqual([BOTH]);
        });

        it("wants the CSRF token", async () => {
            const raid = raidOn(FOREIGN);
            botOnBoth();
            const sid = await login(BOTH);
            const req = jsonRequest("PUT", "/api/signups/raid", { eventId: raid.id, ...NEW_CHARACTER }, { cookie: `sid=${sid}` });
            const res = mockRes();
            await handle("/api/signups/raid", req, res, new URL("http://localhost/api/signups/raid"));
            expect(status(res)).toBe(403);
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        });

        it("signs up for the first raid when the link names a further raid of a group", async () => {
            const first = raidOn(FOREIGN);
            eventStore.updateEvent(first.id, { raidGroupId: first.id, raidGroupIndex: 1 });
            const further = raidOn(FOREIGN, { title: "Karazhan 2", raidGroupId: first.id, raidGroupIndex: 2 });
            botOnBoth();
            const sid = await login(BOTH);

            expect(body(await openRaid(sid, further.id)).events.map((e) => e.id)).toEqual([first.id]);
            expect(status(await saveRaid(sid, { eventId: further.id, ...NEW_CHARACTER }))).toBe(200);
            expect(signupStore.listSignups(first.id).map((s) => s.userId)).toEqual([BOTH]);
            expect(signupStore.listSignups(further.id)).toEqual([]);
        });

        it("refuses a body that names nothing", async () => {
            const sid = await login(BOTH);
            const res = await saveRaid(sid, null);
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("raid_unavailable");
        });

        it("reads with read alone, and saves only with write", async () => {
            configStore.writeStored({
                ...CONFIG,
                serverSettings: { ...CONFIG.serverSettings, [FOREIGN]: { baseAccess: { signup: { read: true, write: false } } } },
            });
            const raid = raidOn(FOREIGN);
            const sid = await login(BOTH);
            expect(status(await openRaid(sid, raid.id))).toBe(200);
            const res = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("raid_unavailable");
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        });

        it("never names wish partners", async () => {
            const raid = raidOn(FOREIGN);
            const sid = await login(MEMBER);
            expect(body(await openRaid(sid, raid.id)).events[0].wishPartners).toEqual([]);
        });
    });

    describe("a raid of a hidden game version", () => {
        it("answers archived to reading and to saving", async () => {
            configStore.writeStored({ ...CONFIG, mainVersion: "forever", hideOtherVersions: true });
            const raid = raidOn(FOREIGN, { versionId: "tbc" });
            botOnBoth();
            const sid = await login(BOTH);
            const read = await openRaid(sid, raid.id);
            expect(status(read)).toBe(409);
            expect(body(read).error.code).toBe("archived");
            const saved = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(saved)).toBe(409);
            expect(body(saved).error.code).toBe("archived");
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        });
    });

    // One rule for reading and saving: own signup, orga, or a category they may sign up for.
    // Unknown roles refuse here, unlike checkRaiderRole on the ordinary route.
    describe("who a raid shows to", () => {
        const ROLE_CATEGORY = "777";
        const ROLE = "888";
        const withRoles = (over = {}) => configStore.writeStored({ ...CONFIG, categoryRoles: { [ROLE_CATEGORY]: [ROLE] }, ...over });
        const failing = () => jest.fn(async () => { throw new Error("gateway timeout"); });

        /** Reading and saving both get the one refusal, and nothing lands. */
        async function expectHidden(sid, raid) {
            const read = await openRaid(sid, raid.id);
            expect(status(read)).toBe(403);
            expect(body(read).error.code).toBe("raid_unavailable");
            const saved = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(saved)).toBe(403);
            expect(body(saved)).toEqual(body(read));
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        }

        beforeEach(() => {
            _resetRoleMemory();
            withRoles();
        });

        it("hides a role category from a non-member", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            await expectHidden(await login(STRANGER), raid);
        });

        it("hides a role category when Discord does not answer", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            const sid = await login(STRANGER);
            botOnline(failing());
            await expectHidden(sid, raid);
        });

        it("hides a role category without a bot", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            const sid = await login(STRANGER);
            discord.setClient(null);
            await expectHidden(sid, raid);
        });

        it("hides a role category of a server the bot is not on", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            const sid = await login(STRANGER);
            discord.setClient(makeClient({ guilds: [makeGuild({ id: OWN })] }));
            await expectHidden(sid, raid);
        });

        it("hides a category outside the server's event categories", async () => {
            withRoles({ categoryIds: ["778"] });
            const raid = raidOn(FOREIGN, { categoryId: "779" });
            await expectHidden(await login(STRANGER), raid);
        });

        it("waits for the roles only as long as the page may", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            const sid = await login(STRANGER);
            const read = jest.spyOn(discord, "memberRoleIds").mockResolvedValue(null);
            await expectHidden(sid, raid);
            expect(read).toHaveBeenCalledWith(FOREIGN, STRANGER, { waitMs: discord.NAME_FETCH_MS });
            read.mockRestore();
        });

        it("shows it to a holder of the role, who may save", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            discord.setClient(makeClient({ guilds: [
                makeGuild({ id: OWN }),
                makeGuild({ id: FOREIGN, members: [makeMember({ id: BOTH, roleIds: [ROLE] })] }),
            ] }));
            const sid = await login(BOTH);
            expect(status(await openRaid(sid, raid.id))).toBe(200);
            expect(status(await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER }))).toBe(200);
        });

        it("keeps it open for whoever holds a signup, also during an outage", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            discord.setClient(makeClient({ guilds: [
                makeGuild({ id: OWN }),
                makeGuild({ id: FOREIGN, members: [makeMember({ id: BOTH, roleIds: [ROLE] })] }),
            ] }));
            const sid = await login(BOTH);
            expect(status(await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER }))).toBe(200);

            _resetRoleMemory();
            botOnline(failing());
            expect(status(await openRaid(sid, raid.id))).toBe(200);
            expect(status(await saveRaid(sid, { eventId: raid.id, character: "Nerathil", spec: "Mage-Frost", status: "absence" }))).toBe(200);
            expect(signupStore.listSignups(raid.id).map((s) => s.status)).toEqual(["absence"]);
        });

        it("keeps it open for the orga, who sees why the button is off", async () => {
            const raid = raidOn(FOREIGN, { categoryId: ROLE_CATEGORY });
            const sid = await login(ADMIN);
            botOnline(failing());
            expect(status(await openRaid(sid, raid.id))).toBe(200);
        });

        it("tells a member of the server that their roles could not be read", async () => {
            const raid = raidOn(OWN, { categoryId: ROLE_CATEGORY });
            const sid = await login(MEMBER);
            _resetRoleMemory();
            // a member the bot does not hold in its cache, or the fetch would never be asked
            const own = makeGuild({ id: OWN, name: "Eigener Server" });
            own.members.fetch = failing();
            discord.setClient(makeClient({ guilds: [own] }));
            const read = await openRaid(sid, raid.id);
            expect(status(read)).toBe(503);
            expect(body(read).error.code).toBe("raid_roles_unknown");
            const saved = await saveRaid(sid, { eventId: raid.id, ...NEW_CHARACTER });
            expect(status(saved)).toBe(503);
            expect(signupStore.listSignups(raid.id)).toEqual([]);
        });

        it("refuses a member who surely holds no role", async () => {
            const raid = raidOn(OWN, { categoryId: ROLE_CATEGORY });
            await expectHidden(await login(MEMBER), raid);
        });
    });
});
