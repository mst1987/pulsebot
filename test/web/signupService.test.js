// Die Anmelde-Regeln (src/web/signupService.js), die Web und Discord (#258) teilen:
// Spec passt zum Charakter aus dem Profil, Anmeldeschluss, Statuswechsel,
// „kann auch“ aus dem Profil, Raid-Helper-Events nicht anmeldbar.

const mockEvents = new Map();
const mockLog = jest.fn();
jest.mock("../../src/web/eventStore", () => ({
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
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockRoleIds = null;
jest.mock("../../src/web/discord", () => ({ memberRoleIds: jest.fn(async () => mockRoleIds), postNotice: jest.fn(async () => ({})) }));

const profiles = require("../../src/web/raiderProfileStore");
const discord = require("../../src/web/discord");
const service = require("../../src/web/signupService");
const { tempStoreFile } = require("../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../factories/events");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const NOW = 1_900_000_000_000;

// The factory's own event, but three days after the fixed NOW rather than the real clock.
const event = (over = {}) => ownEvent({
    startTime: sec(NOW) + 3 * DAY, signupDeadline: sec(NOW) + 2 * DAY, wishes: true, ...over,
});

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-service.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mockEvents.clear();
    mockSignups.clear();
    mockChanged.mockClear();
    mockConfig = {};
    mockRoleIds = null;
    mockLog.mockClear();
    discord.memberRoleIds.mockClear();
    mockEvents.set("eh-kara", event());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane", "Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
});

describe("submitSignup", () => {
    it("meldet mit Charakter und Spec aus dem Profil an und löst das Änderungsereignis aus", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed", comment: "komme pünktlich" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.signup).toMatchObject({ character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", comment: "komme pünktlich" });
        expect(mockChanged).toHaveBeenCalledWith("eh-kara");
    });

    it("lehnt einen Charakter ab, der nicht im eigenen Profil steht", async () => {
        profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Ysolde", spec: "Mage-Frost" }, { now: NOW });
        expect(res).toMatchObject({ code: "character" });
    });

    it("lehnt einen Spec ab, der nicht zum Charakter passt oder nicht hinterlegt ist", async () => {
        expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Priest-Holy" }, { now: NOW })).toMatchObject({ code: "spec" });
        expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Frost" }, { now: NOW })).toMatchObject({ code: "spec" });
        expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "" }, { now: NOW })).toMatchObject({ code: "spec" });
    });

    it("füllt „kann auch“ aus dem Profil vor, ohne die eigene Rolle", async () => {
        // Nerathil hat nur Fernkampf-Specs; dass Nerasol heilen kann, gilt nur für Nerasol.
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.signup.canAlso).toEqual([]);
    });

    it("nimmt „kann offtanken / heilen“ des angemeldeten Charakters", async () => {
        profiles.addCharacter(ANNA, { name: "Bärbel", className: "Druid", specs: ["Druid-Balance"] }, { name: "Anna" });
        // der Magier kann weder tanken noch heilen – das „ja“ zählt nicht
        profiles.saveProfile(ANNA, { characters: [{ key: "nerathil", canHeal: true }, { key: "bärbel", canHeal: true, canOfftank: false }] });
        const mage = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(mage.signup.canAlso).toEqual([]);
        const druid = await service.submitSignup("eh-kara", ANNA, { character: "Bärbel", spec: "Druid-Balance" }, { now: NOW });
        expect(druid.signup.canAlso).toEqual(["healer"]);
        expect(service.profileRoles(profiles.getProfile(ANNA), "Bärbel")).toEqual({ canOfftank: false, canHeal: true });
        expect(service.profileRoles(profiles.getProfile(ANNA), "Nerathil")).toEqual({ canOfftank: false, canHeal: false });
        // ohne Charakter: kann es irgendeiner? (Nerasol ist Heilig-Priester)
        expect(service.profileRoles(profiles.getProfile(ANNA))).toEqual({ canOfftank: false, canHeal: true });
    });

    it("nimmt eine eigene Auswahl bei „kann auch“, auch eine leere", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", canAlso: [] }, { now: NOW });
        expect(res.signup.canAlso).toEqual([]);
    });

    it("wechselt den Status und meldet ohne Spec ab", async () => {
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
        const res = await service.submitSignup("eh-kara", ANNA, { status: "absence", comment: "krank" }, { now: NOW });
        expect(res.signup).toMatchObject({ status: "absence", spec: "", role: "", comment: "krank" });
    });

    it("postet die Nachricht zu Vielleicht/Absagen in den Kanal der Orga – einmal, und nicht für die Orga", async () => {
        discord.postNotice.mockClear();
        mockConfig = { discordServers: { signupNoteChannelId: "777777" } };
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "tentative", comment: "evtl. Spätschicht" }, { now: NOW });
        expect(discord.postNotice).toHaveBeenCalledWith("777777", expect.objectContaining({ embeds: [expect.objectContaining({ description: expect.stringContaining("evtl. Spätschicht") })] }));
        // the same again (e.g. "kann auch" edited) posts nothing new
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "tentative", comment: "evtl. Spätschicht", canAlso: [] }, { now: NOW });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        await service.submitSignup("eh-kara", ANNA, { status: "absence", comment: "krank" }, { now: NOW, byOrga: true });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
    });

    it("lässt Raid-Helper-Events nicht zu", async () => {
        expect(await service.submitSignup("1234567890", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW })).toMatchObject({ code: "raidhelper" });
        expect(service._internal.validateSignup({ id: "123", source: "raidhelper" }, {}, { now: NOW })).toMatchObject({ code: "raidhelper" });
    });

    it("antwortet not_found für ein unbekanntes eigenes Event", async () => {
        expect(await service.submitSignup("eh-weg", ANNA, { status: "absence" }, { now: NOW })).toMatchObject({ code: "not_found" });
    });

    describe("Anmeldeschluss", () => {
        const late = NOW + 2.5 * 86400 * 1000;

        it("erlaubt danach nur noch Abmelden und Spät", async () => {
            expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: late })).toMatchObject({ code: "deadline" });
            expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "tentative" }, { now: late })).toMatchObject({ code: "deadline" });
            expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: late })).signup.status).toBe("late");
            expect((await service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: late })).signup.status).toBe("absence");
        });

        it("lässt eine bestehende Anmeldung mit gleichem Status und Spec bearbeiten (Kommentar)", async () => {
            await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW });
            const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed", comment: "neu" }, { now: late });
            expect(res.signup.comment).toBe("neu");
            expect(await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: late })).toMatchObject({ code: "deadline" });
        });

        it("bindet die Orga nicht", async () => {
            const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane" }, { now: late, byOrga: true });
            expect(res.signup.status).toBe("signed");
        });

        it("schließt die Anmeldung mit Raidbeginn", async () => {
            const started = NOW + 3.1 * 86400 * 1000;
            expect(await service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: started })).toMatchObject({ code: "started" });
            expect(service.allowedStatuses(event(), { now: started })).toEqual([]);
            expect(service.allowedStatuses(event(), { now: late })).toEqual(["absence", "late"]);
            expect(service.allowedStatuses(event(), { now: NOW })).toEqual(["signed", "tentative", "late", "bench", "absence"]);
        });
    });
});

