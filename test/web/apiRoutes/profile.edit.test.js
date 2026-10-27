// „Mein Profil“ › Bearbeiten (POST /api/profile/characters { edit }): nur das
// eigene Konto, nur die erlaubten Felder, Fehler als 400/404.

let mockUser = null;
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "" }));
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
const mockReports = [];
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: () => mockReports.map((r) => ({ id: r.id, generatedAt: r.generatedAt })),
    getReportRoster: (id) => mockReports.find((r) => r.id === id) || null,
}));
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: () => [] }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}) }));
const mockEdit = jest.fn();
jest.mock("../../../src/services/characters/characterEdit", () => ({ editProfileCharacter: (...a) => mockEdit(...a) }));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const store = require("../../../src/stores/raiderProfileStore");
const route = require("../../../src/web/apiRoutes/profile");
const { tempStoreFile } = require("../../helpers/tempStore");
const { mockRes, status, json } = require("../../helpers/http");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false };

async function call(user, payload) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload);
    const res = mockRes();
    await route.postProfileCharacter({}, res, new URL("http://x/api"));
    return res;
}

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-edit-route.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    store.reset();
    mockEdit.mockReset();
    mockEdit.mockImplementation((uid, key, data) => ({ ...store.editCharacter(uid, key, data), moved: null }));
    store.addCharacter(ANNA.id, { name: "Gentle", className: "Druid", source: "manual" }, { name: "Anna" });
});

describe("POST /api/profile/characters { edit }", () => {
    it("bearbeitet den eigenen Charakter: nur Name, Realm, Klasse und Specs gehen durch", async () => {
        const res = await call(ANNA, { edit: "gentle", name: "Blattwerk", realm: "Thunderstrike", className: "Druid", specs: ["Druid-Feral"], userId: BERT.id, source: "log" });
        expect(status(res)).toBe(200);
        expect(mockEdit).toHaveBeenCalledWith(ANNA.id, "gentle", { name: "Blattwerk", realm: "Thunderstrike", className: "Druid", specs: ["Druid-Feral"] }, { actor: ANNA.id });
        const data = json(res).data;
        expect(data.character).toMatchObject({ key: "blattwerk", name: "Blattwerk", realm: "Thunderstrike" });
        expect(data.renamed).toMatchObject({ fromName: "Gentle", toName: "Blattwerk" });
        expect(data.profile.characters.map((c) => c.name)).toEqual(["Blattwerk"]);
    });

    it("kann keinen fremden Charakter bearbeiten: es gilt immer das eigene Konto", async () => {
        const res = await call(BERT, { edit: "gentle", name: "Blattwerk" });
        expect(status(res)).toBe(404);
        expect(store.getProfile(ANNA.id).characters[0].name).toBe("Gentle");
    });

    it("ordnet einen Charakter aus den Logs zu: Name und Klasse aus dem Log, nicht aus der Anfrage", async () => {
        mockReports.splice(0, mockReports.length, { id: "r1", generatedAt: 1, roster: [{ name: "Gentlê", type: "Shaman" }] });
        const res = await call(ANNA, { edit: "gentle", fromLog: "gentlê", className: "Mage" });
        expect(status(res)).toBe(200);
        expect(mockEdit).toHaveBeenCalledWith(ANNA.id, "gentle", { name: "Gentlê", className: "Shaman", source: "log", specs: [] }, { actor: ANNA.id });
        expect(json(res).data.character).toMatchObject({ name: "Gentlê", className: "Shaman", source: "log" });
    });

    it("ein Name, den kein Log kennt, ist 404 not_in_logs", async () => {
        mockReports.length = 0;
        const res = await call(ANNA, { edit: "gentle", fromLog: "Niemand" });
        expect(status(res)).toBe(404);
        expect(json(res).error.code).toBe("not_in_logs");
        expect(mockEdit).not.toHaveBeenCalled();
    });

    it("schlägt Log-Namen zum korrigierten Charakter vor, ähnliche zuerst (?near=)", async () => {
        mockReports.splice(0, mockReports.length, { id: "r1", generatedAt: 1, roster: [{ name: "Zeta", type: "Mage" }, { name: "Gentl", type: "Druid" }] });
        mockUser = ANNA;
        const res = mockRes();
        await route.getLogCharacters({}, res, new URL("http://x/api?near=gentle"));
        expect(json(res).data.characters.map((c) => [c.character, c.match])).toEqual([["Gentl", "similar"], ["Zeta", ""]]);
    });

    it("meldet einen abgelehnten Namen als 400 mit Code", async () => {
        const res = await call(ANNA, { edit: "gentle", name: "X1" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("bad_name");
    });
});
