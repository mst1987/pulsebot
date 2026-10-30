// Ab- und Anwesenheiten (src/services/signups/availability.js): ein Zeitraum meldet
// für die Raids darin ab bzw. an — sofort und für später angelegte Raids — und
// sagt es dem Raider per DM.

const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    listEvents: (_guildId, { sinceSeconds = 0 } = {}) => [...mockEvents.values()].filter((e) => e.startTime >= sinceSeconds),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventState: (id, patch) => ({ ...mockEvents.get(id), ...patch }),
    appendEventLog: jest.fn(),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/events/signupStore", () => {
    const actual = jest.requireActual("../../../src/stores/events/signupStore");
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
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => null),
    guildMembership: jest.fn(async () => null),
    postNotice: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "m1" })),
}));
// which server a category lies on (categoryGuild reads Discord, the snapshot and the stores - here a plain map)
const mockCategoryServer = { cat1: "g1", cat2: "g1", "cat-b": "g2" };
jest.mock("../../../src/services/categories/categoryGuild", () => ({
    ...jest.requireActual("../../../src/services/categories/categoryGuild"),
    categoryContext: () => ({}),
    displayServerOf: (id) => mockCategoryServer[id] || "g1",
}));

const profiles = require("../../../src/stores/roster/raiderProfileStore");
const store = require("../../../src/stores/events/availabilityStore");
const discord = require("../../../src/services/discord/discord");
const availability = require("../../../src/services/signups/availability");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent, sec, DAY } = require("../../factories/events");

const ANNA = "200000000000000001";
const ORGA = "200000000000000009";
// every category of the test server g1
const ALL = [{ guildId: "g1", categoryIds: [] }];
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
    mockConfig = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } } };
    discord.sendDirectMessage.mockClear();
    discord.sendDirectMessage.mockImplementation(async () => ({ ok: true, messageId: "m1" }));
    for (const e of [raid("eh-a", 2), raid("eh-b", 4), raid("eh-c", 9)]) mockEvents.set(e.id, e);
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] }, { name: "Anna" });
});

