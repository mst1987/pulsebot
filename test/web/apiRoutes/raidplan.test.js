// The raid plan API (src/web/apiRoutes/raidplan.js): the area gate, the editor's
// payload, saving with the version check, publishing, map upload, profiles and
// the public read view. The stores are real, on scratch files.
let mockUser = null;
let mockViewer = null;
jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/auth", () => ({ getUser: jest.fn(() => mockViewer) }));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh_")),
}));

const { readJsonBody, readRawBody } = require("../../../src/web/apiBody");
const { requireCsrf } = require("../../../src/web/apiMiddleware");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");
const store = require("../../../src/stores/raidplanStore");
const profiles = require("../../../src/stores/raidplanProfileStore");
const route = require("../../../src/web/apiRoutes/raidplan");
const { checkAccess, areasFor, UNGATED } = require("../../../src/web/apiAccess");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const MEMBER = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

const person = (userId, character, spec, role) => ({ userId, character, spec, role });
const APPROVED = {
    version: 1, approvedAt: 1, approvedBy: "orga",
    groups: [{ index: 1, slots: [person("u1", "Tanky", "Warrior-Protection", "tank"), person("u2", "Heally", "Priest-Holy", "healer")] }],
    bench: [person("u3", "Benchy", "Mage-Fire", "ranged")],
};

function eventWith(setup) {
    return ownEvent({ id: "eh_1", title: "Black Temple", startTime: 1800000000, instanceIds: ["bt"], setup });
}

const { mockRes, status, json } = require("../../helpers/http");
const body = (r) => { const p = json(r); return p.data || p.error; };

