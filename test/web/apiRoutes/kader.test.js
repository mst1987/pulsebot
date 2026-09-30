// The Kaderbau export, driven through the real router: the endpoint has no
// Discord session behind it, so the access gate's exemption and the handler's
// own token check are the risky part. The tokens are the real stores on
// scratch files, so "a loot token must not read the export" is tested for real.
const { mockRes, status, json, body, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    getRealUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => ""),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
}));
jest.mock("../../../src/services/discord/guildRoles", () => ({
    ...jest.requireActual("../../../src/services/discord/guildRoles"),
    eventGuildId: jest.fn(() => "g1"),
}));
jest.mock("../../../src/services/events/eventSources", () => ({
    ...jest.requireActual("../../../src/services/events/eventSources"),
    listStoredEvents: jest.fn(() => []),
}));
jest.mock("../../../src/web/characters/profileLogs", () => ({
    ...jest.requireActual("../../../src/web/characters/profileLogs"),
    logIndex: jest.fn(() => new Map()),
}));

const fs = require("fs");
const auth = require("../../../src/web/http/auth");
const discord = require("../../../src/services/discord/discord");
const kaderTokens = require("../../../src/stores/kaderTokenStore");
const ingestTokens = require("../../../src/stores/ingestTokenStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const { handle, urlFor, post, get } = routerClient(require("../../../src/web/apiRoutes/kader"));

const U1 = "111111111111111111";
const U3 = "333333333333333333";

beforeAll(() => {
    kaderTokens.useFile(tempStoreFile("kader-tokens.json"));
    ingestTokens.useFile(tempStoreFile("ingest-tokens.json"));
    const file = tempStoreFile("kader-route-profiles.json");
    fs.writeFileSync(file, JSON.stringify({ profiles: { [U1]: {
        name: "Aldric",
        characters: [{ name: "Aldric Sturmwind", versionId: "forever", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] }],
        availability: ["mi"],
        wishes: [], avoidEnabled: true, avoid: [U3], note: "PRIVATE-NOTE",
    } } }));
    profiles.useFile(file);
});
afterAll(() => {
    kaderTokens.useFile(null);
    ingestTokens.useFile(null);
    profiles.useFile(null);
});

beforeEach(() => {
    jest.clearAllMocks();
    auth.getUser.mockReturnValue(null);
    auth.checkCsrf.mockReturnValue(true);
    discord.listHumanMembers.mockResolvedValue({ members: [{ id: U1, displayName: "Aldric", avatarUrl: null }], error: null });
});

/** GET /api/kader/export with an Authorization header (or none). */
async function exportWith(authorization, query) {
    const res = mockRes();
    const headers = authorization ? { authorization } : {};
    await handle("/api/kader/export", { method: "GET", headers }, res, urlFor("/api/kader/export", query));
    return res;
}

