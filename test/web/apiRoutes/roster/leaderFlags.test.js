// Leader-Flags (#1034) über den echten Router: eigene Flags in „Mein Profil“, die Orga setzt und
// entfernt Flags anderer (über den Raid oder das Roster) nur in ihrem Kontext und mischt sie in die
// übrigen, eine Kategorie-Orga einer fremden Kategorie bekommt 403, ein Roster eines anderen Servers
// gibt 404, und Orga oder Admin sein macht niemanden zum Leader.
let mockUser = null;
let mockRoleUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    getUserWithoutRank: jest.fn(() => mockRoleUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => ""),
}));
let mockGuild = "g1";
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => mockGuild) }));
let mockUntrusted = new Set();
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({
    ...jest.requireActual("../../../../src/services/discord/roles/guildRoles"),
    serverIsTrusted: jest.fn((guildId) => !mockUntrusted.has(guildId)),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
// cat1's TBC roster: managed by "mgr", members "m1" and "m2"; cat2's roster by "mgr2"
jest.mock("../../../../src/stores/roster/rosterStore", () => {
    const roster = (id, categoryId, versionId, managers, members, guildId = "g1") => ({
        id, categoryId, versionId, guildId, managers: { userIds: managers, roleIds: [] },
        members: Object.fromEntries(members.map((m) => [m, { status: "active" }])),
    });
    const rosters = {
        "cat1:tbc": roster("r1", "cat1", "tbc", ["mgr"], ["m1", "m2"]),
        "cat2:tbc": roster("r2", "cat2", "tbc", ["mgr2"], ["m3"]),
        // another server's roster (g2) and a roster without category
        "cat9:tbc": roster("r9", "cat9", "tbc", ["mgr"], ["m9"], "g2"),
        "-:tbc": roster("r0", "", "tbc", ["mgr"], ["m1"]),
    };
    return {
        listRosters: jest.fn(() => Object.values(rosters)),
        rosterForCategory: jest.fn((cat, version) => rosters[`${cat}:${version}`] || null),
        getRoster: jest.fn((id) => Object.values(rosters).find((r) => r.id === id) || null),
        isClosed: jest.fn(() => false),
    };
});
jest.mock("../../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../../src/services/versions/mainVersion"),
    versionOfEvent: jest.fn((event) => (event && event.versionId) || "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
}));
jest.mock("../../../../src/services/signups/eventVisibility", () => ({ userSeesEvent: jest.fn(async () => true) }));
jest.mock("../../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({})),
    avatarUrlFor: () => "",
    memberRoleIds: jest.fn(async () => []),
    // the server of a category (#925 server check of a roster path): both on g1
    getClient: () => ({ channels: { cache: new Map([["cat1", { guildId: "g1" }], ["cat2", { guildId: "g1" }]]) } }),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const eventStore = require("../../../../src/stores/events/eventStore");
const signupStore = require("../../../../src/stores/events/signupStore");
const profileStore = require("../../../../src/stores/roster/raiderProfileStore");
const leaderFlagsStore = require("../../../../src/stores/roster/leaderFlagsStore");
const { userCanLead } = require("../../../../src/services/roster/leaderFlags");
const { emptyAccess } = require("../../../../src/config/permissions");
const route = require("../../../../src/web/apiRoutes/roster/leaderFlags");
const auth = require("../../../../src/web/http/auth");
const { routerClient, status, body } = require("../../../helpers/http");

const api = routerClient(route);
const put = (path, payload) => api.request("PUT", path, payload);
const code = (r) => (body(r).error || {}).code;

const raiderAccess = () => ({ ...emptyAccess(), raids: { read: true, write: false }, signup: { read: true, write: true } });
const RAIDER = { id: "m1", name: "Raider", isAdmin: false, access: raiderAccess() };
const MANAGER = { id: "mgr", name: "Manager", isAdmin: false, access: raiderAccess() };
const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true }, signup: { read: true, write: true } } };
const ADMIN = { id: "admin", name: "Admin", isAdmin: true, isOrga: true, access: { ...emptyAccess(), raids: { read: true, write: true }, signup: { read: true, write: true } } };

