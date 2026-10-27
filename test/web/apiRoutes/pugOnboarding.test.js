// The PuG onboarding API (src/web/apiRoutes/pugOnboarding.js) through the real router:
// full admins only, the server (guildId) passed on, 400 unknown_guild, CSRF on the
// button and the service's refusals as API errors.
let mockUser = null;
let mockCsrf = true;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => mockCsrf, getActiveGuild: () => "" }));
jest.mock("../../../src/stores/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000003" }], links: [] } }),
}));
jest.mock("../../../src/services/discord/pugOnboarding", () => {
    class PugOnboardingError extends Error {
        constructor(status, code, message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }
    return {
        PugOnboardingError,
        overview: jest.fn(async (guildId) => ({ guildId, online: true, changes: 0 })),
        apply: jest.fn(async (guildId) => ({ done: { roles: 2, categories: 1, onboarding: true }, overview: { guildId, changes: 0 } })),
    };
});

const svc = require("../../../src/services/discord/pugOnboarding");
const route = require("../../../src/web/apiRoutes/pugOnboarding");
const { emptyAccess } = require("../../../src/config/permissions");
const { routerClient, status, body, json } = require("../../helpers/http");

const { get, post } = routerClient(route);
const FIRST = "900000000000000001";
const PUG = "900000000000000003";
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const settingsWriter = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } } };

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = ADMIN;
    mockCsrf = true;
});

describe("access (full admins only)", () => {
    it("keeps out a settings writer who is no full admin, and anonymous callers", async () => {
        mockUser = settingsWriter;
        expect(status(await get("/api/discord/pug-onboarding"))).toBe(403);
        expect(status(await post("/api/discord/pug-onboarding", { guildId: PUG }))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/discord/pug-onboarding"))).toBe(401);
        expect(svc.apply).not.toHaveBeenCalled();
    });

    it("refuses the button without a CSRF token", async () => {
        mockCsrf = false;
        expect(status(await post("/api/discord/pug-onboarding", { guildId: PUG }))).toBe(403);
        expect(svc.apply).not.toHaveBeenCalled();
    });
});

describe("GET /api/discord/pug-onboarding", () => {
    it("passes the server on, the first server by default", async () => {
        expect(body(await get("/api/discord/pug-onboarding", { guildId: PUG }))).toEqual({ guildId: PUG, online: true, changes: 0 });
        expect(svc.overview).toHaveBeenLastCalledWith(PUG);
        await get("/api/discord/pug-onboarding");
        expect(svc.overview).toHaveBeenLastCalledWith(FIRST);
    });

    it("refuses a server outside the list", async () => {
        const res = await get("/api/discord/pug-onboarding", { guildId: "900000000000000099" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
        expect(svc.overview).not.toHaveBeenCalled();
    });
});

describe("POST /api/discord/pug-onboarding", () => {
    it("takes the server over and names the admin in the audit reason", async () => {
        const res = await post("/api/discord/pug-onboarding", { guildId: PUG });
        expect(status(res)).toBe(200);
        expect(body(res).done).toEqual({ roles: 2, categories: 1, onboarding: true });
        expect(svc.apply).toHaveBeenCalledWith(PUG, { actor: "Admin" });
    });

    it("refuses a server outside the list", async () => {
        const res = await post("/api/discord/pug-onboarding", { guildId: "900000000000000099" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
        expect(svc.apply).not.toHaveBeenCalled();
    });

    it("answers the service's refusals with their status and code", async () => {
        svc.apply.mockRejectedValueOnce(new svc.PugOnboardingError(409, "no_community", "Kein Community-Server."));
        let res = await post("/api/discord/pug-onboarding", { guildId: PUG });
        expect(status(res)).toBe(409);
        expect(json(res).error).toEqual({ code: "no_community", message: "Kein Community-Server." });
        svc.apply.mockRejectedValueOnce(new svc.PugOnboardingError(502, "discord_failed", "Onboarding: abgelehnt."));
        res = await post("/api/discord/pug-onboarding", { guildId: PUG });
        expect(status(res)).toBe(502);
        expect(json(res).error.code).toBe("discord_failed");
    });

    it("leaves an unexpected error to the router (500)", async () => {
        svc.apply.mockRejectedValueOnce(new Error("boom"));
        expect(status(await post("/api/discord/pug-onboarding", { guildId: PUG }))).toBe(500);
    });
});
