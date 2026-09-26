// The API of "Event verwalten" (src/web/apiRoutes/eventManage.js, #288): every
// path is area `raids`, writes need write by method, the two reads check write
// in the handler, and each route hands the body to the service as it should.
let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../../src/web/eventManage", () => ({
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
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const manage = require("../../../src/web/eventManage");
const route = require("../../../src/web/apiRoutes/eventManage");
const { checkAccess } = require("../../../src/web/http/apiAccess");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const PATHS = [
    "/api/raids/manage", "/api/raids/manage/move", "/api/raids/manage/signups", "/api/raids/manage/raider",
    "/api/raids/manage/raider/remove", "/api/raids/manage/cancel", "/api/raids/manage/reopen", "/api/raids/manage/delete",
];

const { mockRes, status, body } = require("../../helpers/http");

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, query ? new URL(`http://x/api/raids/manage?${query}`) : undefined);
    return r;
}

beforeEach(() => jest.clearAllMocks());

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
});