describe("web/apiRoutes/kader", () => {
    describe("GET /api/kader/export", () => {
        it("refuses a call without a token", async () => {
            const res = await exportWith("");
            expect(status(res)).toBe(401);
            expect(json(res).error.code).toBe("no_token");
        });

        it("refuses an unknown token", async () => {
            const res = await exportWith("Bearer ehk_0000000000000000000000000000000000000000000000");
            expect(status(res)).toBe(401);
            expect(json(res).error.code).toBe("bad_token");
        });

        it("refuses a revoked token", async () => {
            const { token, record } = kaderTokens.createToken("PC");
            kaderTokens.revokeToken(record.id);
            expect(status(await exportWith(`Bearer ${token}`))).toBe(401);
        });

        it("refuses a loot-sync token — another capability", async () => {
            const { token } = ingestTokens.createToken("Loot-PC");
            const res = await exportWith(`Bearer ${token}`);
            expect(status(res)).toBe(401);
            expect(json(res).error.code).toBe("bad_token");
        });

        it("answers 200 with the export in the { data } envelope and counts the use", async () => {
            const { token, record } = kaderTokens.createToken("PC");
            const res = await exportWith(`Bearer ${token}`);
            expect(status(res)).toBe(200);
            const envelope = json(res);
            expect(Object.keys(envelope)).toEqual(["data"]);
            const data = envelope.data;
            expect(data).toMatchObject({ format: "eventhelper-kader", v: 1, versionId: "forever", guildId: "g1", warnings: [] });
            expect(data.members).toEqual([{ userId: U1, displayName: "Aldric", avatarUrl: null }]);
            expect(data.profiles[0].characters[0]).toMatchObject({ key: "forever~aldric sturmwind", className: "Warrior", main: true });
            expect(data.attendance).toEqual([{ userId: U1, attended: 0, counted: 0, rate: null, nights: [] }]);
            expect(kaderTokens.listTokens().find((t) => t.id === record.id).uses).toBe(1);
        });

        it("exports another version when asked, and refuses an unknown one", async () => {
            const { token } = kaderTokens.createToken("PC");
            const tbc = body(await exportWith(`Bearer ${token}`, { version: "tbc" }));
            expect(tbc.versionId).toBe("tbc");
            expect(tbc.profiles).toEqual([]);
            const res = await exportWith(`Bearer ${token}`, { version: "wotlk" });
            expect(status(res)).toBe(400);
            expect(json(res).error.code).toBe("unknown_version");
        });

        it("never lets private profile fields out", async () => {
            const { token } = kaderTokens.createToken("PC");
            const text = JSON.stringify(body(await exportWith(`Bearer ${token}`)));
            for (const field of ["avoid", "avoidEnabled", "wishes", "note", "preferredRaids", "claimedBy"]) {
                expect(text).not.toContain(`"${field}"`);
            }
            expect(text).not.toContain("PRIVATE-NOTE");
            expect(text).not.toContain(U3);
        });

        it("still answers 200 with a warning when Discord cannot list the members", async () => {
            discord.listHumanMembers.mockResolvedValue({ members: [], error: "Used disallowed intents" });
            const { token } = kaderTokens.createToken("PC");
            const res = await exportWith(`Bearer ${token}`);
            expect(status(res)).toBe(200);
            expect(body(res).members).toEqual([]);
            expect(body(res).warnings).toEqual([expect.stringMatching(/GuildMembers/)]);
        });
    });

    describe("the token management", () => {
        const fullAdmin = { id: "1", name: "Admin", isAdmin: true };

        it("needs a session", async () => {
            expect(status(await get("/api/kader/tokens"))).toBe(401);
        });

        it("is refused to an account that is no full admin", async () => {
            auth.getUser.mockReturnValue({ id: "2", name: "Orga", isAdmin: false, access: { settings: { read: true, write: true } } });
            const res = await post("/api/kader/tokens", { name: "PC" });
            expect(status(res)).toBe(403);
        });

        it("mints (secret once), lists (never the secret) and revokes", async () => {
            auth.getUser.mockReturnValue(fullAdmin);
            const created = await post("/api/kader/tokens", { name: "Raidlead-PC" });
            expect(status(created)).toBe(201);
            const { token, record } = body(created);
            expect(token.startsWith("ehk_")).toBe(true);
            expect(record).toMatchObject({ name: "Raidlead-PC", createdBy: "Admin" });

            const listed = body(await get("/api/kader/tokens")).tokens;
            expect(listed.some((t) => t.id === record.id)).toBe(true);
            expect(JSON.stringify(listed)).not.toContain(token);

            expect(status(await post("/api/kader/tokens/delete", { id: record.id }))).toBe(200);
            expect(kaderTokens.verifyToken(token)).toBeNull();
            expect(status(await post("/api/kader/tokens/delete", { id: record.id }))).toBe(404);
        });

        it("refuses a mutation without a valid CSRF token", async () => {
            auth.getUser.mockReturnValue(fullAdmin);
            auth.checkCsrf.mockReturnValue(false);
            expect(status(await post("/api/kader/tokens", { name: "PC" }))).toBe(403);
        });
    });
});
