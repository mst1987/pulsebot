// The Orga-Zentrale's API (src/web/apiRoutes/orgaHub.js) through the real router:
// list, post and remove a category's hub, gated by the area `settings`.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../src/services/events/orgaHub", () => ({ postHub: jest.fn(), removeHub: jest.fn(), saveLinks: jest.fn(), saveFeatures: jest.fn() }));
let mockActive = "";
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => mockActive }));
let mockClient = null;
jest.mock("../../../src/services/discord/discord", () => ({ getClient: () => mockClient }));

const orgaHub = require("../../../src/services/events/orgaHub");
const store = require("../../../src/stores/orgaHubStore");
const route = require("../../../src/web/apiRoutes/orgaHub");
const { emptyAccess } = require("../../../src/config/permissions");
const { tempStoreFile } = require("../../helpers/tempStore");
const { routerClient, status, body } = require("../../helpers/http");

const { get, post, request } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const withSettings = (write) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write } } });

beforeAll(() => store.useFile(tempStoreFile("orga-hubs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    for (const h of store.listHubs()) store.removeHub(h.categoryId);
    mockUser = ADMIN;
    mockActive = "";
    mockClient = null;
});

describe("apiRoutes/orgaHub", () => {
    // the link stays empty while the bot has not confirmed the message (linkCheck.messageLink)
    it("lists the posted hubs", async () => {
        store.setHub({ categoryId: "cat1", guildId: "123456789012345678", channelId: "223456789012345678", messageId: "323456789012345678" }, { now: 5 });
        const res = await get("/api/orga-hubs");
        expect(status(res)).toBe(200);
        expect(body(res).hubs).toEqual([{
            categoryId: "cat1", channelId: "223456789012345678", postedAt: 5,
            url: "",
        }]);
    });

    it("posts a hub and answers its view", async () => {
        orgaHub.postHub.mockResolvedValue({ hub: { categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedAt: 6 }, url: "https://discord.com/channels/g/c2/m2" });
        const res = await post("/api/orga-hub", { categoryId: "cat1", channelId: "c2" });
        expect(status(res)).toBe(200);
        expect(orgaHub.postHub).toHaveBeenCalledWith({ categoryId: "cat1", channelId: "c2", by: "1" });
        expect(body(res).hub).toEqual({ categoryId: "cat1", channelId: "c2", postedAt: 6, url: "https://discord.com/channels/g/c2/m2" });
    });

    it("answers a refused post with 400", async () => {
        orgaHub.postHub.mockResolvedValue({ error: "Kein Kanal gewählt." });
        const res = await post("/api/orga-hub", { categoryId: "cat1" });
        expect(status(res)).toBe(400);
    });

    it("removes a hub, 404 when there is none", async () => {
        orgaHub.removeHub.mockResolvedValueOnce({ categoryId: "cat1" }).mockResolvedValueOnce(null);
        const ok = await request("DELETE", "/api/orga-hub", { categoryId: "cat1" });
        expect(body(ok)).toEqual({ categoryId: "cat1" });
        expect(orgaHub.removeHub).toHaveBeenCalledWith("cat1");
        expect(status(await request("DELETE", "/api/orga-hub", { categoryId: "cat1" }))).toBe(404);
    });

    it("lists every category's orga links with the limit next to the hubs", async () => {
        store.setLinks("cat1", [{ label: "WCL", url: "https://wcl.example/x" }]);
        const res = await get("/api/orga-hubs");
        expect(body(res).links).toEqual({ cat1: [{ label: "WCL", url: "https://wcl.example/x" }] });
        expect(body(res).maxLinks).toBe(5);
        store.setLinks("cat1", []);
    });

    it("replaces a category's links through the hub service (which redraws)", async () => {
        const links = [{ label: "WCL", url: "https://wcl.example/x" }];
        orgaHub.saveLinks.mockResolvedValue({ links });
        const res = await request("PUT", "/api/orga-hub/links", { categoryId: "cat1", links });
        expect(status(res)).toBe(200);
        expect(orgaHub.saveLinks).toHaveBeenCalledWith("cat1", links);
        expect(body(res)).toEqual({ categoryId: "cat1", links });
    });

    it("answers refused links with 400", async () => {
        orgaHub.saveLinks.mockResolvedValue({ error: "„X“ braucht eine Adresse mit https://." });
        const res = await request("PUT", "/api/orga-hub/links", { categoryId: "cat1", links: [{ label: "X", url: "ftp://x" }] });
        expect(status(res)).toBe(400);
        expect(body(res).error.message).toContain("https://");
    });

    it("lets only settings writers change the links", async () => {
        mockUser = withSettings(false);
        expect(status(await request("PUT", "/api/orga-hub/links", { categoryId: "cat1", links: [] }))).toBe(403);
        mockUser = { id: "8", isAdmin: false, access: emptyAccess() };
        expect(status(await request("PUT", "/api/orga-hub/links", { categoryId: "cat1", links: [] }))).toBe(403);
        expect(orgaHub.saveLinks).not.toHaveBeenCalled();
    });

    it("opens for settings: reading with read, posting only with write", async () => {
        mockUser = withSettings(false);
        expect(status(await get("/api/orga-hubs"))).toBe(200);
        expect(status(await post("/api/orga-hub", { categoryId: "cat1", channelId: "c" }))).toBe(403);
        mockUser = { id: "8", isAdmin: false, access: emptyAccess() };
        expect(status(await get("/api/orga-hubs"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/orga-hubs"))).toBe(401);
        expect(orgaHub.postHub).not.toHaveBeenCalled();
    });
});

// Rights per server (#925): the orga of server B sees and changes nothing of server A's hubs.
describe("apiRoutes/orgaHub - rights per server (#925)", () => {
    const orgaOfB = { id: "7", name: "Bob", isAdmin: false, isOrga: true, access: { ...emptyAccess(), settings: { read: true, write: true } } };
    const channels = new Map([
        ["catA", { id: "catA", guildId: "A" }], ["chA", { id: "chA", guildId: "A" }],
        ["catB", { id: "catB", guildId: "B" }], ["chB", { id: "chB", guildId: "B" }],
    ]);

    beforeEach(() => {
        mockActive = "B";
        mockClient = { channels: { cache: channels } };
        store.setHub({ categoryId: "catA", guildId: "A", channelId: "chA", messageId: "m1" }, { now: 1 });
        store.setHub({ categoryId: "catB", guildId: "B", channelId: "chB", messageId: "m2" }, { now: 2 });
        store.setLinks("catA", [{ label: "A", url: "https://a.example" }]);
        store.setLinks("catB", [{ label: "B", url: "https://b.example" }]);
    });
    afterEach(() => {
        store.setLinks("catA", []);
        store.setLinks("catB", []);
    });

    it("lists only the hubs and links of the active server, a full admin sees all", async () => {
        mockUser = orgaOfB;
        let res = await get("/api/orga-hubs");
        expect(body(res).hubs.map((h) => h.categoryId)).toEqual(["catB"]);
        expect(Object.keys(body(res).links)).toEqual(["catB"]);
        mockUser = ADMIN;
        res = await get("/api/orga-hubs");
        expect(body(res).hubs.map((h) => h.categoryId).sort()).toEqual(["catA", "catB"]);
    });

    it("refuses posting, removing and linking for a category of another server", async () => {
        mockUser = orgaOfB;
        expect(status(await post("/api/orga-hub", { categoryId: "catA", channelId: "chB" }))).toBe(403);
        expect(status(await post("/api/orga-hub", { categoryId: "catB", channelId: "chA" }))).toBe(403);
        expect(status(await request("DELETE", "/api/orga-hub", { categoryId: "catA" }))).toBe(404);
        expect(status(await request("PUT", "/api/orga-hub/links", { categoryId: "catA", links: [] }))).toBe(403);
        expect(orgaHub.postHub).not.toHaveBeenCalled();
        expect(orgaHub.removeHub).not.toHaveBeenCalled();
        expect(orgaHub.saveLinks).not.toHaveBeenCalled();
        orgaHub.saveLinks.mockResolvedValue({ links: [] });
        expect(status(await request("PUT", "/api/orga-hub/links", { categoryId: "catB", links: [] }))).toBe(200);
    });

    it("lets a full admin act on every server", async () => {
        orgaHub.saveLinks.mockResolvedValue({ links: [] });
        expect(status(await request("PUT", "/api/orga-hub/links", { categoryId: "catA", links: [] }))).toBe(200);
    });
});

// The hub's parts switched on/off (#969): area settings, a known category only, the hub redrawn by the service.
describe("apiRoutes/orgaHub - parts on/off (#969)", () => {
    const channels = new Map([["catA", { id: "catA", guildId: "A" }], ["catB", { id: "catB", guildId: "B" }]]);
    beforeEach(() => {
        mockClient = { channels: { cache: channels } };
    });
    afterEach(() => store.setFeatures("catB", { newRaid: true, links: true, summary: true }));

    it("lists the switches and their keys next to the hubs", async () => {
        store.setFeatures("catB", { summary: false });
        const res = await get("/api/orga-hubs");
        expect(body(res).features).toEqual({ catB: { newRaid: true, links: true, summary: false } });
        expect(body(res).featureKeys).toEqual(["newRaid", "links", "summary"]);
    });

    it("saves through the hub service and answers the stored switches", async () => {
        orgaHub.saveFeatures.mockResolvedValue({ features: { newRaid: false, links: true, summary: true } });
        const res = await request("PUT", "/api/orga-hub/features", { categoryId: "catB", features: { newRaid: false } });
        expect(status(res)).toBe(200);
        expect(orgaHub.saveFeatures).toHaveBeenCalledWith("catB", { newRaid: false });
        expect(body(res)).toEqual({ categoryId: "catB", features: { newRaid: false, links: true, summary: true } });
    });

    it("answers an unknown category and an unknown part with 400", async () => {
        expect(status(await request("PUT", "/api/orga-hub/features", { categoryId: "nope", features: { newRaid: false } }))).toBe(400);
        expect(status(await request("PUT", "/api/orga-hub/features", { features: { newRaid: false } }))).toBe(400);
        expect(orgaHub.saveFeatures).not.toHaveBeenCalled();
        orgaHub.saveFeatures.mockResolvedValue({ error: "Den Bereich gibt es nicht." });
        expect(status(await request("PUT", "/api/orga-hub/features", { categoryId: "catB", features: { bogus: false } }))).toBe(400);
    });

    it("lets only settings writers of the category's server switch", async () => {
        mockUser = withSettings(false);
        expect(status(await request("PUT", "/api/orga-hub/features", { categoryId: "catB", features: {} }))).toBe(403);
        mockUser = { id: "8", isAdmin: false, access: emptyAccess() };
        expect(status(await request("PUT", "/api/orga-hub/features", { categoryId: "catB", features: {} }))).toBe(403);
        mockUser = { ...withSettings(true), isOrga: true };
        mockActive = "B";
        expect(status(await request("PUT", "/api/orga-hub/features", { categoryId: "catA", features: {} }))).toBe(403);
        expect(orgaHub.saveFeatures).not.toHaveBeenCalled();
    });
});
