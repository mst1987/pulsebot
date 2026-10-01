// The Kaderplaner live (docs/kaderplaner.md, "Live"), driven through the real
// router: the poll GET /api/kader/live (revision, changes since the page's
// revision, who else is in the Kader), the light refetch GET /api/kader/kader,
// and the 409 `stale` of a save over somebody else's change.
const { status, body, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    getRealUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
}));
jest.mock("../../../src/services/events/eventSources", () => ({
    ...jest.requireActual("../../../src/services/events/eventSources"),
    listStoredEvents: jest.fn(() => []),
}));
jest.mock("../../../src/web/characters/profileLogs", () => ({
    ...jest.requireActual("../../../src/web/characters/profileLogs"),
    logIndex: jest.fn(() => new Map()),
}));

const auth = require("../../../src/web/http/auth");
const discord = require("../../../src/services/discord/discord");
const kaderStore = require("../../../src/stores/kaderStore");
const presence = require("../../../src/web/kader/kaderPresence");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../src/config/permissions");
const { get, post, request } = routerClient(require("../../../src/web/apiRoutes/kader"));
const put = (pathname, payload) => request("PUT", pathname, payload);

const KURT = "100000000000000001";
const LENA = "100000000000000002";
const U1 = "111111111111111111";
const U2 = "222222222222222222";

const ADMIN = { id: KURT, name: "Kurt", isAdmin: true, access: emptyAccess() };
const lena = (level) => ({
    id: LENA, name: "Lena", isAdmin: false,
    access: mergeAccess(emptyAccess(), accessForUser({ [LENA]: { kader: { read: true, write: level === "write" } } }, LENA)),
});
const OUTSIDER = { id: "666666666666666666", name: "Raider", isAdmin: false, access: { ...emptyAccess(), loot: { read: true, write: false } } };
const as = (user) => auth.getUser.mockReturnValue(user);

let storeCount = 0;
beforeEach(() => {
    jest.clearAllMocks();
    presence.reset();
    storeCount += 1;
    kaderStore.useFile(tempStoreFile(`kader-live-${storeCount}.json`));
    as(ADMIN);
    discord.listHumanMembers.mockResolvedValue({ members: [
        { id: U1, displayName: "Aldric", avatarUrl: null, roleIds: [] },
        { id: U2, displayName: "Bea", avatarUrl: null, roleIds: [] },
        { id: KURT, displayName: "Kurt", avatarUrl: null, roleIds: [] },
        { id: LENA, displayName: "Lena", avatarUrl: null, roleIds: [] },
    ], error: null });
});
afterAll(() => kaderStore.useFile(null));

/** A Kader led by Kurt and Lena, with Aldric and Bea in the Vorauswahl; a second Kader beside it. */
async function kaders() {
    const kaderId = body(await post("/api/kader/kaders", { name: "Forever" })).kaderId;
    await put("/api/kader/kaders", { kaderId, leads: [KURT, LENA] });
    await post("/api/kader/players/add", { kaderId, players: [{ userId: U1 }, { userId: U2 }] });
    const res = await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "selected" });
    const other = body(await post("/api/kader/kaders", { name: "Donnerstag" })).kaderId;
    return { kaderId, other, kader: body(res).kader };
}
const live = (params) => get("/api/kader/live", { tab: "t1", ...params });

