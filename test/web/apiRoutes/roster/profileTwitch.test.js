// "Mein Profil › Twitch" through the real router: only one's own account, the id comes from
// the session, a request needs membership of that server, and it carries no role or channel.
let mockUser = null;
let mockConfig;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
    sessionGuildAccess: jest.fn(() => null),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1"), pickActiveGuild: jest.fn(async () => "g1") }));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn((partial) => {
        for (const [guildId, block] of Object.entries(partial.serverSettings || {})) {
            mockConfig.serverSettings[guildId] = { ...mockConfig.serverSettings[guildId], ...block };
        }
        return mockConfig;
    }),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    guildMembership: jest.fn(),
}));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({
    serverChoices: jest.fn(() => [
        { guildId: "g1", name: "Pulse", label: "", iconUrl: "http://icon/1" },
        { guildId: "g2", name: "PuGs", label: "", iconUrl: "" },
        { guildId: "g3", name: "", label: "Dritter", iconUrl: "" },
    ]),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const { routerClient, status, json } = require("../../../helpers/http");
const { emptyAccess } = require("../../../../src/config/permissions");
const discord = require("../../../../src/services/discord/discord");
const auth = require("../../../../src/web/http/auth");
const { checkCsrf } = auth;
const store = require("../../../../src/stores/discord/twitchRequestStore");
const { markApproved, fileRequest, rejectRequest } = require("../../../../src/services/twitch/twitchRequests");
const route = require("../../../../src/web/apiRoutes/roster/profileTwitch");

const api = routerClient(route);
const raiderAccess = () => ({ ...emptyAccess(), signup: { read: true, write: true } });
const ANNA = { id: "u1", name: "Anna", isAdmin: false, access: raiderAccess() };
const BERT = { id: "u2", name: "Bert", isAdmin: false, access: raiderAccess() };

const entry = (login, source = "raider") => ({ login, channelId: "111111", roleId: "", text: "", games: [], source });
const listOf = (guildId = "g1") => mockConfig.serverSettings[guildId].twitchStreamers;
const lineOf = (res, guildId) => json(res).data.servers.find((s) => s.guildId === guildId);

let members;

beforeEach(() => {
    store.useFile(tempStoreFile("twitch-requests.json"));
    mockConfig = {
        guildId: "",
        serverSettings: { g1: { twitchStreamers: [] }, g2: { twitchStreamers: [] }, g3: { twitchStreamers: [] } },
    };
    mockUser = ANNA;
    checkCsrf.mockReturnValue(true);
    members = { "g1:u1": true, "g2:u1": false, "g3:u1": null, "g1:u2": true, "g2:u2": true, "g3:u2": false };
    discord.guildMembership.mockReset().mockImplementation(async (guildId, userId) => members[`${guildId}:${userId}`]);
});
afterAll(() => store.useFile(null));

describe("the route table", () => {
    it("belongs to the page Profil with base access", () => {
        expect(route.routes.map((r) => `${r.method} ${r.path} ${r.area} ${r.scope}`)).toEqual([
            "GET /api/profile/twitch signup all",
            "POST /api/profile/twitch signup all",
            "POST /api/profile/twitch/withdraw signup all",
            "POST /api/profile/twitch/remove signup all",
        ]);
    });
});

describe("GET /api/profile/twitch", () => {
    it("shows only the servers one is a member of, and says when Discord cannot answer for one", async () => {
        const res = await api.get("/api/profile/twitch");
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual({
            servers: [
                { guildId: "g1", name: "Pulse", icon: "http://icon/1", status: "none", login: "", requestedAt: 0, decidedAt: 0 },
            ],
            lastLogin: "",
            unknown: true,
        });
    });

    it("never names a foreign server, not even while Discord is down", async () => {
        discord.guildMembership.mockReset().mockResolvedValue(null);
        const data = json(await api.get("/api/profile/twitch")).data;
        expect(data).toEqual({ servers: [], lastLogin: "", unknown: true });
        expect(JSON.stringify(data)).not.toMatch(/Pulse|PuGs|Dritter/);
    });

    it("keeps one's own line with a record while Discord cannot answer", async () => {
        fileRequest({ guildId: "g3", userId: "u1", userName: "Anna", login: "anna", now: 5 });
        const data = json(await api.get("/api/profile/twitch")).data;
        expect(data.servers.find((s) => s.guildId === "g3")).toMatchObject({ name: "Dritter", status: "pending", login: "anna" });
        // no line is missing then: g1 is yours, g2 Discord denied, g3 is shown
        expect(data.unknown).toBe(false);
    });

    it("an approved record whose entry is gone is no record: no line without membership", async () => {
        markApproved(fileRequest({ guildId: "g3", userId: "u1", userName: "Anna", login: "anna" }));
        const data = json(await api.get("/api/profile/twitch")).data;
        expect(data.servers.map((s) => s.guildId)).toEqual(["g1"]);
        expect(data.unknown).toBe(true);
    });

    it("has nothing to say when Discord answers for every server", async () => {
        members["g3:u1"] = true;
        const data = json(await api.get("/api/profile/twitch")).data;
        expect(data.servers.map((s) => s.guildId)).toEqual(["g1", "g3"]);
        expect(data.unknown).toBe(false);
    });

    it("a clear no is no gap", async () => {
        members["g3:u1"] = false;
        const data = json(await api.get("/api/profile/twitch")).data;
        expect(data.servers.map((s) => s.guildId)).toEqual(["g1"]);
        expect(data.unknown).toBe(false);
    });

    it("reads the list after the wait: a decision during the Discord round counts", async () => {
        markApproved(fileRequest({ guildId: "g1", userId: "u1", userName: "Anna", login: "anna" }));
        discord.guildMembership.mockImplementation(async (guildId) => {
            if (guildId === "g1") listOf().push(entry("anna"));
            return true;
        });
        expect(lineOf(await api.get("/api/profile/twitch"), "g1")).toMatchObject({ status: "approved", login: "anna" });
    });

    it("keeps a server one left while a record of one's own is there", async () => {
        fileRequest({ guildId: "g2", userId: "u1", userName: "Anna", login: "anna", now: 5 });
        const res = await api.get("/api/profile/twitch");
        expect(lineOf(res, "g2")).toMatchObject({ status: "pending", login: "anna", requestedAt: 5 });
    });

    it("never shows somebody else's request", async () => {
        fileRequest({ guildId: "g1", userId: "u2", userName: "Bert", login: "bert" });
        const res = await api.get("/api/profile/twitch");
        expect(lineOf(res, "g1")).toMatchObject({ status: "none", login: "" });
        expect(JSON.stringify(json(res))).not.toContain("bert");
    });

    it("ignores an id in the query", async () => {
        fileRequest({ guildId: "g1", userId: "u2", userName: "Bert", login: "bert" });
        const res = await api.get("/api/profile/twitch?userId=u2");
        expect(JSON.stringify(json(res))).not.toContain("bert");
    });

    it("offers the last name as the default", async () => {
        fileRequest({ guildId: "g1", userId: "u1", userName: "Anna", login: "alt", now: 1 });
        rejectRequest("g1", "u1");
        fileRequest({ guildId: "g3", userId: "u1", userName: "Anna", login: "neu", now: 2 });
        expect(json(await api.get("/api/profile/twitch")).data.lastLogin).toBe("neu");
    });

    it("shows an approved entry the orga removed as no entry", async () => {
        markApproved(fileRequest({ guildId: "g1", userId: "u1", userName: "Anna", login: "anna" }));
        const res = await api.get("/api/profile/twitch");
        expect(lineOf(res, "g1")).toMatchObject({ status: "none", login: "" });
    });

    it("refuses without a session", async () => {
        mockUser = null;
        expect(status(await api.get("/api/profile/twitch"))).toBe(401);
    });
});

describe("POST /api/profile/twitch", () => {
    it("files the request for the session's account and name", async () => {
        const res = await api.post("/api/profile/twitch", { guildId: "g1", login: "https://twitch.tv/Anna" });
        expect(status(res)).toBe(201);
        expect(lineOf(res, "g1")).toMatchObject({ status: "pending", login: "anna" });
        expect(store.requestOf("g1", "u1")).toMatchObject({ userId: "u1", userName: "Anna", status: "pending" });
    });

    it("takes neither account nor name nor status from the body", async () => {
        const res = await api.post("/api/profile/twitch", {
            guildId: "g1", login: "anna", userId: "u2", user: "u2", userName: "Bert", status: "approved", source: "orga",
        });
        expect(status(res)).toBe(201);
        expect(store.requestOf("g1", "u2")).toBeNull();
        expect(store.requestOf("g1", "u1")).toMatchObject({ userId: "u1", userName: "Anna", status: "pending" });
    });

    it("stores no role, channel or text a body brings", async () => {
        await api.post("/api/profile/twitch", { guildId: "g1", login: "anna", channelId: "111111", roleId: "222222", text: "@everyone" });
        expect(Object.keys(store.requestOf("g1", "u1")).sort()).toEqual(["decidedAt", "guildId", "login", "requestedAt", "status", "userId", "userName"]);
        expect(listOf()).toEqual([]);
    });

    it("refuses a server one is not a member of", async () => {
        const res = await api.post("/api/profile/twitch", { guildId: "g2", login: "anna" });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("not_member");
        expect(store.requestOf("g2", "u1")).toBeNull();
    });

    it("asks Discord about the session's account, not about one in the body", async () => {
        await api.post("/api/profile/twitch", { guildId: "g2", login: "anna", userId: "u2" });
        expect(discord.guildMembership).toHaveBeenCalledWith("g2", "u1");
        expect(discord.guildMembership).not.toHaveBeenCalledWith("g2", "u2");
    });

    it("fails closed when Discord cannot say", async () => {
        const res = await api.post("/api/profile/twitch", { guildId: "g3", login: "anna" });
        expect(status(res)).toBe(503);
        expect(json(res).error.code).toBe("member_unknown");
        expect(store.requestOf("g3", "u1")).toBeNull();
    });

    it("refuses a server that does not exist here, without asking Discord", async () => {
        const res = await api.post("/api/profile/twitch", { guildId: "g9", login: "anna" });
        expect(status(res)).toBe(404);
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });

    it("refuses a wrong name", async () => {
        const res = await api.post("/api/profile/twitch", { guildId: "g1", login: "twitch.tv/videos/123" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("invalid_login");
    });

    it("refuses a second open request and a listed login with 409", async () => {
        await api.post("/api/profile/twitch", { guildId: "g1", login: "anna" });
        const again = await api.post("/api/profile/twitch", { guildId: "g1", login: "zwei" });
        expect(status(again)).toBe(409);
        expect(json(again).error.code).toBe("already_open");

        mockUser = BERT;
        listOf().push(entry("frei", "orga"));
        const listed = await api.post("/api/profile/twitch", { guildId: "g1", login: "frei" });
        expect(status(listed)).toBe(409);
        expect(json(listed).error.code).toBe("already_listed");
    });

    it("refuses without CSRF", async () => {
        checkCsrf.mockReturnValue(false);
        const res = await api.post("/api/profile/twitch", { guildId: "g1", login: "anna" });
        expect(status(res)).toBe(403);
        expect(store.requestOf("g1", "u1")).toBeNull();
    });
});

describe("POST /api/profile/twitch/withdraw", () => {
    it("takes back one's own open request", async () => {
        fileRequest({ guildId: "g1", userId: "u1", userName: "Anna", login: "anna" });
        const res = await api.post("/api/profile/twitch/withdraw", { guildId: "g1" });
        expect(status(res)).toBe(200);
        expect(lineOf(res, "g1").status).toBe("none");
        expect(store.requestOf("g1", "u1")).toBeNull();
    });

    it("cannot reach somebody else's, whatever the body says", async () => {
        fileRequest({ guildId: "g1", userId: "u2", userName: "Bert", login: "bert" });
        const res = await api.post("/api/profile/twitch/withdraw", { guildId: "g1", userId: "u2" });
        expect(status(res)).toBe(404);
        expect(store.requestOf("g1", "u2").status).toBe("pending");
    });

    it("works on a server one has left", async () => {
        fileRequest({ guildId: "g2", userId: "u1", userName: "Anna", login: "anna" });
        expect(status(await api.post("/api/profile/twitch/withdraw", { guildId: "g2" }))).toBe(200);
    });

    it("refuses without CSRF", async () => {
        fileRequest({ guildId: "g1", userId: "u1", userName: "Anna", login: "anna" });
        checkCsrf.mockReturnValue(false);
        expect(status(await api.post("/api/profile/twitch/withdraw", { guildId: "g1" }))).toBe(403);
        expect(store.requestOf("g1", "u1")).not.toBeNull();
    });
});

describe("POST /api/profile/twitch/remove", () => {
    function approved(userId = "u1", login = "anna") {
        markApproved(fileRequest({ guildId: "g1", userId, userName: "x", login }));
        listOf().push(entry(login));
    }

    it("takes one's own entry off the list, the profile says no entry again", async () => {
        approved();
        listOf().push(entry("bleibt", "orga"));
        const res = await api.post("/api/profile/twitch/remove", { guildId: "g1" });
        expect(status(res)).toBe(200);
        expect(listOf().map((e) => e.login)).toEqual(["bleibt"]);
        expect(lineOf(res, "g1").status).toBe("none");
    });

    it("cannot reach somebody else's entry, whatever the body says", async () => {
        approved("u2", "bert");
        const res = await api.post("/api/profile/twitch/remove", { guildId: "g1", userId: "u2", login: "bert" });
        expect(status(res)).toBe(404);
        expect(listOf()).toHaveLength(1);
    });

    it("cannot reach an entry of the orga by naming it", async () => {
        listOf().push(entry("orga", "orga"));
        const res = await api.post("/api/profile/twitch/remove", { guildId: "g1", login: "orga" });
        expect(status(res)).toBe(404);
        expect(listOf()).toHaveLength(1);
    });

    it("refuses without CSRF", async () => {
        approved();
        checkCsrf.mockReturnValue(false);
        expect(status(await api.post("/api/profile/twitch/remove", { guildId: "g1" }))).toBe(403);
        expect(listOf()).toHaveLength(1);
    });
});
