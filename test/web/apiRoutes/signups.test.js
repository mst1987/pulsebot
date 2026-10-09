// „Anmeldungen“ über die API (src/web/apiRoutes/signups.js, src/web/signups/signupView.js):
// nur die eigene Anmeldung, Raid-Helper-Events mit Discord-Link statt Anmeldung,
// Kategorien nach Raider-Rollen, und die Orga-Liste mit Kommentar und „kann auch“.

let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
let mockGroups = [];
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: mockGroups, error: null })) }));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockRoleIds = null;
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => mockRoleIds),
    resolveUserNames: jest.fn(async () => ({ "200000000000000001": "anna_discord" })),
}));
jest.mock("../../../src/stores/eventSoftresStore", () => ({ getEventSoftres: () => null }));

const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => {
    const actual = jest.requireActual("../../../src/stores/signupStore");
    const list = (eventId) => [...mockSignups.entries()].filter(([k]) => k.startsWith(`${eventId}/`)).map(([, v]) => v);
    return {
        normalizeSignup: actual.normalizeSignup,
        getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
        listSignups: list,
        saveSignup: (eventId, userId, input, opts) => {
            const checked = actual.normalizeSignup(input, opts);
            if (checked.error) return { error: checked.error };
            const signup = { userId, ...checked.value, at: 1 };
            mockSignups.set(`${eventId}/${userId}`, signup);
            return { signup };
        },
    };
});

const { readJsonBody } = require("../../../src/web/http/apiBody");
const profiles = require("../../../src/stores/raiderProfileStore");
const route = require("../../../src/web/apiRoutes/signups");
const { categoryVisible } = require("../../../src/web/signups/signupView");
const { tempStoreFile } = require("../../helpers/tempStore");
const { mockRes, status, json } = require("../../helpers/http");
const { ownEvent: ownEventFixture } = require("../../factories/events");
const { knownChannels } = require("../../helpers/linkCheck");

// The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
beforeEach(() => knownChannels("c1", "c2"));

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false, access: { signup: { read: true, write: true } } };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false, access: { signup: { read: true, write: true } } };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: true, access: {} };
const future = Math.floor(Date.now() / 1000) + 3 * 86400;

async function call(handler, user, { json: payload = {}, query = "" } = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload);
    const res = mockRes();
    await handler({}, res, new URL(`http://x/api?${query}`));
    return res;
}

const ownEvent = ownEventFixture({
    guildId: "g1", title: "Karazhan PuG", startTime: future, channelId: "c1",
    categoryId: "cat-kara", instanceIds: ["kara"], signupDeadline: future - 3600, wishes: true,
    message: { channelId: "c1", messageId: "m1" },
});

function groups() {
    const ownSignUps = [...mockSignups.entries()].filter(([k]) => k.startsWith("eh-kara/")).map(([, s]) => ({ ...s, specName: "Arcane" }));
    return [
        { categoryId: "cat-kara", categoryName: "Karazhan", events: [{ ...ownEvent, signUps: ownSignUps, signupCount: ownSignUps.length }] },
        { categoryId: "cat-t5", categoryName: "SSC/TK", events: [{
            id: "1400000000000000001", source: "raidhelper", title: "SSC + TK", startTime: future + 86400, channelId: "c2",
            signUps: [{ userId: BERT.id, specName: "Arcane", status: "signed" }], signupCount: 1,
        }] },
    ];
}

beforeAll(() => profiles.useFile(tempStoreFile("eh-signups-route.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mockSignups.clear();
    mockEvents.clear();
    mockEvents.set("eh-kara", ownEvent);
    mockConfig = {};
    mockRoleIds = null;
    profiles.addCharacter(ANNA.id, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] }, { name: "Anna" });
    mockGroups = groups();
});