describe("mehrere Charaktere je Anmeldung (#293)", () => {
    const both = [{ character: "Nerasol", spec: "Priest-Holy" }, { character: "Nerathil", spec: "Mage-Fire" }];

    it("speichert die Charaktere in Reihenfolge, der erste spiegelt die bisherigen Felder", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, { characters: both, status: "signed" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.signup).toMatchObject({
            character: "Nerasol", spec: "Priest-Holy", role: "healer",
            characters: [
                { character: "Nerasol", spec: "Priest-Holy", role: "healer" },
                { character: "Nerathil", spec: "Mage-Fire", role: "ranged" },
            ],
        });
        // "kann auch" gehört zur ersten Wahl: nie deren eigene Rolle
        expect(res.signup.canAlso).not.toContain("healer");
    });

    it("prüft jeden Charakter gegen das Profil, zählt einen doppelten nur einmal und nimmt höchstens drei", async () => {
        profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [...both, { character: "Ysolde", spec: "Mage-Frost" }] }, { now: NOW }))
            .toMatchObject({ code: "character", error: "Ysolde steht nicht in deinem Profil." });
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [both[0], { character: "Nerathil", spec: "Priest-Holy" }] }, { now: NOW }))
            .toMatchObject({ code: "spec" });
        const twice = await service.submitSignup("eh-kara", ANNA, { characters: [both[1], { character: "Nerathil", spec: "Mage-Arcane" }] }, { now: NOW });
        expect(twice.signup.characters).toEqual([{ character: "Nerathil", spec: "Mage-Fire", role: "ranged", status: "signed" }]);
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] }, { name: "Anna" });
        profiles.addCharacter(ANNA, { name: "Zul", className: "Rogue", specs: ["Rogue-Combat"] }, { name: "Anna" });
        const four = [...both, { character: "Brokk", spec: "Warrior-Protection" }, { character: "Zul", spec: "Rogue-Combat" }];
        expect(await service.submitSignup("eh-kara", ANNA, { characters: four }, { now: NOW })).toMatchObject({ code: "characters" });
    });

    it("behält die „kann auch mit“-Charaktere, wenn ein Frontend nur einen Charakter schickt", async () => {
        await service.submitSignup("eh-kara", ANNA, { characters: both }, { now: NOW });
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerasol", spec: "Priest-Holy", status: "tentative", comment: "vielleicht" }, { now: NOW });
        expect(res.signup.status).toBe("tentative");
        expect(res.signup.characters.map((c) => c.character)).toEqual(["Nerasol", "Nerathil"]);
        // nach dem Anmeldeschluss: gleiche Charaktere + gleicher Status = nur der Kommentar ändert sich
        const late = NOW + 2.5 * 86400 * 1000;
        expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerasol", spec: "Priest-Holy", status: "tentative", comment: "neu" }, { now: late })).signup.comment).toBe("neu");
        // ein Charakter weniger ist wie ein Teil-Abmelden und geht; ein neuer Charakter als „Vielleicht“ nicht
        expect((await service.submitSignup("eh-kara", ANNA, { characters: [both[0]], status: "tentative" }, { now: late })).signup.characters).toHaveLength(1);
        expect(await service.submitSignup("eh-kara", ANNA, { characters: both, status: "tentative" }, { now: late })).toMatchObject({ code: "deadline" });
    });

    it("liest eine alte Einzel-Anmeldung als characters[0]", async () => {
        mockSignups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", at: 1 });
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed", comment: "x" }, { now: NOW + 2.5 * 86400 * 1000 });
        expect(res.signup.characters).toEqual([{ character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed" }]);
    });
});

describe("Status je Charakter (Anmelde-Buttons)", () => {
    const both = [{ character: "Nerasol", spec: "Priest-Holy" }, { character: "Nerathil", spec: "Mage-Fire" }];
    const late = NOW + 2.5 * 86400 * 1000;

    it("speichert einen eigenen Status je Charakter, die Anmeldung spiegelt den ersten", async () => {
        const res = await service.submitSignup("eh-kara", ANNA, {
            characters: [{ ...both[0], status: "late" }, both[1]], status: "signed",
        }, { now: NOW });
        expect(res.signup.status).toBe("late");
        expect(res.signup.characters.map((c) => c.status)).toEqual(["late", "signed"]);
        // „Abgemeldet“ gibt es nur für die ganze Anmeldung: je Charakter gilt dann der Status der Anmeldung
        const odd = await service.submitSignup("eh-kara", ANNA, { characters: [{ ...both[0], status: "absence" }], status: "tentative" }, { now: NOW });
        expect(odd.signup.characters.map((c) => c.status)).toEqual(["tentative"]);
        expect(require("../../src/web/signupStore").normalizeSignup({ characters: [{ spec: "Mage-Fire", status: "absence" }] }).error).toMatch(/Unbekannter Status/);
    });

    it("behält die Status der Charaktere, solange der Status der Anmeldung gleich bleibt", async () => {
        await service.submitSignup("eh-kara", ANNA, { characters: [{ ...both[0], status: "late" }, both[1]] }, { now: NOW });
        // die Web-Seite speichert nur den Kommentar: „Spät“ bleibt am ersten, „Dabei“ am zweiten
        const kept = await service.submitSignup("eh-kara", ANNA, { characters: both, status: "late", comment: "20:30" }, { now: NOW });
        expect(kept.signup.characters.map((c) => c.status)).toEqual(["late", "signed"]);
        // ein neuer Status für die Anmeldung gilt für alle
        const all = await service.submitSignup("eh-kara", ANNA, { characters: both, status: "bench" }, { now: NOW });
        expect(all.signup.characters.map((c) => c.status)).toEqual(["bench", "bench"]);
        // eine Abmeldung trägt keinen Status je Charakter, die Wiederanmeldung nimmt den neuen
        const off = await service.submitSignup("eh-kara", ANNA, { characters: both, status: "absence" }, { now: NOW });
        expect(off.signup.characters.every((c) => c.status === undefined)).toBe(true);
        const back = await service.submitSignup("eh-kara", ANNA, { character: "Nerasol", spec: "Priest-Holy", status: "tentative" }, { now: NOW });
        expect(back.signup.characters.map((c) => c.status)).toEqual(["tentative", "tentative"]);
    });

    it("nach dem Anmeldeschluss: nur der erste auf „Spät“, die anderen bleiben unverändert", async () => {
        await service.submitSignup("eh-kara", ANNA, { characters: both, status: "signed" }, { now: NOW });
        const res = await service.submitSignup("eh-kara", ANNA, { characters: [{ ...both[0], status: "late" }, { ...both[1], status: "signed" }], status: "late" }, { now: late });
        expect(res.error).toBeUndefined();
        expect(res.signup.characters.map((c) => c.status)).toEqual(["late", "signed"]);
        // der zweite auf „Vielleicht“ ist eine Änderung – nach dem Schluss nicht mehr
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [{ ...both[0], status: "late" }, { ...both[1], status: "tentative" }], status: "late" }, { now: late }))
            .toMatchObject({ code: "deadline" });
    });

    it("geschlossene Anmeldung: kein „Spät“ mehr, Abmelden geht", async () => {
        await service.submitSignup("eh-kara", ANNA, { characters: both, status: "signed" }, { now: NOW });
        mockEvents.set("eh-kara", event({ signupsClosed: true }));
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [{ ...both[0], status: "late" }, both[1]], status: "late" }, { now: NOW }))
            .toMatchObject({ code: "closed" });
        expect((await service.submitSignup("eh-kara", ANNA, { characters: both, status: "absence", comment: "krank" }, { now: NOW })).signup)
            .toMatchObject({ status: "absence", comment: "krank" });
    });

    it("liest eine gespeicherte Anmeldung ohne Status je Charakter mit dem Status der Anmeldung", () => {
        const { migrateSignup } = require("../../src/web/signupCharacters");
        const old = { userId: ANNA, status: "bench", character: "Nerasol", spec: "Priest-Holy", role: "healer", characters: [{ character: "Nerasol", spec: "Priest-Holy", role: "healer" }, { character: "Nerathil", spec: "Mage-Fire", role: "ranged" }] };
        expect(migrateSignup(old).characters.map((c) => c.status)).toEqual(["bench", "bench"]);
        // die Felder oben spiegeln den ersten – auch seinen Status
        const mixed = { ...old, status: "signed", characters: [{ ...old.characters[0], status: "late" }, old.characters[1]] };
        expect(migrateSignup(mixed)).toMatchObject({ status: "late", characters: [{ status: "late" }, { status: "signed" }] });
        expect(migrateSignup({ ...old, status: "absence" }).characters.every((c) => !("status" in c))).toBe(true);
    });
});

