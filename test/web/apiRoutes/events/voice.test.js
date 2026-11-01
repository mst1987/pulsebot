// The voice-channel API of the setup editor: the state of every raid of the group, and
// "Jetzt anlegen" / "Schließen" through the job, only for a raid of the active server.
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: { id: "1", isAdmin: true } }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "100000") }));
jest.mock("../../../../src/stores/events/eventStore", () => ({ getEvent: jest.fn() }));
jest.mock("../../../../src/services/discord/discord", () => ({ getGuild: jest.fn() }));
jest.mock("../../../../src/services/voice/tempVoiceJob", () => ({
    voiceStatus: jest.fn(() => [{ eventId: "e1", index: 1, total: 1, kind: "temp", state: "planned" }]),
    openNow: jest.fn(),
    closeNow: jest.fn(),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { getEvent } = require("../../../../src/stores/events/eventStore");
const discord = require("../../../../src/services/discord/discord");
const job = require("../../../../src/services/voice/tempVoiceJob");
const { getVoice, postVoiceOpen, postVoiceClose, routes } = require("../../../../src/web/apiRoutes/events/voice");
const { mockRes, json } = require("../../../helpers/http");

const event = { id: "e1", guildId: "100000", categoryId: "900000" };
const urlFor = (id) => new URL(`http://localhost/api/raids/voice${id ? `?event=${id}` : ""}`);

beforeEach(() => {
    jest.clearAllMocks();
    getEvent.mockImplementation((id) => (id === "e1" ? event : id === "e2" ? { ...event, id: "e2", guildId: "200000" } : null));
    discord.getGuild.mockReturnValue({ id: "100000" });
});

describe("GET /api/raids/voice", () => {
    it("answers the state of every raid of the group and whether the bot is there", async () => {
        const r = mockRes();
        await getVoice({}, r, urlFor("e1"));
        expect(json(r).data).toEqual({ botOnline: true, raids: [expect.objectContaining({ kind: "temp", state: "planned" })] });
        expect(job.voiceStatus).toHaveBeenCalledWith(event);
    });

    it("tells when the bot is not on the raid's server", async () => {
        discord.getGuild.mockReturnValue(null);
        const r = mockRes();
        await getVoice({}, r, urlFor("e1"));
        expect(json(r).data.botOnline).toBe(false);
    });

    it.each([["a raid of another server", "e2"], ["an unknown raid", "x"], ["no raid", ""]])("answers 404 for %s", async (_label, id) => {
        const r = mockRes();
        await getVoice({}, r, urlFor(id));
        expect(r.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(job.voiceStatus).not.toHaveBeenCalled();
    });
});

describe("POST /api/raids/voice/open and /close", () => {
    it.each([["open", postVoiceOpen, "openNow"], ["close", postVoiceClose, "closeNow"]])("%s asks the job and answers the new state", async (_label, handler, fn) => {
        readJsonBody.mockResolvedValue({ event: "e1" });
        job[fn].mockResolvedValue({ ok: true });
        const r = mockRes();
        await handler({}, r);
        expect(job[fn]).toHaveBeenCalledWith("e1");
        expect(json(r).data.raids).toHaveLength(1);
    });

    it("hands a refusal of the job on with its status", async () => {
        readJsonBody.mockResolvedValue({ event: "e1" });
        job.openNow.mockResolvedValue({ error: "Für diesen Raid ist kein temporärer Kanal vorgesehen.", status: 409 });
        const r = mockRes();
        await postVoiceOpen({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
        expect(json(r).error).toMatchObject({ code: "conflict", message: "Für diesen Raid ist kein temporärer Kanal vorgesehen." });
    });

    it("names a Discord failure as such", async () => {
        readJsonBody.mockResolvedValue({ event: "e1" });
        job.closeNow.mockResolvedValue({ error: "Discord: Missing Permissions", status: 502 });
        const r = mockRes();
        await postVoiceClose({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
        expect(json(r).error.code).toBe("discord");
    });

    it("never acts on a raid of another server", async () => {
        readJsonBody.mockResolvedValue({ event: "e2" });
        const r = mockRes();
        await postVoiceOpen({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(job.openNow).not.toHaveBeenCalled();
    });
});

it("registers its routes in the raids area", () => {
    expect(routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
        "GET /api/raids/voice raids",
        "POST /api/raids/voice/open raids",
        "POST /api/raids/voice/close raids",
    ]);
});
