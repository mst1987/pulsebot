// Die Anmelde-Regeln (src/services/signups/signupService.js), die Web und Discord (#258) teilen:
// Spec passt zum Charakter aus dem Profil, Anmeldeschluss, Statuswechsel,
// „kann auch“ aus dem Profil, Raid-Helper-Events nicht anmeldbar.

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
let mockMembership = null;
// Discord said "Unknown Member": memberRoleIds answers the caller's absentAs
let mockAbsent = false;
let mockGuild = null;
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async (g, u, opts) => (mockAbsent ? opts && opts.absentAs : mockRoleIds)),
    guildMembership: jest.fn(async () => mockMembership),
    postNotice: jest.fn(async () => ({})),
    getGuild: jest.fn(() => mockGuild),
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const discord = require("../../../src/services/discord/discord");
const service = require("../../../src/services/signups/signupService");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

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
    mockMembership = null;
    mockAbsent = false;
    mockGuild = null;
    mockLog.mockClear();
    discord.memberRoleIds.mockClear();
    discord.guildMembership.mockClear();
    discord.getGuild.mockClear();
    mockEvents.set("eh-kara", event());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane", "Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
});

describe("submitSignup", () => {
    it("lehnt ein Event einer ausgeblendeten Spielversion ab (#563) und speichert nichts", async () => {
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res.code).toBe("archived");
        expect(res.error).toContain("archiviert");
        expect(mockChanged).not.toHaveBeenCalled();
        // the raider reads it in English
        const { toEnglish } = require("../../../src/utils/signup/botEnglish");
        expect(toEnglish(res.error)).toBe("This raid is archived (TBC Anniversary is no longer shown) – signups are closed.");
    });

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
        mockConfig = { guildId: "g1", serverSettings: { g1: { signupNoteChannelId: "777777" } } };
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "tentative", comment: "evtl. Spätschicht" }, { now: NOW });
        expect(discord.postNotice).toHaveBeenCalledWith("777777", expect.objectContaining({ embeds: [expect.objectContaining({ description: expect.stringContaining("evtl. Spätschicht") })] }), { guildId: "g1" });
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

    it("prüft jeden Charakter gegen das Profil, zählt einen doppelten nur einmal und nimmt höchstens so viele, wie die Kategorie erlaubt", async () => {
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
        // default: up to 8 per signup
        expect((await service.submitSignup("eh-kara", ANNA, { characters: four }, { now: NOW })).signup.characters).toHaveLength(4);
        mockSignups.clear();
        // the category allows three: the fourth is refused, and the refusal names the limit
        mockEvents.set("eh-kara", event({ categoryId: "cat1" }));
        mockConfig = { categorySignupCharacters: { cat1: 3 } };
        expect(await service.submitSignup("eh-kara", ANNA, { characters: four }, { now: NOW }))
            .toMatchObject({ code: "characters", error: "Höchstens 3 Charaktere je Anmeldung in dieser Kategorie." });
        expect((await service.submitSignup("eh-kara", ANNA, { characters: four.slice(0, 3) }, { now: NOW })).signup.characters).toHaveLength(3);
    });

    it("nimmt bis zu acht Charaktere, wenn die Kategorie nichts einstellt", async () => {
        const classes = [["Mage", "Mage-Frost"], ["Warrior", "Warrior-Protection"], ["Rogue", "Rogue-Combat"], ["Hunter", "Hunter-BeastMastery"],
            ["Warlock", "Warlock-Destruction"], ["Druid", "Druid-Balance"], ["Paladin", "Paladin-Holy"]];
        const names = ["Aa", "Bb", "Cc", "Dd", "Ee", "Ff", "Gg"];
        classes.forEach(([className, spec], i) => profiles.addCharacter(ANNA, { name: names[i], className, specs: [spec] }, { name: "Anna" }));
        const eight = [both[0], ...classes.map(([, spec], i) => ({ character: names[i], spec }))];
        expect((await service.submitSignup("eh-kara", ANNA, { characters: eight }, { now: NOW })).signup.characters).toHaveLength(8);
        expect(service.maxCharactersFor("eh-kara-category", {})).toBe(8);
    });

    it("lässt eine Anmeldung von vor einem gesenkten Limit stehen: weniger geht, ein neuer Charakter darüber nicht", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] }, { name: "Anna" });
        profiles.addCharacter(ANNA, { name: "Zul", className: "Rogue", specs: ["Rogue-Combat"] }, { name: "Anna" });
        const three = [...both, { character: "Brokk", spec: "Warrior-Protection" }];
        mockEvents.set("eh-kara", event({ categoryId: "cat1" }));
        await service.submitSignup("eh-kara", ANNA, { characters: three }, { now: NOW });
        mockConfig = { categorySignupCharacters: { cat1: 2 } };
        // nothing is cut: the status button (one character sent, the others kept) still saves all three
        const kept = await service.submitSignup("eh-kara", ANNA, { character: "Nerasol", spec: "Priest-Holy", status: "late" }, { now: NOW });
        expect(kept.signup.characters.map((c) => c.character)).toEqual(["Nerasol", "Nerathil", "Brokk"]);
        // the same three again (reordered) is fine
        expect((await service.submitSignup("eh-kara", ANNA, { characters: [three[2], three[0], three[1]] }, { now: NOW })).error).toBeUndefined();
        // swapping one for a new character, or adding one, is not
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [...both, { character: "Zul", spec: "Rogue-Combat" }] }, { now: NOW }))
            .toMatchObject({ code: "characters", error: "Höchstens 2 Charaktere je Anmeldung in dieser Kategorie." });
        expect(await service.submitSignup("eh-kara", ANNA, { characters: [...three, { character: "Zul", spec: "Rogue-Combat" }] }, { now: NOW }))
            .toMatchObject({ code: "characters" });
        // removing one is
        expect((await service.submitSignup("eh-kara", ANNA, { characters: [three[0], three[2]] }, { now: NOW })).signup.characters).toHaveLength(2);
        // signing off is never refused
        expect((await service.submitSignup("eh-kara", ANNA, { characters: [...three, { character: "Zul", spec: "Rogue-Combat" }], status: "absence" }, { now: NOW })).error).toBeUndefined();
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
        expect(require("../../../src/stores/signupStore").normalizeSignup({ characters: [{ spec: "Mage-Fire", status: "absence" }] }).error).toMatch(/Unbekannter Status/);
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
        const { migrateSignup } = require("../../../src/services/signups/signupCharacters");
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

    it("nimmt je Raid so viele Charaktere, wie seine Kategorie erlaubt, und nennt den Rest mit dem Limit", async () => {
        mockEvents.set("eh-kara", event({ categoryId: "cat1" }));
        mockConfig = { categorySignupCharacters: { cat1: 1 } };
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: chars, status: "signed" },
            { eventId: "eh-ssc", characters: chars, status: "signed" },
        ], { now: NOW });
        expect(results.every((r) => r.ok)).toBe(true);
        expect(results[0].signup.characters.map((c) => c.character)).toEqual(["Nerasol"]);
        expect(results[0].skipped).toEqual([{ character: "Nerathil", spec: "Mage-Fire", reason: "mehr als 1 Charaktere je Anmeldung in dieser Kategorie" }]);
        expect(results[1].signup.characters.map((c) => c.character)).toEqual(["Nerasol", "Nerathil"]);
        expect(results[1].skipped).toEqual([]);
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

