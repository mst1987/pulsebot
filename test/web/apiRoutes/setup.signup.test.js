// The setup editor's "Anmeldung bearbeiten" routes (#521): GET/PUT
// /api/raids/setup/signup — orga only (raids write), the service does the work
// (test/services/setup/setupSignup.test.js), the answer is the editor's payload.
let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: () => [],
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: () => [] }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/services/discord/discord", () => ({ resolveUserNames: jest.fn(async () => ({})), listAllChannels: () => [] }));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
}));
jest.mock("../../../src/services/setup/setupSignup", () => ({
    signupEditView: jest.fn(),
    changeSignupFromSetup: jest.fn(),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const setupSignup = require("../../../src/services/setup/setupSignup");
const route = require("../../../src/web/apiRoutes/setup");
const { checkAccess } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");
const { ownEvent } = require("../../factories/events");

const ID = "eh-kara";
const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, query ? new URL(`http://x/api/raids/setup/signup?${query}`) : undefined);
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEvents.clear();
    mockEvents.set(ID, ownEvent({ id: ID, guildId: "g1", title: "Kara", startTime: 2000000000, setup: null }));
});

describe("access", () => {
    it("is raids write for reading and for changing", () => {
        expect(checkAccess("/api/raids/setup/signup", "PUT", READER)).toMatchObject({ status: 403 });
        expect(checkAccess("/api/raids/setup/signup", "PUT", ORGA)).toBeNull();
        const member = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
        expect(checkAccess("/api/raids/setup/signup", "GET", member)).toMatchObject({ status: 403 });
    });

    it("refuses a reader in the handlers as well — nothing is read or changed", async () => {
        expect(status(await call(route.getSignupEdit, READER, null, `event=${ID}&user=u1`))).toBe(403);
        expect(status(await call(route.putSignupEdit, READER, { event: ID, userId: "u1", status: "signed" }))).toBe(403);
        expect(setupSignup.signupEditView).not.toHaveBeenCalled();
        expect(setupSignup.changeSignupFromSetup).not.toHaveBeenCalled();
    });
});

describe("GET /api/raids/setup/signup", () => {
    it("answers the service's view, or its failure", async () => {
        setupSignup.signupEditView.mockReturnValueOnce({ view: { userId: "u1", status: "bench", options: [] } });
        const r = await call(route.getSignupEdit, ORGA, null, `event=${ID}&user=u1`);
        expect(status(r)).toBe(200);
        expect(body(r)).toMatchObject({ userId: "u1", status: "bench" });
        expect(setupSignup.signupEditView).toHaveBeenCalledWith(ID, "u1");
        setupSignup.signupEditView.mockReturnValueOnce({ failed: { status: 404, code: "not_signed_up", error: "Dieser Raider ist nicht angemeldet." } });
        expect(status(await call(route.getSignupEdit, ORGA, null, `event=${ID}&user=u9`))).toBe(404);
    });

    it("refuses a Raid-Helper event", async () => {
        expect(status(await call(route.getSignupEdit, ORGA, null, "event=12345&user=u1"))).toBe(409);
    });
});

describe("PUT /api/raids/setup/signup", () => {
    it("changes the signup as the logged-in orga member and answers the editor's payload with the message", async () => {
        setupSignup.changeSignupFromSetup.mockResolvedValueOnce({ event: mockEvents.get(ID), signup: {}, message: "Anmeldung von Zibbo geändert.", warning: "" });
        const r = await call(route.putSignupEdit, ORGA, { event: ID, userId: "u1", status: "signed", character: "Zibbo", spec: "Shaman-Elemental", from: "Zibbo" });
        expect(status(r)).toBe(200);
        expect(body(r)).toMatchObject({ eventId: ID, canWrite: true, message: "Anmeldung von Zibbo geändert." });
        expect(setupSignup.changeSignupFromSetup).toHaveBeenCalledWith(ID, "u1", expect.objectContaining({ status: "signed", spec: "Shaman-Elemental" }), { user: ORGA });
    });

    it("passes the service's refusal on with its status", async () => {
        setupSignup.changeSignupFromSetup.mockResolvedValueOnce({ status: 400, code: "spec", error: "Diese Spezialisierung ist für Zibbo nicht im Profil hinterlegt." });
        const r = await call(route.putSignupEdit, ORGA, { event: ID, userId: "u1", status: "signed", spec: "Mage-Fire" });
        expect(status(r)).toBe(400);
        expect(body(r)).toMatchObject({ error: { code: "spec" } });
    });
});