async function call(handler, user, payload, query = "") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raidplan${query ? `?${query}` : ""}`));
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("raidplans.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    mockViewer = null;
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents.eh_1 = eventWith({ groups: [{ index: 1, slots: [person("u1", "Tanky", "Warrior-Protection", "tank"), person("u9", "Drafty", "Rogue-Combat", "melee")] }], bench: [], approved: APPROVED });
});
afterAll(() => {
    store.useFile();
    profiles.useFile();
});

describe("access", () => {
    it("puts every path under raids, the public view under nothing but the token", () => {
        for (const p of ["/api/raidplan", "/api/raidplan/publish", "/api/raidplan/map", "/api/raidplan/map/delete", "/api/raidplan/profiles"]) {
            expect(areasFor(p)).toEqual(["raids"]);
            expect(checkAccess(p, "GET", READER)).toBeNull();
            expect(checkAccess(p, "PUT", READER)).toMatchObject({ status: 403 });
            expect(checkAccess(p, "POST", ORGA)).toBeNull();
            expect(checkAccess(p, "GET", MEMBER)).toMatchObject({ status: 403 });
            expect(checkAccess(p, "GET", null)).toMatchObject({ status: 401 });
        }
        expect(UNGATED.has("/api/raidplan/public")).toBe(true);
        expect(checkAccess("/api/raidplan/public", "GET", null)).toBeNull();
    });
});

describe("GET /api/raidplan", () => {
    it("hands the editor the bosses, the current lineup (draft first) and the empty plan", async () => {
        const r = await call(route.getPlan, ORGA, null, "event=eh_1");
        expect(status(r)).toBe(200);
        const d = body(r);
        expect(d.canWrite).toBe(true);
        expect(d.plan).toMatchObject({ version: 0, status: "draft", publicPath: "", bosses: {} });
        expect(d.bosses[0]).toMatchObject({ key: "general" });
        expect(d.bosses[1]).toMatchObject({ key: "bt/high-warlord-najentus", mapUrl: "" });
        expect(d.roster.map((p) => p.userId)).toEqual(["u1", "u9"]);
        expect(d.roster[0]).toMatchObject({ character: "Tanky", role: "tank", classColor: "#C79C6E", group: 1 });
        expect(d.roster[0].iconUrl).toMatch(/^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\//);
        expect(d.hasApprovedSetup).toBe(true);
        expect(d.profiles).toEqual([]);
    });

    it("falls back to the approved lineup and tells a reader they may not write", async () => {
        mockEvents.eh_1 = eventWith({ approved: APPROVED });
        const d = body(await call(route.getPlan, READER, null, "event=eh_1"));
        expect(d.canWrite).toBe(false);
        expect(d.roster.map((p) => p.userId)).toEqual(["u1", "u2", "u3"]);
    });

    it("has no players and a hint without any setup, and no bosses without an instance", async () => {
        mockEvents.eh_1 = { ...eventWith(null), instanceIds: [] };
        const d = body(await call(route.getPlan, ORGA, null, "event=eh_1"));
        expect(d.roster).toEqual([]);
        expect(d.hasApprovedSetup).toBe(false);
        expect(d.bosses).toEqual([]);
    });

    it("answers 409 for a Raid-Helper event and 404 for a missing one", async () => {
        expect(status(await call(route.getPlan, ORGA, null, "event=12345"))).toBe(409);
        expect(status(await call(route.getPlan, ORGA, null, "event=eh_nope"))).toBe(404);
    });

    it("shows the url of the boss map or of the instance map", async () => {
        store.saveMap("bt", PNG);
        store.saveMap("bt/supremus", PNG);
        const d = body(await call(route.getPlan, ORGA, null, "event=eh_1"));
        expect(d.bosses.find((b) => b.key === "bt/high-warlord-najentus")).toMatchObject({ mapUrl: expect.stringMatching(/^\/rp-map\/bt\?v=\d+$/), ownMap: false, instanceMap: true });
        expect(d.bosses.find((b) => b.key === "bt/supremus")).toMatchObject({ mapUrl: expect.stringMatching(/^\/rp-map\/bt\/supremus\?v=\d+$/), ownMap: true });
    });
});

describe("PUT /api/raidplan", () => {
    const tokens = [{ userId: "u1", x: 0.3, y: 0.4 }, { userId: "u2", x: 0.5, y: 0.5 }];

    it("saves for players of the current lineup only and answers with the new version", async () => {
        const r = await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: { "bt/supremus": { tokens, targets: [{ title: "MT", userIds: ["u1", "u9"] }] } } });
        expect(status(r)).toBe(200);
        const d = body(r);
        expect(d.plan.version).toBe(1);
        // u2 is only in the approved setup, not in the draft the editor works on
        expect(d.plan.bosses["bt/supremus"].tokens.map((t) => t.userId)).toEqual(["u1"]);
        expect(d.plan.bosses["bt/supremus"].targets[0].userIds).toEqual(["u1", "u9"]);
        expect(d.dropped).toBe(1);
    });

    it("answers 409 on a stale version and 400 on a malformed plan", async () => {
        await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: {} });
        const stale = await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: {} });
        expect(status(stale)).toBe(409);
        expect(body(stale).code).toBe("conflict");
        expect(status(await call(route.putPlan, ORGA, { event: "eh_1", version: 1, bosses: "x" }))).toBe(400);
    });

    it("refuses a reader, a missing CSRF token and a foreign event", async () => {
        expect(status(await call(route.putPlan, READER, { event: "eh_1", version: 0, bosses: {} }))).toBe(403);
        requireCsrf.mockReturnValueOnce(false);
        const r = await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: {} });
        expect(r.writeHead).not.toHaveBeenCalled();
        expect(store.getPlan("eh_1")).toBeNull();
        expect(status(await call(route.putPlan, ORGA, { event: "999", version: 0, bosses: {} }))).toBe(409);
    });

    it("only keeps a profile id that exists", async () => {
        const { profile } = profiles.createProfile({ name: "Tanks" });
        const d = body(await call(route.putPlan, ORGA, {
            event: "eh_1", version: 0,
            bosses: { "bt/supremus": { profileId: profile.id }, "bt/shade-of-akama": { profileId: "ghost", notes: "x" } },
        }));
        expect(d.plan.bosses["bt/supremus"].profileId).toBe(profile.id);
        expect(d.plan.bosses["bt/shade-of-akama"].profileId).toBe("");
    });
});

describe("publishing", () => {
    it("publishes with a link, withdraws it and rotates it", async () => {
        const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
        expect(on.plan.status).toBe("published");
        expect(on.plan.publicPath).toMatch(/^\/p\/[A-Za-z0-9_-]{16,}$/);
        const off = body(await call(route.postPublish, ORGA, { event: "eh_1", published: false }));
        expect(off.plan.status).toBe("draft");
        expect(off.plan.publicPath).toBe(on.plan.publicPath);
        const rotated = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true, rotate: true }));
        expect(rotated.plan.publicPath).not.toBe(on.plan.publicPath);
    });

    it("needs write access", async () => {
        expect(status(await call(route.postPublish, READER, { event: "eh_1", published: true }))).toBe(403);
        expect(store.getPlan("eh_1")).toBeNull();
    });
});

describe("room map upload", () => {
    const upload = async (user, key, buffer) => {
        mockUser = user;
        readRawBody.mockResolvedValue(buffer);
        const r = mockRes();
        await route.postMap({ headers: {} }, r, new URL(`http://x/api/raidplan/map?key=${encodeURIComponent(key)}`));
        return r;
    };

    it("stores a real image and removes it again", async () => {
        expect(status(await upload(ORGA, "bt/supremus", PNG))).toBe(200);
        expect(store.readMap("bt/supremus").mime).toBe("image/png");
        const r = await call(route.postMapDelete, ORGA, { key: "bt/supremus" });
        expect(body(r)).toMatchObject({ removed: true });
        expect(store.readMap("bt/supremus")).toBeNull();
    });

    it("refuses other files, huge files, unknown keys and readers", async () => {
        expect(status(await upload(ORGA, "bt/supremus", Buffer.from("<svg onload=alert(1)></svg>")))).toBe(400);
        expect(status(await upload(ORGA, "bt/supremus", null))).toBe(413);
        expect(status(await upload(ORGA, "../../x", PNG))).toBe(400);
        expect(status(await upload(READER, "bt/supremus", PNG))).toBe(403);
        expect(store.readMap("bt/supremus")).toBeNull();
        expect(status(await call(route.postMapDelete, ORGA, { key: "nope" }))).toBe(400);
    });
});

