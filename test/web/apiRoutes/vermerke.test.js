// The Vermerke routes (docs/vermerke.md, #979), driven through the real router:
// the area gate (no base access; read sees, write changes, removing for good is
// for full admins), the rights per server (B does not see what A did not share,
// a shared entry is read on B and changed on A alone, B may hide it), and the
// short form for every orga that plans - without the area only the short form.
const fs = require("fs");
const { status, body, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockUser = null;
let mockActive = "A";
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => mockActive),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => mockActive),
    pickActiveGuild: jest.fn(async () => mockActive),
}));
let mockManager = false;
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    isAnyCategoryManager: jest.fn(async () => mockManager),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    getGuild: jest.fn((id) => (id === "A" ? { id: "A", name: "Server Alpha" } : null)),
}));

const categoryOrga = require("../../../src/services/roster/categoryOrga");
const notes = require("../../../src/stores/userNotesStore");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../src/config/permissions");
const route = require("../../../src/web/apiRoutes/vermerke");
const { get, post } = routerClient(route);

const U = "111111111111111111";
const V = "222222222222222222";
const ADMIN = { id: "1", name: "Admin", isAdmin: true, access: emptyAccess() };
const granted = (level, id = "555555555555555555") => {
    const grant = { [id]: { vermerke: { read: true, write: level === "write" } } };
    return { id, name: "Lena", isAdmin: false, access: mergeAccess(emptyAccess(), accessForUser(grant, id)) };
};
const RAIDER = {
    id: U, name: "Raider", isAdmin: false,
    access: { ...emptyAccess(), signup: { read: true, write: true }, profile: { read: true, write: true } },
};
const ORGA = { id: "7", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true } } };

const add = (payload) => post("/api/vermerke", { userId: U, name: "Zed", level: "warning", reason: "no_show", text: "MARKER-TEXT", ...payload });