describe("checkInput", () => {
    it("lehnt einen umgedrehten, vergangenen oder zu langen Zeitraum ab", () => {
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "absence", from: dayPlus(3), to: dayPlus(1) }, { now: NOW }).error)
            .toBe("Das Bis-Datum liegt vor dem Von-Datum.");
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "absence", from: dayPlus(-5), to: dayPlus(-2) }, { now: NOW }).error)
            .toBe("Der Zeitraum liegt schon in der Vergangenheit.");
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(200) }, { now: NOW }).error)
            .toBe("Höchstens 180 Tage auf einmal.");
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "absence", from: "morgen", to: "" }, { now: NOW }).error)
            .toBe("Bitte ein gültiges Von- und Bis-Datum angeben.");
    });

    it("nimmt für eine Anwesenheit nur Charakter und Spec aus dem Profil und merkt sich die Spielversion", () => {
        const ok = availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(ok.value).toMatchObject({ characters: [{ character: "Nerathil", spec: "Mage-Arcane", versionId: "tbc" }], to: today, scope: ALL });
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, character: "Brokk", spec: "Warrior-Arms" }, { now: NOW }).error)
            .toBe("Dieser Charakter steht nicht in deinem Profil.");
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, character: "Nerathil", spec: "Mage-Fire" }, { now: NOW }).error)
            .toBe("Diese Spec hat der Charakter im Profil nicht.");
    });

    // A TBC character never stands for a Forever category (#741), nor for a hidden version (#563).
    it("lehnt einen Charakter ab, dessen Version die Kategorie nicht spielt oder ausgeblendet ist", () => {
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" }, { name: "Anna" });
        mockConfig = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } }, mainVersion: "tbc", categoryVersion: { cat1: "forever", cat2: "tbc" } };
        expect(availability.checkInput(ANNA, { kind: "presence", from: today, categoryId: "cat1", character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW }).error)
            .toBe("Nerathil gehört zu TBC Anniversary – lege einen WoW Forever-Charakter im Profil an.");
        expect(availability.checkInput(ANNA, { kind: "presence", from: today, categoryId: "cat1", character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW }).value)
            .toMatchObject({ characters: [{ character: "Devi Res", versionId: "forever" }] });
        // every category: the character's own version, while it is shown
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW }).value)
            .toMatchObject({ characters: [{ versionId: "forever" }] });
        mockConfig = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } }, mainVersion: "tbc", hideOtherVersions: true };
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, character: "Devi Res", spec: "Priest-Shadow" }, { now: NOW }).error)
            .toBe("Devi Res gehört zu WoW Forever – lege einen TBC Anniversary-Charakter im Profil an.");
        // an absence names no character: untouched
        expect(availability.checkInput(ANNA, { kind: "absence", from: today, categoryId: "cat1" }, { now: NOW }).value).toBeTruthy();
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
        const tbc = availability.raidsInRange({ kind: "presence", from: today, to: dayPlus(5), characters: [{ character: "Nerathil", spec: "Mage-Arcane", versionId: "tbc" }] }, { now: NOW });
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
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(5), comment: "Urlaub" }, { now: NOW, eventIds: ["eh-a"] });
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
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3) }, { now: NOW });
        expect(res.results[0]).toMatchObject({ eventId: "eh-a", ok: false, skipped: "already_absent" });
        expect(mockSignups.get(`eh-a/${ANNA}`).comment).toBe("krank");
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("already signed off");
    });

    it("gibt ohne Grund den Zeitraum als Kommentar mit und meldet eine DM, die nicht ankam", async () => {
        discord.sendDirectMessage.mockImplementation(async () => ({ ok: false, error: "closed" }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3) }, { now: NOW });
        expect(mockSignups.get(`eh-a/${ANNA}`).comment).toMatch(/^Away \d+ \w+–\d+ \w+$/);
        expect(res.dm).toBe(false);
    });

    // #982: an absence from the panel is a sign-off like any other - a hint only when it comes late
    it("eine kurzfristige Abwesenheit wird ein Hinweis, eine frühe nicht (#982)", async () => {
        const signals = require("../../../src/stores/roster/userSignalsStore");
        signals.useFile(tempStoreFile("eh-availability-signals.json"));
        try {
            mockEvents.set("eh-soon", raid("eh-soon", 5 / 24, { guildId: "g1" }));
            mockEvents.set("eh-a", raid("eh-a", 2, { guildId: "g1" }));
            const signed = { userId: ANNA, status: "signed", character: "Nerathil", spec: "Mage-Arcane", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }] };
            mockSignups.set(`eh-soon/${ANNA}`, { ...signed });
            mockSignups.set(`eh-a/${ANNA}`, { ...signed });
            await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3) }, { now: NOW, eventIds: ["eh-soon", "eh-a"] });
            expect(mockSignups.get(`eh-soon/${ANNA}`).status).toBe("absence");
            expect(mockSignups.get(`eh-a/${ANNA}`).status).toBe("absence");
            const events = (signals.eventsFor("g1", { now: NOW })[ANNA] || { events: [] }).events;
            expect(events).toEqual([expect.objectContaining({ kind: "late_signoff", eventId: "eh-soon" })]);
            expect(events[0].byOrga).toBeUndefined();
        } finally {
            signals.useFile(null);
        }
    });

    it("die Orga trägt für einen Raider ein: die DM sagt es", async () => {
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3) }, { now: NOW, by: ORGA });
        expect(res.entry.createdBy).toBe(ORGA);
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).footer).toBe("Entered for you by the raid lead");
    });
});