describe("tactic profiles", () => {
    it("creates, lists, renames and deletes", async () => {
        const created = body(await call(route.postProfile, ORGA, { name: "Tanks", category: "Tank", targets: [{ title: "MT" }] }));
        expect(created.profile).toMatchObject({ name: "Tanks", category: "Tank" });
        expect(created.categories).toEqual(["Tank"]);
        const list = body(await call(route.getProfiles, READER));
        expect(list.profiles).toHaveLength(1);
        const renamed = body(await call(route.patchProfile, ORGA, { id: created.profile.id, name: "Tanks P2" }));
        expect(renamed.profile.name).toBe("Tanks P2");
        expect(status(await call(route.deleteProfile, ORGA, { id: created.profile.id }))).toBe(200);
        expect(status(await call(route.deleteProfile, ORGA, { id: created.profile.id }))).toBe(404);
        expect(status(await call(route.patchProfile, ORGA, { id: "nope", name: "x" }))).toBe(404);
    });

    it("answers 400 for a bad profile and refuses a reader", async () => {
        expect(status(await call(route.postProfile, ORGA, { name: "" }))).toBe(400);
        expect(status(await call(route.postProfile, READER, { name: "x" }))).toBe(403);
        expect(profiles.listProfiles()).toEqual([]);
    });

    it("also arrives in the editor payload", async () => {
        profiles.createProfile({ name: "Heiler", category: "Heiler" });
        expect(body(await call(route.getPlan, ORGA, null, "event=eh_1")).profiles).toHaveLength(1);
    });
});

