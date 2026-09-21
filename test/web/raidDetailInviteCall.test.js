// POST /api/raids/invite-call — the raid detail's "Invite callen": a dry run for
// the dialog's preview, then the post. The caller is the logged-in user (their
// Discord id picks the character); the service itself is test/web/inviteCall.test.js.
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(() => ({ id: "u-lead", name: "Nerathil", isAdmin: true })),
    requireFullAdmin: jest.fn(() => ({ id: "u-lead", isAdmin: true })),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../src/web/eventStore", () => ({ ...jest.requireActual("../../src/web/eventStore"), getEvent: jest.fn() }));
jest.mock("../../src/web/inviteCall", () => ({ invitePlan: jest.fn(), callInvite: jest.fn() }));

const { readJsonBody } = require("../../src/web/apiBody");
const { requireCsrf } = require("../../src/web/apiMiddleware");
const { getEvent } = require("../../src/web/eventStore");
const { invitePlan, callInvite } = require("../../src/web/inviteCall");
const { postInviteCall } = require("../../src/web/apiRoutes/raidDetail");

const res = () => ({ writeHead: jest.fn(), end: jest.fn() });
const status = (r) => r.writeHead.mock.calls[0][0];
const body = (r) => JSON.parse(r.end.mock.calls[0][0]);

beforeEach(() => jest.clearAllMocks());

describe("POST /api/raids/invite-call", () => {
    it("previews for the logged-in user without posting", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "g1" });
        invitePlan.mockReturnValue({ userIds: ["u2", "u3"], character: "Naphfß", text: "/w Naphfß inv", groups: [1, 2] });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = res();
        await postInviteCall({}, r);
        expect(invitePlan).toHaveBeenCalledWith({ id: "eh-1", guildId: "g1" }, "u-lead");
        expect(body(r).data).toEqual({ count: 2, text: "/w Naphfß inv", groups: [1, 2] });
        expect(callInvite).not.toHaveBeenCalled();
    });

    it("does not preview another server's event", async () => {
        getEvent.mockReturnValue({ id: "eh-1", guildId: "elsewhere" });
        readJsonBody.mockResolvedValue({ event: "eh-1", dryRun: true });
        const r = res();
        await postInviteCall({}, r);
        expect(status(r)).toBe(404);
        expect(invitePlan).not.toHaveBeenCalled();
    });

    it("posts as the logged-in user on the active server", async () => {
        callInvite.mockResolvedValue({ message: "2 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv", count: 2, text: "/w Naphfß inv" });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = res();
        await postInviteCall({}, r);
        expect(callInvite).toHaveBeenCalledWith({ guildId: "g1", eventId: "eh-1", userId: "u-lead", byName: "Nerathil" });
        expect(body(r).data.message).toBe("2 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv");
    });

    it("passes the service's refusal on with its status", async () => {
        callInvite.mockResolvedValue({ error: { status: 400, code: "no_setup", message: "Für diesen Raid ist noch kein Setup freigegeben." } });
        readJsonBody.mockResolvedValue({ event: "eh-1" });
        const r = res();
        await postInviteCall({}, r);
        expect(status(r)).toBe(400);
        expect(body(r).error.code).toBe("no_setup");
    });

    it("wants the CSRF token", async () => {
        requireCsrf.mockReturnValueOnce(false);
        await postInviteCall({}, res());
        expect(callInvite).not.toHaveBeenCalled();
    });
});