describe("Abwesenheit und Raider-Rolle", () => {
    const WITHOUT_ROLE = ["r-other"];

    beforeEach(() => {
        mockConfig = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } }, categoryRoles: { cat1: ["r-raider"] } };
        discord.memberRoleIds.mockImplementation(async () => WITHOUT_ROLE);
    });
    afterEach(() => discord.memberRoleIds.mockImplementation(async () => null));

    it("signs off at a category's panel even without the raider role — saying \"I am away\" needs none", async () => {
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW, via: "panel" });
        expect(res.entry.via).toBe("panel");
        expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true], ["eh-b", true]]);
        expect(mockSignups.get(`eh-a/${ANNA}`)).toMatchObject({ status: "absence" });
    });

    it("an older entry without `via` came from the panel too and keeps signing off without the role", async () => {
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW });
        expect(res.entry.via).toBe("");
        expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true], ["eh-b", true]]);
    });

    it("checks the role for a web entry with a category: anybody can pick any category there", async () => {
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW, by: ANNA, via: "web" });
        expect(res.entry.via).toBe("web");
        expect(res.results.map((r) => [r.eventId, r.ok, r.skipped || ""])).toEqual([["eh-a", false, "not_raider"], ["eh-b", false, "not_raider"]]);
        expect(mockSignups.get(`eh-a/${ANNA}`)).toBeUndefined();
        // a raid created later is held to the same check
        mockEvents.set("eh-later", raid("eh-later", 4));
        await availability.applyToEvent("eh-later", { now: NOW });
        expect(mockSignups.get(`eh-later/${ANNA}`)).toBeUndefined();
    });

    it("a web entry with the role signs off as usual", async () => {
        discord.memberRoleIds.mockImplementation(async () => ["r-raider"]);
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW, by: ANNA, via: "web" });
        expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true], ["eh-b", true]]);
    });

    it("the orga entering for a raider stays without the role check, from the web too", async () => {
        const res = await availability.createEntry(ANNA, { kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }, { now: NOW, by: "orga-1", via: "web" });
        expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true], ["eh-b", true]]);
    });

    it("leaves the raids of categories the raider is no raider of quietly alone for an absence of every category", async () => {
        mockEvents.set("eh-open", raid("eh-open", 3, { categoryId: "cat2" }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(5) }, { now: NOW });
        expect(res.results.map((r) => [r.eventId, r.ok, r.skipped || ""])).toEqual([["eh-a", false, "not_raider"], ["eh-open", true, ""], ["eh-b", false, "not_raider"]]);
        // not a word about them in the DM: they were never the raider's raids
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]).description;
        expect(dm).toContain("eh-open");
        expect(dm).not.toContain("eh-a");
    });

    it("names those raids up front, so the picker can leave them out", async () => {
        mockEvents.set("eh-open", raid("eh-open", 3, { categoryId: "cat2" }));
        // a raid already signed up for stays the raider's
        mockSignups.set(`eh-b/${ANNA}`, { userId: ANNA, status: "signed", character: "Nerathil", spec: "Mage-Arcane", characters: [] });
        expect(await availability.foreignRaids(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(5) }, { now: NOW })).toEqual(["eh-a"]);
        // roles that cannot be read keep everything
        discord.memberRoleIds.mockImplementation(async () => null);
        expect(await availability.foreignRaids(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(5) }, { now: NOW })).toEqual([]);
    });
});

