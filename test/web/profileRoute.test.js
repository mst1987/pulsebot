// "Mein Profil" über die API (src/web/apiRoutes/profile.js): nur das eigene
// Konto, Charaktere aus den Logs / der Armory / von Hand, doppelt beanspruchte
// Charaktere, und dass die Wünsche anderer nie bei einem Mitglied ankommen.

let mockUser = null;
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(() => mockUser),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));

const mockReports = [];
jest.mock("../../src/web/reportStore", () => ({
    listReports: () => mockReports.map((r) => ({ id: r.id, generatedAt: r.generatedAt })),
    getReportRoster: (id) => mockReports.find((r) => r.id === id) || null,
}));
const mockCharacters = [];
jest.mock("../../src/web/characterStore", () => ({ listCharacters: () => mockCharacters }));
const mockAssignments = {};
jest.mock("../../src/web/raiderCharactersStore", () => ({ listAllAssignments: () => mockAssignments }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => ({ blizzard: { clientId: "id", clientSecret: "secret" } }) }));

const mockSummary = jest.fn();
let mockConfigured = true;
jest.mock("../../src/classes/blizzard", () => jest.fn().mockImplementation(() => ({
    isConfigured: () => mockConfigured,
    getCharacterSummary: (...a) => mockSummary(...a),
})));

const { readJsonBody } = require("../../src/web/apiBody");
const store = require("../../src/web/raiderProfileStore");
const route = require("../../src/web/apiRoutes/profile");
const { tempStoreFile } = require("../helpers/tempStore");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: true };

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}
function status(res) {
    return res.writeHead.mock.calls[0][0];
}
async function call(handler, user, { json = {}, query = "" } = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(json);
    const res = mockRes();
    await handler({}, res, new URL(`http://x/api?${query}`));
    return res;
}

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-route.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    store.reset();
    mockReports.length = 0;
    mockCharacters.length = 0;
    for (const k of Object.keys(mockAssignments)) delete mockAssignments[k];
    mockSummary.mockReset();
    mockConfigured = true;
});

