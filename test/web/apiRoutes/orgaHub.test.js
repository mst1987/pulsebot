// The Orga-Zentrale's API (src/web/apiRoutes/orgaHub.js) through the real router:
// list, post and remove a category's hub, gated by the area `settings`.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../src/services/events/orgaHub", () => ({ postHub: jest.fn(), removeHub: jest.fn(), saveLinks: jest.fn() }));

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