describe("createEntry – Anwesenheit", () => {
    it("meldet mit Charakter · Spec als Dabei an, aber nie über eine bestehende Anmeldung", async () => {
        mockSignups.set(`eh-b/${ANNA}`, { userId: ANNA, status: "tentative", character: "Nerathil", spec: "Mage-Arcane", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "tentative" }] });
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(5), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results.map((r) => [r.eventId, r.ok, r.skipped])).toEqual([["eh-a", true, undefined], ["eh-b", false, "already_signed"]]);
        expect(mockSignups.get(`eh-a/${ANNA}`)).toMatchObject({ status: "signed", character: "Nerathil", spec: "Mage-Arcane" });
        expect(mockSignups.get(`eh-b/${ANNA}`).status).toBe("tentative");
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]);
        expect(dm.title).toBe("Attendance saved");
        expect(dm.description).toContain("Character: **Nerathil** · Arcane");
        expect(dm.description).toContain("already signed up");
    });

    it("meldet nicht in einen Raid an, für den eine Abwesenheit gilt", async () => {
        await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: dayPlus(4), to: dayPlus(4) }, { now: NOW, dm: false });
        mockSignups.clear();
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(5), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results.find((r) => r.eventId === "eh-b")).toMatchObject({ ok: false, skipped: "absent" });
    });

    it("trägt den Fehler des Anmelde-Service ein (Anmeldeschluss vorbei) und übersetzt ihn in der DM", async () => {
        mockEvents.set("eh-a", raid("eh-a", 2, { signupDeadline: sec(NOW) - 60 }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW });
        expect(res.results[0]).toMatchObject({ ok: false, error: expect.stringContaining("Anmeldeschluss") });
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("⛔");
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("The signup deadline has passed");
    });

    it("an attendance from the web keeps PuG raids to members of their server (#907)", async () => {
        discord.guildMembership.mockImplementation(async () => false);
        try {
            const web = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, by: ANNA, via: "web" });
            expect(web.results[0]).toMatchObject({ eventId: "eh-a", ok: false, error: expect.stringContaining("PuG-Server") });
            expect(mockSignups.get(`eh-a/${ANNA}`)).toBeUndefined();
            // from Discord (the panel) whoever presses is on the server: no lookup
            discord.guildMembership.mockClear();
            const panel = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, via: "panel" });
            expect(panel.results[0]).toMatchObject({ eventId: "eh-a", ok: true });
            expect(discord.guildMembership).not.toHaveBeenCalled();
        } finally {
            discord.guildMembership.mockImplementation(async () => null);
        }
    });

    it("an attendance from the web asks each PuG server once, all servers at once (#907)", async () => {
        mockEvents.set("eh-b", raid("eh-b", 4, { guildId: "g-other" }));
        mockConfig = { ...mockConfig, discordServers: { servers: [{ guildId: "g1" }, { guildId: "g-other" }] } };
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        try {
            discord.guildMembership.mockClear();
            discord.guildMembership.mockImplementation((guildId) => new Promise((resolve) => setTimeout(() => resolve(guildId !== "g-other"), 5000)));
            let res = null;
            availability.createEntry(ANNA, { scope: [...ALL, { guildId: "g-other", categoryIds: [] }], kind: "presence", from: today, to: dayPlus(10), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, by: ANNA, via: "web" })
                .then((r) => { res = r; });
            // three raids on two servers: two lookups, one time limit
            await jest.advanceTimersByTimeAsync(5000);
            expect(res).not.toBeNull();
            expect(discord.guildMembership).toHaveBeenCalledTimes(2);
            expect(discord.guildMembership.mock.calls.map((c) => c[0]).sort()).toEqual(["g-other", "g1"]);
            expect(res.results.map((r) => [r.eventId, r.ok])).toEqual([["eh-a", true], ["eh-b", false], ["eh-c", true]]);
        } finally {
            jest.useRealTimers();
            discord.guildMembership.mockImplementation(async () => null);
        }
    });

    it("die Orga ist an den Anmeldeschluss nicht gebunden", async () => {
        mockEvents.set("eh-a", raid("eh-a", 2, { signupDeadline: sec(NOW) - 60 }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(3), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, by: ORGA });
        expect(res.results[0].ok).toBe(true);
    });
});

describe("applyToEvent – später angelegte Raids", () => {
    it("meldet in einem neuen Raid des Zeitraums ab, genau einmal, mit DM", async () => {
        await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(10), comment: "Urlaub" }, { now: NOW, dm: false });
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
        await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(10), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, dm: false });
        await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: dayPlus(6), to: dayPlus(7) }, { now: NOW, dm: false });
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
        await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(10), character: "nerathil", spec: "Mage-Arcane" }, { now: NOW, dm: false });
        mockEvents.set("eh-forever", raid("eh-forever", 6, { versionId: "forever" }));
        expect(await availability.applyToEvent("eh-forever", { now: NOW })).toEqual([]);
    });
});