describe("PuG-Raids im Web nur für Mitglieder (#907)", () => {
    const BERTHOLT = { name: "Bertholt", spec: "Warrior-Protection" };
    const chars = [{ character: "Nerathil", spec: "Mage-Fire" }];
    const charsOf = (uid) => (profiles.getProfile(uid) || { characters: [] }).characters;
    beforeEach(() => {
        mockConfig = { guildId: "g" };
        mockEvents.set("eh-ssc", event({ id: "eh-ssc", title: "SSC" }));
    });

    it("submitSignups mit memberOnly: fragt je Server einmal und lehnt Nicht-Mitglieder ab – auch nach einer Abmeldung", async () => {
        mockMembership = false;
        mockSignups.set(`eh-ssc/${ANNA}`, { userId: ANNA, status: "absence", characters: [], comment: "", at: 1 });
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: chars, status: "signed" },
            { eventId: "eh-ssc", characters: chars, status: "signed" },
        ], { now: NOW, memberOnly: true });
        expect(results.map((r) => [r.eventId, r.ok, r.code, r.inviteUrl])).toEqual([
            ["eh-kara", false, "pug_members_only", ""],
            ["eh-ssc", false, "pug_members_only", ""],
        ]);
        expect(discord.guildMembership).toHaveBeenCalledTimes(1);
        expect(mockSignups.has(`eh-kara/${ANNA}`)).toBe(false);
        expect(mockSignups.get(`eh-ssc/${ANNA}`).status).toBe("absence");
    });

    it("submitSignups: eine echte Anmeldung und die Orga sind ausgenommen, ohne memberOnly fragt niemand", async () => {
        mockMembership = false;
        mockSignups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", canAlso: [], comment: "", at: 1 });
        const results = await service.submitSignups(ANNA, [
            { eventId: "eh-kara", characters: chars, status: "late" },
            { eventId: "eh-ssc", characters: chars, status: "signed" },
        ], { now: NOW, memberOnly: true, byOrga: (ev) => ev.id === "eh-ssc" });
        expect(results.map((r) => [r.eventId, r.ok])).toEqual([["eh-kara", true], ["eh-ssc", true]]);
        expect(discord.guildMembership).not.toHaveBeenCalled();
        mockSignups.clear();
        const plain = await service.submitSignups(ANNA, [{ eventId: "eh-ssc", characters: chars, status: "signed" }], { now: NOW });
        expect(plain[0].ok).toBe(true);
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });

    it("ein Nicht-Mitglied mit neuem Charakter legt keinen Charakter an", async () => {
        mockMembership = false;
        const res = await service.submitSignup("eh-kara", BERT, { newCharacter: BERTHOLT, status: "signed" }, { now: NOW, memberOnly: true });
        expect(res.code).toBe("pug_members_only");
        expect(charsOf(BERT)).toHaveLength(0);
    });

    it("eine abgelehnte Anmeldung legt keinen Charakter an, eine angenommene schon", async () => {
        mockEvents.set("eh-alt", event({ id: "eh-alt", signupDeadline: sec(NOW) - 60 }));
        const late = await service.submitSignup("eh-alt", BERT, { newCharacter: BERTHOLT, status: "signed" }, { now: NOW });
        expect(late.code).toBe("deadline");
        expect(charsOf(BERT)).toHaveLength(0);
        const ok = await service.submitSignup("eh-kara", BERT, { newCharacter: BERTHOLT, status: "signed" }, { now: NOW, accountName: "Bert" });
        expect(ok.signup).toMatchObject({ character: "Bertholt", spec: "Warrior-Protection" });
        expect(charsOf(BERT).map((c) => c.name)).toEqual(["Bertholt"]);
    });

    it("ein neuer Spec eines vorhandenen Charakters kommt erst mit der Anmeldung ins Profil", async () => {
        mockEvents.set("eh-alt", event({ id: "eh-alt", signupDeadline: sec(NOW) - 60 }));
        const specsOf = () => charsOf(ANNA).find((c) => c.name === "Nerathil").specs.map((s) => s.key);
        const late = await service.submitSignup("eh-alt", ANNA, { newCharacter: { name: "nerathil", spec: "Mage-Frost" }, status: "signed" }, { now: NOW });
        expect(late.code).toBe("deadline");
        expect(specsOf()).not.toContain("Mage-Frost");
        const ok = await service.submitSignup("eh-kara", ANNA, { newCharacter: { name: "nerathil", spec: "Mage-Frost" }, status: "signed" }, { now: NOW });
        expect(ok.signup).toMatchObject({ character: "Nerathil", spec: "Mage-Frost" });
        expect(specsOf()).toContain("Mage-Frost");
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
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g-event", ANNA, { absentAs: [] });
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

    describe("kein Mitglied des Raid-Servers (#904: Anmeldung aus einer Partner-Liste)", () => {
        // one fetch: memberRoleIds answers absentAs ([]) on Unknown Member/User
        it("lehnt im Dialog ab, wenn Discord „Unknown Member“ meldet", async () => {
            withRoles();
            mockAbsent = true;
            const res = await service.submitSignup("eh-kara", ANNA, signup, { now: NOW });
            expect(res).toEqual({ code: "raider_role", error: "Für diesen Raid brauchst du eine Raider-Rolle." });
            expect(discord.memberRoleIds).toHaveBeenCalledTimes(1);
            expect(discord.memberRoleIds).toHaveBeenCalledWith("g-event", ANNA, { absentAs: [] });
            expect(discord.getGuild).not.toHaveBeenCalled();
            expect(mockSignups.size).toBe(0);
        });

        it("lehnt bei „Mehrere Raids“ ab", async () => {
            withRoles();
            mockAbsent = true;
            const results = await service.submitSignups(ANNA, [{ eventId: "eh-kara", characters: [{ character: "Nerathil", spec: "Mage-Arcane" }], status: "signed" }], { now: NOW });
            expect(results[0]).toMatchObject({ ok: false, code: "raider_role" });
            expect(mockSignups.size).toBe(0);
        });

        it("bleibt nachsichtig bei anderen Fehlern (Bot offline, Netz)", async () => {
            withRoles();
            mockRoleIds = null;
            expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).signup).toBeTruthy();
        });
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

    describe("Anmeldung nur für das Roster (#658)", () => {
        const rosterStore = require("../../../src/stores/rosterStore");
        const ONLY = "Für diesen Raid melden sich nur Mitglieder des Rosters an (Stamm, Probe oder Ersatz). Frag die Raidleitung.";
        let rosterId;
        beforeEach(() => {
            rosterStore.useFile(tempStoreFile("eh-signup-rosters.json"));
            withRoles();
            const roster = rosterStore.createRoster({ name: "T5", guildId: "g-event", categoryId: "cat-t5", roleIds: ["role-t5"], signupOnly: true });
            rosterId = roster.id;
        });
        afterAll(() => rosterStore.useFile(null));

        it("takes core, trial and bench - the roster decides, not the role", async () => {
            for (const status of ["core", "trial", "bench"]) {
                rosterStore.upsertMember(rosterId, ANNA, { status });
                mockSignups.clear();
                mockRoleIds = [];
                expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).signup).toBeTruthy();
            }
            expect(discord.memberRoleIds).not.toHaveBeenCalled();
            expect(service.rosterOnlyAccess("cat-t5", ANNA)).toBe(true);
        });

        it("refuses a paused member and a non-member, even holding the raider role", async () => {
            mockRoleIds = ["role-t5"];
            expect(await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).toEqual({ code: "roster_only", error: ONLY });
            rosterStore.upsertMember(rosterId, ANNA, { status: "pause" });
            expect(await service.checkRaiderRole(mockEvents.get("eh-kara"), ANNA)).toEqual({ code: "roster_only", error: ONLY });
            expect(mockSignups.size).toBe(0);
            expect(service.httpStatusFor("roster_only")).toBe(403);
        });

        it("lets the orga and an existing own signup through, and falls back to the roles without the switch", async () => {
            expect((await service.submitSignup("eh-kara", ANNA, signup, { now: NOW, byOrga: true })).signup).toBeTruthy();
            expect((await service.submitSignup("eh-kara", ANNA, { ...signup, status: "absence" }, { now: NOW })).signup).toBeTruthy();
            mockSignups.clear();
            rosterStore.updateRoster(rosterId, { signupOnly: false });
            expect(service.rosterOnlyAccess("cat-t5", ANNA)).toBeNull();
            mockRoleIds = ["role-other"];
            expect(await service.submitSignup("eh-kara", ANNA, signup, { now: NOW })).toMatchObject({ code: "raider_role" });
        });

        it("asks the roster of the raid's version (#739): another version's roster does not lock", () => {
            rosterStore.upsertMember(rosterId, ANNA, { status: "core" });
            expect(service.rosterOnlyAccess("cat-t5", ANNA, { versionId: "tbc" })).toBe(true);
            expect(service.rosterOnlyAccess("cat-t5", ANNA, { versionId: "forever" })).toBeNull();
            const forever = rosterStore.createRoster({ name: "T5 F", guildId: "g-event", categoryId: "cat-t5", versionId: "forever", signupOnly: true });
            expect(service.rosterOnlyAccess("cat-t5", ANNA, { versionId: "forever" })).toBe(false);
            rosterStore.upsertMember(forever.id, ANNA, { status: "trial" });
            expect(service.rosterOnlyAccess("cat-t5", ANNA, { versionId: "forever" })).toBe(true);
        });

        it("refuses in the several-raids path too", async () => {
            const results = await service.submitSignups(ANNA, [{ eventId: "eh-kara", characters: [{ character: "Nerathil", spec: "Mage-Arcane" }], status: "signed" }], { now: NOW });
            expect(results.map((r) => [r.ok, r.code])).toEqual([[false, "roster_only"]]);
        });
    });

    it("nutzt dieselbe Regel wie die Raid-Listen (signupAccess.canSignUp)", async () => {
        const { canSignUp } = require("../../../src/services/signups/signupAccess");
        withRoles();
        const config = { categoryRoles: { "cat-t5": ["role-t5"] } };
        const ev = mockEvents.get("eh-kara");
        for (const roles of [["role-t5"], ["role-x"], []]) {
            const saved = await service.checkRaiderRole(ev, ANNA, { roleIds: roles, config, previous: null });
            expect(!!saved.ok).toBe(canSignUp(ev.categoryId, { userId: ANNA, roleIds: roles, config }));
        }
        // roles that cannot be read: the save lets the raider through, a list does not vouch for the raid
        expect(await service.checkRaiderRole(ev, ANNA, { roleIds: null, config, previous: null })).toEqual({ ok: true });
        expect(canSignUp(ev.categoryId, { userId: ANNA, roleIds: null, config })).toBe(false);
        expect(service.categoryVisible).toBeUndefined();
    });
});