describe("GET /api/signups", () => {
    it("listet eigene Events mit Rollenständen und Raid-Helper-Events mit Discord-Link", async () => {
        const data = json(await call(route.getSignups, ANNA)).data;
        expect(data.events.map((e) => e.id)).toEqual(["eh-kara", "1400000000000000001"]);
        const [own, rh] = data.events;
        expect(own).toMatchObject({
            source: "eventhelper", instanceIcon: expect.any(String), size: 10, mine: null, wishes: true,
            counts: { tank: { n: 0, target: 2 }, healer: { n: 0, target: 3 }, dps: { n: 0, target: 5 } },
            allowedStatuses: ["signed", "tentative", "late", "bench", "absence"],
            discordUrl: "https://discord.com/channels/g1/c1/m1",
        });
        expect(rh).toMatchObject({ source: "raidhelper", discordUrl: "https://discord.com/channels/g1/c2/1400000000000000001", mine: null });
        expect(rh.allowedStatuses).toBeUndefined();
        expect(data.profile.characters[0]).toMatchObject({ name: "Nerathil", specs: [{ key: "Mage-Arcane", label: "Arkan", gear: "usable" }] });
        expect(data.classes).toHaveLength(9);
    });

    it("liefert die Klassen je Spielversion, `classes` aus der Hauptversion (#541)", async () => {
        const { rulesFor } = require("../../../src/config/gameVersions");
        const shape = (v) => rulesFor(v).classes.map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon }));
        let data = json(await call(route.getSignups, ANNA)).data;
        expect(data.classes).toEqual(shape("tbc"));
        expect(data.classesByVersion).toEqual({ tbc: shape("tbc"), classic: shape("classic"), forever: shape("forever") });
        // the own event keeps its version, whatever the main version says
        mockConfig = { mainVersion: "forever" };
        data = json(await call(route.getSignups, ANNA)).data;
        expect(data.classes).toEqual(shape("forever"));
        expect(data.events[0].versionId).toBe("tbc");
    });

    it("gibt jedem Charakter seine Version mit, jeder eigenen Zeile eine Version und die Versionsnamen (#543)", async () => {
        profiles.addCharacter(ANNA.id, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" }, { name: "Anna" });
        mockEvents.set("eh-kara", { ...ownEvent, versionId: "" });
        mockGroups[0].events[0].versionId = "";
        mockConfig = { categoryVersion: { "cat-kara": "forever" } };
        const data = json(await call(route.getSignups, ANNA)).data;
        expect(data.profile.characters.map((c) => [c.name, c.versionId])).toEqual([["Nerathil", "tbc"], ["Devi Res", "forever"]]);
        // an event without a version plays its category's (the dialog filters by it)
        expect(data.events[0].versionId).toBe("forever");
        expect(data.versions).toEqual(expect.arrayContaining([{ id: "forever", label: "WoW Forever", short: "Forever" }]));
    });

    it("zeigt einem Raider nie einen Setup-Entwurf, nur das freigegebene Setup (#263)", async () => {
        const slot = { userId: ANNA.id, character: "Nerathil", classId: "Mage", spec: "Mage-Arcane", role: "ranged" };
        mockEvents.set("eh-kara", { ...ownEvent, setup: { status: "draft", groups: [{ index: 3, slots: [{ ...slot, reasons: ["x"] }] }], bench: [], approved: null } });
        let data = json(await call(route.getSignups, ANNA)).data;
        expect(data.events[0].placement).toBeNull();
        expect(JSON.stringify(data)).not.toContain("\"index\":3");

        // a changed draft after an approval: the member keeps the approved group
        mockEvents.set("eh-kara", { ...ownEvent, setup: {
            status: "draft", changedSinceApproval: true, groups: [{ index: 3, slots: [slot] }], bench: [],
            approved: { version: 1, groups: [{ index: 2, slots: [slot] }], bench: [] },
        } });
        data = json(await call(route.getSignups, ANNA)).data;
        expect(data.events[0].placement).toEqual({ group: 2, character: "Nerathil", spec: "Mage-Arcane", role: "ranged" });
    });

    it("zeigt den eigenen Raid-Helper-Status", async () => {
        const data = json(await call(route.getSignups, BERT)).data;
        expect(data.events[1].mine).toEqual({ status: "signed", specName: "Arcane" });
    });

    it("zählt je Zeile die einzelnen Discord-Accounts (#520): doppelte Einträge eines Kontos einmal, Absage nicht", async () => {
        mockGroups[1].events[0].signUps = [
            { userId: BERT.id, specName: "Arcane", status: "signed" },
            { userId: BERT.id, specName: "Holy", status: "late" },
            { userId: ANNA.id, specName: "Fire", status: "late" },
            { userId: ORGA.id, specName: "Absence", status: "absence" },
        ];
        const data = json(await call(route.getSignups, ORGA)).data;
        const rh = data.events.find((e) => e.source === "raidhelper");
        expect(rh).toMatchObject({ attending: 3, accounts: 2 });
        expect(data.events.find((e) => e.source === "eventhelper")).toMatchObject({ accounts: 0, counts: { accounts: 0 } });
    });

    it("blendet Kategorien mit Raider-Rollen aus, die das Mitglied nicht hat", async () => {
        mockConfig = { categoryIds: ["cat-kara", "cat-t5"], categoryRoles: { "cat-t5": ["role-t5"] } };
        mockRoleIds = ["role-other"];
        let data = json(await call(route.getSignups, ANNA)).data;
        expect(data.events.map((e) => e.id)).toEqual(["eh-kara"]);
        // …wer dort schon angemeldet ist, sieht das Event trotzdem
        data = json(await call(route.getSignups, BERT)).data;
        expect(data.events.map((e) => e.id)).toEqual(["eh-kara", "1400000000000000001"]);
        // …und die Orga sieht alles
        data = json(await call(route.getSignups, ORGA)).data;
        expect(data.events).toHaveLength(2);
    });
});

