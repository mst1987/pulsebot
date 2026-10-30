// The Kaderplaner routes (docs/kaderplaner.md), driven through the real router:
// the area gate (only full admins and explicit grants; read-only sees all and
// changes nothing), the privacy of the view model, and a Kader walked from the
// pool to the roster — every write in the planner's store, never in a profile.
const fs = require("fs");
const { status, body, routerClient } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    getRealUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../../src/services/discord/discord"),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
}));
jest.mock("../../../../src/services/events/eventSources", () => ({
    ...jest.requireActual("../../../../src/services/events/eventSources"),
    listStoredEvents: jest.fn(() => []),
}));
jest.mock("../../../../src/services/roster/rosterRoleSync", () => ({
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, results: [] })),
}));
jest.mock("../../../../src/services/roster/rosterTakeover", () => ({
    precheck: jest.fn(async () => ({ blockers: [], notes: [], players: [] })),
    start: jest.fn(async () => ({ takeover: { roleId: "role1" }, steps: [], assigning: 1 })),
    pullRole: jest.fn(async () => ({ count: 2, away: 0 })),
    dropPlayers: jest.fn(async () => 0),
}));
jest.mock("../../../../src/web/characters/profileLogs", () => ({
    ...jest.requireActual("../../../../src/web/characters/profileLogs"),
    logIndex: jest.fn(() => new Map()),
}));

const auth = require("../../../../src/web/http/auth");
const discord = require("../../../../src/services/discord/discord");
const { listStoredEvents } = require("../../../../src/services/events/eventSources");
const profiles = require("../../../../src/stores/roster/raiderProfileStore");
const kaderStore = require("../../../../src/stores/roster/kaderStore");
const rosterStore = require("../../../../src/stores/roster/rosterStore");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../../src/config/permissions");
const { get, post, request } = routerClient(require("../../../../src/web/apiRoutes/roster/kader"));
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
        characters: [
            { name: "Aldric Sturmwind", versionId: "forever", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }, { key: "Warrior-Fury", gear: "none" }] },
            { name: "Devi", versionId: "tbc", className: "Priest", specs: [{ key: "Priest-Holy", gear: "usable" }] },
        ],
        availability: ["mi"],
        wishes: [U2], avoidEnabled: true, avoid: [U3], note: "PRIVATE-NOTE",
    } } }));
    profileBefore = fs.readFileSync(profileFile, "utf8");
    profiles.useFile(profileFile);
});
afterAll(() => {
    profiles.useFile(null);
    kaderStore.useFile(null);
    rosterStore.useFile(null);
});