// #306 — die Warteliste: ein voller Raid nimmt keine neue „Dabei“-Anmeldung mehr.
describe("Warteliste bei vollem Raid (#306, overflow: waitlist/refuse)", () => {
    // Füllt den Raid mit `n` fremden Anmeldungen auf (Rolle egal, es zählt der Platz).
    const fill = (n, status = "signed") => {
        for (let i = 0; i < n; i += 1) {
            mockSignups.set(`eh-kara/filler${i}`, { userId: `filler${i}`, character: `F${i}`, spec: "Mage-Fire", role: "ranged", status, characters: [], canAlso: [], comment: "", at: 1 });
        }
    };

    it("macht aus einer neuen „Dabei“ die Bank und sagt es dem Raider sofort", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res.error).toBeUndefined();
        expect(res.waitlisted).toBe(true);
        expect(res.signup.status).toBe("bench");
        expect(res.signup.characters.every((c) => c.status === "bench")).toBe(true);
        expect(res.notice).toContain("Raid ist voll (2/2)");
        expect(res.notice).toContain("Warteliste");
    });

    it("lehnt die Anmeldung ab, wenn die Kategorie keine Warteliste will (overflow: refuse)", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "refuse" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(res).toMatchObject({ code: "full" });
        expect(res.error).toContain("voll (2/2)");
        expect(service.httpStatusFor("full")).toBe(409);
        expect(mockSignups.get("eh-kara/" + ANNA)).toBeUndefined();
    });

    it("lässt wer schon einen Platz hat seinen Platz behalten – auch beim Spec-Wechsel", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
        fill(1);
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        fill(2); // der Raid ist jetzt voll, Anna sitzt aber schon drin
        const again = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Fire", status: "signed" }, { now: NOW });
        expect(again.waitlisted).toBeFalsy();
        expect(again.signup).toMatchObject({ spec: "Mage-Fire", status: "signed" });
    });

    it("bindet die Orga nicht und zählt „Spät“ als belegten Platz", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
        fill(2, "late");
        const orga = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW, byOrga: true });
        expect(orga.waitlisted).toBeFalsy();
        expect(orga.signup.status).toBe("signed");
    });

    it("fängt auch eine neue „Spät“-Anmeldung ab – sonst geht man an der Warteliste vorbei", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res.waitlisted).toBe(true);
        expect(res.signup.status).toBe("bench");
        expect(res.notice).toContain("Warteliste");
        // und der Raid bleibt bei 2 von 2 statt 3 von 2
        expect(service.rosterCounts([...mockSignups.values()])).toMatchObject({ attending: 2, bench: 1 });
    });

    it("lehnt auch „Spät“ ab, wenn die Warteliste aus ist", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "refuse" }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res).toMatchObject({ code: "full" });
        expect(mockSignups.get("eh-kara/" + ANNA)).toBeUndefined();
    });

    it("lässt einen belegten Platz von „Dabei“ auf „Spät“ wechseln", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
        fill(1);
        await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        fill(2); // jetzt voll, Anna sitzt drin
        const late = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(late.waitlisted).toBeFalsy();
        expect(late.signup.status).toBe("late");
    });

    it("lässt „Vielleicht“, „Bank“ und Abmelden unberührt", async () => {
        mockEvents.set("eh-kara", event({ size: 2, overflow: "waitlist" }));
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
        mockEvents.set("eh-kara", event({ size: 3, overflow: "waitlist" }));
        fill(2);
        expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW })).signup.status).toBe("signed");
        mockSignups.delete("eh-kara/" + ANNA);
        mockEvents.set("eh-kara", event({ size: 0, overflow: "waitlist" }));
        expect((await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW })).signup.status).toBe("signed");
    });
});

