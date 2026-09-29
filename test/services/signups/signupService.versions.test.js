// Anmeldung je Spielversion (#543): für ein Event zählen nur die Charaktere
// seiner Version — Web und Discord teilen die Regel (signupService.js).

const mockEvents = new Map();
const mockLog = jest.fn();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventState: (id, patch) => {
        const ev = mockEvents.get(id);
        if (!ev) return null;
        const next = { ...ev, ...patch };
        mockEvents.set(id, next);
        return next;
    },
    appendEventLog: (id, entry) => mockLog(id, entry),
}));
const mockSignups = new Map();
const mockChanged = jest.fn();
jest.mock("../../../src/stores/signupStore", () => {
    const actual = jest.requireActual("../../../src/stores/signupStore");
    return {
        normalizeSignup: actual.normalizeSignup,
        getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
        listSignups: (eventId) => [...mockSignups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v),
        saveSignup: (eventId, userId, input, opts) => {
            const checked = actual.normalizeSignup(input, opts);
            if (checked.error) return { error: checked.error };
            const signup = { userId, ...checked.value, at: 1 };
            mockSignups.set(`${eventId}/${userId}`, signup);
            mockChanged(eventId);
            return { signup };
        },
    };
});
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockRoleIds = null;
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn(async () => mockRoleIds), postNotice: jest.fn(async () => ({})) }));

const profiles = require("../../../src/stores/raiderProfileStore");
const service = require("../../../src/services/signups/signupService");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const NOW = 1_900_000_000_000;

// The factory's own event, but three days after the fixed NOW rather than the real clock.
const event = (over = {}) => ownEvent({
    startTime: sec(NOW) + 3 * DAY, signupDeadline: sec(NOW) + 2 * DAY, wishes: true, ...over,
});

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-service-versions.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mockEvents.clear();
    mockSignups.clear();
    mockConfig = {};
    mockRoleIds = null;
    mockEvents.set("eh-kara", event());
    mockEvents.set("eh-barrow", event({ id: "eh-barrow", title: "Barrow Deeps", versionId: "forever", composition: { tank: 2, healer: 3, melee: 0, ranged: 0 } }));
    profiles.addCharacter(ANNA, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" }, { name: "Anna" });
});

describe("submitSignup je Spielversion", () => {
    it("nimmt für ein Forever-Event den Forever-Charakter, für TBC den TBC-Charakter", async () => {
        const forever = await service.submitSignup("eh-barrow", ANNA, { character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW });
        expect(forever.error).toBeUndefined();
        expect(forever.signup).toMatchObject({ character: "Devi Res", spec: "Priest-Shadow" });
        // the bot hands the key, the web the name — both find the character
        const byKey = await service.submitSignup("eh-barrow", ANNA, { character: "forever~devi res", spec: "Priest-Shadow" }, { now: NOW });
        expect(byKey.signup.character).toBe("Devi Res");
        const tbc = await service.submitSignup("eh-kara", ANNA, { character: "Devi", spec: "Priest-Holy" }, { now: NOW });
        expect(tbc.signup).toMatchObject({ character: "Devi", spec: "Priest-Holy" });
    });

    it("lehnt einen Charakter der anderen Version mit klarem Hinweis ab", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW });
        expect(res).toMatchObject({ code: "character_version" });
        expect(res.error).toBe("Devi Res gehört zu WoW Forever – lege einen TBC Anniversary-Charakter im Profil an.");
        const other = await service.submitSignup("eh-barrow", ANNA, { character: "Devi", spec: "Priest-Holy" }, { now: NOW });
        expect(other.error).toMatch(/Devi gehört zu TBC Anniversary – lege einen WoW Forever-Charakter im Profil an/);
        expect(service.httpStatusFor(other.code)).toBe(400);
    });

    it("die Orga im Setup-Editor (offProfile) bleibt in der Version des Events", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW, byOrga: true, offProfile: true });
        expect(res.code).toBe("character_version");
    });

    it("findCharacter sucht auf Wunsch nur in einer Version", () => {
        const p = profiles.getProfile(ANNA);
        expect(service.findCharacter(p, "Devi Res", "forever").key).toBe("forever~devi res");
        expect(service.findCharacter(p, "Devi Res", "tbc")).toBeNull();
        expect(service.findCharacter(null, "Devi")).toBeNull();
    });
});

describe("submitSignups je Spielversion", () => {
    it("überspringt einen Charakter der anderen Version mit Grund, statt den Raid abzulehnen", async () => {
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: [{ character: "Devi Res", spec: "Priest-Shadow" }, { character: "Devi", spec: "Priest-Holy" }] },
            { eventId: "eh-barrow", characters: [{ character: "Devi Res", spec: "Priest-Shadow" }, { character: "Devi", spec: "Priest-Holy" }] },
        ], { now: NOW });
        const [kara, barrow] = results;
        expect(kara.ok).toBe(true);
        expect(kara.signup.character).toBe("Devi");
        expect(kara.skipped).toEqual([{ character: "Devi Res", spec: "Priest-Shadow", reason: "Charakter aus einer anderen Spielversion – dieser Raid ist TBC Anniversary" }]);
        expect(barrow.ok).toBe(true);
        expect(barrow.signup.character).toBe("Devi Res");
        expect(barrow.skipped[0]).toMatchObject({ character: "Devi", reason: expect.stringContaining("WoW Forever") });
    });
});
