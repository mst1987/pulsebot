// Ab-/Anwesenheiten über die API (src/web/apiRoutes/availability.js): eigene
// Einträge, die Orga für andere, Vorschau der Raids, Löschen, Panels je Kategorie.
// Die Regeln selbst prüft test/services/signups/availability.test.js.

let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/stores/signupStore", () => ({ getSignup: (eventId) => (eventId === "eh-a" ? { status: "tentative" } : null) }));
jest.mock("../../../src/services/signups/availability", () => ({
    MAX_DAYS: 180,
    today: () => "2030-03-17",
    activeEntries: jest.fn(() => []),
    checkInput: jest.fn((userId, body) => (body.from ? { value: { userId, ...body } } : { error: "Bitte ein gültiges Von- und Bis-Datum angeben." })),
    raidsInRange: jest.fn(() => [{ id: "eh-a", title: "Kara", startTime: 1900000000, categoryName: "Raids" }, { id: "eh-b", title: "Gruul", startTime: 1900100000 }]),
    createEntry: jest.fn(),
    deleteEntry: jest.fn(),
}));
jest.mock("../../../src/services/signups/availabilityPanel", () => ({
    categoryNameFor: (id) => (id === "cat1" ? "Raids TBC" : ""),
    postPanel: jest.fn(),
    removePanel: jest.fn(),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const profiles = require("../../../src/stores/raiderProfileStore");
const store = require("../../../src/stores/availabilityStore");
const availability = require("../../../src/services/signups/availability");
const panel = require("../../../src/services/signups/availabilityPanel");
const route = require("../../../src/web/apiRoutes/availability");
const { tempStoreFile } = require("../../helpers/tempStore");
const { mockRes, status, json } = require("../../helpers/http");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false, access: { signup: { read: true, write: true } } };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: false, access: { signup: { read: true, write: true }, raids: { read: true, write: true } } };

const handler = (method, path) => route.routes.find((r) => r.method === method && r.path === path).handler;
async function call(method, path, user, { json: payload = {}, query = "" } = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload);
    const res = mockRes();
    await handler(method, path)({}, res, new URL(`http://x/api?${query}`));
    return res;
}

const entry = (over = {}) => ({
    id: "e1", userId: ANNA.id, kind: "absence", from: "2030-03-20", to: "2030-03-25", comment: "Urlaub",
    character: "", spec: "", versionId: "", categoryId: "", skip: [], applied: { "eh-a": { ok: true }, "eh-b": { ok: false } },
    createdBy: ANNA.id, createdAt: 1, ...over,
});

beforeAll(() => {
    profiles.useFile(tempStoreFile("eh-availability-route-profiles.json"));
    store.useFile(tempStoreFile("eh-availability-route.json"));
});
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
    store.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    profiles.reset();
    profiles.addCharacter(ANNA.id, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }, { key: "Mage-Fire", gear: "none" }] }, { name: "Anna" });
    profiles.addCharacter(ANNA.id, { name: "Ohnegear", className: "Priest", specs: [{ key: "Priest-Holy", gear: "none" }] }, { name: "Anna" });
});

describe("GET /api/availability", () => {
    it("liefert die eigenen Einträge und nur Charaktere mit brauchbarem Gear", async () => {
        availability.activeEntries.mockReturnValue([entry(), entry({ id: "e2", kind: "presence", character: "Nerathil", spec: "Mage-Arcane", categoryId: "cat1", createdBy: ORGA.id })]);
        const res = await call("GET", "/api/availability", ANNA);
        expect(status(res)).toBe(200);
        const data = json(res).data;
        expect(data).toMatchObject({ userId: ANNA.id, orga: false, today: "2030-03-17", maxDays: 180 });
        expect(data.entries[0]).toMatchObject({ id: "e1", kind: "absence", comment: "Urlaub", byOrga: false, done: 1, categoryName: "" });
        expect(data.entries[1]).toMatchObject({ kind: "presence", specLabel: "Arkan", categoryName: "Raids TBC", byOrga: true });
        expect(data.characters).toEqual([{ key: "nerathil", name: "Nerathil", className: "Mage", versionId: "tbc", specs: [{ key: "Mage-Arcane", label: "Arkan", gear: "ready" }] }]);
    });

    it("die eines anderen nur für die Orga", async () => {
        expect(status(await call("GET", "/api/availability", ANNA, { query: "userId=200000000000000002" }))).toBe(403);
        const res = await call("GET", "/api/availability", ORGA, { query: `userId=${ANNA.id}` });
        expect(json(res).data).toMatchObject({ userId: ANNA.id, name: "Anna", orga: true });
        expect(availability.activeEntries).toHaveBeenCalledWith(ANNA.id);
    });
});

