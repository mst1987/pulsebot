// "Gruppen im Plan" (#529) through the real routes: a 25er with 25 raiders in five groups, 3 on the bench and 2 only signed up (the pool).
// The plan picks from the 25 (the bench only when switched on, the pool never): the editor's payload, the read view's class priority and
// named rows, the suggestions, applying a template, and POST /api/raidplan/groups (stored at once, cleaned, no version step).
let mockUser = null;
let mockViewer = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/auth", () => ({ getUser: jest.fn(() => mockViewer) }));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh-")),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");
const store = require("../../../src/stores/raidplanStore");
const profiles = require("../../../src/stores/raidplanProfileStore");
const templates = require("../../../src/stores/raidplanTemplateStore");
const route = require("../../../src/web/apiRoutes/raidplan");
const { checkAccess, areasFor } = require("../../../src/web/http/apiAccess");
const { mockRes, status, json } = require("../../helpers/http");

const ORGA = { id: "orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const EV = "eh-1";
const BOSS = "bt/supremus";
const body = (r) => { const p = json(r); return p.data || p.error; };
const person = (userId, spec, role) => ({ userId, character: userId, spec, role });

/** Group g: a tank (groups 1-3) or a rogue, a priest / shaman healer, a mage, a hunter, a warlock. */
function setup() {
    const groups = [];
    for (let g = 1; g <= 5; g += 1) {
        groups.push({
            index: g,
            slots: [
                g <= 3 ? person(`t${g}`, "Warrior-Protection", "tank") : person(`r${g}`, "Rogue-Combat", "melee"),
                person(`h${g}`, g % 2 ? "Priest-Holy" : "Shaman-Restoration", "healer"),
                person(`m${g}`, "Mage-Fire", "ranged"),
                person(`hu${g}`, "Hunter-BeastMastery", "ranged"),
                person(`w${g}`, "Warlock-Destruction", "ranged"),
            ],
        });
    }
    const bench = [person("bPal", "Paladin-Holy", "healer"), person("bRog", "Rogue-Combat", "melee"), person("bHu", "Hunter-BeastMastery", "ranged")];
    const pool = [person("pDru", "Druid-Restoration", "healer"), person("pMag", "Mage-Fire", "ranged")];
    return { groups, bench, pool, approved: { version: 1, approvedAt: 1, approvedBy: "orga", groups, bench } };
}

async function call(handler, user, payload, query = "") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raidplan${query ? `?${query}` : ""}`));
    return r;
}
async function publicGet(token) {
    const r = mockRes();
    await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${token}`));
    return body(r);
}
/** Saves one boss board, publishes and answers the read view. */
async function readView(board) {
    const plan = store.getPlan(EV);
    expect(status(await call(route.putPlan, ORGA, { event: EV, version: plan ? plan.version : 0, bosses: { [BOSS]: board } }))).toBe(200);
    const on = body(await call(route.postPublish, ORGA, { event: EV, published: true }));
    return publicGet(on.plan.publicPath.replace("/p/", ""));
}
const row = (id, type, extra = {}) => ({ id, type, assignees: [], targets: [], ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("raidplans.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    templates.useFile(tempStoreFile("templates.json"));
    mockViewer = null;
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents[EV] = ownEvent({ id: EV, guildId: "500000", title: "BT", startTime: 1800000000, instanceIds: ["bt"], size: 25, setup: setup() });
});
afterAll(() => {
    store.useFile();
    profiles.useFile();
    templates.useFile();
});

describe("the editor's payload", () => {
    it("sends the 25 and the bench (marked), never the pool; the plan's selection is the default", async () => {
        const d = body(await call(route.getPlan, ORGA, null, `event=${EV}`));
        expect(d.roster).toHaveLength(28);
        expect(d.roster.filter((p) => p.bench).map((p) => p.userId)).toEqual(["bPal", "bRog", "bHu"]);
        expect(d.roster.some((p) => p.userId.startsWith("p"))).toBe(false);
        expect(d.plan.includedGroups).toBeNull();
        expect(d.besetzung.groups).toBe(5);
    });
});

describe("the read view", () => {
    it("a class priority never takes the bench paladin; a bench raider named in a row stays, marked and in no group", async () => {
        const d = await readView({ assignments: [
            row("prio", "heal", { count: 1, classPriority: ["Paladin", "Priest"], targets: [{ kind: "group", ref: "1" }] }),
            row("named", "other", { assignees: ["user:bRog"] }),
            row("cls", "kick", { assignees: ["class:Rogue:1", "class:Rogue:2", "class:Rogue:3"] }),
        ] });
        const rows = d.bosses[0].assignments;
        expect(rows.find((a) => a.id === "prio").assignees).toEqual(["user:h1"]);
        expect(rows.find((a) => a.id === "named").assignees).toEqual(["user:bRog"]);
        // three rogue places, two rogues in the raid (groups 4 and 5): the third stays open, the bench rogue does not fill it
        expect(rows.find((a) => a.id === "cls").assignees).toEqual(["user:r4", "user:r5", "class:Rogue:3"]);
        const benchRog = d.roster.find((p) => p.userId === "bRog");
        expect(benchRog).toMatchObject({ outOfPlan: true, group: 0 });
        expect(d.roster.some((p) => p.userId === "bPal")).toBe(false);
    });

    it("a bench raider in a role slot leaves it: the place goes to the next raider of that role in the plan", async () => {
        const d = await readView({ slots: [{ kind: "healer", n: 1, userId: "bPal", x: 0.5, y: 0.5 }], tokens: [{ userId: "bHu", x: 0.2, y: 0.2 }] });
        expect(d.bosses[0].slots.find((s) => s.kind === "healer").userId).toBe("h1");
        expect(d.bosses[0].tokens).toEqual([]);
    });

    it("with the bench switched on the paladin is first again; group 5 switched off drops its raiders from the resolution", async () => {
        expect(status(await call(route.postGroups, ORGA, { event: EV, includedGroups: [1, 2, 3, 4, 5, "bench"] }))).toBe(200);
        const prio = row("prio", "heal", { count: 1, classPriority: ["Paladin", "Priest"] });
        let d = await readView({ assignments: [prio] });
        expect(d.bosses[0].assignments[0].assignees).toEqual(["user:bPal"]);
        expect(status(await call(route.postGroups, ORGA, { event: EV, includedGroups: [1, 2, 3, 4] }))).toBe(200);
        d = await readView({ assignments: [row("cls", "kick", { assignees: ["class:Rogue:1", "class:Rogue:2"] })] });
        expect(d.bosses[0].assignments[0].assignees).toEqual(["user:r4", "class:Rogue:2"]);
    });
});

describe("POST /api/raidplan/groups", () => {
    it("is under raids write", () => {
        expect(areasFor("/api/raidplan/groups")).toEqual(["raids"]);
        expect(checkAccess("/api/raidplan/groups", "POST", READER)).toMatchObject({ status: 403 });
    });

    it("stores a cleaned selection at once without a version step, null goes back to the default", async () => {
        body(await call(route.putPlan, ORGA, { event: EV, version: 0, bosses: { [BOSS]: { notes: "x" } } }));
        const before = store.getPlan(EV).version;
        const r = body(await call(route.postGroups, ORGA, { event: EV, includedGroups: [3, "1", 9, "bench", "x", 1] }));
        expect(r).toEqual({ includedGroups: [1, 3, "bench"], included: [1, 3, "bench"] });
        expect(store.getPlan(EV)).toMatchObject({ version: before, includedGroups: [1, 3, "bench"] });
        expect(body(await call(route.getPlan, ORGA, null, `event=${EV}`)).plan.includedGroups).toEqual([1, 3, "bench"]);
        // a save of the boards keeps it
        body(await call(route.putPlan, ORGA, { event: EV, version: before, bosses: { [BOSS]: { notes: "y" } } }));
        expect(store.getPlan(EV).includedGroups).toEqual([1, 3, "bench"]);
        const back = body(await call(route.postGroups, ORGA, { event: EV, includedGroups: null }));
        expect(back).toEqual({ includedGroups: null, included: [1, 2, 3, 4, 5] });
        expect(store.getPlan(EV).includedGroups).toBeUndefined();
    });

    it("refuses a body that is no list, a reader and an unknown event", async () => {
        expect(status(await call(route.postGroups, ORGA, { event: EV, includedGroups: "1,2" }))).toBe(400);
        expect(status(await call(route.postGroups, ORGA, { event: EV }))).toBe(400);
        expect(status(await call(route.postGroups, READER, { event: EV, includedGroups: [1] }))).toBe(403);
        expect(status(await call(route.postGroups, ORGA, { event: "eh-nope", includedGroups: [1] }))).toBe(404);
        expect(store.getPlan(EV)).toBeNull();
    });
});

describe("suggestions and templates take nobody from the bench", () => {
    it("the heal suggestion spreads over the groups in the plan and never names a bench healer", async () => {
        const slots = [{ kind: "tank", n: 1, userId: "t1" }];
        const all = body(await call(route.postSuggest, ORGA, { event: EV, type: "heal", slots }));
        const named = JSON.stringify(all.assignments);
        expect(named).not.toContain("bPal");
        expect(all.assignments.flatMap((a) => a.targets).filter((t) => t.kind === "group").map((t) => t.ref).sort()).toEqual(["1", "2", "3", "4", "5"]);
        body(await call(route.postGroups, ORGA, { event: EV, includedGroups: [1, 2, 3, 4] }));
        const four = body(await call(route.postSuggest, ORGA, { event: EV, type: "heal", slots }));
        expect(JSON.stringify(four.assignments)).not.toContain("h5");
        expect(four.assignments.flatMap((a) => a.targets).some((t) => t.kind === "group" && t.ref === "5")).toBe(false);
    });

    it("applying a template fills its open slots only from the groups in the plan", async () => {
        const created = body(await call(route.postTemplate, ORGA, { name: "BT", instanceIds: ["bt"] })).template;
        const layout = { slots: Array.from({ length: 6 }, (_, i) => ({ kind: "healer", n: i + 1, x: 0.1 * (i + 1), y: 0.5 })) };
        const t = body(await call(route.patchTemplate, ORGA, { id: created.id, version: created.version, bosses: { [BOSS]: layout } })).template;
        const d = body(await call(route.postApply, ORGA, { event: EV, templateId: t.id, version: 0 }));
        const healers = d.plan.bosses[BOSS].slots.filter((s) => s.kind === "healer").map((s) => s.userId);
        expect(healers).toEqual(["h1", "h2", "h3", "h4", "h5", ""]);
    });
});