// #516 — keine Grenze: ohne Überlauf-Regel (Standard) bleibt jede Anmeldung, wie sie ist.
describe("Keine Grenze bei voller Raidgröße (#516, overflow: none)", () => {
    const fill = (n) => {
        for (let i = 0; i < n; i += 1) {
            mockSignups.set(`eh-kara/filler${i}`, { userId: `filler${i}`, character: `F${i}`, spec: "Mage-Fire", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
        }
    };

    it.each([["ohne Angabe", {}], ["none", { overflow: "none" }], ["alt: bench", { overflow: "bench" }], ["alt: off", { overflow: "off" }]])(
        "lässt die 26. Anmeldung „Dabei“ (%s) – kein Bank, keine Ablehnung, kein Hinweis", async (_label, over) => {
            mockEvents.set("eh-kara", event({ size: 25, ...over }));
            fill(25);
            const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
            expect(res.error).toBeUndefined();
            expect(res.signup.status).toBe("signed");
            expect(res.waitlisted).toBe(false);
            expect(res.notice).toBe("");
            expect(service.rosterCounts([...mockSignups.values()]).attending).toBe(26);
        });

    it("lässt auch „Spät“ über die Größe", async () => {
        mockEvents.set("eh-kara", event({ size: 2 }));
        fill(2);
        const res = await service.submitSignup("eh-kara", ANNA, { character: "Nerathil", spec: "Mage-Arcane", status: "late" }, { now: NOW });
        expect(res.signup.status).toBe("late");
        expect(res.waitlisted).toBe(false);
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
