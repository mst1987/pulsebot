// "Jetzt abrufen" of a WCL guild (#922): only on the active server, a switched
// tab gets 409, an unsaved entry 404, the fetch itself is the sync's (joined
// with a running one there). No network: the sync is a stand-in.
let mockConfig;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: { id: "1", name: "Orga", isAdmin: true } }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => mockConfig) }));
jest.mock("../../../src/services/logcheck/wclGuildSync", () => ({ fetchEntry: jest.fn() }));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const wclGuildSync = require("../../../src/services/logcheck/wclGuildSync");
const { postFetch, routes } = require("../../../src/web/apiRoutes/wclGuilds");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body, json } = require("../../helpers/http");

const KEY = "tbc|pulse|thunderstrike|EU";
const entry = { versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU", interval: 0, lastRunAt: 0, lastResult: null };

async function call(payload) {
    readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await postFetch({}, res);
    return res;
}

describe("web/apiRoutes/wclGuilds (#922)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        activeGuildFor.mockReturnValue("g1");
        mockConfig = { serverSettings: { g1: { wclGuilds: [entry] }, g2: { wclGuilds: [{ ...entry, guildName: "Other" }] } } };
    });

    it("is one POST in the settings area", () => {
        expect(routes).toEqual([expect.objectContaining({ method: "POST", path: "/api/settings/wcl-guilds/fetch", area: "settings" })]);
        expect(AREA_BY_PATH["/api/settings/wcl-guilds/fetch"]).toBe("settings");
    });

    it("fetches the saved entry of the active server now, even with the interval off", async () => {
        wclGuildSync.fetchEntry.mockImplementationOnce(async () => {
            mockConfig.serverSettings.g1.wclGuilds = [{ ...entry, lastRunAt: 7, lastResult: { found: 2, error: "", at: 7 } }];
            return { found: 2, error: "", at: 7 };
        });
        const res = await call({ key: KEY, serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(200);
        expect(wclGuildSync.fetchEntry).toHaveBeenCalledWith("g1", KEY);
        expect(body(res)).toEqual({
            key: KEY,
            result: { found: 2, error: "", at: 7 },
            wclGuilds: [expect.objectContaining({ guildName: "Pulse", lastRunAt: 7 })],
        });
    });

    it("an error of the fetch is an answer, not a failure", async () => {
        wclGuildSync.fetchEntry.mockResolvedValueOnce({ found: 0, error: "Warcraft Logs nicht erreichbar.", at: 3 });
        const res = await call({ key: KEY, serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(200);
        expect(body(res).result.error).toBe("Warcraft Logs nicht erreichbar.");
    });

    it("400 without an active server", async () => {
        activeGuildFor.mockReturnValue("");
        const res = await call({ key: KEY, serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("no_active_server");
        expect(wclGuildSync.fetchEntry).not.toHaveBeenCalled();
    });

    it("409 when the tab loaded another server", async () => {
        activeGuildFor.mockReturnValue("g2");
        const res = await call({ key: KEY, serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("server_switched");
        expect(wclGuildSync.fetchEntry).not.toHaveBeenCalled();
    });

    it("404 for an entry the active server has not saved (another server's does not count)", async () => {
        let res = await call({ key: "tbc|other|thunderstrike|EU", serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(404);
        res = await call({ serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(404);
        expect(wclGuildSync.fetchEntry).not.toHaveBeenCalled();
    });

    it("404 when the entry was removed before the sync read it", async () => {
        wclGuildSync.fetchEntry.mockResolvedValueOnce(null);
        const res = await call({ key: KEY, serverSettingsGuildId: "g1" });
        expect(status(res)).toBe(404);
    });
});
