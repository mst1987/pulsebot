// „Anmeldungen“ über die API (src/web/apiRoutes/signups.js, src/web/signupView.js):
// nur die eigene Anmeldung, Raid-Helper-Events mit Discord-Link statt Anmeldung,
// Kategorien nach Raider-Rollen, und die Orga-Liste mit Kommentar und „kann auch“.
const os = require("os");
const path = require("path");

let mockUser = null;
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(() => mockUser),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: () => "g1" }));
let mockGroups = [];
jest.mock("../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(async () => ({ groups: mockGroups, error: null })) }));
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockRoleIds = null;
jest.mock("../../src/web/discord", () => ({
    memberRoleIds: jest.fn(async () => mockRoleIds),
    resolveUserNames: jest.fn(async () => ({ "200000000000000001": "anna_discord" })),
}));
jest.mock("../../src/web/eventSoftresStore", () => ({ getEventSoftres: () => null }));

const mockEvents = new Map();
jest.mock("../../src/web/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
const mockSignups = new Map();
jest.mock("../../src/web/signupStore", () => {
    const actual = jest.requireActual("../../src/web/signupStore");
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

const { readJsonBody } = require("../../src/web/apiBody");
const profiles = require("../../src/web/raiderProfileStore");
const route = require("../../src/web/apiRoutes/signups");
const { categoryVisible } = require("../../src/web/signupView");

const ANNA = { id: "200000000000000001", name: "Anna", isAdmin: false, access: { signup: { read: true, write: true } } };
const BERT = { id: "200000000000000002", name: "Bert", isAdmin: false, access: { signup: { read: true, write: true } } };
const ORGA = { id: "200000000000000009", name: "Orga", isAdmin: true, access: {} };
const future = Math.floor(Date.now() / 1000) + 3 * 86400;

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const body = (res) => JSON.parse(res.end.mock.calls[0][0]);
const status = (res) => res.writeHead.mock.calls[0][0];
async function call(handler, user, { json = {}, query = "" } = {}) {
    mockUser = user;
    readJsonBody.mockResolvedValue(json);
    const res = mockRes();
    await handler({}, res, new URL(`http://x/api?${query}`));
    return res;
}

const ownEvent = {
    id: "eh-kara", source: "eventhelper", guildId: "g1", title: "Karazhan PuG", startTime: future, channelId: "c1",
    categoryId: "cat-kara", versionId: "tbc", instanceIds: ["kara"], size: 10,
    composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, signupDeadline: future - 3600, wishes: true,
    message: { channelId: "c1", messageId: "m1" },
};

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

beforeAll(() => profiles.useFile(path.join(os.tmpdir(), `eh-signups-route-${process.pid}.json`)));
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
        const data = body(await call(route.getSignups, ANNA)).data;
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
    });

    it("zeigt einem Raider nie einen Setup-Entwurf, nur das freigegebene Setup (#263)", async () => {
        const slot = { userId: ANNA.id, character: "Nerathil", classId: "Mage", spec: "Mage-Arcane", role: "ranged" };
        mockEvents.set("eh-kara", { ...ownEvent, setup: { status: "draft", groups: [{ index: 3, slots: [{ ...slot, reasons: ["x"] }] }], bench: [], approved: null } });
        let data = body(await call(route.getSignups, ANNA)).data;
        expect(data.events[0].placement).toBeNull();
        expect(JSON.stringify(data)).not.toContain("\"index\":3");

        // a changed draft after an approval: the member keeps the approved group
        mockEvents.set("eh-kara", { ...ownEvent, setup: {
            status: "draft", changedSinceApproval: true, groups: [{ index: 3, slots: [slot] }], bench: [],
            approved: { version: 1, groups: [{ index: 2, slots: [slot] }], bench: [] },
        } });
        data = body(await call(route.getSignups, ANNA)).data;
        expect(data.events[0].placement).toEqual({ group: 2, character: "Nerathil", spec: "Mage-Arcane", role: "ranged" });
    });

    it("zeigt den eigenen Raid-Helper-Status", async () => {
        const data = body(await call(route.getSignups, BERT)).data;
        expect(data.events[1].mine).toEqual({ status: "signed", specName: "Arcane" });
    });

    it("blendet Kategorien mit Raider-Rollen aus, die das Mitglied nicht hat", async () => {
        mockConfig = { categoryIds: ["cat-kara", "cat-t5"], categoryRoles: { "cat-t5": ["role-t5"] } };
        mockRoleIds = ["role-other"];
        let data = body(await call(route.getSignups, ANNA)).data;
        expect(data.events.map((e) => e.id)).toEqual(["eh-kara"]);
        // …wer dort schon angemeldet ist, sieht das Event trotzdem
        data = body(await call(route.getSignups, BERT)).data;
        expect(data.events.map((e) => e.id)).toEqual(["eh-kara", "1400000000000000001"]);
        // …und die Orga sieht alles
        data = body(await call(route.getSignups, ORGA)).data;
        expect(data.events).toHaveLength(2);
    });
});

