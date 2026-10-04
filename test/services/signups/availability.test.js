// Ab- und Anwesenheiten (src/services/signups/availability.js): ein Zeitraum meldet
// für die Raids darin ab bzw. an — sofort und für später angelegte Raids — und
// sagt es dem Raider per DM.

const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    listEvents: (_guildId, { sinceSeconds = 0 } = {}) => [...mockEvents.values()].filter((e) => e.startTime >= sinceSeconds),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventState: (id, patch) => ({ ...mockEvents.get(id), ...patch }),
    appendEventLog: jest.fn(),
}));
const mockSignups = new Map();
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
            return { signup };
        },
    };
});
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => null),
    postNotice: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "m1" })),
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const store = require("../../../src/stores/availabilityStore");
const discord = require("../../../src/services/discord/discord");
const availability = require("../../../src/services/signups/availability");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const ORGA = "200000000000000009";
// 2030-03-17 (a Sunday) around 18:46 server time
const NOW = 1_900_000_000_000;
const today = availability.today(NOW);
const dayPlus = (n) => availability.dayOf(sec(NOW) + n * DAY);

const raid = (id, days, over = {}) => ownEvent({
    id, title: id, startTime: sec(NOW) + days * DAY, signupDeadline: sec(NOW) + days * DAY - 3600, categoryId: "cat1", ...over,
});
const dmText = (call) => {
    const embed = call[1].embeds[0];
    const data = embed.data || embed;
    return { title: data.title, description: data.description, footer: data.footer && data.footer.text };
};

beforeAll(() => {
    profiles.useFile(tempStoreFile("eh-availability-profiles.json"));
    store.useFile(tempStoreFile("eh-availability.json"));
});
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
    store.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    for (const e of store.listEntries()) store.removeEntry(e.id);
    mockEvents.clear();
    mockSignups.clear();
    mockConfig = {};
    discord.sendDirectMessage.mockClear();
    discord.sendDirectMessage.mockImplementation(async () => ({ ok: true, messageId: "m1" }));
    for (const e of [raid("eh-a", 2), raid("eh-b", 4), raid("eh-c", 9)]) mockEvents.set(e.id, e);
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] }, { name: "Anna" });
});