describe("PUT /api/signups", () => {
    it("weist ein Event einer ausgeblendeten Spielversion mit 409 ab (#563)", async () => {
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("archived");
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(false);
        mockConfig = {};
    });

    it("schreibt nur die eigene Anmeldung, auch wenn der Body ein anderes Konto nennt", async () => {
        const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", userId: BERT.id, character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
        expect(status(res)).toBe(200);
        expect(json(res).data.signup).toMatchObject({ character: "Nerathil", specLabel: "Arkan", status: "signed" });
        expect(json(res).data.counts.dps).toEqual({ n: 1, target: 5 });
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(true);
        expect(mockSignups.has(`eh-kara/${BERT.id}`)).toBe(false);
    });

    it("weist Raid-Helper-Events mit 409 ab", async () => {
        const res = await call(route.putSignup, ANNA, { json: { eventId: "1400000000000000001", character: "Nerathil", spec: "Mage-Arcane" } });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("raidhelper");
    });

    it("weist ohne Raider-Rolle der Kategorie mit 403 ab – die Orga nicht", async () => {
        mockConfig = { categoryRoles: { "cat-kara": ["role-kara"] } };
        mockRoleIds = ["role-other"];
        profiles.addCharacter(ORGA.id, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] }, { name: "Orga" });
        const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
        expect(status(res)).toBe(403);
        expect(json(res).error).toEqual({ code: "raider_role", message: "Für diesen Raid brauchst du eine Raider-Rolle." });
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(false);

        const orga = await call(route.putSignup, ORGA, { json: { eventId: "eh-kara", character: "Brokk", spec: "Warrior-Protection", status: "signed" } });
        expect(status(orga)).toBe(200);

        mockRoleIds = ["role-kara"];
        expect(status(await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane" } }))).toBe(200);
    });

    it("weist außerhalb des Rosters mit 403 roster_only ab und markiert die Zeile vorab (#658)", async () => {
        const rosterStore = require("../../../src/stores/rosterStore");
        rosterStore.useFile(tempStoreFile("eh-signups-route-rosters.json"));
        try {
            const roster = rosterStore.createRoster({ name: "Kara", guildId: "g1", categoryId: "cat-kara", signupOnly: true });
            mockRoleIds = [];
            let rows = json(await call(route.getSignups, ANNA)).data.events;
            expect(rows.find((r) => r.id === "eh-kara").rosterOnly).toBe(true);
            const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("roster_only");
            expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(false);
            // the orga sees no lock
            rows = json(await call(route.getSignups, ORGA)).data.events;
            expect(rows.find((r) => r.id === "eh-kara").rosterOnly).toBe(false);
            // a trial member signs up
            rosterStore.upsertMember(roster.id, ANNA.id, { status: "trial" });
            rows = json(await call(route.getSignups, ANNA)).data.events;
            expect(rows.find((r) => r.id === "eh-kara").rosterOnly).toBe(false);
            expect(status(await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } }))).toBe(200);
        } finally {
            rosterStore.useFile(null);
        }
    });

    it("weist einen fremden Charakter ab", async () => {
        const res = await call(route.putSignup, BERT, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane" } });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("character");
    });

    it("verlangt ein Event", async () => {
        expect(status(await call(route.putSignup, ANNA, { json: {} }))).toBe(400);
    });

    it("verlangt die Nachricht bei Vielleicht/Absage, wo die Kategorie sie vorschreibt – die Orga nicht", async () => {
        mockConfig = { categorySignupNotes: { "cat-kara": "required" } };
        const bare = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", status: "absence", comment: " " } });
        expect(status(bare)).toBe(400);
        expect(json(bare).error.code).toBe("note_required");
        expect(status(await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", status: "absence", comment: "Urlaub" } }))).toBe(200);
        expect(status(await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } }))).toBe(200);
        expect(status(await call(route.putSignup, ORGA, { json: { eventId: "eh-kara", status: "absence" } }))).toBe(200);
    });

    it("sagt dem Dialog, ob die Kategorie eine Nachricht verlangt", async () => {
        mockConfig = { categorySignupNotes: { "cat-kara": "none" } };
        const res = await call(route.getSignups, ANNA);
        expect(json(res).data.events.find((e) => e.id === "eh-kara").noteMode).toBe("none");
    });

    it("nimmt mehrere eigene Charaktere in Reihenfolge an (#293)", async () => {
        profiles.addCharacter(ANNA.id, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
        const res = await call(route.putSignup, ANNA, { json: {
            eventId: "eh-kara", status: "signed",
            characters: [{ character: "Nerasol", spec: "Priest-Holy" }, { character: "Nerathil", spec: "Mage-Arcane" }],
        } });
        expect(status(res)).toBe(200);
        const { signup } = json(res).data;
        expect(signup).toMatchObject({ character: "Nerasol", specLabel: expect.any(String), role: "healer" });
        expect(signup.characters.map((c) => [c.character, c.spec, c.role])).toEqual([["Nerasol", "Priest-Holy", "healer"], ["Nerathil", "Mage-Arcane", "ranged"]]);
        expect(signup.characters[1]).toMatchObject({ className: "Mage", classColor: expect.any(String), specIcon: expect.any(String) });
        // each character carries its own status (the Discord buttons can move only the first)
        const mixed = await call(route.putSignup, ANNA, { json: {
            eventId: "eh-kara", status: "signed",
            characters: [{ character: "Nerasol", spec: "Priest-Holy", status: "late" }, { character: "Nerathil", spec: "Mage-Arcane" }],
        } });
        expect(json(mixed).data.signup.status).toBe("late");
        expect(json(mixed).data.signup.characters.map((c) => c.status)).toEqual(["late", "signed"]);
    });
});