describe("PUT /api/signups", () => {
    it("schreibt nur die eigene Anmeldung, auch wenn der Body ein anderes Konto nennt", async () => {
        const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", userId: BERT.id, character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
        expect(status(res)).toBe(200);
        expect(body(res).data.signup).toMatchObject({ character: "Nerathil", specLabel: "Arkan", status: "signed" });
        expect(body(res).data.counts.dps).toEqual({ n: 1, target: 5 });
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(true);
        expect(mockSignups.has(`eh-kara/${BERT.id}`)).toBe(false);
    });

    it("weist Raid-Helper-Events mit 409 ab", async () => {
        const res = await call(route.putSignup, ANNA, { json: { eventId: "1400000000000000001", character: "Nerathil", spec: "Mage-Arcane" } });
        expect(status(res)).toBe(409);
        expect(body(res).error.code).toBe("raidhelper");
    });

    it("weist ohne Raider-Rolle der Kategorie mit 403 ab – die Orga nicht", async () => {
        mockConfig = { categoryRoles: { "cat-kara": ["role-kara"] } };
        mockRoleIds = ["role-other"];
        profiles.addCharacter(ORGA.id, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] }, { name: "Orga" });
        const res = await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", status: "signed" } });
        expect(status(res)).toBe(403);
        expect(body(res).error).toEqual({ code: "raider_role", message: "Für diesen Raid brauchst du eine Raider-Rolle." });
        expect(mockSignups.has(`eh-kara/${ANNA.id}`)).toBe(false);

        const orga = await call(route.putSignup, ORGA, { json: { eventId: "eh-kara", character: "Brokk", spec: "Warrior-Protection", status: "signed" } });
        expect(status(orga)).toBe(200);

        mockRoleIds = ["role-kara"];
        expect(status(await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane" } }))).toBe(200);
    });

    it("weist einen fremden Charakter ab", async () => {
        const res = await call(route.putSignup, BERT, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane" } });
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("character");
    });

    it("verlangt ein Event", async () => {
        expect(status(await call(route.putSignup, ANNA, { json: {} }))).toBe(400);
    });
});

describe("GET /api/signups/event", () => {
    it("liefert der Orga alle Anmeldungen mit Name, Kommentar und „kann auch“", async () => {
        await call(route.putSignup, ANNA, { json: { eventId: "eh-kara", character: "Nerathil", spec: "Mage-Arcane", canAlso: ["tank"], comment: "10 min später" } });
        const data = body(await call(route.getEventSignups, ORGA, { query: "id=eh-kara" })).data;
        expect(data.signups).toEqual([expect.objectContaining({
            userId: ANNA.id, name: "anna_discord", character: "Nerathil", className: "Mage", role: "ranged", canAlso: ["tank"], comment: "10 min später",
        })]);
    });

    it("antwortet 409 für ein Raid-Helper-Event und 404 für ein unbekanntes", async () => {
        expect(status(await call(route.getEventSignups, ORGA, { query: "id=1400000000000000001" }))).toBe(409);
        expect(status(await call(route.getEventSignups, ORGA, { query: "id=eh-weg" }))).toBe(404);
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