describe("checkInput", () => {
    it("lehnt einen umgedrehten, vergangenen oder zu langen Zeitraum ab", () => {
        expect(availability.checkInput(ANNA, { kind: "absence", from: dayPlus(3), to: dayPlus(1) }, { now: NOW }).error)
            .toBe("Das Bis-Datum liegt vor dem Von-Datum.");
        expect(availability.checkInput(ANNA, { kind: "absence", from: dayPlus(-5), to: dayPlus(-2) }, { now: NOW }).error)
            .toBe("Der Zeitraum liegt schon in der Vergangenheit.");
        expect(availability.checkInput(ANNA, { kind: "absence", from: today, to: dayPlus(200) }, { now: NOW }).error)
            .toBe("Höchstens 180 Tage auf einmal.");
        expect(availability.checkInput(ANNA, { kind: "absence", from: "morgen", to: "" }, { now: NOW }).error)
            .toBe("Bitte ein gültiges Von- und Bis-Datum angeben.");
    });

    it("nimmt für eine Anwesenheit nur Charakter und Spec aus dem Profil und merkt sich die Spielversion", () => {
        const ok = availability.checkInput(ANNA, { kind: "presence", from: today, character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(ok.value).toMatchObject({ character: "Nerathil", spec: "Mage-Arcane", versionId: "tbc", to: today });
        expect(availability.checkInput(ANNA, { kind: "presence", from: today, character: "Brokk", spec: "Warrior-Arms" }, { now: NOW }).error)
            .toBe("Dieser Charakter steht nicht in deinem Profil.");
        expect(availability.checkInput(ANNA, { kind: "presence", from: today, character: "Nerathil", spec: "Mage-Fire" }, { now: NOW }).error)
            .toBe("Diese Spec hat der Charakter im Profil nicht.");
    });
});

describe("raidsInRange", () => {
    it("nimmt die Raids des Zeitraums, aber keine begonnenen, abgesagten, fremden Kategorien oder Versionen", () => {
        mockEvents.set("eh-gone", raid("eh-gone", 3, { status: "cancelled" }));
        mockEvents.set("eh-other", raid("eh-other", 3, { categoryId: "cat2" }));
        mockEvents.set("eh-forever", raid("eh-forever", 3, { versionId: "forever" }));
        const all = availability.raidsInRange({ kind: "absence", from: today, to: dayPlus(5) }, { now: NOW });
        expect(all.map((e) => e.id)).toEqual(["eh-a", "eh-other", "eh-forever", "eh-b"]);
        const cat = availability.raidsInRange({ kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW });
        expect(cat.map((e) => e.id)).toEqual(["eh-a", "eh-forever", "eh-b"]);
        const tbc = availability.raidsInRange({ kind: "presence", from: today, to: dayPlus(5), versionId: "tbc" }, { now: NOW });
        expect(tbc.map((e) => e.id)).toEqual(["eh-a", "eh-other", "eh-b"]);
    });

    it("hält sich an die Kategorien der Einstellungen", () => {
        mockConfig = { categoryIds: ["cat2"] };
        mockEvents.set("eh-other", raid("eh-other", 3, { categoryId: "cat2" }));
        expect(availability.raidsInRange({ kind: "absence", from: today, to: dayPlus(5) }, { now: NOW }).map((e) => e.id)).toEqual(["eh-other"]);
    });
});

describe("createEntry – Abwesenheit", () => {
    it("meldet von den gewählten Raids ab, auch wer schon angemeldet war, und schickt eine DM", async () => {
        mockSignups.set(`eh-a/${ANNA}`, { userId: ANNA, status: "signed", character: "Nerathil", spec: "Mage-Arcane", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }] });
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), comment: "Urlaub" }, { now: NOW, eventIds: ["eh-a"] });
        expect(res.error).toBeUndefined();
        expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true]]);
        expect(mockSignups.get(`eh-a/${ANNA}`)).toMatchObject({ status: "absence", comment: "Urlaub" });
        // eh-b was deselected: untouched now, and never later
        expect(mockSignups.get(`eh-b/${ANNA}`)).toBeUndefined();
        expect(res.entry.skip).toEqual(["eh-b"]);
        expect(res.dm).toBe(true);
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]);
        expect(dm.title).toBe("Absence saved");
        expect(dm.description).toContain("Reason: Urlaub");
        expect(dm.description).toContain("**Signed off from:**");
        expect(dm.description).toContain("**eh-a**");
        expect(dm.footer).toBeUndefined();
        const later = await availability.applyToEvent("eh-b", { now: NOW });
        expect(later).toEqual([]);
    });

    it("lässt eine schon bestehende Abmeldung stehen und nennt sie übersprungen", async () => {
        mockSignups.set(`eh-a/${ANNA}`, { userId: ANNA, status: "absence", comment: "krank" });
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(3) }, { now: NOW });
        expect(res.results[0]).toMatchObject({ eventId: "eh-a", ok: false, skipped: "already_absent" });
        expect(mockSignups.get(`eh-a/${ANNA}`).comment).toBe("krank");
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("already signed off");
    });

    it("gibt ohne Grund den Zeitraum als Kommentar mit und meldet eine DM, die nicht ankam", async () => {
        discord.sendDirectMessage.mockImplementation(async () => ({ ok: false, error: "closed" }));
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(3) }, { now: NOW });
        expect(mockSignups.get(`eh-a/${ANNA}`).comment).toMatch(/^Away \d+ \w+–\d+ \w+$/);
        expect(res.dm).toBe(false);
    });

    it("die Orga trägt für einen Raider ein: die DM sagt es", async () => {
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(3) }, { now: NOW, by: ORGA });
        expect(res.entry.createdBy).toBe(ORGA);
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).footer).toBe("Entered for you by the raid lead");
    });
});

describe("createEntry – Anwesenheit", () => {
    it("meldet mit Charakter · Spec als Dabei an, aber nie über eine bestehende Anmeldung", async () => {
        mockSignups.set(`eh-b/${ANNA}`, { userId: ANNA, status: "tentative", character: "Nerathil", spec: "Mage-Arcane", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "tentative" }] });
        const res = await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(5), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results.map((r) => [r.eventId, r.ok, r.skipped])).toEqual([["eh-a", true, undefined], ["eh-b", false, "already_signed"]]);
        expect(mockSignups.get(`eh-a/${ANNA}`)).toMatchObject({ status: "signed", character: "Nerathil", spec: "Mage-Arcane" });
        expect(mockSignups.get(`eh-b/${ANNA}`).status).toBe("tentative");
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]);
        expect(dm.title).toBe("Attendance saved");
        expect(dm.description).toContain("Character: **Nerathil** · Arcane");
        expect(dm.description).toContain("already signed up");
    });

    it("meldet nicht in einen Raid an, für den eine Abwesenheit gilt", async () => {
        await availability.createEntry(ANNA, { kind: "absence", from: dayPlus(4), to: dayPlus(4) }, { now: NOW, dm: false });
        mockSignups.clear();
        const res = await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(5), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results.find((r) => r.eventId === "eh-b")).toMatchObject({ ok: false, skipped: "absent" });
    });

    it("trägt den Fehler des Anmelde-Service ein (Anmeldeschluss vorbei) und übersetzt ihn in der DM", async () => {
        mockEvents.set("eh-a", raid("eh-a", 2, { signupDeadline: sec(NOW) - 60 }));
        const res = await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results[0]).toMatchObject({ ok: false, error: expect.stringContaining("Anmeldeschluss") });
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("⛔");
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("The signup deadline has passed");
    });

    it("die Orga ist an den Anmeldeschluss nicht gebunden", async () => {
        mockEvents.set("eh-a", raid("eh-a", 2, { signupDeadline: sec(NOW) - 60 }));
        const res = await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, by: ORGA });
        expect(res.results[0].ok).toBe(true);
    });
});

