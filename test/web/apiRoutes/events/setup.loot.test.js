// "Loot verteilen" in the setup editor (#1037), through the real router: no route of
// its own - `loadLoot: true` on POST /api/raids/setup/propose starts the background
// job, the GET of the editor shows its state. The job itself (setupLoot.loadLootData)
// is mocked: it is the only place that asks softres.it and the armory.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../../src/stores/roster/raiderProfileStore", () => ({ listProfiles: () => [], firstCharacter: () => null, getProfile: () => null }));
jest.mock("../../../../src/stores/roster/rosterStore", () => ({ rosterForCategory: () => null, listRosters: () => [], isClosed: () => false }));
jest.mock("../../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }), attendanceForAccounts: () => new Map() }));
jest.mock("../../../../src/services/discord/discord", () => ({ resolveUserNames: jest.fn(async () => ({})), listAllChannels: () => [], listGuilds: () => [] }));
jest.mock("../../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../../src/services/setup/setupMessage", () => ({
    publishSetup: jest.fn(async () => ({ post: { action: "posted" }, dms: null })),
    publishView: jest.fn(() => ({ dmsEnabled: false, recipients: 0 })),
    refreshLiveSetup: jest.fn(async () => ({})),
}));
jest.mock("../../../../src/services/setup/setupLoot", () => ({
    ...jest.requireActual("../../../../src/services/setup/setupLoot"),
    loadLootData: jest.fn(),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const eventStore = require("../../../../src/stores/events/eventStore");
const signupStore = require("../../../../src/stores/events/signupStore");
const setupLoot = require("../../../../src/services/setup/setupLoot");
const { saveSetupLoot } = require("../../../../src/stores/loot/setupLootStore");
const evalJobs = require("../../../../src/web/logcheck/evalJobs");
const route = require("../../../../src/web/apiRoutes/events/setup");
const { routerClient, status, body } = require("../../../helpers/http");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
const RAIDER = { id: "u1", name: "Raider", isAdmin: false, access: { raids: { read: true, write: false } } };
const START = Math.floor(Date.now() / 1000) + 7 * 86400;
const api = routerClient(route);
const flush = () => new Promise((r) => setImmediate(r));

let primary;

beforeEach(() => {
    jest.clearAllMocks();
    evalJobs.reset();
    mockUser = ORGA;
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    primary = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId: "cat", title: "Karazhan", startTime: START, versionId: "tbc",
        size: 10, instanceIds: ["kara"], composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    }).event;
    signupStore.saveSignup(primary.id, "u1", { character: "U1", spec: "Warrior-Fury", status: "signed" }, { versionId: "tbc" });
    setupLoot.loadLootData.mockResolvedValue({ ok: true, counts: { signups: 1 } });
});

const addRaid = async () => body(await api.post("/api/raids/setup/raid-add", { event: primary.id })).event;

describe("loadLoot on POST /api/raids/setup/propose (#1037)", () => {
    it("starts the job over every raid of the group and proposes nothing", async () => {
        const sibling = await addRaid();
        const before = eventStore.getEvent(primary.id).setup || null;
        const r = await api.post("/api/raids/setup/propose", { event: sibling, loadLoot: true });
        expect(status(r)).toBe(202);
        expect(body(r).message).toBe("Loot-Daten werden geladen.");
        await flush();
        expect(setupLoot.loadLootData).toHaveBeenCalledTimes(1);
        expect(setupLoot.loadLootData).toHaveBeenCalledWith([primary.id, sibling]);
        // no proposal ran: the setup is as it was
        expect(eventStore.getEvent(primary.id).setup || null).toEqual(before);
        // the job is keyed by the group's first raid: both editors show it
        expect(evalJobs.getJob(primary.id, route.LOOT_SECTION)).toMatchObject({ status: "done" });
    });

    it("a second click while it runs joins the running job", async () => {
        await addRaid();
        let release;
        setupLoot.loadLootData.mockImplementation(() => new Promise((r) => { release = r; }));
        expect(status(await api.post("/api/raids/setup/propose", { event: primary.id, loadLoot: true }))).toBe(202);
        await flush();
        const again = await api.post("/api/raids/setup/propose", { event: primary.id, loadLoot: true });
        expect(status(again)).toBe(200);
        expect(body(again).message).toBe("Loot-Daten werden schon geladen.");
        expect(body(again).loot.job).toMatchObject({ status: "running" });
        expect(setupLoot.loadLootData).toHaveBeenCalledTimes(1);
        release({ ok: true });
    });

    it("refuses a single raid (400 no_raid_group) without starting anything", async () => {
        const r = await api.post("/api/raids/setup/propose", { event: primary.id, loadLoot: true });
        expect(status(r)).toBe(400);
        expect(body(r).error.code).toBe("no_raid_group");
        await flush();
        expect(setupLoot.loadLootData).not.toHaveBeenCalled();
    });

    it("is the orga's: a raider without raids write gets 403 and nothing starts", async () => {
        await addRaid();
        mockUser = RAIDER;
        expect(status(await api.post("/api/raids/setup/propose", { event: primary.id, loadLoot: true }))).toBe(403);
        await flush();
        expect(setupLoot.loadLootData).not.toHaveBeenCalled();
    });

    it("a normal proposal never starts the job", async () => {
        await addRaid();
        expect(status(await api.post("/api/raids/setup/propose", { event: primary.id }))).toBe(200);
        await flush();
        expect(setupLoot.loadLootData).not.toHaveBeenCalled();
    });
});

describe("loot in GET /api/raids/setup (#1037)", () => {
    it("shows the stored counts and the job for the orga of a raid group", async () => {
        const sibling = await addRaid();
        saveSetupLoot(primary.id, { versionId: "tbc", instanceIds: ["kara"], wants: {}, items: {}, counts: { signups: 50, gear: 31 } });
        const view = body(await api.get("/api/raids/setup", { event: sibling }));
        expect(view.loot).toMatchObject({ job: null, progress: null, counts: { signups: 50, gear: 31 } });
        expect(view.loot.at).toBeGreaterThan(0);
        // the item links of the list follow the raid's own version, never a guessed one
        expect(view.loot.wowheadPath).toBe("tbc");
    });

    it("names the sources the last load could not reach and the time of the data that stayed", async () => {
        const sibling = await addRaid();
        // the kept data counts the 30 days, so it has to be recent to show at all
        const keptAt = Date.now() - 3600_000;
        saveSetupLoot(primary.id, { versionId: "tbc", instanceIds: ["kara"], counts: { signups: 5 }, failed: ["softres"], keptAt });
        const view = body(await api.get("/api/raids/setup", { event: sibling }));
        expect(view.loot).toMatchObject({ failed: ["softres"], keptAt });
        saveSetupLoot(primary.id, { versionId: "tbc", instanceIds: ["kara"] });
        expect(body(await api.get("/api/raids/setup", { event: sibling })).loot).toMatchObject({ failed: [], keptAt: 0 });
    });

    it("is null for a single raid and missing for a raider", async () => {
        expect(body(await api.get("/api/raids/setup", { event: primary.id })).loot).toBeNull();
        await addRaid();
        mockUser = RAIDER;
        expect(body(await api.get("/api/raids/setup", { event: primary.id })).loot).toBeUndefined();
    });
});

describe("a manual save of a raid group keeps the loot (#1037)", () => {
    // an invented item id: the test checks the bookkeeping, not the game data
    const ITEM = 900001;
    const want = { items: [{ itemId: ITEM, weight: 1 }], source: "softres" };

    beforeEach(() => {
        signupStore.saveSignup(primary.id, "h1", { character: "H1", spec: "Priest-Holy", status: "signed" }, { versionId: "tbc" });
        signupStore.saveSignup(primary.id, "h2", { character: "H2", spec: "Priest-Holy", status: "signed" }, { versionId: "tbc" });
    });

    const put = (event, version, slots) => api.request("PUT", "/api/raids/setup", { event, version, groups: [{ index: 1, slots }], bench: [] });

    it("PUT on one raid values the whole group: checks.loot here, and the other raid follows", async () => {
        const sibling = await addRaid();
        saveSetupLoot(primary.id, {
            versionId: "tbc", instanceIds: ["kara"],
            wants: { u1: { u1: want }, h1: { h1: want }, h2: { h2: want } },
            items: { [ITEM]: { name: "Testklinge", icon: "", quality: 4 } },
        });
        expect(status(await put(sibling, 0, [{ userId: "h2", spec: "Priest-Holy" }]))).toBe(200);
        const r = await put(primary.id, 0, [{ userId: "u1", spec: "Warrior-Fury" }, { userId: "h1", spec: "Priest-Holy" }]);
        expect(status(r)).toBe(200);

        const own = eventStore.getEvent(primary.id).setup;
        expect(own.checks.loot).toMatchObject({ on: true, conflicts: 1 });
        expect(own.checks.loot.items.map((i) => i.itemId)).toEqual([ITEM]);
        expect(own.checks.loot.items[0].conflictIn).toEqual([primary.id]);

        // the other raid: same loot check, its own placement and version untouched
        const other = eventStore.getEvent(sibling).setup;
        expect(other.checks.loot).toEqual(own.checks.loot);
        expect(other.groups[0].slots.map((s) => s.userId)).toEqual(["h2"]);
        expect(other.version).toBe(1);
    });

    it("loot data gone stale clears checks.loot and every loot reason in all raids of the group", async () => {
        const sibling = await addRaid();
        const fresh = {
            versionId: "tbc", instanceIds: ["kara"],
            wants: { u1: { u1: want }, h1: { h1: want }, h2: { h2: want } },
            items: { [ITEM]: { name: "Testklinge", icon: "", quality: 4 } },
        };
        saveSetupLoot(primary.id, fresh);
        expect(status(await put(sibling, 0, [{ userId: "h2", spec: "Priest-Holy" }]))).toBe(200);
        expect(status(await put(primary.id, 0, [{ userId: "u1", spec: "Warrior-Fury" }, { userId: "h1", spec: "Priest-Holy" }]))).toBe(200);
        const slotsOf = (id) => eventStore.getEvent(id).setup.groups.flatMap((g) => g.slots);
        expect(eventStore.getEvent(sibling).setup.checks.loot).toBeDefined();
        expect([...slotsOf(primary.id), ...slotsOf(sibling)].some((s) => s.lootReason)).toBe(true);
        const otherBefore = eventStore.getEvent(sibling).setup;

        // the data that stayed is older than 30 days: no group value any more
        saveSetupLoot(primary.id, { ...fresh, keptAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
        const own = eventStore.getEvent(primary.id).setup;
        expect(status(await put(primary.id, own.version, [{ userId: "u1", spec: "Warrior-Fury" }, { userId: "h1", spec: "Priest-Holy" }]))).toBe(200);

        for (const id of [primary.id, sibling]) {
            expect(eventStore.getEvent(id).setup.checks.loot).toBeUndefined();
            for (const s of slotsOf(id)) {
                expect(s.lootReason).toBeUndefined();
                expect((s.reasons || []).filter((r) => /Testklinge/.test(r))).toEqual([]);
            }
        }
        // the other raid only lost its loot: placement, version and status as they were
        const other = eventStore.getEvent(sibling).setup;
        expect(other.groups[0].slots.map((s) => s.userId)).toEqual(["h2"]);
        expect(other.version).toBe(otherBefore.version);
        expect(other.status).toBe(otherBefore.status);
    });

    it("without loot data the save stays a single raid's evaluation", async () => {
        await addRaid();
        expect(status(await put(primary.id, 0, [{ userId: "h1", spec: "Priest-Holy" }]))).toBe(200);
        expect(eventStore.getEvent(primary.id).setup.checks.loot).toBeUndefined();
    });
});