describe("submitSignups (#293)", () => {
    beforeEach(() => {
        mockEvents.set("eh-ssc", event({ id: "eh-ssc", title: "SSC", categoryId: "cat-ssc" }));
        mockEvents.set("eh-alt", event({ id: "eh-alt", title: "Alter Raid", signupDeadline: sec(NOW) - 60 }));
        mockEvents.set("eh-other", event({ id: "eh-other", title: "Andere Welt", versionId: "unbekannte-version" }));
    });
    const chars = [{ character: "Nerasol", spec: "Priest-Holy" }, { character: "Nerathil", spec: "Mage-Fire" }];

    it("meldet für jeden Raid einzeln an und nennt je Raid den Grund einer Ablehnung", async () => {
        mockConfig = { guildId: "g", categoryRoles: { "cat-ssc": ["role-ssc"] } };
        mockRoleIds = [];
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: chars, status: "signed" },
            { eventId: "eh-ssc", characters: chars, status: "signed" },
            { eventId: "eh-alt", characters: chars, status: "signed" },
            { eventId: "eh-kara", characters: chars, status: "signed" },
            { eventId: "123456", characters: chars },
        ], { now: NOW });
        expect(results.map((r) => [r.eventId, r.ok, r.code || ""])).toEqual([
            ["eh-kara", true, ""],
            ["eh-ssc", false, "raider_role"],
            ["eh-alt", false, "deadline"],
            ["123456", false, "raidhelper"],
        ]);
        expect(results[0].signup.characters.map((c) => c.character)).toEqual(["Nerasol", "Nerathil"]);
        expect(results[0].title).toBe("Karazhan");
        expect(mockSignups.has(`eh-ssc/${ANNA}`)).toBe(false);
    });

    it("überspringt Charaktere, die im Raid nicht passen, und den Raid, wenn keiner bleibt", async () => {
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-other", characters: chars, status: "signed" },
            { eventId: "eh-kara", characters: [], status: "signed" },
        ], { now: NOW });
        expect(results[0]).toMatchObject({ ok: false, code: "no_character", error: "Keiner der gewählten Charaktere passt" });
        expect(results[0].skipped.map((s) => [s.character, s.reason])).toEqual([
            ["Nerasol", "Klasse passt nicht zu diesem Raid"],
            ["Nerathil", "Klasse passt nicht zu diesem Raid"],
        ]);
        expect(results[1]).toMatchObject({ ok: false, code: "no_character", error: "Kein Charakter gewählt" });
    });

    it("liest die Rollen je Server nur einmal und behält Kommentar und „kann auch“", async () => {
        mockConfig = { guildId: "g", categoryRoles: { "cat-ssc": ["role-ssc"], "cat-kara": ["role-ssc"] } };
        mockRoleIds = ["role-ssc"];
        mockEvents.set("eh-kara", event({ categoryId: "cat-kara" }));
        mockSignups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", canAlso: [], comment: "bleibt", at: 1 });
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: chars, status: "late" },
            { eventId: "eh-ssc", characters: chars, status: "late" },
        ], { now: NOW });
        expect(results.every((r) => r.ok)).toBe(true);
        expect(discord.memberRoleIds).toHaveBeenCalledTimes(1);
        expect(mockSignups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "late", comment: "bleibt", canAlso: [] });
    });
});