describe("Sprache", () => {
    it("schreibt die DM ohne eigene Wahl in der Server-Sprache, Deutsch als Standard", async () => {
        mockConfig = {};
        await availability.createEntry(ANNA, { categoryId: "cat1", kind: "absence", from: today, to: dayPlus(3), comment: "Urlaub" }, { now: NOW });
        const dm = dmText(discord.sendDirectMessage.mock.calls[0]);
        expect(dm.title).toBe("Abwesenheit gespeichert");
        expect(dm.description).toContain("Grund: Urlaub");
        expect(dm.description).toContain("**Abgemeldet von:**");
    });

    it("schreibt den Standard-Kommentar in der Server-Sprache", async () => {
        mockConfig = {};
        await availability.createEntry(ANNA, { categoryId: "cat1", kind: "absence", from: today, to: dayPlus(3) }, { now: NOW, dm: false });
        expect(mockSignups.get(`eh-a/${ANNA}`).comment).toMatch(/^Weg \d+\. \S+–\d+\. \S+$/);
    });
});

describe("deleteEntry / activeEntries", () => {
    it("löscht nur eigene Einträge, die Orga alle; vergangene zeigt die Liste nicht", async () => {
        const { entry } = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(1) }, { now: NOW, dm: false });
        store.addEntry({ userId: ANNA, kind: "absence", from: dayPlus(-9), to: dayPlus(-8) });
        expect(availability.activeEntries(ANNA, { now: NOW }).map((e) => e.id)).toEqual([entry.id]);
        expect(availability.deleteEntry(entry.id, { userId: ORGA }).code).toBe("not_found");
        expect(availability.deleteEntry(entry.id, { userId: ORGA, orga: true }).entry.id).toBe(entry.id);
        expect(availability.activeEntries(ANNA, { now: NOW })).toEqual([]);
    });

    it("räumt beim Eintragen Einträge weg, die über 120 Tage vorbei sind (#677: die Anwesenheit liest sie als Urlaub)", async () => {
        const old = store.addEntry({ userId: ANNA, kind: "absence", from: dayPlus(-160), to: dayPlus(-140) }).entry;
        const recent = store.addEntry({ userId: ANNA, kind: "absence", from: dayPlus(-62), to: dayPlus(-60) }).entry;
        await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: today }, { now: NOW, dm: false });
        const left = store.listEntries({ userId: ANNA }).map((e) => e.id);
        expect(left).not.toContain(old.id);
        expect(left).toContain(recent.id);
    });
});

describe("Scope je Server", () => {
    const TWO = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } }, discordServers: { servers: [{ guildId: "g1" }, { guildId: "g2" }] } };

    it("deckt einen Raid eines anderen Servers nie ab – weder sofort noch später", async () => {
        mockConfig = TWO;
        mockEvents.set("eh-b2", raid("eh-b2", 3, { guildId: "g2", categoryId: "cat-b" }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(10) }, { now: NOW, dm: false });
        expect(res.results.map((r) => r.eventId)).not.toContain("eh-b2");
        expect(mockSignups.get(`eh-b2/${ANNA}`)).toBeUndefined();
        mockEvents.set("eh-b3", raid("eh-b3", 5, { guildId: "g2", categoryId: "cat-b" }));
        expect(await availability.applyToEvent("eh-b3", { now: NOW })).toEqual([]);
        // a scope naming g2 covers them
        const other = await availability.createEntry(ANNA, { scope: [{ guildId: "g2", categoryIds: ["cat-b"] }], kind: "absence", from: today, to: dayPlus(10) }, { now: NOW, dm: false, by: ORGA });
        expect(other.results.map((r) => r.eventId).sort()).toEqual(["eh-b2", "eh-b3"]);
    });

    it("prüft Server und Kategorie und fasst denselben Server zusammen", () => {
        mockConfig = TWO;
        const check = (scope) => availability.checkInput(ANNA, { scope, kind: "absence", from: today }, { now: NOW });
        expect(check([]).error).toBe("Bitte mindestens einen Server oder eine Kategorie wählen.");
        expect(check([{ guildId: "g9", categoryIds: [] }]).error).toBe("Diesen Server gibt es hier nicht.");
        expect(check([{ guildId: "g1", categoryIds: ["cat-b"] }]).error).toBe("Die Kategorie gehört nicht zu diesem Server.");
        expect(check([{ guildId: "g1", categoryIds: ["cat1"] }, { guildId: "g1", categoryIds: ["cat2"] }, { guildId: "g2", categoryIds: [] }]).value.scope)
            .toEqual([{ guildId: "g1", categoryIds: ["cat1", "cat2"] }, { guildId: "g2", categoryIds: [] }]);
        expect(check([{ guildId: "g1", categoryIds: ["cat1"] }, { guildId: "g1", categoryIds: [] }]).value.scope)
            .toEqual([{ guildId: "g1", categoryIds: [] }]);
    });

    it("liest Alt-Einträge ohne Scope: categoryId = diese Kategorie, leer = alles", () => {
        const ev = raid("eh-x", 2);
        const cat = store.addEntry({ userId: ANNA, kind: "absence", from: today, to: dayPlus(5), categoryId: "cat1" }).entry;
        const any = store.addEntry({ userId: ANNA, kind: "absence", from: today, to: dayPlus(5), categoryId: "" }).entry;
        expect(availability.covers(cat, ev)).toBe(true);
        expect(availability.covers(cat, { ...ev, categoryId: "cat2" })).toBe(false);
        expect(availability.covers(any, { ...ev, categoryId: "cat2", guildId: "g2" })).toBe(true);
        // an old single character reads as a list
        const pres = store.addEntry({ userId: ANNA, kind: "presence", from: today, to: dayPlus(5), categoryId: "cat1", character: "Nerathil", spec: "Mage-Arcane", versionId: "tbc" }).entry;
        expect(pres.characters).toEqual([{ character: "Nerathil", spec: "Mage-Arcane", versionId: "tbc" }]);
        expect(availability.covers(pres, ev)).toBe(true);
    });
});

