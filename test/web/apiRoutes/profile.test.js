// "Mein Profil" über die API (src/web/apiRoutes/profile.js): nur das eigene
// Konto, Charaktere aus den Logs / der Armory / von Hand, doppelt beanspruchte
// Charaktere, und dass die Wünsche anderer nie bei einem Mitglied ankommen.

let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());

const mockReports = [];
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: () => mockReports.map((r) => ({ id: r.id, generatedAt: r.generatedAt })),
    getReportRoster: (id) => mockReports.find((r) => r.id === id) || null,
}));
const mockCharacters = [];
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: () => mockCharacters }));
const mockAssignments = {};
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ listAllAssignments: () => mockAssignments }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({ blizzard: { clientId: "id", clientSecret: "secret" } }) }));

const mockSummary = jest.fn();
let mockConfigured = true;
jest.mock("../../../src/classes/blizzard", () => jest.fn().mockImplementation(() => ({
    isConfigured: () => mockConfigured,
    getCharacterSummary: (...a) => mockSummary(...a),
})));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const store = require("../../../src/stores/raiderProfileStore");
const route = require("../../../src/web/apiRoutes/profile");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: true };

const { mockRes, status, json } = require("../../helpers/http");

async function call(handler, user, { json: payload = {}, query = "" } = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload);
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
        const data = json(res).data;
        expect(data.profile).toMatchObject({ userId: ANNA.id, name: "Anna", characters: [] });
        expect(data.isNew).toBe(true);
        expect(data.classes).toHaveLength(9);
        expect(data.raidGroups.map((g) => g.id)).toEqual(["tbc", "classic", "forever"]);
        expect(data.gearLevels.map((g) => g.label)).toEqual(["keins", "brauchbar", "raidbereit"]);
    });

    it("liefert nur die eigene aus Raid-Helper importierte Spec-Historie (#291)", async () => {
        const history = require("../../../src/stores/specHistoryStore");
        history.useFile(tempStoreFile("spec-history.json"));
        try {
            history.applyImport([
                { userId: ANNA.id, spec: "Mage-Frost", eventId: "rh-1", at: 1000, character: "Nerathil" },
                { userId: BERT.id, spec: "Priest-Shadow", eventId: "rh-1", at: 1000, character: "Ysolde" },
            ], { eventIds: ["rh-1"] });
            const data = json(await call(route.getProfile, ANNA)).data;
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
        expect(json(res).data.profile.wishes).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("schlägt Offtank/Heilen je Charakter aus dessen Specs vor, bis der Raider selbst schaltet", async () => {
        store.addCharacter(ANNA.id, { name: "Bärbel", className: "Druid", specs: ["Druid-Balance", "Druid-Guardian"] });
        store.addCharacter(ANNA.id, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        const char = (p, key) => p.characters.find((c) => c.key === key);
        let profile = json(await call(route.getProfile, ANNA)).data.profile;
        expect(char(profile, "bärbel")).toMatchObject({ canOfftank: true, canHeal: false, suggested: { canOfftank: true, canHeal: false } });
        expect(char(profile, "nerathil")).toMatchObject({ canOfftank: false, canHeal: false, possible: { canOfftank: false, canHeal: false } });
        expect(char(profile, "bärbel").possible).toEqual({ canOfftank: true, canHeal: true });
        profile = json(await call(route.putProfile, ANNA, { json: { characters: [{ key: "bärbel", canHeal: true }, { key: "nerathil", canHeal: true }] } })).data.profile;
        expect(char(profile, "bärbel")).toMatchObject({ canOfftank: true, canHeal: true });
        // ein Magier kann nicht heilen, egal was der Body sagt
        expect(char(profile, "nerathil")).toMatchObject({ canOfftank: false, canHeal: false });
        // die Zusammenfassung: kann es irgendein Charakter?
        expect(profile).toMatchObject({ canOfftank: true, canHeal: true });
        // das alte profilweite Feld nimmt die Route nicht mehr an
        await call(route.putProfile, ANNA, { json: { canOfftank: false } });
        expect(store.getProfile(ANNA.id).canOfftank).toBeNull();
    });
});

describe("Nicht mit X raiden", () => {
    beforeEach(() => {
        store.addCharacter(ANNA.id, { name: "Nerathil", className: "Mage" }, { name: "Anna" });
        store.addCharacter(BERT.id, { name: "Ysolde", className: "Mage" }, { name: "Bert" });
    });

    it("ist aus, bis der Raider es einschaltet, und vergisst die Namen beim Ausschalten", async () => {
        let profile = json(await call(route.getProfile, ANNA)).data.profile;
        expect(profile).toMatchObject({ avoidEnabled: false, avoid: [] });
        // ausgeschaltet nimmt es keine Namen an
        profile = json(await call(route.putProfile, ANNA, { json: { avoid: [BERT.id] } })).data.profile;
        expect(profile.avoid).toEqual([]);
        profile = json(await call(route.putProfile, ANNA, { json: { avoidEnabled: true, avoid: [BERT.id, "200000000000000077"] } })).data.profile;
        expect(profile).toMatchObject({ avoidEnabled: true, avoid: [{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }] });
        profile = json(await call(route.putProfile, ANNA, { json: { avoidEnabled: false } })).data.profile;
        expect(profile).toMatchObject({ avoidEnabled: false, avoid: [] });
        expect(store.getProfile(ANNA.id).avoid).toEqual([]);
    });

    it("kommt beim Genannten nie an — auch nicht in der Orga-Ansicht", async () => {
        await call(route.putProfile, ANNA, { json: { avoidEnabled: true, avoid: [BERT.id] } });
        const own = JSON.stringify(json(await call(route.getProfile, BERT)).data);
        expect(own).not.toContain(ANNA.id);
        const orga = json(await call(route.getUserProfile, ORGA, { query: `id=${BERT.id}` })).data.profile;
        expect(JSON.stringify(orga)).not.toContain(ANNA.id);
        const search = JSON.stringify(json(await call(route.getRaiderSearch, BERT, { query: "q=ner" })).data);
        expect(search).not.toContain("avoid");
    });

    it("streicht einen Namen, der zugleich ein Wunsch ist", async () => {
        const profile = json(await call(route.putProfile, ANNA, { json: { wishes: [BERT.id], avoidEnabled: true, avoid: [BERT.id] } })).data.profile;
        expect(profile.wishes.map((w) => w.userId)).toEqual([BERT.id]);
        expect(profile.avoid).toEqual([]);
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
        const text = JSON.stringify(json(await call(route.getProfile, ANNA)).data);
        expect(text).not.toContain("mutual");
        expect(text).not.toContain("wishedBy");
        expect(text).not.toContain("nur für die Orga");
        const profile = JSON.parse(text).profile;
        expect(profile.wishes).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("liefert in der Raider-Suche nur Namen", async () => {
        const data = json(await call(route.getRaiderSearch, ANNA, { query: "q=ys" })).data;
        expect(data.raiders).toEqual([{ userId: BERT.id, name: "Bert", main: "Ysolde", className: "Mage" }]);
    });

    it("zeigt der Orga das Profil mit gegenseitigen Wünschen und wer sich wen wünscht", async () => {
        const data = json(await call(route.getUserProfile, ORGA, { query: `id=${BERT.id}` })).data;
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
        const { character } = json(res).data;
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
        expect(json(res).data.character.specs[0].logs).toEqual({ status: "other", reports: 1, loggedSpec: "Mage-Arcane" });
    });

    it("verknüpft mit der Armory und übernimmt Klasse, Stufe und Gilde", async () => {
        mockSummary.mockResolvedValue({ className: "Priest", level: 70, guild: "Pulse" });
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol", realm: "Die Aldor" } });
        const data = json(res).data;
        expect(mockSummary).toHaveBeenCalledWith("Nerasol", { realmSlug: "die-aldor" });
        expect(data.armory).toEqual({ linked: true, fetched: true });
        expect(data.character).toMatchObject({ className: "Priest", realm: "Die Aldor", armory: { level: 70, guild: "Pulse" } });
        expect(data.character.armoryUrl).toContain("Nerasol");
    });

    it("bleibt beim Link, wenn die Armory ausfällt – mit der Klasse von Hand", async () => {
        mockSummary.mockRejectedValue(new Error("503"));
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol", className: "Priest" } });
        const data = json(res).data;
        expect(data.armory).toEqual({ linked: true, fetched: false });
        expect(data.character).toMatchObject({ className: "Priest", armory: null });
    });

    it("fragt nach der Klasse, wenn die Armory nichts liefert und keine angegeben ist", async () => {
        mockConfigured = false;
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "armory", name: "Nerasol" } });
        expect(status(res)).toBe(422);
        expect(json(res).error.code).toBe("class_required");
        expect(mockSummary).not.toHaveBeenCalled();
    });

    it("vergibt einen Charakter ein zweites Mal, zeigt es aber an und listet es fürs Roster", async () => {
        await call(route.postProfileCharacter, BERT, { json: { source: "manual", name: "Nerathil", className: "Mage" } });
        const res = await call(route.postProfileCharacter, ANNA, { json: { source: "manual", name: "Nerathil", className: "Mage" } });
        expect(json(res).data.character.claimedBy).toEqual([{ userId: BERT.id, name: "Bert" }]);

        const claims = json(await call(route.getCharacterClaims, ORGA)).data.claims;
        expect(claims).toHaveLength(1);
        expect(claims[0].claims.map((c) => c.name).sort()).toEqual(["Anna", "Bert"]);
    });

    it("entfernt nur aus dem eigenen Profil", async () => {
        store.addCharacter(BERT.id, { name: "Ysolde", className: "Mage" });
        const res = await call(route.postProfileCharacter, ANNA, { json: { remove: "ysolde" } });
        expect(json(res).data.removed).toBe(false);
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

        const list = json(await call(route.getLogCharacters, ANNA)).data.characters;
        expect(list.map((c) => [c.character, c.match])).toEqual([["Zuordnung", "assigned"], ["Annabell", "name"], ["Brokk", ""]]);
        expect(list[2].claimedBy).toEqual([{ userId: BERT.id, name: "Bert" }]);
    });
});

// Kalender-Abo (#312): der Link ist der ganze Zugang zur Feed-Route. Wichtig ist
// darum, dass er genau einmal herausgeht, nur dem eigenen Konto gehört und
// sofort widerrufbar ist.
describe("Kalender-Abo (/api/profile/calendar)", () => {
    const calStore = require("../../../src/stores/calendarTokenStore");
    const calFeed = require("../../../src/web/pages/calendarFeed");
    const { requireCsrf } = require("../../../src/web/http/apiMiddleware");

    beforeEach(() => {
        calStore.useFile(tempStoreFile("eh-calendar-tokens-route.json"));
        calFeed.clearCache();
    });
    afterAll(() => calStore.useFile(null));

    it("gibt das Geheimnis genau einmal heraus – die Liste danach nie wieder", async () => {
        const made = json(await call(route.postCalendarToken, ANNA)).data;
        expect(made.token).toMatch(/^ehc_[a-f0-9]+$/);
        expect(made.url).toContain(made.token);

        const list = json(await call(route.getCalendarTokens, ANNA)).data;
        expect(list.tokens).toHaveLength(1);
        expect(JSON.stringify(list)).not.toContain(made.token);
        expect(list.tokens[0]).not.toHaveProperty("hash");
        expect(list.tokens[0].hint).toBe(made.token.slice(-4));
    });

    it("zeigt nur die eigenen Links", async () => {
        await call(route.postCalendarToken, ANNA);
        await call(route.postCalendarToken, BERT);
        expect(json(await call(route.getCalendarTokens, ANNA)).data.tokens).toHaveLength(1);
        expect(json(await call(route.getCalendarTokens, BERT)).data.tokens).toHaveLength(1);
    });

    it("widerruft sofort – und nie den Link eines anderen", async () => {
        const mine = json(await call(route.postCalendarToken, ANNA)).data;
        const id = mine.tokens[0].id;

        // Bert versucht es mit Annas Id: nichts passiert, kein Hinweis
        const foreign = json(await call(route.postCalendarToken, BERT, { json: { revoke: id } })).data;
        expect(foreign.revoked).toBe(false);
        expect(calStore.verifyToken(mine.token)).toBeTruthy();

        const own = json(await call(route.postCalendarToken, ANNA, { json: { revoke: id } })).data;
        expect(own.revoked).toBe(true);
        expect(own.tokens).toHaveLength(0);
        expect(calStore.verifyToken(mine.token)).toBeNull();
    });

    it("begrenzt die Zahl der Links pro Konto", async () => {
        for (let i = 0; i < calStore.MAX_PER_USER; i += 1) {
            expect(json(await call(route.postCalendarToken, ANNA)).data.token).toBeTruthy();
        }
        const res = await call(route.postCalendarToken, ANNA);
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("too_many");
    });

    it("braucht ein CSRF-Token zum Erzeugen", async () => {
        requireCsrf.mockReturnValueOnce(false);
        const res = await call(route.postCalendarToken, ANNA);
        expect(res.end).not.toHaveBeenCalled();
        expect(calStore.listTokensFor(ANNA.id)).toEqual([]);
    });
});