describe("applyToEvent – später angelegte Raids", () => {
    it("meldet in einem neuen Raid des Zeitraums ab, genau einmal, mit DM", async () => {
        await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(10), comment: "Urlaub" }, { now: NOW, dm: false });
        mockEvents.set("eh-new", raid("eh-new", 6));
        const out = await availability.applyToEvent("eh-new", { now: NOW });
        expect(out).toHaveLength(1);
        expect(mockSignups.get(`eh-new/${ANNA}`)).toMatchObject({ status: "absence", comment: "Urlaub" });
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]);
        expect(dm.title).toBe("Signed off automatically");
        expect(dm.description).toContain("(Urlaub)");
        // signing up again by hand is not undone by the next run
        mockSignups.set(`eh-new/${ANNA}`, { userId: ANNA, status: "signed", character: "Nerathil", spec: "Mage-Arcane" });
        expect(await availability.applyToEvent("eh-new", { now: NOW })).toEqual([]);
        expect(mockSignups.get(`eh-new/${ANNA}`).status).toBe("signed");
    });

    it("erst Abwesenheiten, dann Anwesenheiten: die Anwesenheit bleibt draußen", async () => {
        await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(10), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, dm: false });
        await availability.createEntry(ANNA, { kind: "absence", from: dayPlus(6), to: dayPlus(7) }, { now: NOW, dm: false });
        mockEvents.set("eh-new", raid("eh-new", 6));
        const out = await availability.applyToEvent("eh-new", { now: NOW });
        expect(out.map((o) => [o.entry.kind, o.result.ok])).toEqual([["absence", true], ["presence", false]]);
        expect(mockSignups.get(`eh-new/${ANNA}`).status).toBe("absence");
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
    });

    it("lässt Raids außerhalb, anderer Kategorie und abgesagte Raids in Ruhe und wirft nie", async () => {
        await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(10), categoryId: "cat1" }, { now: NOW, dm: false });
        mockEvents.set("eh-far", raid("eh-far", 20));
        mockEvents.set("eh-cat2", raid("eh-cat2", 5, { categoryId: "cat2" }));
        mockEvents.set("eh-gone", raid("eh-gone", 5, { status: "cancelled" }));
        for (const id of ["eh-far", "eh-cat2", "eh-gone", "eh-missing"]) expect(await availability.applyToEvent(id, { now: NOW })).toEqual([]);
    });

    it("bezieht nur Anwesenheiten der Spielversion des Raids ein", async () => {
        await availability.createEntry(ANNA, { kind: "presence", from: today, to: dayPlus(10), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, dm: false });
        mockEvents.set("eh-forever", raid("eh-forever", 6, { versionId: "forever" }));
        expect(await availability.applyToEvent("eh-forever", { now: NOW })).toEqual([]);
    });
});

describe("deleteEntry / activeEntries", () => {
    it("löscht nur eigene Einträge, die Orga alle; vergangene zeigt die Liste nicht", async () => {
        const { entry } = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(1) }, { now: NOW, dm: false });
        store.addEntry({ userId: ANNA, kind: "absence", from: dayPlus(-9), to: dayPlus(-8) });
        expect(availability.activeEntries(ANNA, { now: NOW }).map((e) => e.id)).toEqual([entry.id]);
        expect(availability.deleteEntry(entry.id, { userId: ORGA }).code).toBe("not_found");
        expect(availability.deleteEntry(entry.id, { userId: ORGA, orga: true }).entry.id).toBe(entry.id);
        expect(availability.activeEntries(ANNA, { now: NOW })).toEqual([]);
    });
});