describe("GET /api/raidplan/public", () => {
    async function publish() {
        await call(route.putPlan, ORGA, {
            event: "eh_1", version: 0,
            bosses: {
                "bt/supremus": {
                    tokens: [{ userId: "u1", x: 0.2, y: 0.3 }, { userId: "u9", x: 0.6, y: 0.6 }],
                    targets: [{ title: "Main-Tank", userIds: ["u1", "u9"] }], notes: "Hi",
                },
            },
        });
        const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
        return on.plan.publicPath.replace("/p/", "");
    }

    const publicGet = async (token, viewer = null) => {
        mockViewer = viewer;
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${token}`));
        return r;
    };

    it("needs no login and names only what the approved setup knows (never a draft)", async () => {
        const token = await publish();
        const r = await publicGet(token);
        expect(status(r)).toBe(200);
        const d = body(r);
        expect(d.event).toEqual({ title: "Black Temple", startTime: 1800000000 });
        expect(d.bosses).toHaveLength(1);
        expect(d.bosses[0]).toMatchObject({ key: "bt/supremus", name: "Supremus", notes: "Hi", profileName: "" });
        // u9 exists only in the draft: not on the public page, on no row
        expect(d.bosses[0].tokens.map((t) => t.userId)).toEqual(["u1"]);
        // the old task rows are handed out as assignments: title = the task, the player who is in the approved setup = the assignee
        expect(d.bosses[0].targets).toEqual([]);
        expect(d.bosses[0].assignments[0]).toMatchObject({ type: "other", assignees: ["user:u1"] });
        expect(d.roster.map((p) => p.userId)).toEqual(["u1"]);
        expect(JSON.stringify(d)).not.toContain("Drafty");
        expect(d).toMatchObject({ me: "", loggedIn: false });
    });

    it("marks the viewer's own token when they are logged in and in the plan", async () => {
        const token = await publish();
        expect(body(await publicGet(token, { id: "u1" }))).toMatchObject({ me: "u1", loggedIn: true });
        expect(body(await publicGet(token, { id: "outsider" }))).toMatchObject({ me: "", loggedIn: true });
    });

    it("shows the name of the profile the board was built from", async () => {
        const { profile } = profiles.createProfile({ name: "Tanks P1" });
        await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: { "bt/supremus": { profileId: profile.id, notes: "x" } } });
        const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
        expect(body(await publicGet(on.plan.publicPath.replace("/p/", ""))).bosses[0].profileName).toBe("Tanks P1");
    });

    it("answers one and the same 404 for unknown, malformed, withdrawn and orphaned tokens", async () => {
        const token = await publish();
        for (const bad of ["", "x", "aaaaaaaaaaaaaaaaaaaaaaaa"]) expect(status(await publicGet(bad))).toBe(404);
        await call(route.postPublish, ORGA, { event: "eh_1", published: false });
        const withdrawn = await publicGet(token);
        expect(status(withdrawn)).toBe(404);
        await call(route.postPublish, ORGA, { event: "eh_1", published: true });
        delete mockEvents.eh_1;
        const orphan = await publicGet(token);
        expect(status(orphan)).toBe(404);
        expect(orphan.end.mock.calls[0][0]).toBe(withdrawn.end.mock.calls[0][0]);
    });

    describe("sections left out of the sheet", () => {
        async function publishTwo(flags) {
            await call(route.putPlan, ORGA, {
                event: "eh_1", version: 0,
                bosses: {
                    "bt/supremus": { tokens: [{ userId: "u1", x: 0.2, y: 0.3 }], notes: "BOSS-SECRET-NOTE", ...(flags.boss || {}) },
                    "bt/trash": { notes: "TRASH-SECRET-NOTE", texts: [{ text: "TRASH-TEXT", x: 0.5, y: 0.5 }], ...(flags.trash || {}) },
                },
            });
            const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
            return on.plan.publicPath.replace("/p/", "");
        }

        it("delivers every section by default (a plan from before the switch: all in)", async () => {
            const d = body(await publicGet(await publishTwo({})));
            expect(d.bosses.map((b) => b.key)).toEqual(["bt/supremus", "bt/trash"]);
            expect(d.hiddenCount).toBe(0);
        });

        it("does not deliver an excluded section at all: no chip, no notes, no objects, no players", async () => {
            const d = body(await publicGet(await publishTwo({ trash: { inSheet: false } })));
            expect(d.bosses.map((b) => b.key)).toEqual(["bt/supremus"]);
            expect(d.hiddenCount).toBe(1);
            const text = JSON.stringify(d);
            expect(text).not.toContain("TRASH-SECRET-NOTE");
            expect(text).not.toContain("TRASH-TEXT");
            expect(text).toContain("BOSS-SECRET-NOTE");
        });

        it("a player only an excluded section names is not in the public roster", async () => {
            const d = body(await publicGet(await publishTwo({ boss: { inSheet: false } })));
            expect(d.bosses.map((b) => b.key)).toEqual(["bt/trash"]);
            expect(d.roster).toEqual([]);
            expect(JSON.stringify(d)).not.toContain("BOSS-SECRET-NOTE");
        });

        it("all sections excluded: nothing is delivered, only how many are held back", async () => {
            const d = body(await publicGet(await publishTwo({ boss: { inSheet: false }, trash: { inSheet: false } })));
            expect(d.bosses).toEqual([]);
            expect(d.roster).toEqual([]);
            expect(d.hiddenCount).toBe(2);
            expect(JSON.stringify(d)).not.toContain("SECRET");
        });

        it("the editor still gets the excluded section with all its data", async () => {
            await publishTwo({ trash: { inSheet: false } });
            const v = body(await call(route.getPlan, ORGA, null, "event=eh_1"));
            expect(v.plan.bosses["bt/trash"]).toMatchObject({ inSheet: false, notes: "TRASH-SECRET-NOTE" });
        });
    });

    describe("a section without its map", () => {
        async function publishMap(showMap) {
            await call(route.putPlan, ORGA, {
                event: "eh_1", version: 0,
                bosses: { "bt/supremus": { showMap, tokens: [{ userId: "u1", x: 0.2, y: 0.3 }], texts: [{ text: "MAP-TEXT", x: 0.5, y: 0.5 }], notes: "Hi", autoPos: { "t:r1:1": { x: 0.25, y: 0.75 } }, autoStyle: { "t:r1:1": { size: 19 } }, autoScale: 0.5 } },
            });
            const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
            return body(await publicGet(on.plan.publicPath.replace("/p/", ""))).bosses[0];
        }

        it("sends the map and its objects while it is shown", async () => {
            const b = await publishMap(true);
            expect(b.showMap).toBe(true);
            expect(b.tokens).toHaveLength(1);
            // the page derives what the tank rows put on the map: it gets the switch and the moved positions
            expect(b).toMatchObject({ autoPlace: true, autoPos: { "t:r1:1": { x: 0.25, y: 0.75 } }, autoStyle: { "t:r1:1": { size: 19 } }, autoScale: 0.5 });
            expect(JSON.stringify(b)).toContain("MAP-TEXT");
        });

        it("sends no map url and no objects when it is hidden, the rest of the section stays", async () => {
            const b = await publishMap(false);
            expect(b).toMatchObject({ key: "bt/supremus", showMap: false, mapUrl: "", notes: "Hi", tokens: [], marks: [], icons: [], zones: [], lines: [], texts: [], autoPos: {}, autoStyle: {} });
            expect(JSON.stringify(b)).not.toContain("MAP-TEXT");
            // the editor still holds the objects
            const v = body(await call(route.getPlan, ORGA, null, "event=eh_1"));
            expect(v.plan.bosses["bt/supremus"]).toMatchObject({ showMap: false, tokens: [{ userId: "u1" }] });
        });
    });

    it("a role group names every raider of that role for the page (\"Meine Aufgaben\"), a flex role on the boss wins; the flex roles go along", async () => {
        await call(route.putPlan, ORGA, { event: "eh_1", version: 0, bosses: { "bt/supremus": { assignments: [{ id: "a", type: "other", assignees: ["role:ranged"], targets: [] }], roles: { u1: "ranged" } } } });
        const on = body(await call(route.postPublish, ORGA, { event: "eh_1", published: true }));
        const d = body(await publicGet(on.plan.publicPath.replace("/p/", "")));
        // u3 is ranged by spec, u1 a tank who plays ranged here; u2 (healer) is not named
        expect(d.roster.map((p) => p.userId).sort()).toEqual(["u1", "u3"]);
        expect(d.bosses[0].roles).toEqual({ u1: "ranged" });
        expect(d.bosses[0].assignments[0].assignees).toEqual(["role:ranged"]);
    });

    it("leaves out bosses nobody planned", async () => {
        const token = await publish();
        expect(body(await publicGet(token)).bosses.map((b) => b.key)).toEqual(["bt/supremus"]);
    });
});

describe("what a raider counts as", () => {
    const { resolveRole } = require("../../../src/web/raidplan");
    const spec = (role) => ({ role });

    it("takes the placed role when it is one of the four, else the spec's, else dps", () => {
        expect(resolveRole("melee", spec("ranged"))).toBe("melee");
        expect(resolveRole("tank", spec("melee"))).toBe("tank");
        expect(resolveRole("", spec("ranged"))).toBe("ranged");
        expect(resolveRole("dps", spec("melee"))).toBe("melee");
        expect(resolveRole("", null)).toBe("dps");
        expect(resolveRole(undefined, spec("weird"))).toBe("dps");
    });

    it("classifies every TBC spec of the rule set as tank, healer, melee or ranged", () => {
        const { rulesFor } = require("../../../src/config/gameVersions");
        const roles = {};
        for (const c of rulesFor("tbc").classes) for (const sp of c.specs) roles[sp.key] = resolveRole("", sp);
        for (const key of ["Rogue-Combat", "Warrior-Arms", "Warrior-Fury", "Paladin-Retribution", "Shaman-Enhancement", "Druid-Feral"]) expect(roles[key]).toBe("melee");
        for (const key of ["Mage-Fire", "Warlock-Destruction", "Hunter-BeastMastery", "Priest-Shadow", "Shaman-Elemental", "Druid-Balance"]) expect(roles[key]).toBe("ranged");
        for (const key of ["Warrior-Protection", "Paladin-Protection", "Druid-Guardian"]) expect(roles[key]).toBe("tank");
        for (const key of ["Priest-Holy", "Priest-Discipline", "Paladin-Holy", "Shaman-Restoration", "Druid-Restoration"]) expect(roles[key]).toBe("healer");
        expect(Object.values(roles).filter((r) => r === "dps")).toEqual([]);
    });
});
