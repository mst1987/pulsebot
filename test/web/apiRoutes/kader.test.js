// The Kaderplaner routes (docs/kaderplaner.md), driven through the real router:
// the area gate (only full admins and explicit grants; read-only sees all and
// changes nothing), the privacy of the view model, and a Kader walked from the
// pool to the roster — every write in the planner's store, never in a profile.
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
const { listStoredEvents } = require("../../../src/services/events/eventSources");
const profiles = require("../../../src/stores/raiderProfileStore");
const kaderStore = require("../../../src/stores/kaderStore");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../src/config/permissions");
const { get, post, request } = routerClient(require("../../../src/web/apiRoutes/kader"));
const put = (pathname, payload) => request("PUT", pathname, payload);

const LEAD = "100000000000000001";
const U1 = "111111111111111111";
const U2 = "222222222222222222";
const U3 = "333333333333333333";
const HAND = "444444444444444444";

const ADMIN = { id: LEAD, name: "Kurt", isAdmin: true, access: emptyAccess() };
/** A member with a single-account grant, resolved like auth.js does (config.userPermissions). */
const granted = (level, id = "555555555555555555") => {
    const grant = { [id]: { kader: { read: true, write: level === "write" } } };
    return { id, name: "Lena", isAdmin: false, access: mergeAccess(emptyAccess(), accessForUser(grant, id)) };
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
        characters: [{ name: "Aldric Sturmwind", versionId: "forever", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }, { key: "Warrior-Fury", gear: "none" }] }],
        availability: ["mi"],
        wishes: [U2], avoidEnabled: true, avoid: [U3], note: "PRIVATE-NOTE",
    } } }));
    profileBefore = fs.readFileSync(profileFile, "utf8");
    profiles.useFile(profileFile);
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
        { id: U1, displayName: "Aldric", avatarUrl: null, roleIds: ["r-raider"] },
        { id: U2, displayName: "Bea", avatarUrl: null, roleIds: ["r-raider"] },
        { id: LEAD, displayName: "Kurt", avatarUrl: null, roleIds: [] },
    ], error: null });
    discord.listRoles.mockReturnValue([{ id: "r-raider", name: "Raider", color: "#8a7cff" }]);
});

/** A Kader with Aldric and Bea in its pool. */
async function kaderWithPlayers() {
    const created = body(await post("/api/kader/kaders", { name: "Forever-Kader 2027" }));
    const kaderId = created.kaderId;
    const res = await post("/api/kader/players/add", { kaderId, players: [{ userId: U1 }, { userId: U2, displayName: "Bea" }] });
    expect(status(res)).toBe(200);
    return { kaderId, view: body(res) };
}