describe("Raider-Rollen der Kategorie", () => {
    const withRoles = () => {
        mockEvents.set("eh-kara", event({ categoryId: "cat-t5", guildId: "g-event" }));
        mockConfig = { guildId: "g-fallback", categoryRoles: { "cat-t5": ["role-t5"] } };
    };
    const signup = { character: "Nerathil", spec: "Mage-Arcane", status: "signed" };

    it("lehnt eine neue Anmeldung ohne Raider-Rolle ab und liest die Rollen auf dem Event-Server", async () => {
        withRoles();
        mockRoleIds = ["role-other"];
        const res = await service.submitSignup("eh-kara", ANNA, signup, { now: NOW });
        expect(res).toEqual({ code: "raider_role", error: "Für diesen Raid brauchst du eine Raider-Rolle." });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g-event", ANNA);
        expect(mockSignups.size).toBe(0);
        expect(service.httpStatusFor("raider_role")).toBe(403);
    });

    it("lässt Inhaber einer Raider-Rolle, unlesbare Rollen und Kategorien ohne Rollen durch", async () => {
        withRoles();
        mockRoleIds = ["role-t5"];
        expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).signup).toBeTruthy();
        mockSignups.clear();
        mockRoleIds = null;
        expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).signup).toBeTruthy();
        mockSignups.clear();
        mockConfig = { categoryRoles: {} };
        mockRoleIds = [];
        expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).signup).toBeTruthy();
    });

    it("lässt eine bestehende eigene Anmeldung ändern und zurückziehen", async () => {
        withRoles();
        mockSignups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", status: "signed" });
        mockRoleIds = [];
        expect((await service.submitSignup("eh-kara", ANNA, { ...signup, status: "tentative" }, { now: NOW })).signup.status).toBe("tentative");
        expect((await service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: NOW })).signup.status).toBe("absence");
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });

    it("bindet die Orga nicht und nimmt übergebene Rollen statt eines Discord-Abrufs", async () => {
        withRoles();
        mockRoleIds = [];
        expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW, byOrga: true })).signup).toBeTruthy();
        mockSignups.clear();
        expect(await service.submitSignup("eh-kara", ANNA, signup, { now: NOW, roleIds: ["role-x"] })).toMatchObject({ code: "raider_role" });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });

    it("categoryVisible nutzt dieselbe Regel", () => {
        const config = { categoryIds: ["a", "b"], categoryRoles: { a: ["r1"] } };
        expect(service.categoryVisible("a", { config, roleIds: ["r2"] })).toBe(false);
        expect(service._internal.categoryRoleAllowed("a", { config, roleIds: ["r2"] })).toBe(false);
        expect(service.categoryVisible("a", { config, roleIds: ["r2"], orga: true })).toBe(true);
        expect(service.categoryVisible("b", { config, roleIds: [] })).toBe(true);
    });
});


