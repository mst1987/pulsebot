// The API of "Event verwalten" (src/web/apiRoutes/events/eventManage.js, #288): every
// path is area `raids`, writes need write by method, the two reads check write
// in the handler, and each route hands the body to the service as it should.
let mockUser = null;
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
// #925: the event "eh-a" is one of the active server g1
jest.mock("../../../../src/stores/events/eventStore", () => ({
    ...jest.requireActual("../../../../src/stores/events/eventStore"),
    getEvent: (id) => (id === "eh-a" ? { id, guildId: "g1" } : null),
}));
jest.mock("../../../../src/services/events/eventManage", () => ({
    manageInfo: jest.fn(async () => ({ status: 200, body: { event: { id: "eh-a" } } })),
    movePlan: jest.fn(async () => ({ plan: { eventId: "eh-a", channel: { rename: true } } })),
    moveEvent: jest.fn(async () => ({ status: 200, body: { message: "Verschoben." } })),
    setSignupsOpen: jest.fn(async () => ({ status: 200, body: { message: "ok" } })),
    raiderCandidates: jest.fn(async () => ({ status: 200, body: { raiders: [], classes: [] } })),
    addRaider: jest.fn(async () => ({ error: { status: 400, code: "spec", message: "Bitte eine Spezialisierung wählen." } })),
    removeRaider: jest.fn(async () => ({ status: 200, body: { message: "ausgetragen" } })),
    cancelEvent: jest.fn(async () => ({ status: 200, body: { message: "abgesagt" } })),
    reopenEvent: jest.fn(async () => ({ status: 200, body: { message: "offen" } })),
    deleteEvent: jest.fn(async () => ({ status: 200, body: { message: "gelöscht", warnings: [] } })),
    recreateChannel: jest.fn(async () => ({ status: 200, body: { message: "Kanal #mi-kara angelegt, Anmelde-Nachricht gepostet.", channelId: "c-new", channelName: "mi-kara" } })),
}));
jest.mock("../../../../src/services/discord/members/serverMembers", () => ({ serverMemberIds: jest.fn() }));
jest.mock("../../../../src/stores/events/signupStore", () => ({
    ...jest.requireActual("../../../../src/stores/events/signupStore"),
    getSignup: jest.fn(),
}));
jest.mock("../../../../src/services/characters/profileVisibility", () => ({ visibleRaiderIds: jest.fn() }));

const { visibleRaiderIds } = require("../../../../src/services/characters/profileVisibility");
const { serverMemberIds } = require("../../../../src/services/discord/members/serverMembers");
const { getSignup } = require("../../../../src/stores/events/signupStore");
const { readJsonBody } = require("../../../../src/web/http/apiBody");
const manage = require("../../../../src/services/events/eventManage");
const route = require("../../../../src/web/apiRoutes/events/eventManage");
const { checkAccess } = require("../../../../src/web/http/apiAccess");

// The orga is a role setting (permissions.userIsOrga), no area right: raider roles hold "raids" too.
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const PATHS = [
    "/api/raids/manage", "/api/raids/manage/move", "/api/raids/manage/signups", "/api/raids/manage/raider",
    "/api/raids/manage/raider/remove", "/api/raids/manage/cancel", "/api/raids/manage/reopen", "/api/raids/manage/delete",
    "/api/raids/manage/recreate-channel",
];

const { mockRes, status, body } = require("../../../helpers/http");

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, query ? new URL(`http://x/api/raids/manage?${query}`) : undefined);
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    // #1077: account "1" is one of the server's raiders
    visibleRaiderIds.mockResolvedValue(new Set(["1"]));
});

