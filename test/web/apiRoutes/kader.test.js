// The Kaderplaner routes (docs/kaderplaner.md), driven through the real router:
// the area gate (only full admins and explicit grants), the privacy of the view
// model, and that every write lands in the planner store — never in a profile.
const fs = require("fs");
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
const profiles = require("../../../src/stores/raiderProfileStore");
const kaderStore = require("../../../src/stores/kaderStore");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../src/config/permissions");
const { get, post, request } = routerClient(require("../../../src/web/apiRoutes/kader"));
const put = (pathname, payload) => request("PUT", pathname, payload);

const U1 = "111111111111111111";
const U2 = "222222222222222222";
const U3 = "333333333333333333";
const HAND = "444444444444444444";

const ADMIN = { id: "1", name: "Admin", isAdmin: true, access: emptyAccess() };
/** A member with a single-account grant, resolved like auth.js does (config.userPermissions). */
const granted = (level) => {
    const id = "555555555555555555";
    const grant = { [id]: { kader: { read: true, write: level === "write" } } };
    return { id, name: "Lead", isAdmin: false, access: mergeAccess(emptyAccess(), accessForUser(grant, id)) };
};
const OUTSIDER = {
    id: "666666666666666666", name: "Raider", isAdmin: false,
    access: { ...emptyAccess(), loot: { read: true, write: false }, signup: { read: true, write: true } },
};

let profileFile;
let profileBefore;
beforeAll(() => {
    profileFile = tempStoreFile("kader-route-profiles.json");
    fs.writeFileSync(profileFile, JSON.stringify({ profiles: { [U1]: {
        name: "Aldric",
        characters: [{ name: "Aldric Sturmwind", versionId: "forever", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] }],
        availability: ["mi"],
        wishes: [U2], avoidEnabled: true, avoid: [U3], note: "PRIVATE-NOTE",
    } } }));
    profiles.useFile(profileFile);
    profileBefore = fs.readFileSync(profileFile, "utf8");
});
afterAll(() => {
    profiles.useFile(null);
    kaderStore.useFile(null);
});

let storeCount = 0;
beforeEach(() => {
    jest.clearAllMocks();
    storeCount += 1;
    kaderStore.useFile(tempStoreFile(`kader-${storeCount}.json`));
    auth.getUser.mockReturnValue(ADMIN);
    auth.checkCsrf.mockReturnValue(true);
    discord.listHumanMembers.mockResolvedValue({ members: [
        { id: U1, displayName: "Aldric", avatarUrl: null },
        { id: U2, displayName: "Bea", avatarUrl: null },
    ], error: null });
});