beforeEach(() => {
    const file = tempStoreFile("user-notes.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    notes.useFile(file);
    mockUser = ADMIN;
    mockActive = "A";
    mockManager = false;
    categoryOrga.isAnyCategoryManager.mockClear();
});
afterAll(() => notes.useFile(null));

describe("web/apiRoutes/vermerke", () => {
    it("adds an entry on the active server and lists it without the text", async () => {
        const res = await add({ eventIds: ["e1"] });
        expect(status(res)).toBe(201);
        const { entry } = body(res);
        expect(entry).toMatchObject({ level: "warning", reason: "no_show", by: "1", byName: "Admin", own: true, originGuildId: "A" });

        const list = body(await get("/api/vermerke")).people;
        expect(list).toEqual([{ userId: U, name: "Zed", level: "warning", reasons: { no_show: 1 }, activeCount: 1, totalCount: 1, lastAt: entry.at }]);
        expect(JSON.stringify(list)).not.toContain("MARKER-TEXT");

        const person = body(await get("/api/vermerke/person", { userId: U }));
        expect(person).toMatchObject({ userId: U, name: "Zed", level: "warning" });
        expect(person.entries).toEqual([expect.objectContaining({ id: entry.id, text: "MARKER-TEXT", active: true })]);
    });

    it("answers the store's refusals with their code", async () => {
        expect(body(await add({ level: "ban" })).error.code).toBe("bad_level");
        expect(status(await post("/api/vermerke", { userId: "x", level: "hint", reason: "other" }))).toBe(400);
        expect(status(await get("/api/vermerke/person"))).toBe(400);
    });

    it("changes, archives and restores an entry of the own server", async () => {
        const { entry } = body(await add());
        const upd = await post("/api/vermerke/update", { userId: U, id: entry.id, level: "hint" });
        expect(body(upd).entry.level).toBe("hint");
        expect(body(await post("/api/vermerke/archive", { userId: U, id: entry.id })).entry.archived).toBe(true);
        expect(body(await post("/api/vermerke/update", { userId: U, id: entry.id, level: "warning" })).error.code).toBe("archived");
        expect(body(await get("/api/vermerke")).people[0]).toMatchObject({ level: null, activeCount: 0, totalCount: 1 });
        const back = await post("/api/vermerke/archive", { userId: U, id: entry.id, archived: false });
        expect(body(back).entry.archived).toBeUndefined();
    });

    describe("rights per server", () => {
        it("B does not see the entries A did not share (404 for a change)", async () => {
            const { entry } = body(await add());
            mockActive = "B";
            expect(body(await get("/api/vermerke")).people).toEqual([]);
            expect(body(await get("/api/vermerke/person", { userId: U })).entries).toEqual([]);
            const res = await post("/api/vermerke/update", { userId: U, id: entry.id, level: "hint" });
            expect([status(res), body(res).error.code]).toEqual([404, "not_found"]);
            expect(body(await post("/api/vermerke/archive", { userId: U, id: entry.id })).error.code).toBe("not_found");
            expect(body(await post("/api/vermerke/hide", { id: entry.id })).error.code).toBe("not_found");
        });

        it("B reads a shared entry of A with the name of its server, changes it not, may hide it", async () => {
            const { entry } = body(await add({ shared: true }));
            mockActive = "B";
            const person = body(await get("/api/vermerke/person", { userId: U }));
            expect(person.entries).toEqual([expect.objectContaining({ id: entry.id, own: false, originGuildId: "A", originName: "Server Alpha", active: true })]);
            expect(status(await post("/api/vermerke/update", { userId: U, id: entry.id, level: "hint" }))).toBe(404);
            expect(status(await post("/api/vermerke/archive", { userId: U, id: entry.id }))).toBe(404);
            expect(status(await post("/api/vermerke/delete", { userId: U, id: entry.id }))).toBe(404);

            expect(body(await post("/api/vermerke/hide", { id: entry.id }))).toEqual({ id: entry.id, hidden: true });
            expect(body(await get("/api/vermerke/person", { userId: U }))).toMatchObject({ level: null });
            expect(body(await get("/api/vermerke/short", { userIds: U })).short).toEqual({});
            mockActive = "A";
            expect(body(await get("/api/vermerke/short", { userIds: U })).short[U].level).toBe("warning");
        });

        it("needs an active server", async () => {
            mockActive = "";
            expect(body(await get("/api/vermerke")).error.code).toBe("no_server");
        });
    });

    describe("the area", () => {
        it("read sees the list and the notes but changes nothing", async () => {
            await add();
            mockUser = granted("read");
            expect(status(await get("/api/vermerke"))).toBe(200);
            expect(body(await get("/api/vermerke/person", { userId: U })).entries[0].text).toBe("MARKER-TEXT");
            expect(status(await add())).toBe(403);
        });

        it("write adds, changes and archives - removing for good is for full admins only", async () => {
            mockUser = granted("write");
            const { entry } = body(await add());
            expect(status(await post("/api/vermerke/update", { userId: U, id: entry.id, text: "neu" }))).toBe(200);
            const refused = await post("/api/vermerke/delete", { userId: U, id: entry.id });
            expect(status(refused)).toBe(403);
            mockUser = ADMIN;
            expect(body(await post("/api/vermerke/delete", { userId: U, id: entry.id }))).toEqual({ removed: true });
            expect(body(await get("/api/vermerke")).people).toEqual([]);
        });

        it("the global orga without the area gets the short form only", async () => {
            await add();
            mockUser = ORGA;
            expect(status(await get("/api/vermerke"))).toBe(403);
            expect(status(await get("/api/vermerke/person", { userId: U }))).toBe(403);
            const short = await get("/api/vermerke/short", { userIds: `${U},${V}` });
            expect(body(short).short).toEqual({ [U]: { level: "warning", reasons: { no_show: 1 } } });
            expect(JSON.stringify(body(short))).not.toContain("MARKER-TEXT");
        });

        it("a roster manager of the active server gets the short form - asked for that server", async () => {
            await add();
            mockUser = { ...RAIDER, id: "888888888888888888" };
            mockManager = true;
            expect(body(await get("/api/vermerke/short", { userIds: U })).short[U].level).toBe("warning");
            expect(categoryOrga.isAnyCategoryManager).toHaveBeenCalledWith(mockUser, expect.objectContaining({ guildId: "A" }));
        });

        it("a raider gets nothing, not even the short form", async () => {
            await add();
            mockUser = RAIDER;
            for (const res of [await get("/api/vermerke"), await get("/api/vermerke/person", { userId: U }), await get("/api/vermerke/short", { userIds: U }), await add()]) {
                expect(status(res)).toBe(403);
                expect(JSON.stringify(body(res))).not.toContain("MARKER-TEXT");
            }
        });
    });

    it("names a shared server by its label in the settings, else by Discord", () => {
        expect(route.serverNameOf("A", { discordServers: { servers: [] } })).toBe("Server Alpha");
        expect(route.serverNameOf("Z", {})).toBe("");
    });
});
