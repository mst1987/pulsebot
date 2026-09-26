// POST /api/raids/invite-call — the raid detail's "Invite callen": a dry run for
// the dialog's preview, then the post. The caller is the logged-in user (their
// Discord id picks the character); the service itself is test/services/setup/inviteCall.test.js.
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({
    user: { id: "u-lead", name: "Nerathil", isAdmin: true },
    fullAdmin: { id: "u-lead", isAdmin: true },
}));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/eventStore", () => ({ ...jest.requireActual("../../../src/stores/eventStore"), getEvent: jest.fn() }));
jest.mock("../../../src/services/setup/inviteCall", () => ({ invitePlan: jest.fn(), callInvite: jest.fn() }));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { requireCsrf } = require("../../../src/web/http/apiMiddleware");
const { getEvent } = require("../../../src/stores/eventStore");
const { invitePlan, callInvite } = require("../../../src/services/setup/inviteCall");
const { postInviteCall } = require("../../../src/web/apiRoutes/raidDetail");

const { mockRes, status, json } = require("../../helpers/http");

beforeEach(() => jest.clearAllMocks());

describe("POST /api/raids/invite-call", () => {
    it("previews for the logged-in user without posting", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        invitePlan.mockReturnValue({ userIds: ["u2", "u3"], character: "Naphfß", text: "/w Naphfß inv", groups: [1, 2] });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = mockRes();
        await postInviteCall({}, r);
        expect(invitePlan).toHaveBeenCalledWith({ id: "eh-1", guildId: "g1" }, "u-lead");
        expect(json(r).data).toEqual({ count: 2, text: "/w Naphfß inv", groups: [1, 2] });
        expect(callInvite).not.toHaveBeenCalled();
    });

    it("does not preview another server's event", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "elsewhere" });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = mockRes();
        await postInviteCall({}, r);
        expect(status(r)).toBe(404);
        expect(invitePlan).not.toHaveBeenCalled();
    });

    it("posts as the logged-in user on the active server", async () => {
        callInvite.mockResolvedValue({ message: "2 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv", count: 2, text: "/w Naphfß inv" });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postInviteCall({}, r);
        expect(callInvite).toHaveBeenCalledWith({ guildId: "g1", eventId: "eh-1", userId: "u-lead", byName: "Nerathil" });
        expect(json(r).data.message).toBe("2 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv");
    });

    it("passes the service's refusal on with its status", async () => {
        callInvite.mockResolvedValue({ error: { status: 400, code: "no_setup", message: "Für diesen Raid ist noch kein Setup freigegeben." } });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = mockRes();
        await postInviteCall({}, r);
        expect(status(r)).toBe(400);
        expect(json(r).error.code).toBe("no_setup");
    });

    it("wants the CSRF token", async () => {
        requireCsrf.mockReturnValueOnce(false);
        await postInviteCall({}, mockRes());
        expect(callInvite).not.toHaveBeenCalled();
    });
});