describe("web/apiRoutes/kader", () => {
    describe("access", () => {
        it("needs a login", async () => {
            auth.getUser.mockReturnValue(null);
            expect(status(await get("/api/kader"))).toBe(401);
        });

        it("refuses a member without the grant, even one with other areas", async () => {
            auth.getUser.mockReturnValue(OUTSIDER);
            expect(status(await get("/api/kader"))).toBe(403);
            expect(status(await post("/api/kader/rosters", { instanceId: "forever-hyjal" }))).toBe(403);
            expect(kaderStore.readPlanner("g1").rosters).toEqual([]);
        });

        it("lets a single-account grant in: read views, write edits", async () => {
            auth.getUser.mockReturnValue(granted("read"));
            expect(status(await get("/api/kader"))).toBe(200);
            expect(status(await post("/api/kader/rosters", { instanceId: "forever-hyjal" }))).toBe(403);

            auth.getUser.mockReturnValue(granted("write"));
            expect(status(await post("/api/kader/rosters", { instanceId: "forever-hyjal" }))).toBe(200);
        });

        it("refuses a write without a valid CSRF token", async () => {
            auth.checkCsrf.mockReturnValue(false);
            expect(status(await post("/api/kader/rosters", { instanceId: "forever-hyjal" }))).toBe(403);
            expect(kaderStore.readPlanner("g1").rosters).toEqual([]);
        });
    });

    describe("GET /api/kader", () => {
        it("answers the view model of the active server", async () => {
            const res = await get("/api/kader");
            expect(status(res)).toBe(200);
            const view = body(res);
            expect(view).toMatchObject({ versionId: "forever", guildId: "g1", roles: ["tank", "healer", "melee", "ranged"], rosters: [], setups: {} });
            expect(discord.listHumanMembers).toHaveBeenCalledWith("g1");
            expect(view.players.map((p) => p.userId)).toEqual([U1]);
            expect(view.members).toEqual([
                expect.objectContaining({ userId: U1, inPool: true, hasProfile: true, profile: { className: "Warrior", mainSpec: "Warrior-Protection" } }),
                expect.objectContaining({ userId: U2, inPool: false, hasProfile: false, profile: null }),
            ]);
            // no raids yet: no attendance at all, the page shows "—"
            expect(view.players[0].attendance).toBeNull();
            expect(view).not.toHaveProperty("poolIds");
        });

        it("never lets private profile fields out", async () => {
            const text = JSON.stringify(body(await get("/api/kader")));
            for (const field of ["avoid", "avoidEnabled", "wishes", "note", "preferredRaids"]) expect(text).not.toContain(`"${field}"`);
            expect(text).not.toContain("PRIVATE-NOTE");
            expect(text).not.toContain(U3);
        });

        it("still answers with a warning when Discord cannot list the members", async () => {
            discord.listHumanMembers.mockResolvedValue({ members: [], error: "offline" });
            const view = body(await get("/api/kader"));
            expect(view.members).toEqual([]);
            expect(view.warnings).toEqual([expect.stringContaining("offline")]);
        });
    });

    describe("writes", () => {
        it("builds a roster, places players, assigns characters and splits a setup", async () => {
            let res = await post("/api/kader/rosters", { instanceId: "forever-hyjal" });
            expect(status(res)).toBe(200);
            const { rosterId } = body(res);
            expect(body(res).rosters[0]).toMatchObject({
                id: rosterId, name: "Hyjal Summit (Forever) · 20er", size: 20, targets: { tank: 2, healer: 5, melee: 7, ranged: 6 },
            });

            res = await post("/api/kader/accounts", { userId: U2, displayName: "Bea", character: { firstName: "rikka", lastName: "feldmark", className: "Shaman" } });
            expect(status(res)).toBe(200);
            const bea = body(res).players.find((p) => p.userId === U2);
            expect(bea).toMatchObject({ manual: true, hasProfile: false, hasOverride: true });
            expect(bea.characters[0]).toMatchObject({ name: "Rikka Feldmark", className: "Shaman", origin: "planner" });

            // the planner's own view of Aldric: a fury warrior instead of the profile's tank
            res = await put("/api/kader/assignments", {
                userId: U1,
                characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", onlineKey: "forever~aldric sturmwind", specs: [{ spec: "Warrior-Fury", main: true, gear: "usable" }] }],
                activeCharacterId: "c1",
            });
            expect(status(res)).toBe(200);
            const aldric = body(res).players.find((p) => p.userId === U1);
            expect(aldric.differs).toEqual(["mainSpec", "gear", "tank"]);
            // the raider profile is never written
            expect(fs.readFileSync(profileFile, "utf8")).toBe(profileBefore);

            await post("/api/kader/rosters/place", { rosterId, userId: U1, to: "role" });
            res = await post("/api/kader/rosters/place", { rosterId, userId: U2, to: "role", role: "healer" });
            expect(body(res).rosters[0].members).toEqual([{ userId: U1, role: "melee" }, { userId: U2, role: "healer" }]);

            const variantId = body(res).setups[rosterId].variants[0].id;
            res = await post("/api/kader/variants/auto", { rosterId, variantId });
            const groups = body(res).setups[rosterId].variants[0].groups;
            expect(groups).toHaveLength(4);
            expect(groups.flat().filter(Boolean).sort()).toEqual([U1, U2].sort());

            res = await put("/api/kader/variants", { rosterId, variantId, name: "Plan B", groups: [[U2, U1, null, null, null]] });
            const empty = [null, null, null, null, null];
            expect(body(res).setups[rosterId].variants[0]).toMatchObject({ name: "Plan B", groups: [[U2, U1, null, null, null], empty, empty, empty] });

            // stored per server, in the planner's own file
            expect(kaderStore.readPlanner("g1").rosters).toHaveLength(1);
            expect(kaderStore.readPlanner("other").rosters).toEqual([]);
        });

        it("answers a rule violation with its status and message", async () => {
            let res = await post("/api/kader/rosters", { instanceId: "nope" });
            expect(status(res)).toBe(400);
            expect(body(res).error).toMatchObject({ code: "invalid", message: "Unbekannte Instanz." });

            res = await post("/api/kader/accounts", { userId: "123", displayName: "Kurz" });
            expect(status(res)).toBe(400);

            res = await post("/api/kader/accounts", { userId: U1, displayName: "Aldric" });
            expect(status(res)).toBe(409);

            res = await post("/api/kader/accounts/remove", { userId: U1 });
            expect(status(res)).toBe(404);
        });

        it("adds by raw Discord id and removes a hand-added account again", async () => {
            let res = await post("/api/kader/accounts", { userId: HAND, displayName: "Neu" });
            expect(body(res).players.map((p) => p.userId)).toContain(HAND);
            res = await post("/api/kader/accounts/remove", { userId: HAND });
            expect(body(res).players.map((p) => p.userId)).not.toContain(HAND);
        });

        it("resets an assignment, updates and deletes a roster, adds and deletes a variant", async () => {
            await put("/api/kader/assignments", { userId: U1, characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [] }] });
            let res = await post("/api/kader/assignments/reset", { userId: U1 });
            expect(body(res).players[0].hasOverride).toBe(false);

            res = await post("/api/kader/rosters", { instanceId: "forever-barrow", name: "Barrow Mo" });
            const { rosterId } = body(res);
            res = await put("/api/kader/rosters", { rosterId, targets: { tank: 1, healer: 3, melee: 3, ranged: 3 } });
            expect(body(res).rosters[0].targets).toEqual({ tank: 1, healer: 3, melee: 3, ranged: 3 });

            res = await post("/api/kader/variants", { rosterId });
            const { variantId } = body(res);
            expect(variantId).toEqual(expect.any(String));
            expect(body(res).setups[rosterId].variants.map((v) => v.name)).toEqual(["Variante A", "Variante B"]);
            res = await post("/api/kader/variants/delete", { rosterId, variantId });
            expect(body(res).setups[rosterId].variants).toHaveLength(1);

            res = await post("/api/kader/rosters/delete", { rosterId });
            expect(body(res).rosters).toEqual([]);
        });
    });
});