describe("POST /api/availability/preview", () => {
    it("nennt die Raids des Zeitraums mit dem eigenen Status", async () => {
        const res = await call("POST", "/api/availability/preview", ANNA, { json: { kind: "absence", from: "2030-03-20", to: "2030-03-25" } });
        expect(json(res).data.raids.map((r) => [r.id, r.status])).toEqual([["eh-a", "tentative"], ["eh-b", ""]]);
    });

    it("gibt den Fehler der Prüfung als 400 zurück", async () => {
        const res = await call("POST", "/api/availability/preview", ANNA, { json: { kind: "absence" } });
        expect(status(res)).toBe(400);
        expect(json(res).error.message).toBe("Bitte ein gültiges Von- und Bis-Datum angeben.");
    });
});

describe("POST /api/availability", () => {
    it("trägt für sich selbst ein, mit den gewählten Raids", async () => {
        availability.createEntry.mockResolvedValue({ entry: entry(), results: [{ eventId: "eh-a", title: "Kara", startTime: 1, ok: true }], dm: true });
        const res = await call("POST", "/api/availability", ANNA, { json: { kind: "absence", from: "2030-03-20", eventIds: ["eh-a", ""], userId: "" } });
        expect(availability.createEntry).toHaveBeenCalledWith(ANNA.id, expect.objectContaining({ kind: "absence" }), expect.objectContaining({ by: ANNA.id, eventIds: ["eh-a"] }));
        expect(json(res).data).toMatchObject({ entry: { id: "e1" }, results: [{ eventId: "eh-a", ok: true, skipped: "", error: "" }], dm: true });
    });

    it("die Orga trägt für einen Raider ein, ein Raider nicht für andere", async () => {
        availability.createEntry.mockResolvedValue({ entry: entry({ createdBy: ORGA.id }), results: [], dm: false });
        expect(status(await call("POST", "/api/availability", ANNA, { json: { userId: "200000000000000002" } }))).toBe(403);
        await call("POST", "/api/availability", ORGA, { json: { kind: "absence", from: "2030-03-20", userId: ANNA.id } });
        expect(availability.createEntry).toHaveBeenCalledWith(ANNA.id, expect.anything(), expect.objectContaining({ by: ORGA.id, eventIds: undefined }));
    });

    it("gibt den Fehler des Service als 400 zurück", async () => {
        availability.createEntry.mockResolvedValue({ error: "Der Zeitraum liegt schon in der Vergangenheit." });
        const res = await call("POST", "/api/availability", ANNA, { json: {} });
        expect(status(res)).toBe(400);
    });
});

describe("DELETE /api/availability", () => {
    it("löscht über den Service, mit Orga-Recht nur für die Orga", async () => {
        availability.deleteEntry.mockReturnValueOnce({ error: "Eintrag nicht gefunden.", code: "not_found" });
        expect(status(await call("DELETE", "/api/availability", ANNA, { json: { id: "x" } }))).toBe(404);
        expect(availability.deleteEntry).toHaveBeenLastCalledWith("x", { userId: ANNA.id, orga: false });
        availability.deleteEntry.mockReturnValueOnce({ entry: { id: "e1" } });
        const res = await call("DELETE", "/api/availability", ORGA, { json: { id: "e1" } });
        expect(json(res).data).toEqual({ id: "e1" });
        expect(availability.deleteEntry).toHaveBeenLastCalledWith("e1", { userId: ORGA.id, orga: true });
    });
});

describe("Panels", () => {
    it("listet, postet und entfernt Panels", async () => {
        store.setPanel({ categoryId: "cat1", guildId: "g", channelId: "c1", messageId: "m1" }, { now: 5 });
        const list = await call("GET", "/api/availability/panels", ORGA);
        expect(json(list).data.panels).toEqual([{ categoryId: "cat1", channelId: "c1", postedAt: 5, url: "" }]);

        panel.postPanel.mockResolvedValue({ panel: { categoryId: "cat1", guildId: "g", channelId: "c2", messageId: "m2", postedAt: 6 }, url: "https://discord.com/channels/g/c2/m2" });
        const posted = await call("POST", "/api/availability/panel", ORGA, { json: { categoryId: "cat1", channelId: "c2" } });
        expect(panel.postPanel).toHaveBeenCalledWith({ categoryId: "cat1", channelId: "c2", by: ORGA.id });
        expect(json(posted).data.panel).toMatchObject({ channelId: "c2", url: "https://discord.com/channels/g/c2/m2" });

        panel.postPanel.mockResolvedValue({ error: "Kein Kanal gewählt." });
        expect(status(await call("POST", "/api/availability/panel", ORGA, { json: { categoryId: "cat1" } }))).toBe(400);

        panel.removePanel.mockResolvedValueOnce({ categoryId: "cat1" }).mockResolvedValueOnce(null);
        expect(json(await call("DELETE", "/api/availability/panel", ORGA, { json: { categoryId: "cat1" } })).data).toEqual({ categoryId: "cat1" });
        expect(status(await call("DELETE", "/api/availability/panel", ORGA, { json: { categoryId: "cat1" } }))).toBe(404);
    });
});