describe("access", () => {
    it("puts every path under raids: a reader may neither act nor read the previews", async () => {
        for (const path of PATHS) {
            expect({ path, gate: checkAccess(path, "POST", READER) }).toEqual({ path, gate: expect.objectContaining({ status: 403 }) });
            expect({ path, gate: checkAccess(path, "POST", ORGA) }).toEqual({ path, gate: null });
        }
        const member = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
        expect(checkAccess("/api/raids/manage", "GET", member)).toMatchObject({ status: 403 });
        for (const handler of [route.getManage, route.getMovePreview, route.getRaiderCandidates]) {
            const r = await call(handler, READER, null, "event=eh-a");
            expect(status(r)).toBe(403);
        }
        expect(manage.manageInfo).not.toHaveBeenCalled();
    });

    it("refuses a raider role even with raids write: Event verwalten and its log are the orga's (Oct 2026)", async () => {
        const raiderWriter = { id: "rw", isAdmin: false, access: { raids: { read: true, write: true } } };
        for (const handler of [route.getManage, route.getMovePreview, route.getRaiderCandidates]) {
            const r = await call(handler, raiderWriter, null, "event=eh-a");
            expect(status(r)).toBe(403);
            expect(body(r).error.code).toBe("orga_only");
        }
        for (const handler of [route.postMove, route.postSignups, route.postRaider, route.postRaiderRemove, route.postCancel, route.postReopen, route.postDelete, route.postRecreateChannel]) {
            const r = await call(handler, raiderWriter, { event: "eh-a" });
            expect(status(r)).toBe(403);
        }
        expect(manage.manageInfo).not.toHaveBeenCalled();
        expect(manage.moveEvent).not.toHaveBeenCalled();
        expect(manage.deleteEvent).not.toHaveBeenCalled();
    });
});