let storeCount = 0;
beforeEach(() => {
    jest.clearAllMocks();
    storeCount += 1;
    kaderStore.useFile(tempStoreFile(`kader-${storeCount}.json`));
    rosterStore.useFile(tempStoreFile(`rosters-${storeCount}.json`));
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
    describe("Vermerke short form (#981)", () => {
        it("gives the orga the field", async () => {
            const { kaderId } = await kaderWithPlayers();
            const res = await get("/api/kader", { kader: kaderId });
            expect(status(res)).toBe(200);
            expect(body(res)).toHaveProperty("vermerke");
        });

        it("gives a Kader reader without the short-form right no field (they may stand in the pool)", async () => {
            const { kaderId } = await kaderWithPlayers();
            auth.getUser.mockReturnValue(granted("write"));
            const res = await get("/api/kader", { kader: kaderId });
            expect(status(res)).toBe(200);
            expect(body(res)).not.toHaveProperty("vermerke");
            auth.getUser.mockReturnValue(granted("read"));
            expect(body(await get("/api/kader", { kader: kaderId }))).not.toHaveProperty("vermerke");
        });
    });

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
            const view = body(await get("/api/kader", { kader: kaderId, version: "forever" }));
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

        it("lists a Kader only under its game version (#741): no Forever Kader in the TBC view", async () => {
            const { kaderId } = await kaderWithPlayers();
            const tbcKader = body(await post("/api/kader/kaders", { name: "TBC-Kader", versionId: "tbc" }));
            expect(tbcKader.kader.versionId).toBe("tbc");
            // a change inside a Kader answers the list of its own version
            expect(tbcKader.kaders.map((k) => k.id)).toEqual([tbcKader.kaderId]);
            const forever = body(await get("/api/kader", { version: "forever" }));
            expect(forever.kaders.map((k) => [k.id, k.versionId])).toEqual([[kaderId, "forever"]]);
            const tbc = body(await get("/api/kader", { version: "tbc" }));
            expect(tbc.kaders.map((k) => [k.id, k.versionId])).toEqual([[tbcKader.kaderId, "tbc"]]);
            // without a version: the main version (TBC), never every Kader
            expect(body(await get("/api/kader", { version: "all" })).kaders.map((k) => k.id)).toEqual([tbcKader.kaderId]);
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

    describe("one game version per Kader (#741: Forever = Forever characters)", () => {
        const configStore = require("../../../../src/stores/settings/configStore");
        const devi = { id: "d1", name: "Devi", nameStyle: "nick", className: "Priest", specs: [{ spec: "Priest-Holy", main: true }], onlineKey: "devi" };
        const aldric = { id: "a1", name: "Aldric Sturmwind", nameStyle: "forever", className: "Warrior", specs: [], onlineKey: "forever~aldric sturmwind" };
        afterEach(() => configStore.useFile(null));

        it("offers only the profile characters of the Kader's version to assign", async () => {
            const { kaderId } = await kaderWithPlayers();
            const forever = body(await get("/api/kader", { kader: kaderId, version: "forever" }));
            expect(forever.players.find((p) => p.userId === U1).pickable.map((c) => c.name)).toEqual(["Aldric Sturmwind"]);
            const tbc = body(await post("/api/kader/kaders", { name: "TBC-Kader", versionId: "tbc" }));
            // the named Kader decides the version the planner reads, whatever the page shows
            const view = body(await get("/api/kader", { kader: tbc.kaderId, version: "forever" }));
            expect(view.versionId).toBe("tbc");
            expect(view.players.find((p) => p.userId === U1).pickable.map((c) => c.name)).toEqual(["Devi"]);
        });

        it("refuses a profile character of another version in the planner's character data", async () => {
            const { kaderId } = await kaderWithPlayers();
            let res = await put("/api/kader/assignments", { kaderId, userId: U1, characters: [devi], activeCharacterId: "d1" });
            expect(status(res)).toBe(400);
            expect(body(res).error.message).toBe("Devi ist ein TBC-Charakter – hier zählen nur Charaktere aus Forever.");
            expect(kaderStore.readPlanner("g1").assignments[U1]).toBeUndefined();
            // a Forever profile character and one typed by hand are fine
            res = await put("/api/kader/assignments", { kaderId, userId: U1, characters: [aldric, { id: "h1", name: "Hand Name", nameStyle: "forever", className: "Mage", specs: [] }], activeCharacterId: "a1" });
            expect(status(res)).toBe(200);
            // in a TBC Kader it is the other way round
            const tbc = body(await post("/api/kader/kaders", { name: "TBC-Kader", versionId: "tbc" }));
            expect(status(await put("/api/kader/assignments", { kaderId: tbc.kaderId, userId: U1, characters: [devi], activeCharacterId: "d1" }))).toBe(200);
            expect(status(await put("/api/kader/assignments", { kaderId: tbc.kaderId, userId: U1, characters: [aldric], activeCharacterId: "a1" }))).toBe(400);
        });

        it("creates no Kader of a hidden version (#563)", async () => {
            const file = tempStoreFile("kader-route-hidden.json");
            fs.writeFileSync(file, JSON.stringify({ mainVersion: "tbc", hideOtherVersions: true }));
            configStore.useFile(file);
            const res = await post("/api/kader/kaders", { name: "Forever", versionId: "forever" });
            expect(status(res)).toBe(400);
            expect(body(res).error.code).toBe("version_hidden");
            // without a pick the planner's own version (Forever, hidden here) gives way to the main version
            expect(body(await post("/api/kader/kaders", { name: "Ohne" })).kader.versionId).toBe("tbc");
        });
    });

    describe("the raid categories attendance counts in", () => {
        const past = (days) => Math.floor(Date.now() / 1000) - days * 86400;
        const configStore = require("../../../../src/stores/settings/configStore");

        // Only active categories count (#744): both raid categories are marked for events.
        beforeAll(() => {
            const file = tempStoreFile("kader-route-config.json");
            fs.writeFileSync(file, JSON.stringify({ categoryIds: ["c-mo", "c-do", "c-tbc"], categoryVersion: { "c-mo": "forever", "c-do": "forever" } }));
            configStore.useFile(file);
        });
        afterAll(() => configStore.useFile(null));

        beforeEach(() => {
            listStoredEvents.mockReturnValue([
                { id: "e1", guildId: "g1", categoryId: "c-mo", categoryName: "Mo Raid", versionId: "forever", title: "Kara", startTime: past(3), signUps: [{ userId: U1, status: "signed" }] },
                { id: "e2", guildId: "g1", categoryId: "c-do", categoryName: "Do Raid", versionId: "forever", title: "Gruul", startTime: past(6), signUps: [{ userId: U1, status: "absence" }] },
                { id: "e3", guildId: "g1", categoryId: "c-mo", categoryName: "Mo Raid", versionId: "forever", title: "Kara", startTime: past(10), signUps: [{ userId: U1, status: "signed" }] },
                { id: "e4", guildId: "g1", categoryId: "c-tbc", categoryName: "TBC Raid", versionId: "tbc", title: "Kara", startTime: past(4), signUps: [{ userId: U1, status: "signed" }] },
            ]);
        });

        it("hands out the server's raid categories and each account's attendance per category", async () => {
            const { kaderId } = await kaderWithPlayers();
            const view = body(await get("/api/kader", { kader: kaderId }));
            // the Kader's own version first; a category of another version uncounted (null) until a Kader picks it
            expect(view.raidCategories.map((c) => [c.id, c.name, c.nights])).toEqual([["c-mo", "Mo Raid", 2], ["c-do", "Do Raid", 1], ["c-tbc", "TBC Raid", null]]);
            expect(view.raidCategories[0]).toEqual({ id: "c-mo", name: "Mo Raid", versionId: "forever", versionLabel: "Forever", hidden: false, nights: 2 });
            const aldric = view.players.find((p) => p.userId === U1);
            expect(aldric.attendance["c-mo"]).toMatchObject({ attended: 2, counted: 2, versionId: "forever" });
            expect(aldric.attendance["c-tbc"]).toBeUndefined();
            expect(aldric.attendance["c-do"]).toMatchObject({ attended: 0, counted: 1, nights: [expect.objectContaining({ title: "Gruul", reason: "abgemeldet" })] });
            // a new Kader counts in no category until a lead picks one
            expect(view.kader.attendanceCategories).toEqual([]);
        });

        it("keeps the pick on the Kader for every lead, leaving out what is no raid category", async () => {
            const { kaderId } = await kaderWithPlayers();
            let res = await put("/api/kader/kaders", { kaderId, attendanceCategories: ["c-mo", "c-nope"] });
            expect(status(res)).toBe(200);
            expect(Object.keys(body(res)).sort()).toEqual(["kader", "kaders", "sharedRev"]);
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

        it("lets a Forever Kader count the attendance of a TBC category, read in TBC (the attendance exception)", async () => {
            const { kaderId } = await kaderWithPlayers();
            const res = await put("/api/kader/kaders", { kaderId, attendanceCategories: ["c-mo", "c-tbc"] });
            expect(status(res)).toBe(200);
            expect(body(res).kader.attendanceCategories).toEqual(["c-mo", "c-tbc"]);
            expect(kaderStore.readPlanner("g1").kaders[0].attendanceCategories).toEqual(["c-mo", "c-tbc"]);
            // now picked, the TBC category is counted: its TBC night, nothing of the Forever nights
            const view = body(await get("/api/kader", { kader: kaderId }));
            expect(view.versionId).toBe("forever");
            expect(view.raidCategories.map((c) => [c.id, c.versionId, c.nights])).toEqual([["c-mo", "forever", 2], ["c-do", "forever", 1], ["c-tbc", "tbc", 1]]);
            const aldric = view.players.find((p) => p.userId === U1);
            expect(aldric.attendance["c-tbc"]).toEqual({ attended: 1, counted: 1, versionId: "tbc", nights: [expect.objectContaining({ title: "Kara", attended: true })] });
            // the strict separation stays everywhere else: the characters to assign are Forever ones
            expect(aldric.pickable.map((c) => c.name)).toEqual(["Aldric Sturmwind"]);
            // a TBC Kader sees its own categories first and the Forever ones after them
            const tbc = body(await post("/api/kader/kaders", { name: "TBC-Kader", versionId: "tbc" }));
            const tbcView = body(await get("/api/kader", { kader: tbc.kaderId, version: "tbc" }));
            expect(tbcView.versionId).toBe("tbc");
            expect(tbcView.raidCategories.map((c) => [c.id, c.nights])).toEqual([["c-tbc", 1], ["c-mo", null], ["c-do", null]]);
        });

        it("offers and keeps a category of a hidden version, marked hidden (#563)", async () => {
            const file = tempStoreFile("kader-route-config-hidden.json");
            fs.writeFileSync(file, JSON.stringify({ categoryIds: ["c-mo", "c-do", "c-tbc"], categoryVersion: { "c-mo": "forever", "c-do": "forever", "c-tbc": "tbc" }, mainVersion: "forever", hideOtherVersions: true }));
            configStore.useFile(file);
            try {
                const { kaderId } = await kaderWithPlayers();
                const before = body(await get("/api/kader", { kader: kaderId }));
                expect(before.raidCategories.map((c) => [c.id, c.hidden])).toEqual([["c-mo", false], ["c-do", false], ["c-tbc", true]]);
                const res = await put("/api/kader/kaders", { kaderId, attendanceCategories: ["c-tbc"] });
                expect(status(res)).toBe(200);
                expect(body(res).kader.attendanceCategories).toEqual(["c-tbc"]);
                const view = body(await get("/api/kader", { kader: kaderId }));
                expect(view.players.find((p) => p.userId === U1).attendance["c-tbc"]).toMatchObject({ counted: 1, versionId: "tbc" });
            } finally {
                const back = tempStoreFile("kader-route-config-back.json");
                fs.writeFileSync(back, JSON.stringify({ categoryIds: ["c-mo", "c-do", "c-tbc"], categoryVersion: { "c-mo": "forever", "c-do": "forever" } }));
                configStore.useFile(back);
            }
        });
    });

    describe("a Kader from the pool to the roster", () => {
        it("walks the pipeline, answering changes inside the Kader with the Kader alone", async () => {
            const { kaderId, view } = await kaderWithPlayers();
            // the import answered the whole view; Aldric starts with his profile's spec as the wish
            expect(view.kader.players[U1]).toMatchObject({ state: "pool", wishes: [{ className: "Warrior", spec: "Warrior-Protection" }], addedBy: LEAD });
            expect(view.kader.players[U2]).toMatchObject({ name: "Bea", wishes: [] });

            let res = await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "selected" });
            expect(Object.keys(body(res)).sort()).toEqual(["kader", "kaders", "moved", "sharedRev", "skipped"]);
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
            expect(body(res).kader.setups[0]).toMatchObject({ size: 10, groups: [[{ userId: U1, spec: "Warrior-Protection" }, null, null, null, null], expect.any(Array), expect.any(Array), expect.any(Array), expect.any(Array), expect.any(Array), expect.any(Array), expect.any(Array)] });
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
                ["added", "state", "interview_saved", "lead", "interview_completed", "state", "vote", "state", "decision"],
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

        it("plays a composition draft through: plan a spec, leave a player out, take it over without a state change", async () => {
            const { kaderId } = await kaderWithPlayers();
            await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "selected" });
            await put("/api/kader/interview", { kaderId, userId: U1, wishes: [{ className: "Warrior", spec: "Warrior-Protection" }, { className: "Warrior", spec: "Warrior-Fury" }] });
            await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "provisional" });

            let res = await put("/api/kader/plan", { kaderId, userId: U1, spec: { className: "Warrior", spec: "Warrior-Fury" } });
            expect(status(res)).toBe(200);
            const draft = body(res).kader.plan;
            expect(draft).toMatchObject({ specs: { [U1]: { className: "Warrior", spec: "Warrior-Fury" } }, excluded: [], by: LEAD, rev: expect.any(Number) });
            res = await put("/api/kader/plan", { kaderId, userId: U2, excluded: true });
            expect(body(res).kader.plan.excluded).toEqual([U2]);
            // a spec outside the wishes, and a player outside the composition
            expect(status(await put("/api/kader/plan", { kaderId, userId: U1, spec: { className: "Warrior", spec: "Warrior-Arms" } }))).toBe(400);

            // the confirmation was shown for the first draft: somebody changed it since
            res = await post("/api/kader/plan/apply", { kaderId, baseRev: draft.rev });
            expect(status(res)).toBe(409);
            expect(body(res).error).toMatchObject({ code: "stale", by: LEAD });
            res = await post("/api/kader/plan/apply", { kaderId, baseRev: body(await get("/api/kader", { kader: kaderId })).kader.plan.rev });
            expect(status(res)).toBe(200);
            expect(body(res)).toMatchObject({ applied: 1 });
            expect(body(res).kader.plan).toBeNull();
            expect(body(res).kader.players[U1]).toMatchObject({ state: "provisional", decision: { className: "Warrior", spec: "Warrior-Fury" } });
            expect(body(res).kader.players[U2]).toMatchObject({ state: "provisional", decision: null });
            expect(body(res).kader.activity.at(-1)).toMatchObject({ type: "plan_applied", playerId: U1 });

            // nothing left to take over or to throw away
            expect(status(await post("/api/kader/plan/apply", { kaderId }))).toBe(409);
            expect(status(await post("/api/kader/plan/discard", { kaderId }))).toBe(409);
            await put("/api/kader/plan", { kaderId, userId: U2, excluded: true });
            expect(body(await post("/api/kader/plan/apply", { kaderId })).error.message).toMatch(/keine Entscheidung/);
            // taking the last change back empties the draft: gone, as a change of it - no "Verwerfen"
            const before = body(await get("/api/kader", { kader: kaderId })).kader.activity.length;
            res = await put("/api/kader/plan", { kaderId, userId: U2, excluded: false });
            expect(body(res).kader.plan).toBeNull();
            expect(body(res).kader.activity.map((a) => a.type)).not.toContain("plan_discarded");
            expect(body(res).kader.activity.at(-1).type).toBe("plan");
            // without a draft a change that leaves it empty writes nothing
            const rev = body(res).kader.rev;
            res = await put("/api/kader/plan", { kaderId, userId: U2, excluded: false });
            expect(body(res).kader).toMatchObject({ plan: null, rev });
            expect(body(res).kader.activity.length).toBeLessThanOrEqual(before);

            // throwing away a draft that moved on since the dialog opened: 409 stale
            res = await put("/api/kader/plan", { kaderId, userId: U2, excluded: true });
            const shown = body(res).kader.plan.rev;
            await put("/api/kader/plan", { kaderId, userId: U1, excluded: true });
            res = await post("/api/kader/plan/discard", { kaderId, baseRev: shown });
            expect(status(res)).toBe(409);
            expect(body(res).error.code).toBe("stale");
            res = await post("/api/kader/plan/discard", { kaderId, baseRev: body(await get("/api/kader", { kader: kaderId })).kader.plan.rev });
            expect(body(res).kader.plan).toBeNull();
            expect(body(res).kader.activity.at(-1).type).toBe("plan_discarded");
        });

        it("lets a reader see the draft but neither change, take over nor throw it away; and checks the CSRF token", async () => {
            const { kaderId } = await kaderWithPlayers();
            await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "selected" });
            await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "provisional" });
            await put("/api/kader/plan", { kaderId, userId: U1, excluded: true });
            auth.getUser.mockReturnValue(granted("read"));
            expect(body(await get("/api/kader", { kader: kaderId })).kader.plan.excluded).toEqual([U1]);
            expect(status(await put("/api/kader/plan", { kaderId, userId: U1, excluded: false }))).toBe(403);
            expect(status(await post("/api/kader/plan/apply", { kaderId }))).toBe(403);
            expect(status(await post("/api/kader/plan/discard", { kaderId }))).toBe(403);
            auth.getUser.mockReturnValue(OUTSIDER);
            expect(status(await put("/api/kader/plan", { kaderId, userId: U1, excluded: false }))).toBe(403);
            auth.getUser.mockReturnValue(null);
            expect(status(await post("/api/kader/plan/discard", { kaderId }))).toBe(401);
            auth.getUser.mockReturnValue(ADMIN);
            auth.checkCsrf.mockReturnValue(false);
            expect(status(await post("/api/kader/plan/discard", { kaderId }))).toBe(403);
            expect(kaderStore.readPlanner("g1").kaders[0].plan.excluded).toEqual([U1]);
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

describe("web/apiRoutes/kader the raid roster (#658)", () => {
    const MARK = "KADER-GEHEIM";
    /** A Kader with Aldric decided into the roster, interview note and comment carrying a marker. */
    async function decidedKader() {
        const { kaderId } = await kaderWithPlayers();
        await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "selected" });
        await put("/api/kader/interview", { kaderId, userId: U1, wishes: [{ className: "Warrior", spec: "Warrior-Fury" }], note: MARK, lead: LEAD });
        await post("/api/kader/comments", { kaderId, userId: U1, text: MARK });
        await post("/api/kader/interview/complete", { kaderId, userId: U1 });
        await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "provisional" });
        await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "roster", decision: { className: "Warrior", spec: "Warrior-Fury" } });
        return kaderId;
    }
    const rosterFrom = (kaderId, extra = {}) => rosterStore.createRoster({ guildId: "g1", name: "Forever-Roster", versionId: "forever", source: { kind: "kader", kaderId }, ...extra });

    it("says what the roster button offers: create while there is none (admins), take over once there is", async () => {
        const kaderId = await decidedKader();
        let res = await get("/api/kader/roster", { kader: kaderId });
        expect(body(res)).toEqual({ roster: null, candidates: 1, pending: 1, canCreate: true, canSync: false, canLink: true, lootCouncil: false, rosters: [] });
        // #676: a roster running as Loot-Council offers "Zum Loot-Council" (only its id crosses)
        const roster = rosterFrom(kaderId, { lootSystem: "lootcouncil" });
        res = await get("/api/kader/roster", { kader: kaderId });
        expect(body(res)).toEqual({
            roster: { id: roster.id, name: "Forever-Roster", members: 0 }, candidates: 1, pending: 1, canCreate: false, canSync: true, canLink: true, lootCouncil: true,
            rosters: [{ id: roster.id, name: "Forever-Roster", categoryId: null, members: 0, linkedKaderId: null, suggested: false }],
        });
        expect(status(await get("/api/kader/roster", { kader: "nope" }))).toBe(404);
    });

    it("offers the council link only to a reader of the loot council (#676)", async () => {
        const kaderId = await decidedKader();
        rosterFrom(kaderId, { lootSystem: "lootcouncil" });
        auth.getUser.mockReturnValue(granted("read"));
        expect(body(await get("/api/kader/roster", { kader: kaderId })).lootCouncil).toBe(false);
    });

    it("takes the decided players into the roster - status and character only, nothing private", async () => {
        const kaderId = await decidedKader();
        const roster = rosterFrom(kaderId);
        const res = await post("/api/kader/roster/sync", { kaderId });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ rosterId: roster.id, added: 1, skipped: 0, kept: 0, roleFailures: [] });
        expect(rosterStore.getRoster(roster.id).members[U1]).toEqual(expect.objectContaining({ status: "core", chars: ["forever~aldric sturmwind"], by: LEAD }));
        const file = JSON.stringify(rosterStore.getRoster(roster.id));
        for (const marker of [MARK, "PRIVATE-NOTE", "wishes", "votes", "comments"]) expect(file).not.toContain(marker);
        // a second run finds nobody new and touches nobody
        expect(body(await post("/api/kader/roster/sync", { kaderId }))).toMatchObject({ added: 0, kept: 1 });
        expect(fs.readFileSync(profileFile, "utf8")).toBe(profileBefore);
    });

    it("lets only a manager of that roster with kader write take players over", async () => {
        const kaderId = await decidedKader();
        expect(status(await post("/api/kader/roster/sync", { kaderId }))).toBe(404);
        const roster = rosterFrom(kaderId);
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        let res = await post("/api/kader/roster/sync", { kaderId });
        expect(status(res)).toBe(403);
        expect(body(res).error.code).toBe("not_manager");
        expect(body(await get("/api/kader/roster", { kader: kaderId }))).toMatchObject({ canCreate: false, canSync: false });
        rosterStore.updateRoster(roster.id, { managers: { roleIds: [], userIds: [writer.id] } });
        expect(body(await get("/api/kader/roster", { kader: kaderId }))).toMatchObject({ canSync: true });
        res = await post("/api/kader/roster/sync", { kaderId });
        expect(body(res)).toMatchObject({ added: 1 });
        // a read grant never writes, manager or not
        const reader = granted("read", writer.id);
        auth.getUser.mockReturnValue(reader);
        expect(status(await post("/api/kader/roster/sync", { kaderId }))).toBe(403);
        expect(body(await get("/api/kader/roster", { kader: kaderId }))).toMatchObject({ canSync: false });
    });

    it("links the Kader to an existing (migrated) roster - full admins only - and syncs into exactly that one", async () => {
        const kaderId = await decidedKader();
        const migrated = rosterStore.createRoster({ guildId: "g1", name: "Mo-Raider", versionId: "forever", source: { kind: "migration" } });
        const other = rosterStore.createRoster({ guildId: "g1", name: "Andere", versionId: "forever" });
        // a writer of the Kaderplaner who is no full admin may not link and sees no rosters
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        expect(body(await get("/api/kader/roster", { kader: kaderId }))).toMatchObject({ canLink: false, rosters: [] });
        let res = await post("/api/kader/roster/link", { kaderId, rosterId: migrated.id });
        expect([status(res), body(res).error.code]).toEqual([403, "admin_only"]);
        auth.getUser.mockReturnValue(ADMIN);
        res = await post("/api/kader/roster/link", { kaderId, rosterId: migrated.id });
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ roster: { id: migrated.id, name: "Mo-Raider" }, canCreate: false, canSync: true, canLink: true });
        expect(rosterStore.getRoster(migrated.id).kaderId).toBe(kaderId);
        expect(body(await post("/api/kader/roster/sync", { kaderId }))).toMatchObject({ rosterId: migrated.id, added: 1 });
        expect(Object.keys(rosterStore.getRoster(other.id).members)).toEqual([]);
        // unknown roster 404, unlink with ""
        expect(status(await post("/api/kader/roster/link", { kaderId, rosterId: "nope" }))).toBe(404);
        res = await post("/api/kader/roster/link", { kaderId, rosterId: "" });
        expect(body(res)).toMatchObject({ roster: null, canCreate: true });
        // nothing private reached the roster through the link
        const file = JSON.stringify(rosterStore.getRoster(migrated.id));
        for (const marker of [MARK, "wishes", "votes", "comments"]) expect(file).not.toContain(marker);
    });

    it("refuses a roster another Kader holds with kader_taken", async () => {
        const kaderId = await decidedKader();
        const held = rosterStore.createRoster({ guildId: "g1", name: "Belegt", kaderId: "other-kader" });
        const res = await post("/api/kader/roster/link", { kaderId, rosterId: held.id });
        expect([status(res), body(res).error.code]).toEqual([409, "kader_taken"]);
    });
});