describe("web/apiRoutes/kader · live", () => {
    describe("access", () => {
        it("needs a login and the area, read is enough", async () => {
            const { kaderId } = await kaders();
            as(null);
            expect(status(await live({ kader: kaderId }))).toBe(401);
            as(OUTSIDER);
            expect(status(await live({ kader: kaderId }))).toBe(403);
            expect(status(await get("/api/kader/kader", { kader: kaderId }))).toBe(403);
            as(lena("read"));
            expect(status(await live({ kader: kaderId }))).toBe(200);
            expect(status(await get("/api/kader/kader", { kader: kaderId }))).toBe(200);
        });
    });

    describe("GET /api/kader/live", () => {
        it("answers the revision, the changes since the page's revision and nobody else yet — without building the view", async () => {
            const { kaderId, kader } = await kaders();
            discord.listHumanMembers.mockClear();
            const res = body(await live({ kader: kaderId, rev: kader.rev }));
            expect(res).toEqual({ rev: kader.rev, sharedRev: expect.any(Number), changes: [], more: false, presence: [] });
            expect(discord.listHumanMembers).not.toHaveBeenCalled();
        });

        it("names the changes somebody else made since, by type and id, never their content", async () => {
            const { kaderId, kader } = await kaders();
            as(lena("write"));
            await put("/api/kader/interview", { kaderId, userId: U1, note: "GEHEIME NOTIZ" });
            await post("/api/kader/players/state", { kaderId, userIds: [U2], to: "provisional" });
            as(ADMIN);
            const res = body(await live({ kader: kaderId, rev: kader.rev }));
            expect(res.rev).toBeGreaterThan(kader.rev);
            expect(res.changes).toEqual([
                expect.objectContaining({ by: LENA, type: "interview", playerId: U1 }),
                expect.objectContaining({ by: LENA, type: "state", playerId: U2, from: "selected", to: "provisional" }),
            ]);
            expect(JSON.stringify(res)).not.toContain("GEHEIME");
            // the light refetch brings the Kader with Lena's change
            const light = body(await get("/api/kader/kader", { kader: kaderId }));
            expect(Object.keys(light).sort()).toEqual(["kader", "kaders", "sharedRev"]);
            expect(light.kader).toMatchObject({ id: kaderId, rev: res.rev });
            expect(light.kader.players[U2].state).toBe("provisional");
        });

        it("tells who else is in the Kader and what they have open — only in this Kader, never one's own", async () => {
            const { kaderId, other } = await kaders();
            as(lena("write"));
            await live({ kader: kaderId, sub: "vorauswahl", player: U1, what: "interview", edit: "1" });
            as(ADMIN);
            expect(body(await live({ kader: kaderId, sub: "pool", tab: "k" })).presence).toEqual([
                { userId: LENA, name: "Lena", sub: "vorauswahl", playerId: U1, what: "interview", edit: true },
            ]);
            expect(body(await live({ kader: other, tab: "k2" })).presence).toEqual([]);
            as(lena("write"));
            expect(body(await live({ kader: kaderId })).presence.map((p) => p.userId)).toEqual([KURT]);
        });

        it("never says a read-only account is editing, and forgets a page that leaves", async () => {
            const { kaderId } = await kaders();
            as(lena("read"));
            await live({ kader: kaderId, sub: "vorauswahl", player: U1, what: "interview", edit: "1" });
            as(ADMIN);
            expect(body(await live({ kader: kaderId, tab: "k" })).presence[0]).toMatchObject({ userId: LENA, edit: false });
            as(lena("read"));
            await live({ kader: kaderId, leave: "1" });
            as(ADMIN);
            expect(body(await live({ kader: kaderId, tab: "k" })).presence).toEqual([]);
        });

        it("answers `gone` for a Kader that is not there (any more)", async () => {
            const { kaderId } = await kaders();
            await post("/api/kader/kaders/delete", { kaderId });
            expect(body(await live({ kader: kaderId, rev: 3 }))).toMatchObject({ gone: true, changes: [], presence: [] });
        });
    });

    describe("a save over somebody else's change: 409 stale", () => {
        it("refuses an interview save from an older revision with who changed it, and takes it when forced", async () => {
            const { kaderId, kader } = await kaders();
            const seen = kader.players[U1].interview.rev;
            as(lena("write"));
            expect(status(await put("/api/kader/interview", { kaderId, userId: U1, note: "Lena", baseRev: seen }))).toBe(200);
            as(ADMIN);
            const res = await put("/api/kader/interview", { kaderId, userId: U1, note: "Kurt", baseRev: seen });
            expect(status(res)).toBe(409);
            expect(body(res).error).toMatchObject({ code: "stale", by: LENA, rev: expect.any(Number), message: expect.stringContaining("geändert") });
            expect(kaderStore.readPlanner("g1").kaders[0].players[U1].interview.note).toBe("Lena");
            const forced = await put("/api/kader/interview", { kaderId, userId: U1, note: "Kurt", baseRev: seen, force: true });
            expect(status(forced)).toBe(200);
            expect(body(forced).kader.players[U1].interview.note).toBe("Kurt");
        });

        it("refuses a character save and a question save from an older revision", async () => {
            const { kaderId } = await kaders();
            const chars = (name) => [{ id: "c1", name, className: "Warrior", specs: [] }];
            as(lena("write"));
            let res = await put("/api/kader/assignments", { kaderId, userId: U1, characters: chars("Aldric Sturmwind"), baseRev: 0 });
            expect(status(res)).toBe(200);
            expect(body(res).players.find((p) => p.userId === U1)).toMatchObject({ rev: expect.any(Number), changedBy: LENA });
            as(ADMIN);
            res = await put("/api/kader/assignments", { kaderId, userId: U1, characters: chars("Aldric Eisen"), baseRev: 0 });
            expect(status(res)).toBe(409);
            expect(body(res).error).toMatchObject({ code: "stale", by: LENA });

            res = await post("/api/kader/questions", { kaderId, text: "Voice", type: "text" });
            const question = body(res).kader.questions[0];
            as(lena("write"));
            await put("/api/kader/questions", { kaderId, questionId: question.id, text: "Voice?", baseRev: question.rev });
            as(ADMIN);
            res = await put("/api/kader/questions", { kaderId, questionId: question.id, text: "Voice!", baseRev: question.rev });
            expect(status(res)).toBe(409);
            expect(body(res).error).toMatchObject({ code: "stale", by: LENA });
        });
    });
});