// #306 — die Warteliste: ein voller Raid nimmt keine neue „Dabei“-Anmeldung mehr.
describe("Warteliste bei vollem Raid (#306)", () => {
    // Füllt den Raid mit `n` fremden Anmeldungen auf (Rolle egal, es zählt der Platz).
    const fill = (n, status = "signed") => {
        for (let i = 0; i < n; i += 1) {
            mockSignups.set(`eh-kara/filler${i}`, { userId: `filler${i}`, character: `F${i}`, spec: "Mage-Fire", role: "ranged", status, characters: [], canAlso: [], comment: "", at: 1 });
        }
    };

    it("macht aus einer neuen „Dabei“ die Bank und sagt es dem Raider sofort", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.waitlisted).toBe(true);
        expect(res.signup.status).toBe("bench");
        expect(res.signup.characters.every((c) => c.status === "bench")).toBe(true);
        expect(res.notice).toContain("Raid ist voll (2/2)");
        expect(res.notice).toContain("Warteliste");
    });

    it("lehnt die Anmeldung ab, wenn die Kategorie keine Warteliste will (overflow: off)", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "off" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res).toMatchObject({ code: "full" });
        expect(res.error).toContain("voll (2/2)");
        expect(service.httpStatusFor("full")).toBe(409);
        expect(mockSignups.get("eh-kara/" + ANNA)).toBeUndefined();
    });

    it("lässt wer schon einen Platz hat seinen Platz behalten – auch beim Spec-Wechsel", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(1);
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        fill(2); // der Raid ist jetzt voll, Anna sitzt aber schon drin
        const again = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: NOW });
        expect(again.waitlisted).toBeFalsy();
        expect(again.signup).toMatchObject({ spec: "Mage-Fire", status: "signed" });
    });

    it("bindet die Orga nicht und zählt „Spät“ als belegten Platz", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(2, "late");
        const orga = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW, byOrga: true });
        expect(orga.waitlisted).toBeFalsy();
        expect(orga.signup.status).toBe("signed");
    });

    it("fängt auch eine neue „Spät“-Anmeldung ab – sonst geht man an der Warteliste vorbei", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res.waitlisted).toBe(true);
        expect(res.signup.status).toBe("bench");
        expect(res.notice).toContain("Warteliste");
        // und der Raid bleibt bei 2 von 2 statt 3 von 2
        expect(service.rosterCounts([...mockSignups.values()])).toMatchObject({ attending: 2, bench: 1 });
    });

    it("lehnt auch „Spät“ ab, wenn die Warteliste aus ist", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "off" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res).toMatchObject({ code: "full" });
        expect(mockSignups.get("eh-kara/" + ANNA)).toBeUndefined();
    });

    it("lässt einen belegten Platz von „Dabei“ auf „Spät“ wechseln", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(1);
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        fill(2); // jetzt voll, Anna sitzt drin
        const late = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(late.waitlisted).toBeFalsy();
        expect(late.signup.status).toBe("late");
    });

    it("lässt „Vielleicht“, „Bank“ und Abmelden unberührt", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(2);
        for (const status of ["tentative", "bench"]) {
            const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status }, { now: NOW });
            expect({ status, got: res.signup.status, waitlisted: !!res.waitlisted }).toEqual({ status, got: status, waitlisted: false });
        }
        const off = await service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: NOW });
        expect(off.signup.status).toBe("absence");
        expect(off.waitlisted).toBeFalsy();
    });

    it("greift nicht, solange noch ein Platz frei ist oder das Event keine Größe hat", async () => {
        mockEvents.set("eh-kara", event({ size: 3 }));
        fill(2);
        expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW })).signup.status).toBe("signed");
        mockSignups.delete("eh-kara/" + ANNA);
        mockEvents.set("eh-kara", event({ size: 0 }));
        expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW })).signup.status).toBe("signed");
    });
});

