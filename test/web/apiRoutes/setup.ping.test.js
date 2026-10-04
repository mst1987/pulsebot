// POST /api/raids/setup/ping — the setup editor's "Alle pingen": everybody in the
// posted setup, in the event channel, with the stored ping text. A dry run answers
// how many and with what (the question before); the service itself is
// src/services/setup/setupPing.js (the Discord button uses the same one).
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({
    user: { id: "u-lead", name: "Nerathil", isAdmin: true },
    fullAdmin: { id: "u-lead", isAdmin: true },
}));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn(),
}));
jest.mock("../../../src/services/setup/setupPing", () => ({
    ...jest.requireActual("../../../src/services/setup/setupPing"),
    setupPingPlan: jest.fn(),
    callSetupPing: jest.fn(),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { requireCsrf } = require("../../../src/web/http/apiMiddleware");
const { getEvent } = require("../../../src/stores/eventStore");
const { setupPingPlan, callSetupPing } = require("../../../src/services/setup/setupPing");
const { postPing, routes } = require("../../../src/web/apiRoutes/setup");

const { mockRes, status, json } = require("../../helpers/http");

beforeEach(() => jest.clearAllMocks());

describe("POST /api/raids/setup/ping", () => {
    it("is a raids route", () => {
        expect(routes).toContainEqual({ method: "POST", path: "/api/raids/setup/ping", handler: postPing, area: "raids" });
    });

    it("previews for the logged-in user without posting", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        setupPingPlan.mockReturnValue({ userIds: ["u2", "u3", "u4"], text: "Das Setup steht – du bist dabei!" });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = mockRes();
        await postPing({}, r);
        expect(setupPingPlan).toHaveBeenCalledWith({ id: "eh-1", guildId: "g1" }, "u-lead");
        expect(json(r).data).toEqual({ count: 3, text: "Das Setup steht – du bist dabei!" });
        expect(callSetupPing).not.toHaveBeenCalled();
    });

    it("passes a refused preview on with its status", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        setupPingPlan.mockReturnValue({ error: { status: 400, code: "no_setup", message: "Für diesen Raid ist noch kein Setup freigegeben." } });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = mockRes();
        await postPing({}, r);
        expect(status(r)).toBe(400);
        expect(json(r).error.code).toBe("no_setup");
    });

    it("pings as the logged-in user on the active server", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        callSetupPing.mockResolvedValue({ message: "3 Raider aus dem Setup gepingt.", count: 3, url: "https://discord.com/x" });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postPing({}, r);
        expect(callSetupPing).toHaveBeenCalledWith({ guildId: "g1", eventId: "eh-1", userId: "u-lead", byName: "Nerathil" });
        expect(json(r).data).toEqual({ message: "3 Raider aus dem Setup gepingt.", count: 3, url: "https://discord.com/x" });
    });

    it("passes the service's refusal on with its status", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        callSetupPing.mockResolvedValue({ error: { status: 502, code: "post_failed", message: "Konnte nicht posten: offline" } });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postPing({}, r);
        expect(status(r)).toBe(502);
        expect(json(r).error.code).toBe("post_failed");
    });

    it("does not ping another server's event, nor a Raid-Helper one", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "elsewhere" });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postPing({}, r);
        expect(status(r)).toBe(404);

        readJsonBody.mockResolvedValue({ event: "1234567890" });
        const rh = mockRes();
        await postPing({}, rh);
        expect(status(rh)).toBe(409);
        expect(callSetupPing).not.toHaveBeenCalled();
    });

    it("wants the CSRF token", async () => {
        requireCsrf.mockReturnValueOnce(false);
        await postPing({}, mockRes());
        expect(callSetupPing).not.toHaveBeenCalled();
    });
});
