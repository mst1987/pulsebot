jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: { id: "1", name: "Orga", isAdmin: true } }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "active-guild") }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));
jest.mock("../../../src/web/events/raidhelperRetirement", () => ({
    loadChecklist: jest.fn(async () => ({ ready: true, items: [] })),
    setRaidhelperDisabled: jest.fn(async () => ({ checklist: { disabled: true } })),
}));
jest.mock("../../../src/web/events/raidhelperHistoryImport", () => ({
    runImport: jest.fn(async (opts) => ({ dryRun: opts.dryRun, summary: { events: 0 } })),
}));

jest.mock("../../../src/services/events/raidhelperSync", () => ({
    syncStatus: jest.fn(() => ({ syncedAt: 5, events: 2 })),
    refreshNow: jest.fn(async () => ({ syncedAt: 6, throttled: false })),
}));

const { requireFullAdmin, requireCsrf } = require("../../../src/web/http/apiMiddleware");
const raidhelperSync = require("../../../src/services/events/raidhelperSync");
const { readJsonBody } = require("../../../src/web/http/apiBody");
const retirement = require("../../../src/web/events/raidhelperRetirement");
const historyImport = require("../../../src/web/events/raidhelperHistoryImport");
const { getRetirement, postRetirement, postHistoryImport, getSync, postSync } = require("../../../src/web/apiRoutes/raidhelperRetirement");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");

const { mockRes, status, body } = require("../../helpers/http");

describe("apiRoutes/raidhelperRetirement (#291)", () => {
    beforeEach(() => jest.clearAllMocks());

    it("is gated as settings paths", () => {
        expect(AREA_BY_PATH["/api/settings/raidhelper-retirement"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/raidhelper-history-import"]).toBe("settings");
    });

    it("GET answers with the checklist", async () => {
        const res = mockRes();
        await getRetirement({}, res);
        expect(body(res)).toEqual({ checklist: { ready: true, items: [] } });
    });

    it("POST switches with the admin's name and answers 409 when not ready", async () => {
        readJsonBody.mockResolvedValueOnce({ disabled: true });
        const res = mockRes();
        await postRetirement({}, res);
        expect(retirement.setRaidhelperDisabled).toHaveBeenCalledWith(true, { byName: "Orga" });
        expect(body(res).checklist.disabled).toBe(true);

        retirement.setRaidhelperDisabled.mockResolvedValueOnce({ error: "Erst die Pflichtpunkte", code: "not_ready", blockers: ["categories"] });
        readJsonBody.mockResolvedValueOnce({ disabled: true });
        const refused = mockRes();
        await postRetirement({}, refused);
        expect(status(refused)).toBe(409);
    });

    it("the import is a dry run unless dryRun is false, on the event server", async () => {
        readJsonBody.mockResolvedValueOnce({ perCategory: 5 });
        await postHistoryImport({}, mockRes());
        expect(historyImport.runImport).toHaveBeenLastCalledWith({ guildId: "event-guild", perCategory: 5, dryRun: true, byName: "Orga" });
        readJsonBody.mockResolvedValueOnce({ dryRun: false });
        await postHistoryImport({}, mockRes());
        expect(historyImport.runImport).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }));
    });

    it("needs a full admin, and the CSRF token for changes", async () => {
        requireFullAdmin.mockReturnValueOnce(null);
        await getRetirement({}, mockRes());
        expect(retirement.loadChecklist).not.toHaveBeenCalled();
        requireFullAdmin.mockReturnValueOnce(null);
        await postRetirement({}, mockRes());
        requireCsrf.mockReturnValueOnce(false);
        await postRetirement({}, mockRes());
        requireCsrf.mockReturnValueOnce(false);
        await postHistoryImport({}, mockRes());
        expect(retirement.setRaidhelperDisabled).not.toHaveBeenCalled();
        expect(historyImport.runImport).not.toHaveBeenCalled();
    });

    // #608: the one job that fetches the event list, and "Jetzt aktualisieren"
    describe("raidhelper-sync", () => {
        it("is gated as a settings path", () => {
            expect(AREA_BY_PATH["/api/settings/raidhelper-sync"]).toBe("settings");
        });

        it("GET answers with the sync status", async () => {
            const res = mockRes();
            await getSync({}, res);
            expect(body(res)).toEqual({ syncedAt: 5, events: 2 });
        });

        it("POST syncs now", async () => {
            const res = mockRes();
            await postSync({}, res);
            expect(raidhelperSync.refreshNow).toHaveBeenCalledTimes(1);
            expect(body(res)).toEqual({ syncedAt: 6, throttled: false });
        });

        it("needs a full admin, and the CSRF token for the refresh", async () => {
            requireFullAdmin.mockReturnValueOnce(null);
            await getSync({}, mockRes());
            expect(raidhelperSync.syncStatus).not.toHaveBeenCalled();
            requireCsrf.mockReturnValueOnce(false);
            await postSync({}, mockRes());
            expect(raidhelperSync.refreshNow).not.toHaveBeenCalled();
        });
    });
});
