// „Alle Charaktere“ der Orga (src/web/apiRoutes/roster/characters.js): alle Charaktere
// aller Profile lesen, bearbeiten, Gear/Schalter setzen, herausnehmen — nur die Orga.

let mockUser = null;
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "" }));
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/stores/loot/reportStore", () => ({ listReports: () => [], getReportRoster: () => null }));
jest.mock("../../../../src/stores/roster/characterStore", () => ({ listCharacters: () => [] }));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}) }));
// the follow-up of a rename has its own suite (services/characters/characterEdit.test.js)
const mockEdit = jest.fn();
jest.mock("../../../../src/services/characters/characterEdit", () => ({ editProfileCharacter: (...a) => mockEdit(...a) }));
// the rule itself has its own suite (services/characters/profileVisibility.test.js)
jest.mock("../../../../src/services/discord/members/serverMembers", () => ({ serverMemberIds: jest.fn() }));
jest.mock("../../../../src/services/characters/profileVisibility", () => require("../../../helpers/visibilityMock").visibilityMock(
    jest.requireActual("../../../../src/services/characters/profileVisibility"),
));

const { visibleRaiderIds, raiderVisibility } = require("../../../../src/services/characters/profileVisibility");
const { readJsonBody } = require("../../../../src/web/http/apiBody");
const store = require("../../../../src/stores/roster/raiderProfileStore");
const route = require("../../../../src/web/apiRoutes/roster/characters");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { mockRes, status, json } = require("../../../helpers/http");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false, isOrga: false };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false, isOrga: false };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: false, isOrga: true };

async function call(handler, user, payload = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload);
    const res = mockRes();
    await handler({}, res, new URL("http://x/api"));
    return res;
}

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-characters-route.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    store.reset();
    visibleRaiderIds.mockResolvedValue(new Set([ANNA.id, BERT.id]));
    mockEdit.mockReset();
    mockEdit.mockImplementation((uid, key, data) => ({ ...store.editCharacter(uid, key, data), moved: { rosters: 1 } }));
    store.addCharacter(ANNA.id, { name: "Gentle", className: "Druid", source: "manual", specs: ["Druid-Restoration"] }, { name: "Anna" });
    store.addCharacter(BERT.id, { name: "Brando", className: "Shaman", source: "manual" }, { name: "Bert" });
});