describe("handlers", () => {
    it("reads the state and the move preview for the orga", async () => {
        const info = await call(route.getManage, ORGA, null, "event=eh-a");
        expect(status(info)).toBe(200);
        expect(manage.manageInfo).toHaveBeenCalledWith({ guildId: "g1", eventId: "eh-a" });
        const preview = await call(route.getMovePreview, ORGA, null, "event=eh-a&date=2026-09-26&time=20:00");
        expect(body(preview)).toMatchObject({ eventId: "eh-a", channel: { rename: true } });
        expect(manage.movePlan).toHaveBeenCalledWith({ guildId: "g1", eventId: "eh-a", date: "2026-09-26", time: "20:00" });
    });

    it("moves with rename and notify on unless switched off", async () => {
        await call(route.postMove, ORGA, { event: "eh-a", date: "2026-09-26", time: "20:00" });
        expect(manage.moveEvent).toHaveBeenLastCalledWith(expect.objectContaining({ renameChannel: true, notify: true, user: ORGA, byName: "Orga" }));
        await call(route.postMove, ORGA, { event: "eh-a", date: "2026-09-26", time: "20:00", renameChannel: false, notify: false });
        expect(manage.moveEvent).toHaveBeenLastCalledWith(expect.objectContaining({ renameChannel: false, notify: false }));
    });

    it("closes, signs up, signs off, cancels and reopens — errors keep their status", async () => {
        await call(route.postSignups, ORGA, { event: "eh-a", open: false });
        expect(manage.setSignupsOpen).toHaveBeenCalledWith(expect.objectContaining({ eventId: "eh-a", open: false }));
        const add = await call(route.postRaider, ORGA, { event: "eh-a", userId: "1", character: "A", spec: "" });
        expect(status(add)).toBe(400);
        expect(manage.addRaider).toHaveBeenCalledWith(expect.objectContaining({ status: "signed", character: "A" }));
        await call(route.postRaiderRemove, ORGA, { event: "eh-a", userId: "1" });
        expect(manage.removeRaider).toHaveBeenCalledWith(expect.objectContaining({ userId: "1" }));
        await call(route.postCancel, ORGA, { event: "eh-a", reason: "Zu wenig Heiler", archiveChannel: true });
        expect(manage.cancelEvent).toHaveBeenCalledWith(expect.objectContaining({ reason: "Zu wenig Heiler", archiveChannel: true, notify: true }));
        const reopen = await call(route.postReopen, ORGA, { event: "eh-a" });
        expect(body(reopen)).toMatchObject({ message: "offen" });
    });

    describe("a holder of only the server-admin rank (#1072): profiles are global", () => {
        const RANK = { id: "rank", name: "Rang", isAdmin: false, isOrga: true, isServerAdmin: true, access: { raids: { read: true, write: true } } };
        const NO_ROLES = { id: "rank", isAdmin: false, access: {} };
        const ORGA_ROLES = { id: "rank", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
        const orgaOfRaid = jest.spyOn(require("../../../../src/services/roster/categoryOrga"), "canOrgaEvent");
        let withoutRank;

        beforeEach(() => {
            orgaOfRaid.mockResolvedValue(false);
            withoutRank = jest.spyOn(require("../../../../src/web/http/auth"), "getUserWithoutRank").mockReturnValue(NO_ROLES);
            serverMemberIds.mockResolvedValue(new Set(["1"]));
            getSignup.mockReturnValue(null);
        });
        afterEach(() => withoutRank.mockRestore());
        afterAll(() => orgaOfRaid.mockRestore());

        it("limits the candidates and keeps the profiles of other accounts", async () => {
            await call(route.getRaiderCandidates, RANK, null, "event=eh-a");
            expect(manage.raiderCandidates).toHaveBeenLastCalledWith(expect.objectContaining({ ownServerOnly: true }));
            await call(route.postRaider, RANK, { event: "eh-a", userId: "1", character: "A", spec: "" });
            expect(manage.addRaider).toHaveBeenLastCalledWith(expect.objectContaining({ keepProfiles: true, character: "A" }));
        });

        it("refuses an account of no member before the service can name its class", async () => {
            const refused = await call(route.postRaider, RANK, { event: "eh-a", userId: "2", character: "A", spec: "" });
            expect(status(refused)).toBe(403);
            expect(body(refused).error.code).toBe("other_server");
            expect(manage.addRaider).not.toHaveBeenCalled();
        });

        it("refuses every other account while the member list is unknown, except a signup of this raid", async () => {
            serverMemberIds.mockResolvedValue(null);
            const refused = await call(route.postRaider, RANK, { event: "eh-a", userId: "1", character: "A", spec: "" });
            expect(body(refused).error.code).toBe("other_server");
            expect(manage.addRaider).not.toHaveBeenCalled();
            getSignup.mockImplementation((eventId, userId) => (eventId === "eh-a" && userId === "2" ? { userId } : null));
            await call(route.postRaider, RANK, { event: "eh-a", userId: "2", character: "A", spec: "" });
            expect(manage.addRaider).toHaveBeenLastCalledWith(expect.objectContaining({ keepProfiles: true, userId: "2" }));
        });

        it("lets the rank holder sign up itself, and leaves a missing id to the service, without asking for members", async () => {
            await call(route.postRaider, RANK, { event: "eh-a", userId: "rank", character: "A", spec: "" });
            expect(manage.addRaider).toHaveBeenCalledTimes(1);
            await call(route.postRaider, RANK, { event: "eh-a", character: "A", spec: "" });
            expect(manage.addRaider).toHaveBeenCalledTimes(2);
            expect(serverMemberIds).not.toHaveBeenCalled();
        });

        it.each([
            ["the orga by role", () => withoutRank.mockReturnValue(ORGA_ROLES)],
            ["the manager of the raid's category", () => orgaOfRaid.mockResolvedValue(true)],
        ])("treats %s by the rule of the orga (#1077), and keeps its profile writes", async (_who, arrange) => {
            arrange();
            await call(route.getRaiderCandidates, RANK, null, "event=eh-a");
            expect(manage.raiderCandidates.mock.lastCall[0]).toEqual({ guildId: "g1", eventId: "eh-a", visibleIds: new Set(["1", "rank"]) });
            await call(route.postRaider, RANK, { event: "eh-a", userId: "1", character: "A", spec: "" });
            expect(manage.addRaider.mock.lastCall[0]).not.toHaveProperty("keepProfiles");
            expect(serverMemberIds).not.toHaveBeenCalled();
        });

        it("leaves a full admin as on main, with no list asked for", async () => {
            const admin = { id: "a", name: "A", isAdmin: true, access: {} };
            await call(route.getRaiderCandidates, admin, null, "event=eh-a");
            expect(manage.raiderCandidates.mock.lastCall[0]).toEqual({ guildId: "g1", eventId: "eh-a", visibleIds: null });
            await call(route.postRaider, admin, { event: "eh-a", userId: "2", character: "A", spec: "" });
            expect(manage.addRaider.mock.lastCall[0]).toMatchObject({ userId: "2" });
            expect(manage.addRaider.mock.lastCall[0]).not.toHaveProperty("keepProfiles");
            expect(withoutRank).not.toHaveBeenCalled();
            expect(serverMemberIds).not.toHaveBeenCalled();
            expect(visibleRaiderIds).not.toHaveBeenCalled();
        });
    });

    describe("the orga by role (#1077): only raiders the server may see", () => {
        it("limits the candidates to them", async () => {
            await call(route.getRaiderCandidates, ORGA, null, "event=eh-a");
            expect(manage.raiderCandidates.mock.lastCall[0]).toEqual({ guildId: "g1", eventId: "eh-a", visibleIds: new Set(["1", "orga"]) });
        });

        it("refuses a raider only of another server, before the service can write a character", async () => {
            const refused = await call(route.postRaider, ORGA, { event: "eh-a", userId: "2", character: "A", spec: "" });
            expect(status(refused)).toBe(403);
            expect(body(refused).error.code).toBe("other_server");
            expect(manage.addRaider).not.toHaveBeenCalled();
        });

        it("takes him once he counts for this server", async () => {
            visibleRaiderIds.mockResolvedValue(new Set(["1", "2"]));
            await call(route.postRaider, ORGA, { event: "eh-a", userId: "2", character: "A", spec: "" });
            expect(manage.addRaider.mock.lastCall[0]).toMatchObject({ userId: "2" });
        });

        it("signs up the caller and leaves a missing id to the service, whoever the server may see", async () => {
            visibleRaiderIds.mockResolvedValue(new Set());
            await call(route.postRaider, ORGA, { event: "eh-a", userId: "orga", character: "A", spec: "" });
            await call(route.postRaider, ORGA, { event: "eh-a", character: "A", spec: "" });
            expect(manage.addRaider).toHaveBeenCalledTimes(2);
        });
    });

    it("deletes with archive, DM and the started-raid confirmation all off unless sent as true", async () => {
        await call(route.postDelete, ORGA, { event: "eh-a" });
        expect(manage.deleteEvent).toHaveBeenLastCalledWith({
            guildId: "g1", eventId: "eh-a", archiveChannel: false, notify: false, confirmStarted: false, user: ORGA, byName: "Orga",
        });
        await call(route.postDelete, ORGA, { event: "eh-a", archiveChannel: true, notify: true, confirmStarted: true });
        expect(manage.deleteEvent).toHaveBeenLastCalledWith(expect.objectContaining({ archiveChannel: true, notify: true, confirmStarted: true }));
        manage.deleteEvent.mockResolvedValueOnce({ error: { status: 409, code: "started", message: "Bitte bestätigen." } });
        const refused = await call(route.postDelete, ORGA, { event: "eh-a" });
        expect(status(refused)).toBe(409);
    });

    it("recreates a deleted channel for the event of the active server (#537)", async () => {
        const done = await call(route.postRecreateChannel, ORGA, { event: "eh-a" });
        expect(manage.recreateChannel).toHaveBeenLastCalledWith({ guildId: "g1", eventId: "eh-a", user: ORGA, byName: "Orga" });
        expect(body(done)).toMatchObject({ channelId: "c-new", channelName: "mi-kara" });
        manage.recreateChannel.mockResolvedValueOnce({ error: { status: 409, code: "channel_exists", message: "Der Kanal des Events existiert noch." } });
        expect(status(await call(route.postRecreateChannel, ORGA, { event: "eh-a" }))).toBe(409);
    });
});