let own;
let foreign;
function raid(categoryId, title) {
    const event = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId, title, versionId: "tbc", instanceIds: ["kara"],
        startTime: Math.floor(Date.now() / 1000) + 86400, size: 10,
    }).event;
    signupStore.saveSignup(event.id, "s1", { character: "S1", spec: "Mage-Fire", status: "signed" }, { versionId: "tbc" });
    return event;
}

beforeEach(() => {
    mockGuild = "g1";
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    profileStore.useFile(tempStoreFile("profiles.json"));
    leaderFlagsStore.useFile(tempStoreFile("leader-flags.json"));
    own = raid("cat1", "Karazhan");
    foreign = raid("cat2", "Gruul");
});

describe("PUT /api/profile/leads (eigene Flags)", () => {
    beforeEach(() => { mockUser = RAIDER; });

    it("setzt die eigenen Flags sofort und verwirft unbekannte Instanzen", async () => {
        const r = await put("/api/profile/leads", { versionId: "tbc", instances: ["kara", "gibtsnicht", "forever-hyjal"] });
        expect(status(r)).toBe(200);
        const tbc = body(r).leadVersions.find((v) => v.id === "tbc");
        expect(tbc.leads).toEqual(["kara"]);
        expect(tbc.by).toBe("m1");
        expect(tbc.instances.map((i) => i.id)).toContain("ssc");
        expect(userCanLead("m1", "tbc", ["kara"])).toBe(true);
    });

    it("lehnt eine Version ab, die das Profil nicht anbietet", async () => {
        const r = await put("/api/profile/leads", { versionId: "wotlk", instances: ["naxx"] });
        expect(status(r)).toBe(400);
        expect(code(r)).toBe("unknown_version");
    });

    it("schreibt nie in ein fremdes Konto", async () => {
        await put("/api/profile/leads", { versionId: "tbc", instances: ["kara"], userId: "m2" });
        expect(leaderFlagsStore.leadsOf("m2")).toEqual({});
    });
});