describe("mehrere Charaktere", () => {
    beforeEach(() => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Arms"] }, { name: "Anna" });
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" }, { name: "Anna" });
    });
    const chars = [
        { character: "Nerathil", spec: "Mage-Arcane" },
        { character: "Devi Res", spec: "Priest-Shadow" },
        { character: "Brokk", spec: "Warrior-Arms" },
    ];

    it("meldet je Raid mit den Charakteren seiner Version an, in Reihenfolge", async () => {
        mockEvents.set("eh-f", raid("eh-f", 3, { versionId: "forever" }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(5), characters: chars }, { now: NOW });
        expect(res.entry.characters.map((c) => c.character)).toEqual(["Nerathil", "Devi Res", "Brokk"]);
        expect(mockSignups.get(`eh-a/${ANNA}`).characters.map((c) => c.character)).toEqual(["Nerathil", "Brokk"]);
        expect(mockSignups.get(`eh-f/${ANNA}`).characters.map((c) => c.character)).toEqual(["Devi Res"]);
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).description).toContain("Characters: **Nerathil**");
    });

    it("kürzt auf die Charakter-Zahl des Raids, statt ihn scheitern zu lassen", async () => {
        mockConfig = { ...mockConfig, categorySignupCharacters: { cat1: 1 } };
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(3), characters: chars }, { now: NOW, dm: false });
        expect(res.results[0].ok).toBe(true);
        expect(mockSignups.get(`eh-a/${ANNA}`).characters.map((c) => c.character)).toEqual(["Nerathil"]);
    });

    it("ohne Charakter der Version deckt die Anwesenheit deren Raids nicht ab", async () => {
        mockEvents.set("eh-f", raid("eh-f", 3, { versionId: "forever" }));
        const res = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(5), characters: [chars[0]] }, { now: NOW, dm: false });
        expect(res.results.map((r) => r.eventId)).toEqual(["eh-a", "eh-b"]);
    });

    it("lehnt mehr als 12 Charaktere ab", () => {
        const many = Array.from({ length: 13 }, () => chars[0]);
        expect(availability.checkInput(ANNA, { scope: ALL, kind: "presence", from: today, characters: many }, { now: NOW }).error).toBe("Höchstens 12 Charaktere.");
    });
});

