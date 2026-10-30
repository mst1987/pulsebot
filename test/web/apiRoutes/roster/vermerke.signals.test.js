// The hint routes of the Vermerke (docs/vermerke.md, #982), through the real
// router: the hints of the active server only, "Ausblenden" with the write
// level, the thresholds per server with the stale-tab check.
const fs = require("fs");
const { status, body, routerClient } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

let mockUser = null;
let mockActive = "A";
let mockConfig = {};
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => mockActive),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => mockActive),
    pickActiveGuild: jest.fn(async () => mockActive),
}));
jest.mock("../../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../../src/stores/settingsStore"),
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn((patch) => {
        const servers = { ...(mockConfig.serverSettings || {}) };
        for (const [g, s] of Object.entries(patch.serverSettings || {})) servers[g] = { ...(servers[g] || {}), ...s };
        mockConfig = { ...mockConfig, serverSettings: servers };
        return mockConfig;
    }),
}));
jest.mock("../../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../../src/stores/eventStore"),
    listEvents: jest.fn(() => []),
}));

const settingsStore = require("../../../../src/stores/settingsStore");
const signals = require("../../../../src/stores/userSignalsStore");
const notes = require("../../../../src/stores/userNotesStore");
const { emptyAccess, mergeAccess, accessForUser } = require("../../../../src/config/permissions");
const route = require("../../../../src/web/apiRoutes/roster/vermerke");
const { get, post } = routerClient(route);

const U = "111111111111111111";
const ADMIN = { id: "1", name: "Admin", isAdmin: true, access: emptyAccess() };
const granted = (level, id = "555555555555555555") => {
    const grant = { [id]: { vermerke: { read: true, write: level === "write" } } };
    return { id, name: "Lena", isAdmin: false, access: mergeAccess(emptyAccess(), accessForUser(grant, id)) };
};
const ORGA = { id: "7", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true } } };
const signoff = (guildId, eventId) => signals.recordEvent(guildId, U, { kind: "signoff_after_setup", eventId, title: "Karazhan", startTime: 1800000000 }, { name: "Zed" });