// #306 — lockAtLimit: der volle Raid schließt seine eigene Anmeldung.
describe("Sperre bei Voll (#306)", () => {
    it("schließt die Anmeldung, protokolliert das und öffnet sie beim Abmelden nicht wieder", async () => {
        mockEvents.set("eh-kara", event({ size: 1, lockAtLimit: true }));
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res.locked).toBe(true);
        expect(res.notice).toContain("Anmeldung ist jetzt geschlossen");
        expect(mockEvents.get("eh-kara").signupsClosed).toBe(true);
        expect(mockLog).toHaveBeenCalledWith("eh-kara", expect.objectContaining({ action: "lock", detail: "Raid voll (1/1)" }));

        // Abmelden macht den Platz frei — die Anmeldung bleibt trotzdem zu.
        const off = await service.submitSignup("eh-kara", ANNA, { status: "absence" }, { now: NOW });
        expect(off.error).toBeUndefined();
        expect(mockEvents.get("eh-kara").signupsClosed).toBe(true);
        // und die geschlossene Anmeldung nimmt danach nichts Neues mehr an
        const back = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(back).toMatchObject({ code: "closed" });
    });

    it("schließt auch, wenn eine „Spät“-Anmeldung den Raid voll macht", async () => {
        mockEvents.set("eh-kara", event({ size: 1, lockAtLimit: true }));
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res.signup.status).toBe("late");
        expect(res.locked).toBe(true);
        expect(mockEvents.get("eh-kara").signupsClosed).toBe(true);
    });

    it("schließt ohne den Schalter nichts", async () => {
        mockEvents.set("eh-kara", event({ size: 1 }));
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(mockEvents.get("eh-kara").signupsClosed).toBeFalsy();
    });
});

describe("roleCounts", () => {
    it("zählt Dabei und Spät je Rolle gegen den Plan", async () => {
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
    it("nennt nur eigene Wunschpartner, die angemeldet und nicht abgemeldet sind", async () => {
        profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
        const anna = profiles.saveProfile(ANNA, { wishes: [BERT] }, { name: "Anna" });
        expect(service.wishPartnersSignedUp(anna, [{ userId: BERT, character: "Ysolde", status: "signed" }]))
            .toEqual([{ userId: BERT, name: "Ysolde" }]);
        expect(service.wishPartnersSignedUp(anna, [{ userId: BERT, character: "Ysolde", status: "absence" }])).toEqual([]);
        expect(service.wishPartnersSignedUp(profiles.getProfile(BERT), [{ userId: ANNA, status: "signed" }])).toEqual([]);
    });
});