describe("changeEntry", () => {
    it("lässt angefasste Raids stehen und wendet neu abgedeckte sofort an", async () => {
        const { entry } = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3), comment: "Urlaub" }, { now: NOW, dm: false });
        expect(Object.keys(entry.applied)).toEqual(["eh-a"]);
        // signed up again by hand: a change must not sign off from eh-a again
        mockSignups.set(`eh-a/${ANNA}`, { userId: ANNA, status: "signed", character: "Nerathil", spec: "Mage-Arcane" });
        const res = await availability.changeEntry(entry.id, { scope: ALL, from: today, to: dayPlus(10), comment: "Reise" }, { userId: ANNA, now: NOW });
        expect(res.results.map((r) => r.eventId)).toEqual(["eh-b", "eh-c"]);
        expect(mockSignups.get(`eh-a/${ANNA}`).status).toBe("signed");
        expect(mockSignups.get(`eh-c/${ANNA}`)).toMatchObject({ status: "absence", comment: "Reise" });
        expect(res.entry).toMatchObject({ kind: "absence", to: dayPlus(10), comment: "Reise" });
        expect(Object.keys(res.entry.applied).sort()).toEqual(["eh-a", "eh-b", "eh-c"]);
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).title).toBe("Absence changed");
    });

    it("merkt abgewählte neue Raids als skip und bleibt bei der Art", async () => {
        const { entry } = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(3) }, { now: NOW, dm: false });
        const res = await availability.changeEntry(entry.id, { scope: ALL, kind: "presence", from: today, to: dayPlus(10) }, { userId: ANNA, eventIds: ["eh-c"], now: NOW, dm: false });
        expect(res.entry.kind).toBe("absence");
        expect(res.entry.skip).toEqual(["eh-b"]);
        expect(mockSignups.get(`eh-b/${ANNA}`)).toBeUndefined();
        expect(mockSignups.get(`eh-c/${ANNA}`).status).toBe("absence");
    });

    it("ändert fremde Einträge nur für die Orga", async () => {
        const { entry } = await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(1) }, { now: NOW, dm: false });
        expect((await availability.changeEntry(entry.id, { scope: ALL, from: today, to: dayPlus(2) }, { userId: ORGA, now: NOW })).code).toBe("not_found");
        expect((await availability.changeEntry("nope", { scope: ALL, from: today }, { userId: ANNA, now: NOW })).code).toBe("not_found");
        const ok = await availability.changeEntry(entry.id, { scope: ALL, from: today, to: dayPlus(2) }, { userId: ORGA, orga: true, now: NOW, dm: false });
        expect(ok.entry.to).toBe(dayPlus(2));
        expect((await availability.changeEntry(entry.id, { scope: [], from: today }, { userId: ANNA, now: NOW })).error)
            .toBe("Bitte mindestens einen Server oder eine Kategorie wählen.");
    });

    it("tauscht bei einer Anwesenheit die Charaktere", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Arms"] }, { name: "Anna" });
        const { entry } = await availability.createEntry(ANNA, { scope: ALL, kind: "presence", from: today, to: dayPlus(1), character: "Nerathil", spec: "Mage-Arcane" }, { now: NOW, dm: false });
        const res = await availability.changeEntry(entry.id, { scope: ALL, from: today, to: dayPlus(5), characters: [{ character: "Brokk", spec: "Warrior-Arms" }] }, { userId: ANNA, now: NOW });
        expect(res.entry.characters.map((c) => c.character)).toEqual(["Brokk"]);
        expect(mockSignups.get(`eh-b/${ANNA}`).character).toBe("Brokk");
        expect(dmText(discord.sendDirectMessage.mock.calls[0]).title).toBe("Attendance changed");
    });
});

describe("absentFor", () => {
    it("lässt den eigenen Eintrag aus (Vorschau beim Bearbeiten)", async () => {
        await availability.createEntry(ANNA, { scope: ALL, kind: "absence", from: today, to: dayPlus(5) }, { now: NOW, dm: false });
        const own = store.listEntries({ userId: ANNA })[0];
        const ev = mockEvents.get("eh-b");
        expect(availability.absentFor(ANNA, ev)).toBe(true);
        expect(availability.absentFor(ANNA, ev, { excludeId: own.id })).toBe(false);
    });
});