beforeEach(() => {
    for (const [store, name] of [[signals, "user-signals.json"], [notes, "user-notes.json"]]) {
        const file = tempStoreFile(name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        store.useFile(file);
    }
    mockUser = ADMIN;
    mockActive = "A";
    mockConfig = {};
    settingsStore.saveConfig.mockClear();
});
afterAll(() => {
    signals.useFile(null);
    notes.useFile(null);
});

describe("web/apiRoutes/vermerke - hints", () => {
    it("lists the hints of the active server with the thresholds in use", async () => {
        signoff("A", "e1");
        expect(body(await get("/api/vermerke/signals")).signals).toEqual([]);
        signoff("A", "e2");
        signoff("B", "e3");
        signoff("B", "e4");
        const res = body(await get("/api/vermerke/signals"));
        expect(res.signals).toEqual([expect.objectContaining({ userId: U, name: "Zed", kind: "signoff_after_setup", count: 2, windowDays: 60 })]);
        expect(res.signals[0].events.map((e) => e.eventId).sort()).toEqual(["e1", "e2"]);
        expect(res.thresholds).toMatchObject({ windowDays: 60, signoffAfterSetup: 2, lateHours: 12 });
    });

    it("hides a hint until something new, with checked input", async () => {
        signoff("A", "e1");
        signoff("A", "e2");
        const res = await post("/api/vermerke/signals/ignore", { userId: U, kind: "signoff_after_setup" });
        expect(status(res)).toBe(200);
        expect(body(res).ignored).toMatchObject({ userId: U, kind: "signoff_after_setup" });
        expect(body(await get("/api/vermerke/signals")).signals).toEqual([]);

        const badKind = await post("/api/vermerke/signals/ignore", { userId: U, kind: "behavior" });
        expect(status(badKind)).toBe(400);
        expect(body(badKind).error.code).toBe("bad_kind");
        const badUser = await post("/api/vermerke/signals/ignore", { userId: "x", kind: "no_show" });
        expect(status(badUser)).toBe(400);
        expect(body(badUser).error.code).toBe("bad_user");
    });

    it("reads and saves the thresholds of the active server, normalized, refusing a stale tab", async () => {
        const view = body(await get("/api/vermerke/signals/settings"));
        expect(view).toMatchObject({ guildId: "A", own: {}, defaults: { windowDays: 60 }, limits: { lateHours: [1, 72] } });

        const stale = await post("/api/vermerke/signals/settings", { thresholds: { lateHours: 6 }, serverSettingsGuildId: "B" });
        expect(status(stale)).toBe(409);
        expect(body(stale).error.code).toBe("server_switched");
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();

        // a value out of range or no whole number is refused with its field, not moved into range
        const bad = await post("/api/vermerke/signals/settings", { thresholds: { lateHours: 6, noShow: 99, windowDays: "x" }, serverSettingsGuildId: "A" });
        expect(status(bad)).toBe(400);
        expect(body(bad).error).toMatchObject({ code: "bad_threshold", fields: ["windowDays", "noShow"] });
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();

        const saved = await post("/api/vermerke/signals/settings", { thresholds: { lateHours: 6, noShow: 20, leftServer: "", foo: 1 }, serverSettingsGuildId: "A" });
        expect(status(saved)).toBe(200);
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ serverSettings: { A: { vermerkeSignals: { lateHours: 6, noShow: 20 } } } });
        expect(body(saved)).toMatchObject({ own: { lateHours: 6, noShow: 20 }, thresholds: { lateHours: 6, noShow: 20, windowDays: 60 } });
    });

    // #983: the orga's hint at signup sits beside the thresholds, saved only when it is sent
    it("reads and saves the orga's hint at signup without touching the thresholds", async () => {
        mockConfig = { serverSettings: { A: { vermerkeSignals: { noShow: 5 } } } };
        const view = body(await get("/api/vermerke/signals/settings"));
        expect(view).toMatchObject({ orgaNotice: { enabled: false, level: "warning" }, orgaNoticeLevels: ["warning", "shadowban"] });

        const bad = await post("/api/vermerke/signals/settings", { orgaNotice: { enabled: "ja", level: "hint" }, serverSettingsGuildId: "A" });
        expect(status(bad)).toBe(400);
        expect(body(bad).error).toMatchObject({ code: "bad_orga_notice", fields: ["enabled", "level"] });
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();

        const saved = await post("/api/vermerke/signals/settings", { orgaNotice: { enabled: true, level: "shadowban" }, serverSettingsGuildId: "A" });
        expect(status(saved)).toBe(200);
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ serverSettings: { A: { vermerkeOrgaNotice: { enabled: true, level: "shadowban" } } } });
        expect(body(saved)).toMatchObject({ own: { noShow: 5 }, orgaNotice: { enabled: true, level: "shadowban" } });
        expect(mockConfig.serverSettings.A.vermerkeSignals).toEqual({ noShow: 5 });

        // both at once, and another server keeps its own switch
        mockActive = "B";
        expect(body(await get("/api/vermerke/signals/settings")).orgaNotice).toEqual({ enabled: false, level: "warning" });
        mockActive = "A";
        const both = await post("/api/vermerke/signals/settings", { thresholds: { noShow: 4 }, orgaNotice: { enabled: false }, serverSettingsGuildId: "A" });
        expect(body(both)).toMatchObject({ own: { noShow: 4 }, orgaNotice: { enabled: false, level: "warning" } });
    });

    it("lets the read level see and only the write level change", async () => {
        signoff("A", "e1");
        mockUser = granted("read");
        expect(status(await get("/api/vermerke/signals"))).toBe(200);
        expect(status(await get("/api/vermerke/signals/settings"))).toBe(200);
        expect(status(await post("/api/vermerke/signals/ignore", { userId: U, kind: "no_show" }))).toBe(403);
        expect(status(await post("/api/vermerke/signals/settings", { thresholds: {}, serverSettingsGuildId: "A" }))).toBe(403);

        mockUser = granted("write");
        expect(status(await post("/api/vermerke/signals/ignore", { userId: U, kind: "no_show" }))).toBe(200);
    });

    it("shows nothing to an orga without the area", async () => {
        mockUser = ORGA;
        expect(status(await get("/api/vermerke/signals"))).toBe(403);
        expect(status(await get("/api/vermerke/signals/settings"))).toBe(403);
    });
});