describe("web/apiRoutes/kader the takeover (docs/kaderplaner.md \"Übernahme\")", () => {
    const takeover = require("../../../../src/services/roster/rosterTakeover");
    const { AppError } = require("../../../../src/web/http/apiResult");
    const model = require("../../../../src/services/kader/kaderModel");
    const kaderRoster = require("../../../../src/services/kader/kaderRoster");
    const START = { confirm: true, baseRev: 3, role: { name: "Raider" }, category: { name: "Forever" }, channels: [] };

    async function linkedKader() {
        const { kaderId } = await kaderWithPlayers();
        const roster = rosterStore.createRoster({ guildId: "g1", name: "Forever-Roster", versionId: "forever", kaderId });
        return { kaderId, roster };
    }

    it("GET: the precheck and whether this user may start", async () => {
        const { kaderId, roster } = await linkedKader();
        let res = await get("/api/kader/takeover", { kader: kaderId });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ blockers: [], notes: [], players: [], canStart: true });
        expect(takeover.precheck).toHaveBeenCalledWith("g1", kaderId, { withCategories: true });
        // a reader sees the dialog and may not start - and gets no categories
        auth.getUser.mockReturnValue(granted("read"));
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(false);
        expect(takeover.precheck).toHaveBeenLastCalledWith("g1", kaderId, { withCategories: false });
        // a writer only as a manager of the roster
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(false);
        rosterStore.updateRoster(roster.id, { managers: { roleIds: [], userIds: [writer.id] } });
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(true);
        takeover.precheck.mockRejectedValueOnce(new AppError("kader_not_found", 404, "Kader nicht gefunden."));
        res = await get("/api/kader/takeover", { kader: "nope" });
        expect([status(res), body(res).error.code]).toEqual([404, "kader_not_found"]);
        auth.getUser.mockReturnValue(OUTSIDER);
        expect(status(await get("/api/kader/takeover", { kader: kaderId }))).toBe(403);
    });

    it("without a linked roster the takeover creates one: full admins with kader write only", async () => {
        const { kaderId } = await kaderWithPlayers();
        let res = await post("/api/kader/takeover", { kaderId: "nope", ...START });
        expect([status(res), body(res).error.code]).toEqual([404, "not_found"]);
        // a writer of the Kader who is no full admin: neither start nor canStart
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        res = await post("/api/kader/takeover", { kaderId, ...START });
        expect([status(res), body(res).error.code]).toEqual([403, "admin_only"]);
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(false);
        expect(takeover.precheck).toHaveBeenLastCalledWith("g1", kaderId, { withCategories: false });
        // a full admin may - and "Rolle nachziehen" still needs a roster
        auth.getUser.mockReturnValue(ADMIN);
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(true);
        expect(takeover.precheck).toHaveBeenLastCalledWith("g1", kaderId, { withCategories: true });
        expect(status(await post("/api/kader/takeover/role", { kaderId }))).toBe(404);
        res = await post("/api/kader/takeover", { kaderId, ...START, roster: { name: "Neu", categoryId: "" } });
        expect(status(res)).toBe(200);
        expect(takeover.start).toHaveBeenCalledWith("g1", kaderId, expect.objectContaining({ roster: { name: "Neu", categoryId: "" } }), { actor: LEAD, createsRoster: true });
    });

    it("a recorded takeover whose roster is gone creates none (404, no admin path)", async () => {
        const { kaderId } = await kaderWithPlayers();
        kaderRoster.saveTakeover("g1", kaderId, { rosterId: "gone", roleId: "role1", roleName: "Raider", categoryId: "", channelIds: [] });
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(false);
        expect(status(await post("/api/kader/takeover", { kaderId, ...START }))).toBe(404);
        expect(takeover.start).not.toHaveBeenCalled();
    });

    it("POST: full admins and roster managers with kader write only", async () => {
        const { kaderId, roster } = await linkedKader();
        let res;
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        res = await post("/api/kader/takeover", { kaderId, ...START });
        expect([status(res), body(res).error.code]).toEqual([403, "not_manager"]);
        auth.getUser.mockReturnValue(granted("read", writer.id));
        rosterStore.updateRoster(roster.id, { managers: { roleIds: [], userIds: [writer.id] } });
        expect(status(await post("/api/kader/takeover", { kaderId, ...START }))).toBe(403);
        expect(takeover.start).not.toHaveBeenCalled();
        auth.getUser.mockReturnValue(writer);
        res = await post("/api/kader/takeover", { kaderId, ...START });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ takeover: { roleId: "role1" }, steps: [], assigning: 1 });
        expect(takeover.start).toHaveBeenCalledWith("g1", kaderId, expect.objectContaining({ confirm: true, baseRev: 3 }), { actor: writer.id, createsRoster: false });
    });

    it("the rights follow the roster a recorded takeover writes into, not the one linked now", async () => {
        const { kaderId, roster } = await linkedKader();
        const target = rosterStore.createRoster({ guildId: "g1", name: "Ziel", versionId: "forever" });
        kaderRoster.saveTakeover("g1", kaderId, { rosterId: target.id, roleId: "role1", roleName: "Raider", categoryId: "", channelIds: [] });
        const writer = granted("write");
        auth.getUser.mockReturnValue(writer);
        // a manager of the linked roster only: no rights for the takeover's roster
        rosterStore.updateRoster(roster.id, { managers: { roleIds: [], userIds: [writer.id] } });
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(false);
        expect(status(await post("/api/kader/takeover/role", { kaderId }))).toBe(403);
        rosterStore.updateRoster(target.id, { managers: { roleIds: [], userIds: [writer.id] } });
        expect(body(await get("/api/kader/takeover", { kader: kaderId })).canStart).toBe(true);
        expect(status(await post("/api/kader/takeover/role", { kaderId }))).toBe(200);
    });

    it("a taken-over Kader can neither be relinked nor unlinked (409 kader_taken_over)", async () => {
        const { kaderId, roster } = await linkedKader();
        kaderRoster.saveTakeover("g1", kaderId, { rosterId: roster.id, roleId: "role1", roleName: "Raider", categoryId: "", channelIds: [] });
        const other = rosterStore.createRoster({ guildId: "g1", name: "Andere", versionId: "forever" });
        let res = await post("/api/kader/roster/link", { kaderId, rosterId: other.id });
        expect([status(res), body(res).error.code]).toEqual([409, "kader_taken_over"]);
        res = await post("/api/kader/roster/link", { kaderId, rosterId: "" });
        expect([status(res), body(res).error.code]).toEqual([409, "kader_taken_over"]);
        expect(rosterStore.getRoster(roster.id).kaderId).toBe(kaderId);
    });

    it("POST: answers a refusal with its code, a stale one with the current rev", async () => {
        const { kaderId } = await linkedKader();
        takeover.start.mockRejectedValueOnce(new AppError("base_rev_required", 400, "baseRev fehlt"));
        let res = await post("/api/kader/takeover", { kaderId, confirm: true });
        expect([status(res), body(res).error.code]).toEqual([400, "base_rev_required"]);
        let stale;
        try {
            model.assertFresh({ baseRev: 1 }, 4, "Der Kader hat sich geändert.", { kaderId });
        } catch (e) {
            stale = e;
        }
        takeover.start.mockRejectedValueOnce(stale);
        res = await post("/api/kader/takeover", { kaderId, ...START });
        expect(status(res)).toBe(409);
        expect(body(res).error).toMatchObject({ code: "stale", kaderId });
    });

    it("POST role: the count of players the role goes to", async () => {
        const { kaderId } = await linkedKader();
        let res = await post("/api/kader/takeover/role", { kaderId });
        expect([status(res), body(res)]).toEqual([200, { count: 2, away: 0 }]);
        expect(takeover.pullRole).toHaveBeenCalledWith("g1", kaderId, { actor: LEAD });
        takeover.pullRole.mockImplementationOnce(async () => { throw new AppError("not_taken", 409, "Noch nicht übernommen."); });
        res = await post("/api/kader/takeover/role", { kaderId });
        expect([status(res), body(res).error.code]).toEqual([409, "not_taken"]);
        auth.getUser.mockReturnValue(granted("write"));
        expect(status(await post("/api/kader/takeover/role", { kaderId }))).toBe(403);
    });

    it("a player of a taken-over Kader moved below provisional is dropped after the write", async () => {
        const { kaderId, roster } = await linkedKader();
        await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "selected" });
        await post("/api/kader/players/state", { kaderId, userIds: [U1, U2], to: "provisional" });
        kaderRoster.saveTakeover("g1", kaderId, { rosterId: roster.id, roleId: "role1", roleName: "Raider", categoryId: "", channelIds: [] });
        const res = await post("/api/kader/players/state", { kaderId, userIds: [U1], to: "selected" });
        expect(status(res)).toBe(200);
        await new Promise((r) => setImmediate(r));
        expect(takeover.dropPlayers).toHaveBeenCalledWith([{ kaderId, rosterId: roster.id, userId: U1 }], { actor: LEAD });
        const kader = kaderStore.readPlanner("g1").kaders.find((k) => k.id === kaderId);
        expect(kader.activity.slice(-1)[0]).toMatchObject({ type: "role_removed_kader", playerId: U1 });
        expect(kader.players[U1].history.slice(-1)[0]).toMatchObject({ type: "role_removed_kader", from: "provisional", to: "selected" });
        // U2 stays: nothing for them
        expect(takeover.dropPlayers).toHaveBeenCalledTimes(1);
    });
});
