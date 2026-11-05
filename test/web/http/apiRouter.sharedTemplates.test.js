// The sheet, call-out and recruitment templates are one list for every server until #1097 (#1073,
// docs/permissions.md), through the real router, the real gate and the real session. On a server
// without the mark only a full admin reaches them, and the server's own data stays open: its
// recruitment posts, channels and applications, for the base access and for a right of its own.
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
    listRaidsheets: jest.fn(() => [{ id: "s1", name: "Sheet", url: "https://example.com/sheet" }]),
    getRaidsheet: jest.fn(() => ({ id: "s1", name: "Sheet", url: "https://example.com/sheet" })),
    getNotify: jest.fn(() => ({ id: "n1", name: "Aufruf", content: "Komm" })),
    listRecruitment: jest.fn(() => [{ id: "t1", name: "Vorlage", content: "hi", versionId: "tbc" }]),
    getRecruitment: jest.fn(() => ({ id: "t1", name: "Vorlage", content: "hi", versionId: "tbc" })),
    listRecruitmentPosts: jest.fn(() => [
        { id: "own", guildId: "guild-1", channelId: "c1", messageId: "m1", templateId: "t1", versionId: "tbc" },
        { id: "other", guildId: "guild-2", channelId: "c2", messageId: "m2", templateId: "t1", versionId: "tbc" },
    ]),
    getRecruitmentPost: jest.fn((id) => ({
        own: { id: "own", guildId: "guild-1", channelId: "c1", messageId: "m1", templateId: "t1", versionId: "tbc" },
        other: { id: "other", guildId: "guild-2", channelId: "c2", messageId: "m2", templateId: "t1", versionId: "tbc" },
    })[id] || null),
}));

const axios = require("axios");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const auth = require("../../../src/web/http/auth");
const { handle } = require("../../../src/web/http/apiRouter");
const discord = require("../../../src/services/discord/discord");
const raidEventStore = require("../../../src/stores/events/raidEventStore");
const { makeClient, makeGuild } = require("../../helpers/discordClient");
const { json, jsonRequest, mockRes, status } = require("../../helpers/http");

const { getConfig } = settingsStore;

const ALL = { read: true, write: true };
const config = (trusted) => ({
    adminRoleIds: ["role-full"],
    discordServers: { servers: [{ guildId: "guild-1", label: "", trusted }], links: [] },
    serverSettings: {
        "guild-1": {
            orgaRoleIds: ["role-orga"],
            rolePermissions: {
                "role-orga": { raids: ALL, settings: ALL, recruitment: ALL },
                "role-recruit": { recruitment: ALL },
            },
        },
    },
});

const member = (roleIds, administrator) => ({
    roles: { cache: { has: (id) => roleIds.includes(id), keys: () => roleIds[Symbol.iterator]() } },
    permissions: { has: () => administrator },
});