describe("GET/PUT /api/profile", () => {
    it("liefert das eigene Profil mit Klassen, Raids, Tagen und Gear-Stufen", async () => {
        const res = await call(route.getProfile, ANNA);
        const data = body(res).data;
        expect(data.profile).toMatchObject({ userId: ANNA.id, name: "Anna", characters: [] });
        expect(data.isNew).toBe(true);
        expect(data.classes).toHaveLength(9);
        expect(data.raidGroups.map((g) => g.id)).toEqual(["tbc", "classic", "forever"]);
        expect(data.gearLevels.map((g) => g.label)).toEqual(["keins", "brauchbar", "raidbereit"]);
    });

    it("liefert nur die eigene aus Raid-Helper importierte Spec-Historie (#291)", async () => {
        const history = require("../../src/web/specHistoryStore");
        history.useFile(tempStoreFile("spec-history.json"));
        try {
            history.applyImport([
                { userId: ANNA.id, spec: "Mage-Frost", eventId: "rh-1", at: 1000, character: "Nerathil" },
                { userId: BERT.id, spec: "Priest-Shadow", eventId: "rh-1", at: 1000, character: "Ysolde" },
            ], { eventIds: ["rh-1"] });
            const data = body(await call(route.getProfile, ANNA)).data;
            expect(data.specHistory).toEqual([{ spec: "Mage-Frost", count: 1, lastAt: 1000, lastEventId: "rh-1", character: "Nerathil" }]);
            expect(JSON.stringify(data)).not.toContain("Ysolde");
        } finally {
            // The scratch directory goes at the end of the suite (helpers/tempStore).
            history.useFile(null);
        }
    });

    it("speichert nur das eigene Konto, auch wenn der Body ein anderes nennt", async () => {
        await call(route.putProfile, ANNA, { json: { userId: BERT.id, note: "von Anna", availability: ["mi"] } });
        expect(store.getProfile(ANNA.id)).toMatchObject({ note: "von Anna", availability: ["mi"] });
        expect(store.hasProfile(BERT.id)).toBe(false);
    });

    it("nimmt Wünsche nur für Raider mit Profil an", async () => {
        store.addCharacter(BERT.id, { name: "Ysolde", className: "Mage" }, { name: "Bert" });
        const res = await call(route.putProfile, ANNA, { json: { wishes: [BERT.id, "200000000000000077"] } });
        expect(body(res).data.profile.wishes).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("schlägt Offtank/Heilen aus den Specs vor, bis der Raider selbst schaltet", async () => {
        store.addCharacter(ANNA.id, { name: "Bärbel", className: "Druid", specs: ["Druid-Balance", "Druid-Guardian"] });
        let profile = body(await call(route.getProfile, ANNA)).data.profile;
        expect(profile).toMatchObject({ canOfftank: true, canHeal: false, suggested: { canOfftank: true, canHeal: false } });
        profile = body(await call(route.putProfile, ANNA, { json: { canOfftank: false, canHeal: true } })).data.profile;
        expect(profile).toMatchObject({ canOfftank: false, canHeal: true });
    });
});

describe("Wünsche bleiben bei der Orga", () => {
    beforeEach(() => {
        store.addCharacter(ANNA.id, { name: "Nerathil", className: "Mage" }, { name: "Anna" });
        store.addCharacter(BERT.id, { name: "Ysolde", className: "Mage" }, { name: "Bert" });
        store.saveProfile(ANNA.id, { wishes: [BERT.id] }, { name: "Anna" });
        store.saveProfile(BERT.id, { wishes: [ANNA.id], note: "nur für die Orga" }, { name: "Bert" });
    });

    it("zeigt einem Mitglied weder fremde Wünsche noch ob ein Wunsch gegenseitig ist", async () => {
        const text = JSON.stringify(body(await call(route.getProfile, ANNA)).data);
        expect(text).not.toContain("mutual");
        expect(text).not.toContain("wishedBy");
        expect(text).not.toContain("nur für die Orga");
        const profile = JSON.parse(text).profile;
        expect(profile.wishes).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("liefert in der Raider-Suche nur Namen", async () => {
        const data = body(await call(route.getRaiderSearch, ANNA, { query: "q=ys" })).data;
        expect(data.raiders).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("zeigt der Orga das Profil mit gegenseitigen Wünschen und wer sich wen wünscht", async () => {
        const data = body(await call(route.getUserProfile, ORGA, { query: `id=${BERT.id}` })).data;
        expect(data.profile.wishes).toEqual([{ userId: ANNA.id, name: "Anna", main: "Nerathil", className: "Mage", mutual: true }]);
        expect(data.profile.wishedBy).toEqual([{ userId: ANNA.id, name: "Anna", main: "Nerathil", className: "Mage" }]);
        expect(data.profile.note).toBe("nur für die Orga");
    });

    it("antwortet 404 für ein Konto ohne Profil", async () => {
        const res = await call(route.getUserProfile, ORGA, { query: "id=200000000000000055" });
        expect(status(res)).toBe(404);
    });
});

describe("POST /api/profile/characters", () => {
    it("übernimmt einen Charakter aus den Logs mit Klasse und Spec von dort, nicht aus dem Request", async () => {
        mockReports.push({ id: "r1", generatedAt: 1000, roster: [{ name: "Nerathil", type: "Mage" }] });
        mockReports.push({ id: "r2", generatedAt: 2000, roster: [{ name: "Nerathil", type: "Mage" }, { name: "Brokk", type: "Warrior" }] });
        mockCharacters.push({ character: "Nerathil", className: "Mage", spec: "Arcane", source: "wcl", updatedAt: 1 });

        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "log", name: "nerathil", className: "Warrior" } });
        const { character } = body(res).data;
        expect(character).toMatchObject({ name: "Nerathil", className: "Mage", source: "log", main: true });
        expect(character.specs).toEqual([expect.objectContaining({ key: "Mage-Arcane", gear: "ready", logs: { status: "seen", reports: 2, source: "wcl" } })]);
    });

    it("lehnt einen Charakter ab, den kein Log kennt", async () => {
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "log", name: "Niemand" } });
        expect(status(res)).toBe(404);
    });

    it("markiert einen Spec, den die Logs nicht belegen, als Hinweis", async () => {
        mockReports.push({ id: "r1", generatedAt: 1000, roster: [{ name: "Nerathil", type: "Mage" }] });
        mockCharacters.push({ character: "Nerathil", className: "Mage", spec: "Arcane", source: "wcl" });
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "manual", name: "Nerathil", className: "Mage", specs: ["Mage-Frost"] } });
        expect(body(res).data.character.specs[0].logs).toEqual({ status: "other", reports: 1, loggedSpec: "Mage-Arcane" });
    });

    it("verknüpft mit der Armory und übernimmt Klasse, Stufe und Gilde", async () => {
        mockSummary.mockResolvedValue({ className: "Priest", level: 70, guild: "Pulse" });
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol", realm: "Die Aldor" } });
        const data = body(res).data;
        expect(mockSummary).toHaveBeenCalledWith("Nerasol", { realmSlug: "die-aldor" });
        expect(data.armory).toEqual({ linked: true, fetched: true });
        expect(data.character).toMatchObject({ className: "Priest", realm: "Die Aldor", armory: { level: 70, guild: "Pulse" } });
        expect(data.character.armoryUrl).toContain("Nerasol");
    });

    it("bleibt beim Link, wenn die Armory ausfällt – mit der Klasse von Hand", async () => {
        mockSummary.mockRejectedValue(new Error("503"));
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol", className: "Priest" } });
        const data = body(res).data;
        expect(data.armory).toEqual({ linked: true, fetched: false });
        expect(data.character).toMatchObject({ className: "Priest", armory: null });
    });

    it("fragt nach der Klasse, wenn die Armory nichts liefert und keine angegeben ist", async () => {
        mockConfigured = false;
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol" } });
        expect(status(res)).toBe(422);
        expect(body(res).error.code).toBe("class_required");
        expect(mockSummary).not.toHaveBeenCalled();
    });

    it("vergibt einen Charakter ein zweites Mal, zeigt es aber an und listet es fürs Roster", async () => {
        await call(route.postProfileCharacter, BERT, { json: { source: "manual", name: "Nerathil", className: "Mage" } });
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "manual", name: "Nerathil", className: "Mage" } });
        expect(body(res).data.character.claimedBy).toEqual([{ userId: BERT.id, name: "Bert" }]);

        const claims = body(await call(route.getCharacterClaims, ORGA)).data.claims;
        expect(claims).toHaveLength(1);
        expect(claims[0].claims.map((c) => c.name).sort()).toEqual(["Anna", "Bert"]);
    });

    it("entfernt nur aus dem eigenen Profil", async () => {
        store.addCharacter(BERT.id, { name: "Ysolde", className: "Mage" });
        const res = await call(route.postProfileCharacter, ANNA, { json: { remove: "ysolde" } });
        expect(body(res).data.removed).toBe(false);
        expect(store.getProfile(BERT.id).characters).toHaveLength(1);
    });
});

describe("GET /api/profile/log-characters", () => {
    it("stellt dem Konto zugeordnete und namensgleiche Charaktere nach vorn und lässt eigene weg", async () => {
        mockReports.push({ id: "r1", generatedAt: 5000, roster: [
            { name: "Brokk", type: "Warrior" }, { name: "Annabell", type: "Priest" }, { name: "Zuordnung", type: "Rogue" }, { name: "Schon", type: "Mage" },
        ] });
        mockAssignments.cat1 = { [ANNA.id]: "Zuordnung" };
        store.addCharacter(ANNA.id, { name: "Schon", className: "Mage" });
        store.addCharacter(BERT.id, { name: "Brokk", className: "Warrior" }, { name: "Bert" });

        const list = body(await call(route.getLogCharacters, ANNA)).data.characters;
        expect(list.map((c) => [c.character, c.match])).toEqual([["Zuordnung", "assigned"], ["Annabell", "name"], ["Brokk", ""]]);
        expect(list[2].claimedBy).toEqual([{ userId: BERT.id, name: "Bert" }]);
    });
});
