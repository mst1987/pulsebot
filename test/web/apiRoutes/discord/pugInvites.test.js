// The settings routes of the invites per link (src/web/apiRoutes/discord/pugInvites.js, #905).
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: { id: "1" }, fullAdmin: () => mockFullAdmin }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/services/discord/discord", () => ({ getGuild: jest.fn(() => null), listTextChannels: jest.fn(() => []) }));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ links: jest.fn(), serverIds: jest.fn() }));
jest.mock("../../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const discord = require("../../../../src/services/discord/discord");
const guildRoles = require("../../../../src/services/discord/roles/guildRoles");
const eventStore = require("../../../../src/stores/eventStore");
const signupStore = require("../../../../src/stores/signupStore");
const inviteStore = require("../../../../src/stores/discordInviteStore");
const originStore = require("../../../../src/stores/memberOriginStore");
const pugInvites = require("../../../../src/services/discord/pug/pugInvites");
const { getPugInvites, postPugInvite, postInviteChannel, reconcileBriefly } = require("../../../../src/web/apiRoutes/discord/pugInvites");
const { AREA_BY_PATH } = require("../../../../src/web/http/apiAccess");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { mockRes, status, body } = require("../../../helpers/http");

let mockFullAdmin = { id: "1" };

const PUG = "900000000000000001";
const PARTNER = "900000000000000002";
const KEY = `${PUG}:${PARTNER}`;

beforeEach(() => {
    jest.clearAllMocks();
    mockFullAdmin = { id: "1" };
    inviteStore.useFile(tempStoreFile("discord-invites.json"));
    originStore.useFile(tempStoreFile("member-origins.json"));
    pugInvites.resetForTests();
    guildRoles.links.mockReturnValue([{ from: PUG, to: PARTNER }]);
    guildRoles.serverIds.mockReturnValue([PUG, PARTNER]);
});
afterAll(() => {
    inviteStore.useFile(null);
    originStore.useFile(null);
});

const call = async (handler, path) => {
    const res = mockRes();
    await handler({}, res, new URL(`http://x${path}`));
    return res;
};

describe("apiRoutes/pugInvites", () => {
    it("is gated as a settings path", () => {
        expect(AREA_BY_PATH["/api/settings/pug-invites"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/pug-invites/channel"]).toBe("settings");
    });

    it("GET answers per link with the invite, joined and signed up", async () => {
        inviteStore.setLinkInvite(KEY, { code: "abc" });
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000001", inviteCode: "abc", linkKey: KEY });
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000002", inviteCode: "abc", linkKey: KEY });
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000003" });
        eventStore.listEvents.mockReturnValue([{ id: "e1" }]);
        signupStore.listSignups.mockReturnValue([{ userId: "100000000000000002", status: "primary" }]);
        const res = await call(getPugInvites, "/api/settings/pug-invites");
        expect(body(res).links).toEqual([expect.objectContaining({
            key: KEY, url: "https://discord.gg/abc", joined: 2, signedUp: 1,
        })]);
        expect(body(res).servers.map((s) => s.guildId)).toEqual([PUG, PARTNER]);
    });

    it("POST creates or regenerates the invite of a known link", async () => {
        const ensure = jest.spyOn(pugInvites, "ensureLinkInvite").mockResolvedValue({});
        const regen = jest.spyOn(pugInvites, "regenerateLinkInvite").mockResolvedValue({});
        readJsonBody.mockResolvedValueOnce({ key: KEY });
        await call(postPugInvite, "/api/settings/pug-invites");
        expect(ensure).toHaveBeenCalledWith(KEY);
        readJsonBody.mockResolvedValueOnce({ key: KEY, regenerate: true });
        const res = await call(postPugInvite, "/api/settings/pug-invites");
        expect(regen).toHaveBeenCalledWith(KEY);
        expect(body(res).links).toHaveLength(1);
        ensure.mockRestore();
        regen.mockRestore();
    });

    it("POST handles a server's general invite", async () => {
        const regen = jest.spyOn(pugInvites, "regenerateGeneralInvite").mockResolvedValue({});
        readJsonBody.mockResolvedValueOnce({ guildId: PUG, regenerate: true });
        await call(postPugInvite, "/api/settings/pug-invites");
        expect(regen).toHaveBeenCalledWith(PUG);
        regen.mockRestore();
    });

    it("POST refuses an unknown link, an unknown server and an empty body", async () => {
        for (const payload of [{ key: "1:2" }, { guildId: "123" }, {}]) {
            readJsonBody.mockResolvedValueOnce(payload);
            const res = await call(postPugInvite, "/api/settings/pug-invites");
            expect(status(res)).toBe(400);
        }
    });

    it("POST channel stores a text channel of the server and refuses a foreign one", async () => {
        discord.listTextChannels.mockReturnValue([{ id: "300000000000000001", name: "willkommen" }]);
        readJsonBody.mockResolvedValueOnce({ guildId: PUG, channelId: "300000000000000001" });
        const res = await call(postInviteChannel, "/api/settings/pug-invites/channel");
        expect(body(res).servers[0].inviteChannelId).toBe("300000000000000001");

        readJsonBody.mockResolvedValueOnce({ guildId: PUG, channelId: "300000000000000099" });
        expect(status(await call(postInviteChannel, "/api/settings/pug-invites/channel"))).toBe(400);
        readJsonBody.mockResolvedValueOnce({ guildId: "123", channelId: "" });
        expect(status(await call(postInviteChannel, "/api/settings/pug-invites/channel"))).toBe(400);

        readJsonBody.mockResolvedValueOnce({ guildId: PUG, channelId: "" });
        const cleared = await call(postInviteChannel, "/api/settings/pug-invites/channel");
        expect(body(cleared).servers[0].inviteChannelId).toBe("");
    });

    it("GET checks the invites against Discord first and shows a deleted one", async () => {
        inviteStore.setLinkInvite(KEY, { code: "abc" });
        const fetch = jest.fn(async () => new Map());
        discord.getGuild.mockImplementation((id) => (id === PUG ? { id: PUG, invites: { fetch } } : null));
        const res = await call(getPugInvites, "/api/settings/pug-invites");
        expect(fetch).toHaveBeenCalled();
        expect(body(res).links[0]).toEqual(expect.objectContaining({ code: "abc", url: "", deleted: true }));
    });

    it("GET answers even when the check hangs", async () => {
        jest.useFakeTimers();
        const spy = jest.spyOn(pugInvites, "reconcileInvites").mockReturnValue(new Promise(() => {}));
        const pending = reconcileBriefly(50);
        jest.advanceTimersByTime(60);
        await expect(pending).resolves.toBeUndefined();
        spy.mockRestore();
        jest.useRealTimers();
    });

    it("refuses an account that is no full admin on GET and POST", async () => {
        mockFullAdmin = null;
        const ensure = jest.spyOn(pugInvites, "ensureLinkInvite");
        expect(status(await call(getPugInvites, "/api/settings/pug-invites"))).toBe(401);
        readJsonBody.mockResolvedValueOnce({ key: KEY });
        expect(status(await call(postPugInvite, "/api/settings/pug-invites"))).toBe(401);
        expect(ensure).not.toHaveBeenCalled();
        ensure.mockRestore();
    });
});