describe("PUT /api/leads (Orga für andere)", () => {
    it("die globale Orga setzt und entfernt das Flag eines Angemeldeten über den Raid", async () => {
        mockUser = ORGA;
        let r = await put("/api/leads", { event: foreign.id, userId: "s1", instances: ["kara"] });
        expect(status(r)).toBe(200);
        expect(body(r)).toMatchObject({ userId: "s1", versionId: "tbc", leads: ["kara"], editable: ["kara"], by: "orga" });
        expect(userCanLead("s1", "tbc", ["kara"])).toBe(true);

        r = await put("/api/leads", { event: foreign.id, userId: "s1", instances: [] });
        expect(status(r)).toBe(200);
        expect(body(r).leads).toEqual([]);
        expect(leaderFlagsStore.leadsOf("s1")).toEqual({});
    });

    it("die Kategorie-Orga setzt Flags in ihrer Kategorie (Raid und Roster)", async () => {
        mockUser = MANAGER;
        let r = await put("/api/leads", { event: own.id, userId: "m2", instances: ["kara"] });
        expect(status(r)).toBe(200);
        r = await put("/api/leads", { rosterId: "r1", userId: "m1", instances: ["kara"] });
        expect(status(r)).toBe(200);
        expect(leaderFlagsStore.leadsOf("m1").tbc).toMatchObject({ instances: ["kara"], by: "mgr" });
    });

    it("schaltet nur die Instanzen ihres Kontexts und lässt die übrigen Flags stehen (Merge)", async () => {
        leaderFlagsStore.setLeads("m1", "tbc", ["ssc", "tk"], { by: "m1" });
        mockUser = MANAGER;
        let r = await put("/api/leads", { event: own.id, userId: "m1", instances: ["kara"] });
        expect(status(r)).toBe(200);
        expect(body(r).leads).toEqual(["kara", "ssc", "tk"]);
        r = await put("/api/leads", { event: own.id, userId: "m1", instances: [] });
        expect(status(r)).toBe(200);
        expect(leaderFlagsStore.leadsOf("m1").tbc.instances).toEqual(["ssc", "tk"]);
    });

    it("lehnt eine Instanz außerhalb des Kontexts mit 400 ab, und nichts ändert sich", async () => {
        leaderFlagsStore.setLeads("m1", "tbc", ["ssc"], { by: "m1" });
        mockUser = ORGA;
        let r = await put("/api/leads", { event: own.id, userId: "m1", instances: ["kara", "ssc"] });
        expect(status(r)).toBe(400);
        expect(code(r)).toBe("outside_context");
        r = await put("/api/leads", { rosterId: "r1", userId: "m1", instances: ["gruul"] });
        expect(status(r)).toBe(400);
        expect(code(r)).toBe("outside_context");
        expect(leaderFlagsStore.leadsOf("m1").tbc).toMatchObject({ instances: ["ssc"], by: "m1" });
    });

    it("ein Roster ohne Kategorie hat keinen Kontext (400 no_context)", async () => {
        mockUser = ORGA;
        const r = await put("/api/leads", { rosterId: "r0", userId: "m1", instances: [] });
        expect(status(r)).toBe(400);
        expect(code(r)).toBe("no_context");
    });

    it("ein Roster eines anderen Servers gibt 404 und verrät keine Mitglieder", async () => {
        mockUser = ORGA;
        for (const userId of ["m9", "fremd"]) {
            const r = await put("/api/leads", { rosterId: "r9", userId, instances: [] });
            expect(status(r)).toBe(404);
            expect(code(r)).toBe("not_found");
        }
        mockGuild = "g2";
        const r = await put("/api/leads", { rosterId: "r1", userId: "m1", instances: ["kara"] });
        expect(status(r)).toBe(404);
        expect(code(r)).toBe("not_found");
        expect(leaderFlagsStore.allLeads()).toEqual({});
    });

    it("ein Manager bekommt den Roster eines anderen Servers nicht einmal über die Kategorie", async () => {
        mockUser = MANAGER;
        const r = await put("/api/leads", { rosterId: "r9", userId: "m9", instances: [] });
        expect([403, 404]).toContain(status(r));
        expect(leaderFlagsStore.allLeads()).toEqual({});
    });

    it("gibt einer Kategorie-Orga einer fremden Kategorie 403, und nichts ändert sich", async () => {
        mockUser = MANAGER;
        let r = await put("/api/leads", { event: foreign.id, userId: "s1", instances: ["kara"] });
        expect(status(r)).toBe(403);
        expect(code(r)).toBe("not_category_orga");
        r = await put("/api/leads", { rosterId: "r2", userId: "m3", instances: ["kara"] });
        expect(status(r)).toBe(403);
        expect(leaderFlagsStore.allLeads()).toEqual({});
    });

    it("ein Raider ohne Orga-Recht bekommt nichts", async () => {
        mockUser = RAIDER;
        const r = await put("/api/leads", { event: own.id, userId: "m2", instances: ["kara"] });
        expect(status(r)).toBe(403);
        expect(leaderFlagsStore.allLeads()).toEqual({});
    });

    // Die Flags gelten je Konto und Version auf jedem Server (setupInput): der Rang allein setzt keine.
    describe("mit dem Server-Admin-Rang (#1072)", () => {
        const rank = (id) => ({ id, name: "Rang", isAdmin: false, isOrga: true, isServerAdmin: true, access: { ...emptyAccess(), raids: { read: true, write: true }, signup: { read: true, write: true } } });

        it("gibt 403, wenn nur der Rang das Recht gibt, über den Raid und das Roster", async () => {
            mockUser = rank("ohne");
            mockRoleUser = { id: "ohne", isAdmin: false, access: emptyAccess() };
            for (const payload of [{ event: own.id, userId: "m2", instances: ["kara"] }, { rosterId: "r1", userId: "m1", instances: ["kara"] }]) {
                const r = await put("/api/leads", payload);
                expect(status(r)).toBe(403);
                expect(code(r)).toBe("forbidden");
            }
            expect(leaderFlagsStore.allLeads()).toEqual({});
        });

        it("gibt 403, wenn die Rolle das Recht ohne Orga-Rang gibt", async () => {
            mockUser = rank("bereich");
            mockRoleUser = { id: "bereich", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true } } };
            expect(status(await put("/api/leads", { event: own.id, userId: "m2", instances: ["kara"] }))).toBe(403);
            expect(leaderFlagsStore.allLeads()).toEqual({});
        });

        it("lässt eine Orga-Rolle mit Schreibrecht durch", async () => {
            mockUser = rank("orga");
            mockRoleUser = { ...ORGA };
            expect(status(await put("/api/leads", { event: own.id, userId: "m2", instances: ["kara"] }))).toBe(200);
            expect(userCanLead("m2", "tbc", ["kara"])).toBe(true);
        });

        it("lässt den Manager seiner Kategorie durch, aber nur dort", async () => {
            mockUser = rank("mgr");
            mockRoleUser = { ...MANAGER };
            expect(status(await put("/api/leads", { rosterId: "r1", userId: "m2", instances: ["kara"] }))).toBe(200);
            expect(userCanLead("m2", "tbc", ["kara"])).toBe(true);
            expect(status(await put("/api/leads", { event: foreign.id, userId: "s1", instances: ["kara"] }))).toBe(403);
            expect(userCanLead("s1", "tbc", ["kara"])).toBe(false);
        });
    });

    // Der Schalter in Roster und Setup zeigt nur, was PUT /api/leads durchlässt.
    describe("mayOfferLeads", () => {
        const RANG = { ...ORGA, id: "rang", isServerAdmin: true };
        const req = { headers: {} };
        const SCOPE = { categoryId: "cat1" };
        afterEach(() => {
            mockUntrusted = new Set();
            mockRoleUser = null;
        });

        it("bietet dem Rang ohne Rolle nichts an, auf einem Server mit Marke", async () => {
            mockRoleUser = { id: RANG.id, isAdmin: false, access: emptyAccess() };
            expect(await route.mayOfferLeads(RANG, req, SCOPE)).toBe(false);
        });

        it("bietet dem Rang mit Orga-Rolle und dem Rang als Manager den Schalter an", async () => {
            mockRoleUser = { ...ORGA, id: RANG.id };
            expect(await route.mayOfferLeads(RANG, req, SCOPE)).toBe(true);
            mockRoleUser = { ...MANAGER };
            expect(await route.mayOfferLeads({ ...RANG, id: MANAGER.id }, req, SCOPE)).toBe(true);
        });

        it("bietet der Orga ohne Rang den Schalter an, ohne nach den Rollen zu fragen", async () => {
            auth.getUserWithoutRank.mockClear();
            expect(await route.mayOfferLeads(ORGA, req, SCOPE)).toBe(true);
            expect(auth.getUserWithoutRank.mock.calls.filter(([r]) => r === req).length).toBeLessThanOrEqual(1);
        });

        it("bietet auf einem Server ohne Marke nur dem Voll-Admin etwas an", async () => {
            mockUntrusted = new Set(["g1"]);
            // there the roles count for nothing, also in the account without the rank
            mockRoleUser = { id: ORGA.id, isAdmin: false, access: emptyAccess() };
            expect(await route.mayOfferLeads(ORGA, req, SCOPE)).toBe(false);
            expect(await route.mayOfferLeads(RANG, req, SCOPE)).toBe(false);
            expect(await route.mayOfferLeads(ADMIN, req, SCOPE)).toBe(true);
        });
    });

    // Die Flags gelten auf jedem Server: Rollen und Manager eines Servers ohne Marke schreiben sie nicht.
    describe("auf einem Server ohne Marke (#1105)", () => {
        const rosterStore = require("../../../../src/stores/roster/rosterStore");
        const discord = require("../../../../src/services/discord/discord");
        const RANK = { ...ORGA, id: "rang", isServerAdmin: true };

        beforeEach(() => { mockUntrusted = new Set(["g1"]); });
        afterEach(() => { mockUntrusted = new Set(); });

        it("gibt dem Manager eines Rosters 403, über das Roster und über den Raid", async () => {
            mockUser = MANAGER;
            for (const payload of [{ rosterId: "r1", userId: "m2", instances: ["kara"] }, { event: own.id, userId: "s1", instances: ["kara"] }]) {
                const r = await put("/api/leads", payload);
                expect(status(r)).toBe(403);
                expect(code(r)).toBe("forbidden");
            }
            expect(leaderFlagsStore.allLeads()).toEqual({});
        });

        // Ein eigenes Recht vergibt nur ein Voll-Admin: das ist keine selbst gegebene Rolle.
        it("lässt ein eigenes Recht auf raids durch, ohne eigenes Recht nicht", async () => {
            mockUser = MANAGER;
            mockRoleUser = { id: MANAGER.id, isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: true } } };
            try {
                expect(status(await put("/api/leads", { rosterId: "r1", userId: "m2", instances: ["kara"] }))).toBe(200);
                expect(userCanLead("m2", "tbc", ["kara"])).toBe(true);
            } finally {
                mockRoleUser = null;
                leaderFlagsStore.setLeads("m2", "tbc", []);
            }
        });

        describe("wenn eine Rolle das Roster verwaltet (managers.roleIds)", () => {
            let managed;
            beforeEach(() => {
                managed = rosterStore.getRoster("r2");
                managed.managers.roleIds = ["role-mgr"];
                discord.memberRoleIds.mockResolvedValue(["role-mgr"]);
                mockUser = { ...RAIDER, id: "traeger" };
            });
            afterEach(() => {
                managed.managers.roleIds = [];
                discord.memberRoleIds.mockResolvedValue([]);
            });

            it("gibt 403", async () => {
                const r = await put("/api/leads", { rosterId: "r2", userId: "m3", instances: ["kara"] });
                expect(status(r)).toBe(403);
                expect(code(r)).toBe("forbidden");
                expect(leaderFlagsStore.allLeads()).toEqual({});
            });

            it("öffnet die Route auf einem Server mit Marke wie bisher", async () => {
                mockUntrusted = new Set();
                expect(status(await put("/api/leads", { rosterId: "r2", userId: "m3", instances: ["kara"] }))).toBe(200);
                expect(userCanLead("m3", "tbc", ["kara"])).toBe(true);
            });
        });

        // getUserWithoutRank lässt die Rollen dort weg (auth.test.js), hier also nur der Basiszugang.
        it("gibt der Orga-Rolle 403, mit und ohne Rang", async () => {
            mockRoleUser = { id: ORGA.id, isAdmin: false, access: emptyAccess() };
            for (const user of [ORGA, RANK]) {
                mockUser = user;
                expect(status(await put("/api/leads", { event: own.id, userId: "s1", instances: ["kara"] }))).toBe(403);
            }
            expect(leaderFlagsStore.allLeads()).toEqual({});
        });

        it("lässt den Voll-Admin durch", async () => {
            mockUser = ADMIN;
            expect(status(await put("/api/leads", { event: own.id, userId: "s1", instances: ["kara"] }))).toBe(200);
            expect(userCanLead("s1", "tbc", ["kara"])).toBe(true);
        });

        it("lässt die eigenen Flags in „Mein Profil“ offen", async () => {
            mockUser = RAIDER;
            expect(status(await put("/api/profile/leads", { versionId: "tbc", instances: ["kara"] }))).toBe(200);
            expect(userCanLead("m1", "tbc", ["kara"])).toBe(true);
        });

        it("gilt je Server: die Marke des aktiven Servers entscheidet", async () => {
            mockUntrusted = new Set(["g2"]);
            mockUser = MANAGER;
            expect(status(await put("/api/leads", { rosterId: "r1", userId: "m2", instances: ["kara"] }))).toBe(200);
        });
    });

    it("nur für Konten, die zum Raid oder Roster gehören", async () => {
        mockUser = ORGA;
        let r = await put("/api/leads", { event: own.id, userId: "fremd", instances: ["kara"] });
        expect(status(r)).toBe(404);
        expect(code(r)).toBe("not_member");
        r = await put("/api/leads", { event: own.id, instances: ["kara"] });
        expect(status(r)).toBe(400);
        r = await put("/api/leads", { event: "gibtsnicht", userId: "s1", instances: ["kara"] });
        expect(status(r)).toBe(404);
    });

    it("Orga oder Admin sein macht niemanden zum Leader", async () => {
        mockUser = ADMIN;
        await put("/api/leads", { event: own.id, userId: "m1", instances: ["kara"] });
        expect(userCanLead("admin", "tbc", ["kara"])).toBe(false);
        expect(userCanLead("orga", "tbc", [])).toBe(false);
        expect(userCanLead("mgr", "tbc", [])).toBe(false);
    });
});