describe("web/apiRoutes/kader", () => {
    describe("access", () => {
        it("needs a login", async () => {
            auth.getUser.mockReturnValue(null);
            expect(status(await get("/api/kader"))).toBe(401);
        });

        it("refuses a member without the grant, even one with other areas", async () => {
            auth.getUser.mockReturnValue(OUTSIDER);
            expect(status(await get("/api/kader"))).toBe(403);
            expect(status(await post("/api/kader/kaders", { name: "K" }))).toBe(403);
            expect(kaderStore.readPlanner("g1").kaders).toEqual([]);
        });

        it("lets a single-account read grant see everything but change nothing", async () => {
            const { kaderId } = await kaderWithPlayers();
            await post("/api/kader/comments", { kaderId, userId: U1, text: "zuverlässig" });
            auth.getUser.mockReturnValue(granted("read"));
            const res = await get("/api/kader", { kader: kaderId });
            expect(status(res)).toBe(200);
            expect(body(res).kader.players[U1].comments[0].text).toBe("zuverlässig");
            for (const [path, payload] of [
                ["/api/kader/kaders", { name: "K" }],
                ["/api/kader/players/state", { kaderId, userIds: [U1], to: "selected" }],
                ["/api/kader/comments", { kaderId, userId: U1, text: "x" }],
                ["/api/kader/questions", { kaderId, text: "Q", type: "text" }],
            ]) expect(status(await post(path, payload))).toBe(403);
            expect(status(await put("/api/kader/interview", { kaderId, userId: U1, note: "x" }))).toBe(403);
        });

        it("lets a single-account write grant change things", async () => {
            auth.getUser.mockReturnValue(granted("write"));
            const res = await post("/api/kader/kaders", { name: "Lenas Kader" });
            expect(status(res)).toBe(200);
            // the creator leads it
            expect(body(res).kader.leads).toEqual(["555555555555555555"]);
        });

        it("refuses a write without a valid CSRF token", async () => {
            auth.checkCsrf.mockReturnValue(false);
            expect(status(await post("/api/kader/kaders", { name: "K" }))).toBe(403);
            expect(kaderStore.readPlanner("g1").kaders).toEqual([]);
        });
    });

    describe("GET /api/kader", () => {
        it("answers the server's side and the chosen Kader", async () => {
            const { kaderId } = await kaderWithPlayers();
            const view = body(await get("/api/kader", { kader: kaderId }));
            expect(view).toMatchObject({ versionId: "forever", guildId: "g1", roles: ["tank", "healer", "melee", "ranged"] });
            expect(view.kaders).toEqual([expect.objectContaining({ id: kaderId, name: "Forever-Kader 2027", counts: expect.objectContaining({ pool: 2 }) })]);
            expect(view.kader.id).toBe(kaderId);
            expect(view.players.map((p) => p.userId)).toEqual([U1, U2]);
            expect(view.discordRoles).toEqual([{ id: "r-raider", name: "Raider", color: "#8a7cff", count: 2 }]);
            expect(view.names).toMatchObject({ [LEAD]: "Kurt", [U2]: "Bea" });
            // no raids yet: no attendance at all, the page shows "—"
            expect(view.players[0].attendance).toBeNull();
            expect(body(await get("/api/kader")).kader).toBeNull();
        });

        it("never lets private profile fields out", async () => {
            await kaderWithPlayers();
            const text = JSON.stringify(body(await get("/api/kader")));
            for (const field of ["avoid", "avoidEnabled", "preferredRaids"]) expect(text).not.toContain(`"${field}"`);
            expect(text).not.toContain("PRIVATE-NOTE");
            expect(text).not.toContain(U3);
        });

        it("still answers with a warning when Discord cannot list the members", async () => {
            discord.listHumanMembers.mockResolvedValue({ members: [], error: "offline" });
            const view = body(await get("/api/kader"));
            expect(view.members).toEqual([]);
            expect(view.discordRoles).toEqual([]);
            expect(view.warnings).toEqual([expect.stringContaining("offline")]);
        });
    });

    describe("the raid categories attendance counts in", () => {
        const past = (days) => Math.floor(Date.now() / 1000) - days * 86400;

        beforeEach(() => {
            listStoredEvents.mockReturnValue([
                { id: "e1", guildId: "g1", categoryId: "c-mo", categoryName: "Mo Raid", title: "Kara", startTime: past(3), signUps: [{ userId: U1, status: "signed" }] },
                { id: "e2", guildId: "g1", categoryId: "c-do", categoryName: "Do Raid", title: "Gruul", startTime: past(6), signUps: [{ userId: U1, status: "absence" }] },
                { id: "e3", guildId: "g1", categoryId: "c-mo", categoryName: "Mo Raid", title: "Kara", startTime: past(10), signUps: [{ userId: U1, status: "signed" }] },
            ]);
        });

        it("hands out the server's raid categories and each account's attendance per category", async () => {
            const { kaderId } = await kaderWithPlayers();
            const view = body(await get("/api/kader", { kader: kaderId }));
            expect(view.raidCategories.map((c) => [c.id, c.name, c.nights])).toEqual([["c-mo", "Mo Raid", 2], ["c-do", "Do Raid", 1]]);
            const aldric = view.players.find((p) => p.userId === U1);
            expect(aldric.attendance["c-mo"]).toMatchObject({ attended: 2, counted: 2 });
            expect(aldric.attendance["c-do"]).toMatchObject({ attended: 0, counted: 1, nights: [expect.objectContaining({ title: "Gruul", reason: "abgemeldet" })] });
            // a new Kader counts in no category until a lead picks one
            expect(view.kader.attendanceCategories).toEqual([]);
        });

        it("keeps the pick on the Kader for every lead, leaving out what is no raid category", async () => {
            const { kaderId } = await kaderWithPlayers();
            let res = await put("/api/kader/kaders", { kaderId, attendanceCategories: ["c-mo", "c-nope"] });
            expect(status(res)).toBe(200);
            expect(Object.keys(body(res)).sort()).toEqual(["kader", "kaders"]);
            expect(body(res).kader.attendanceCategories).toEqual(["c-mo"]);
            // another lead reads the same pick
            auth.getUser.mockReturnValue(granted("read"));
            expect(body(await get("/api/kader", { kader: kaderId })).kader.attendanceCategories).toEqual(["c-mo"]);
            // a read-only account cannot change it
            expect(status(await put("/api/kader/kaders", { kaderId, attendanceCategories: [] }))).toBe(403);
            auth.getUser.mockReturnValue(ADMIN);
            res = await put("/api/kader/kaders", { kaderId, attendanceCategories: "c-mo" });
            expect(status(res)).toBe(400);
        });
    });

    describe("a Kader from the pool to the roster", () => {
        it("walks the pipeline, answering changes inside the Kader with the Kader alone", async () => {
            const { kaderId, view } = await kaderWithPlayers();
            // the import answered the whole view; Aldric starts with his profile's spec as the wish
            expect(view.kader.players[U1]).toMatchObject({ state: "pool", wishes: [{ className: "Warrior", spec: "Warrior-Protection" }], addedBy: LEAD });
            expect(view.kader.players[U2]).toMatchObject({ name: "Bea", wishes: [] });

            let res = await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "selected" });
            expect(Object.keys(body(res)).sort()).toEqual(["kader", "kaders", "moved", "skipped"]);
            expect(body(res)).toMatchObject({ moved: 2, skipped: 0 });

            res = await post("/api/kader/questions", { kaderId, text: "Raidtage", type: "multi", options: [{ label: "Mi" }, { label: "Do" }], required: true });
            const question = body(res).kader.questions[0];
            expect(body(res).questionId).toBe(question.id);

            res = await put("/api/kader/interview", { kaderId, userId: U1, wishes: [{ className: "Warrior", spec: "Warrior-Fury" }, { className: "Warrior", spec: "Warrior-Protection" }], answers: { [question.id]: [question.options[1].id] }, note: "Will Furor", lead: LEAD });
            expect(status(res)).toBe(200);
            res = await post("/api/kader/interview/complete", { kaderId, userId: U1 });
            expect(body(res).kader.players[U1].interview).toMatchObject({ completedBy: LEAD, lead: LEAD, note: "Will Furor" });
            // Bea has no wish yet: her interview cannot be completed
            res = await post("/api/kader/interview/complete", { kaderId, userId: U2 });
            expect(status(res)).toBe(409);

            res = await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "provisional" });
            expect(body(res).kader.players[U1].state).toBe("provisional");
            res = await post("/api/kader/votes", { kaderId, userId: U1, vote: "yes" });
            expect(body(res).kader.players[U1].votes).toEqual({ [LEAD]: "yes" });
            res = await post("/api/kader/comments", { kaderId, userId: U1, text: "Als Furor gesetzt" });
            const commentId = body(res).commentId;
            res = await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "roster", decision: { className: "Warrior", spec: "Warrior-Fury" } });
            expect(body(res).kader.players[U1]).toMatchObject({ state: "roster", decision: { className: "Warrior", spec: "Warrior-Fury" }, by: LEAD });
            expect(body(res).kaders[0].counts).toMatchObject({ roster: 1, selected: 1 });

            // an example setup: never a change of state
            const variantId = body(res).kader.setups[0].id;
            res = await put("/api/kader/variants", { kaderId, variantId, size: 10, groups: [[{ userId: U1, spec: "Warrior-Protection" }, { userId: U2, spec: "x" }]] });
            expect(body(res).kader.setups[0]).toMatchObject({ size: 10, groups: [[{ userId: U1, spec: "Warrior-Protection" }, null, null, null, null], expect.any(Array), expect.any(Array), expect.any(Array)] });
            res = await post("/api/kader/variants/auto", { kaderId, variantId });
            expect(body(res).kader.setups[0].groups[0][0]).toEqual({ userId: U1, spec: "Warrior-Fury" });
            expect(body(res).kader.players[U1].state).toBe("roster");

            // deleting the question takes its answers along
            res = await post("/api/kader/questions/delete", { kaderId, questionId: question.id });
            expect(body(res).kader.players[U1].interview.answers).toEqual({});
            res = await post("/api/kader/comments/delete", { kaderId, userId: U1, commentId });
            expect(body(res).kader.players[U1].comments).toEqual([]);

            // the raider profile is never written
            expect(fs.readFileSync(profileFile, "utf8")).toBe(profileBefore);
            expect(kaderStore.readPlanner("g1").kaders[0].players[U1].history.map((h) => h.type)).toEqual(
                ["added", "state", "interview_completed", "state", "vote", "state", "decision"],
            );
        });

        it("refuses what the rules refuse, with the status of the rule", async () => {
            const { kaderId } = await kaderWithPlayers();
            let res = await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "roster" });
            expect(status(res)).toBe(409);
            res = await post("/api/kader/players/state", { kaderId: "nope", userIds: [U1], to: "selected" });
            expect(status(res)).toBe(404);
            res = await post("/api/kader/questions", { kaderId, text: "x".repeat(201), type: "text" });
            expect(status(res)).toBe(400);
            res = await put("/api/kader/interview", { kaderId, userId: U1, note: "x".repeat(2001) });
            expect(status(res)).toBe(400);
            res = await post("/api/kader/comments", { kaderId, userId: U1, text: "x".repeat(1001) });
            expect(status(res)).toBe(400);
            // only the Kader's leads vote
            auth.getUser.mockReturnValue(granted("write"));
            res = await post("/api/kader/votes", { kaderId, userId: U1, vote: "yes" });
            expect(status(res)).toBe(403);
        });

        it("adds an account by Discord id straight into a Kader, and takes players out again", async () => {
            const { kaderId } = await kaderWithPlayers();
            let res = await post("/api/kader/accounts", { userId: HAND, displayName: "Neu", kaderId, character: { nameStyle: "nick", nickname: "Knuffel", className: "Mage" } });
            expect(status(res)).toBe(200);
            expect(body(res).kader.players[HAND]).toMatchObject({ state: "pool", name: "Neu" });
            expect(body(res).players.find((p) => p.userId === HAND)).toMatchObject({ manual: true, prefill: { name: "Knuffel", source: "planner" } });
            res = await post("/api/kader/players/remove", { kaderId, userIds: [HAND, U2] });
            expect(Object.keys(body(res).kader.players)).toEqual([U1]);
            res = await post("/api/kader/accounts/remove", { userId: HAND });
            expect(body(res).players.map((p) => p.userId)).not.toContain(HAND);
        });

        it("answers the full-view writes with the open Kader when the call names it", async () => {
            const { kaderId } = await kaderWithPlayers();
            const chars = [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", onlineKey: "forever~aldric sturmwind", specs: [{ spec: "Warrior-Fury", main: true, gear: "usable" }] }];
            let res = await put("/api/kader/assignments", { kaderId, userId: U1, characters: chars, activeCharacterId: "c1" });
            expect(body(res).kader).toMatchObject({ id: kaderId });
            res = await post("/api/kader/assignments/reset", { kaderId, userId: U1 });
            expect(body(res).kader).toMatchObject({ id: kaderId });
            await post("/api/kader/accounts", { userId: HAND, displayName: "Neu", character: { nameStyle: "nick", nickname: "Knuffel", className: "Mage" } });
            res = await post("/api/kader/accounts/remove", { kaderId, userId: HAND });
            expect(body(res).kader).toMatchObject({ id: kaderId });
        });

        it("keeps the Kader's settings: rename, leads, questions from another Kader, delete", async () => {
            const { kaderId } = await kaderWithPlayers();
            await post("/api/kader/questions", { kaderId, text: "Voice", type: "single", options: ["Ja", "Nein"] });
            const other = body(await post("/api/kader/kaders", { name: "Zweiter" }));
            let res = await put("/api/kader/kaders", { kaderId: other.kaderId, name: "Mittwoch", leads: [LEAD, U2] });
            expect(body(res).kader).toMatchObject({ name: "Mittwoch", leads: [LEAD, U2] });
            res = await post("/api/kader/questions/copy", { kaderId: other.kaderId, fromKaderId: kaderId });
            expect(body(res)).toMatchObject({ copied: 1 });
            expect(body(res).kader.questions.map((q) => q.text)).toEqual(["Voice"]);
            res = await post("/api/kader/kaders/delete", { kaderId: other.kaderId });
            expect(body(res).kader).toBeNull();
            expect(body(res).kaders.map((k) => k.id)).toEqual([kaderId]);
        });

        it("saves and resets the planner's character data, answering the whole view", async () => {
            await kaderWithPlayers();
            let res = await put("/api/kader/assignments", { userId: U1, characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", onlineKey: "forever~aldric sturmwind", specs: [{ spec: "Warrior-Fury", main: true, gear: "usable" }] }], activeCharacterId: "c1" });
            const aldric = body(res).players.find((p) => p.userId === U1);
            expect(aldric).toMatchObject({ hasOverride: true, differs: ["mainSpec", "gear", "tank"] });
            res = await post("/api/kader/assignments/reset", { userId: U1 });
            expect(body(res).players.find((p) => p.userId === U1).hasOverride).toBe(false);
            expect(fs.readFileSync(profileFile, "utf8")).toBe(profileBefore);
        });
    });
});