async function login(id, roleIds, administrator = false) {
    const guild = makeGuild({ id: "guild-1" });
    guild.emojis = { cache: new Map() };
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

const USE = [
    ["/api/raids/notify", { event: "e1", templateId: "n1", channelId: "c1", roleIds: [] }],
    ["/api/raids/fill", { event: "e1", sheetId: "s1" }],
];

/** Posts from both templates; the handlers read them right behind the check. */
async function useTemplates(session) {
    const out = [];
    for (const [pathname, body] of USE) out.push(await send(session, "POST", pathname, { body }));
    return out;
}

/** The 403 of the template check itself: the gate in front of it says "forbidden" too. */
const expectClosed = (res) => {
    expect(status(res)).toBe(403);
    expect(json(res).error.message).toMatch(/Vorlagen/);
};

const expectBothRead = () => {
    expect(settingsStore.getNotify).toHaveBeenCalledWith("n1");
    expect(settingsStore.getRaidsheet).toHaveBeenCalledWith("s1");
};

describe("web/http/apiRouter: the templates of every server (#1073, until #1097)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getConfig.mockReset();
        getConfig.mockReturnValue(config(false));
        // the raid of USE belongs to the server: the gate lets it through to the handlers
        jest.spyOn(raidEventStore, "getRaidEvent").mockReturnValue({ id: "e1", guildId: "guild-1", categoryId: "" });
    });
    afterEach(() => {
        discord.setClient(null);
        raidEventStore.getRaidEvent.mockRestore();
    });

    describe("on a server without the mark", () => {
        it("GET /api/settings hands the orga and the server admin no sheet templates", async () => {
            for (const session of [await login("801", ["role-orga"]), await login("802", [], true)]) {
                const res = await send(session, "GET", "/api/settings");
                expect(status(res)).toBe(200);
                expect(json(res).data.raidsheets).toEqual([]);
            }
        });

        it("refuses using a template for the orga and the server admin", async () => {
            for (const session of [await login("803", ["role-orga"]), await login("804", [], true)]) {
                (await useTemplates(session)).forEach(expectClosed);
            }
            expect(settingsStore.getNotify).not.toHaveBeenCalled();
            expect(settingsStore.getRaidsheet).not.toHaveBeenCalled();
        });

        it("GET /api/recruitment keeps the server's own data and empties the templates", async () => {
            const sessions = { rank: await login("805", [], true), right: await login("806", ["role-recruit"]), orga: await login("807", ["role-orga"]) };
            for (const session of Object.values(sessions)) {
                const res = await send(session, "GET", "/api/recruitment", { query: "?edit=t1" });
                expect(status(res)).toBe(200);
                const { data } = json(res);
                expect(data.templatesAvailable).toBe(false);
                expect(data.templates).toEqual([]);
                expect(data.editing).toBeNull();
                expect(data.posts.map((p) => p.id)).toEqual(["own"]);
                expect(Array.isArray(data.channels)).toBe(true);
                expect(Array.isArray(data.targets)).toBe(true);
            }
        });

        it("GET /api/recruitment reads the server's applications for a right of its own", async () => {
            const listApplications = jest.spyOn(discord, "listApplications").mockResolvedValue({ applications: [], error: null });
            const res = await send(await login("808", ["role-recruit"]), "GET", "/api/recruitment", { query: "?view=applications" });
            expect(status(res)).toBe(200);
            expect(json(res).data.applications).toEqual([]);
            expect(listApplications).toHaveBeenCalled();
            listApplications.mockRestore();
        });

        it("GET /api/recruitment opens no post of another server", async () => {
            const session = await login("809", ["role-recruit"]);
            expect(status(await send(session, "GET", "/api/recruitment", { query: "?editpost=other" }))).toBe(404);
            const own = await send(session, "GET", "/api/recruitment", { query: "?editpost=own" });
            expect(status(own)).toBe(200);
            expect(json(own).data.editingPost.id).toBe("own");
        });

        it("keeps the marked routes closed to the roles", async () => {
            const session = await login("810", ["role-recruit"]);
            expect(status(await send(session, "POST", "/api/recruitment/post", { body: { templateId: "t1", channelId: "c1" } }))).toBe(403);
        });

        it("leaves a full admin untouched", async () => {
            const session = await login("811", ["role-full"]);
            expect(json(await send(session, "GET", "/api/settings")).data.raidsheets).toHaveLength(1);
            const { data } = json(await send(session, "GET", "/api/recruitment", { query: "?edit=t1" }));
            expect(data.templatesAvailable).toBe(true);
            expect(data.templates).toHaveLength(1);
            expect(data.editing.id).toBe("t1");
            await useTemplates(session);
            expectBothRead();
        });
    });

    describe("on a server with the mark", () => {
        beforeEach(() => getConfig.mockReturnValue(config(true)));

        it("the roles keep the templates as before", async () => {
            const session = await login("820", ["role-orga"]);
            expect(json(await send(session, "GET", "/api/settings")).data.raidsheets).toHaveLength(1);
            const { data } = json(await send(session, "GET", "/api/recruitment"));
            expect(data.templatesAvailable).toBe(true);
            expect(data.templates).toHaveLength(1);
            await useTemplates(session);
            expectBothRead();
        });

        it("the rank alone reaches no template, the server's own posts stay", async () => {
            const session = await login("821", [], true);
            expect(json(await send(session, "GET", "/api/settings")).data.raidsheets).toEqual([]);
            const { data } = json(await send(session, "GET", "/api/recruitment"));
            expect(data.templatesAvailable).toBe(false);
            expect(data.posts.map((p) => p.id)).toEqual(["own"]);
            (await useTemplates(session)).forEach(expectClosed);
        });
    });

    it("an unreadable mark closes the templates like a missing one", async () => {
        const session = await login("830", ["role-orga"]);
        // only the mark's own read fails: the rest of the configuration stays readable for the routes
        getConfig.mockReturnValue(Object.defineProperty(config(true), "discordServers", {
            get() {
                throw new Error("config unreadable");
            },
        }));
        const { data } = json(await send(session, "GET", "/api/recruitment"));
        expect(data.templatesAvailable).toBe(false);
        expect(data.templates).toEqual([]);
        (await useTemplates(session)).forEach(expectClosed);
    });
});
