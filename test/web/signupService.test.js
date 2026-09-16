// Die Anmelde-Regeln (src/web/signupService.js), die Web und Discord (#258) teilen:
// Spec passt zum Charakter aus dem Profil, Anmeldeschluss, Statuswechsel,
// „kann auch“ aus dem Profil, Raid-Helper-Events nicht anmeldbar.
const os = require("os");
const path = require("path");

const mockEvents = new Map();
jest.mock("../../src/web/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
const mockSignups = new Map();
const mockChanged = jest.fn();
jest.mock("../../src/web/signupStore", () => {
    const actual = jest.requireActual("../../src/web/signupStore");
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

const profiles = require("../../src/web/raiderProfileStore");
const service = require("../../src/web/signupService");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const NOW = 1_900_000_000_000;
const sec = (ms) => Math.floor(ms / 1000);

const event = (over = {}) => ({
    id: "eh-kara", source: "eventhelper", title: "Karazhan", versionId: "tbc",
    startTime: sec(NOW) + 3 * 86400, signupDeadline: sec(NOW) + 2 * 86400,
    size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, wishes: true, ...over,
});

beforeAll(() => profiles.useFile(path.join(os.tmpdir(), `eh-signup-service-${process.pid}.json`)));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mockEvents.clear();
    mockSignups.clear();
    mockChanged.mockClear();
    mockEvents.set("eh-kara", event());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane", "Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
});

describe("submitSignup", () => {
    it("meldet mit Charakter und Spec aus dem Profil an und löst das Änderungsereignis aus", () => {
        const res = service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed", comment: "komme pünktlich" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.signup).toMatchObject({ character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", comment: "komme pünktlich" });
        expect(mockChanged).toHaveBeenCalledWith("eh-kara");
    });

    it("lehnt einen Charakter ab, der nicht im eigenen Profil steht", () => {
        profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
        const res = service.submitSignup("eh-kara", ANNA, { character: "Ysolde", spec: "Mage-Frost" }, { now: NOW });
        expect(res).toMatchObject({ code: "character" });
    });

    it("lehnt einen Spec ab, der nicht zum Charakter passt oder nicht hinterlegt ist", () => {
        expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Priest-Holy" }, { now: NOW })).toMatchObject({ code: "spec" });
        expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Frost" }, { now: NOW })).toMatchObject({ code: "spec" });
        expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "" }, { now: NOW })).toMatchObject({ code: "spec" });
    });

    it("füllt „kann auch“ aus dem Profil vor, ohne die eigene Rolle", () => {
        const res = service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
        // Nerasol ist Heilig-Priester → heilen; die Magier-Specs sind alle Fernkampf.
        expect(res.signup.canAlso).toEqual(["healer"]);
    });

    it("nimmt eine eigene Auswahl bei „kann auch“, auch eine leere", () => {
        const res = service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", canAlso: [] }, { now: NOW });
        expect(res.signup.canAlso).toEqual([]);
    });

    it("wechselt den Status und meldet ohne Spec ab", () => {
        service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
        const res = service.submitSignup("eh-kara", ANNA, { status: "absence", comment: "krank" }, { now: NOW });
        expect(res.signup).toMatchObject({ status: "absence", spec: "", role: "", comment: "krank" });
    });

    it("lässt Raid-Helper-Events nicht zu", () => {
        expect(service.submitSignup("1234567890", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW })).toMatchObject({ code: "raidhelper" });
        expect(service.validateSignup({ id: "123", source: "raidhelper" }, {}, { now: NOW })).toMatchObject({ code: "raidhelper" });
    });

    it("antwortet not_found für ein unbekanntes eigenes Event", () => {
        expect(service.submitSignup("eh-weg", ANNA, { status: "absence" }, { now: NOW })).toMatchObject({ code: "not_found" });
    });

    describe("Anmeldeschluss", () => {
        const late = NOW + 2.5 * 86400 * 1000;

        it("erlaubt danach nur noch Abmelden und Spät", () => {
            expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: late })).toMatchObject({ code: "deadline" });
            expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "tentative" }, { now: late })).toMatchObject({ code: "deadline" });
            expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: late }).signup.status).toBe("late");
            expect(service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: late }).signup.status).toBe("absence");
        });

        it("lässt eine bestehende Anmeldung mit gleichem Status und Spec bearbeiten (Kommentar)", () => {
            service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
            const res = service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed", comment: "neu" }, { now: late });
            expect(res.signup.comment).toBe("neu");
            expect(service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: late })).toMatchObject({ code: "deadline" });
        });

        it("bindet die Orga nicht", () => {
            const res = service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: late, byOrga: true });
            expect(res.signup.status).toBe("signed");
        });

        it("schließt die Anmeldung mit Raidbeginn", () => {
            const started = NOW + 3.1 * 86400 * 1000;
            expect(service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: started })).toMatchObject({ code: "started" });
            expect(service.allowedStatuses(event(), { now: started })).toEqual([]);
            expect(service.allowedStatuses(event(), { now: late })).toEqual(["absence", "late"]);
            expect(service.allowedStatuses(event(), { now: NOW })).toEqual(["signed", "tentative", "late", "bench", "absence"]);
        });
    });
});

describe("roleCounts", () => {
    it("zählt Dabei und Spät je Rolle gegen den Plan", () => {
        const counts = service.roleCounts(event(), [
            { role: "tank", status: "signed" }, { role: "healer", status: "late" },
            { role: "ranged", status: "signed" }, { role: "melee", status: "tentative" }, { role: "", status: "absence" },
        ]);
        expect(counts).toMatchObject({
            tank: { n: 1, target: 2 }, healer: { n: 1, target: 3 }, dps: { n: 1, target: 5 },
            attending: 2 + 1, tentative: 1, absence: 1, size: 10,
        });
    });
});

describe("wishPartnersSignedUp", () => {
    it("nennt nur eigene Wunschpartner, die angemeldet und nicht abgemeldet sind", () => {
        profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
        const anna = profiles.saveProfile(ANNA, { wishes: [BERT] }, { name: "Anna" });
        expect(service.wishPartnersSignedUp(anna, [{ userId: BERT, character: "Ysolde", status: "signed" }]))
            .toEqual([{ userId: BERT, name: "Ysolde" }]);
        expect(service.wishPartnersSignedUp(anna, [{ userId: BERT, character: "Ysolde", status: "absence" }])).toEqual([]);
        expect(service.wishPartnersSignedUp(profiles.getProfile(BERT), [{ userId: ANNA, status: "signed" }])).toEqual([]);
    });
});