describe("/api/characters (Orga)", () => {
    it("sperrt alles für Raider ohne Orga-Rolle (403 orga_only)", async () => {
        for (const handler of [route.getCharacters, route.postEdit, route.postSave, route.postRemove]) {
            const res = await call(handler, ANNA, { userId: BERT.id, key: "brando", name: "X" });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("orga_only");
        }
        expect(store.getProfile(BERT.id).characters[0].name).toBe("Brando");
    });

    it("listet jeden Raider mit Charakteren, nach Namen, mit Klasse, Specs und Nachweis", async () => {
        store.addCharacter("200000000000000003", { name: "Leer", className: "Mage", source: "manual" });
        store.removeCharacter("200000000000000003", "leer");
        const data = json(await call(route.getCharacters, ORGA)).data;
        expect(data.raiders.map((r) => r.name)).toEqual(["Anna", "Bert"]);
        expect(data.raiders[0].characters[0]).toMatchObject({ key: "gentle", name: "Gentle", className: "Druid", versionId: "tbc", evidence: expect.any(Object) });
        expect(data.raiders[0].characters[0].specs.map((s) => s.key)).toEqual(["Druid-Restoration"]);
    });

    it("bearbeitet den Charakter eines anderen Raiders über den Dienst, mit der Orga als Handelndem", async () => {
        const res = await call(route.postEdit, ORGA, { userId: ANNA.id, key: "gentle", name: "Blattwerk", className: "Druid", junk: 1 });
        expect(status(res)).toBe(200);
        expect(mockEdit).toHaveBeenCalledWith(ANNA.id, "gentle", { name: "Blattwerk", className: "Druid" }, { actor: ORGA.id });
        const data = json(res).data;
        expect(data).toMatchObject({ key: "blattwerk", moved: { rosters: 1 }, renamed: { fromName: "Gentle", toName: "Blattwerk" } });
        expect(data.raider.characters.map((c) => c.name)).toEqual(["Blattwerk"]);
    });

    it("meldet unbekanntes Konto/Charakter als 404 und einen abgelehnten Namen als 400", async () => {
        expect(status(await call(route.postEdit, ORGA, { userId: "999", key: "gentle", name: "X" }))).toBe(404);
        expect(status(await call(route.postEdit, ORGA, { userId: ANNA.id, key: "niemand", name: "X" }))).toBe(404);
        const bad = await call(route.postEdit, ORGA, { userId: ANNA.id, key: "gentle", name: "X1" });
        expect(status(bad)).toBe(400);
        expect(json(bad).error.code).toBe("bad_name");
    });

    it("setzt Gear und die Schalter des Charakters", async () => {
        const res = await call(route.postSave, ORGA, { userId: ANNA.id, key: "gentle", specs: [{ key: "Druid-Restoration", gear: "ready" }], canOfftank: true, canHeal: null });
        expect(status(res)).toBe(200);
        const c = store.getProfile(ANNA.id).characters[0];
        expect(c.specs).toEqual([{ key: "Druid-Restoration", gear: "ready" }]);
        expect(c).toMatchObject({ canOfftank: true, canHeal: null });
        expect(json(res).data.raider.characters[0].specs[0].gear).toBe("ready");
    });

    it("nimmt einen Charakter heraus", async () => {
        const res = await call(route.postRemove, ORGA, { userId: BERT.id, key: "brando" });
        expect(json(res).data).toMatchObject({ removed: true, raider: { userId: BERT.id, characters: [] } });
        expect(store.getProfile(BERT.id).characters).toEqual([]);
    });

    it("liefert die Log-Vorschläge des Raiders, Tippfehler seines Charakters zuerst", async () => {
        const res = mockRes();
        mockUser = ORGA;
        await route.getLogSuggestions({}, res, new URL(`http://x/api?userId=${ANNA.id}&key=gentle`));
        expect(status(res)).toBe(200);
        expect(Array.isArray(json(res).data.characters)).toBe(true);
        const none = mockRes();
        await route.getLogSuggestions({}, none, new URL("http://x/api?userId=999"));
        expect(status(none)).toBe(404);
        mockUser = ANNA;
        const refused = mockRes();
        await route.getLogSuggestions({}, refused, new URL(`http://x/api?userId=${ANNA.id}`));
        expect(status(refused)).toBe(403);
    });

    describe("nur Raider, die dieser Server sehen darf (#1077)", () => {
        beforeEach(() => visibleRaiderIds.mockResolvedValue(new Set([ANNA.id])));

        it("listet einen Raider nur eines anderen Servers nicht und nennt ihn nicht bei einem geteilten Charakter", async () => {
            store.addCharacter(BERT.id, { name: "Gentle", className: "Druid", source: "manual" }, { name: "Bert" });
            const data = json(await call(route.getCharacters, ORGA)).data;
            expect(data.raiders.map((r) => r.name)).toEqual(["Anna"]);
            expect(JSON.stringify(data)).not.toContain(BERT.id);
        });

        it("findet ihn, sobald er für diesen Server zählt", async () => {
            visibleRaiderIds.mockResolvedValue(new Set([ANNA.id, BERT.id]));
            const data = json(await call(route.getCharacters, ORGA)).data;
            expect(data.raiders.map((r) => r.name)).toEqual(["Anna", "Bert"]);
        });

        it("antwortet 503, wenn nur die Mitgliederliste fehlt, und ändert nichts", async () => {
            store.addCharacter(BERT.id, { name: "Brando", className: "Shaman", source: "manual" }, { name: "Bert" });
            raiderVisibility.mockResolvedValueOnce({ ids: new Set(), membersKnown: false });
            const res = await call(route.postEdit, ORGA, { userId: BERT.id, key: "brando", name: "Anders", className: "Shaman" });
            expect([status(res), json(res).error.code]).toEqual([503, "members_unavailable"]);
            expect(store.getProfile(BERT.id).characters.map((c) => c.name)).toEqual(["Brando"]);
        });

        it("antwortet auf jedem Weg wie für ein Konto ohne Profil und ändert nichts", async () => {
            const bert = { userId: BERT.id, key: "brando", name: "Anders", className: "Shaman" };
            for (const handler of [route.postEdit, route.postSave, route.postRemove]) {
                const res = await call(handler, ORGA, bert);
                expect(status(res)).toBe(404);
                expect(json(res).error.message).toBe("Kein Profil für dieses Konto.");
            }
            expect(mockEdit).not.toHaveBeenCalled();
            expect(store.getProfile(BERT.id).characters.map((c) => c.name)).toEqual(["Brando"]);
            const res = mockRes();
            mockUser = ORGA;
            await route.getLogSuggestions({}, res, new URL(`http://x/api?userId=${BERT.id}`));
            expect(status(res)).toBe(404);
        });

        it("nennt nach einer Änderung keinen fremden Raider am selben Charakter", async () => {
            store.addCharacter(BERT.id, { name: "Gentle", className: "Druid", source: "manual" }, { name: "Bert" });
            const res = await call(route.postSave, ORGA, { userId: ANNA.id, key: "gentle", canHeal: true });
            expect(status(res)).toBe(200);
            expect(JSON.stringify(json(res).data)).not.toContain(BERT.id);
        });

        it("lässt den Voll-Admin unverändert, ohne die Liste zu fragen", async () => {
            const admin = { ...ORGA, isAdmin: true };
            const data = json(await call(route.getCharacters, admin)).data;
            expect(data.raiders.map((r) => r.name)).toEqual(["Anna", "Bert"]);
            expect(status(await call(route.postSave, admin, { userId: BERT.id, key: "brando", canHeal: true }))).toBe(200);
            expect(visibleRaiderIds).not.toHaveBeenCalled();
        });
    });

    it("hängt am Bereich roster: lesen per GET, schreiben per POST", () => {
        expect(route.routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
            "GET /api/characters roster",
            "GET /api/characters/log-suggestions roster",
            "POST /api/characters/edit roster",
            "POST /api/characters/save roster",
            "POST /api/characters/remove roster",
        ]);
    });
});