describe("POST /api/signups/bulk (#293)", () => {
    beforeEach(() => {
        mockEvents.set("eh-ssc", { ...ownEvent, id: "eh-ssc", title: "SSC", categoryId: "cat-ssc" });
        mockEvents.set("eh-late", { ...ownEvent, id: "eh-late", title: "Vorbei", signupDeadline: Math.floor(Date.now() / 1000) - 60 });
    });

    it("meldet nur das eigene Konto für jeden gewählten Raid an und nennt je Raid das Ergebnis", async () => {
        const res = await call(route.postSignupsBulk, ANNA, { json: {
            eventIds: ["eh-kara", "eh-ssc", "eh-late", "eh-kara"], userId: BERT.id,
            characters: [{ character: "Nerathil", spec: "Mage-Arcane" }], status: "signed",
        } });
        expect(status(res)).toBe(200);
        const { results } = json(res).data;
        expect(results.map((r) => [r.eventId, r.ok, r.code])).toEqual([["eh-kara", true, ""], ["eh-ssc", true, ""], ["eh-late", false, "deadline"]]);
        expect(results[0].counts).toMatchObject({ attending: 1, accounts: 1 });
        expect(results[2]).toMatchObject({ signup: null, counts: null, error: expect.stringContaining("Anmeldeschluss") });
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(true);
        expect([...mockSignups.keys()].some((k) => k.endsWith(BERT.id))).toBe(false);
    });

    it("verlangt mindestens einen Raid", async () => {
        expect(status(await call(route.postSignupsBulk, ANNA, { json: { eventIds: [] } }))).toBe(400);
    });

    it("ist im Zugriffsplan für den Bereich Anmeldung eingetragen", () => {
        const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/signups/bulk"]).toBe("signup");
    });
});

describe("categoryVisible", () => {
    it("zeigt eine Kategorie, wenn die Rollen des Mitglieds unbekannt sind", () => {
        const config = { categoryRoles: { a: ["r1"] } };
        expect(categoryVisible("a", { config, roleIds: null })).toBe(true);
        expect(categoryVisible("a", { config, roleIds: [] })).toBe(false);
        expect(categoryVisible("a", { config, roleIds: ["r1"] })).toBe(true);
        expect(categoryVisible("b", { config: { categoryIds: ["a"] }, roleIds: [] })).toBe(false);
    });
});
