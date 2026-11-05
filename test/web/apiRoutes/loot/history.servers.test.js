// Loot of the active Discord server only (#919), through the real router and
// on the real loot/event stores: server A never sees, imports into or changes
// the loot of server B's raids - not even when the two servers are linked
// (user decision: only the active server counts).
// #1073: roles count for data of every server on a server with the mark only
let mockTrusted = true;
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ ...jest.requireActual("../../../../src/services/discord/roles/guildRoles"), serverIsTrusted: jest.fn(() => mockTrusted) }));
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    getRealUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => mockGuild),
    getUserWithoutRank: jest.fn(),
}));
jest.mock("../../../../src/services/characters/characterInfo", () => ({
    ...jest.requireActual("../../../../src/services/characters/characterInfo"),
    rememberFromLoot: jest.fn(),
    resolveMissing: jest.fn(async () => ({ fromExport: 0, fromReports: 0, fromWcl: 0, checkedReports: 0, pendingReports: 0, missing: [], unlinked: [], error: "" })),
}));
jest.mock("../../../../src/web/characters/charGearIssues", () => ({
    ...jest.requireActual("../../../../src/web/characters/charGearIssues"),
    issuesForCharacter: jest.fn(() => null),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../../src/stores/settings/settingsStore"),
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn(),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../../src/services/discord/discord"),
    listGuilds: jest.fn(() => [{ id: "gA", name: "A" }, { id: "gB", name: "B" }]),
    listCategories: jest.fn(() => []),
}));
jest.mock("../../../../src/services/discord/servers/serverOf", () => ({
    ...jest.requireActual("../../../../src/services/discord/servers/serverOf"),
    // The category-name snapshot: cat-b is a category of server B.
    storedCategoryGuilds: () => new Map([["cat-a", "gA"], ["cat-b", "gB"]]),
}));
jest.mock("../../../../src/stores/loot/lootStore", () => ({
    ...jest.requireActual("../../../../src/stores/loot/lootStore"),
    repairItemNames: jest.fn(async () => 0),
}));
jest.mock("../../../../src/utils/loot/lootImport", () => ({
    ...jest.requireActual("../../../../src/utils/loot/lootImport"),
    // No Wowhead lookup: the names come with the rows.
    enrichItemNames: jest.fn((items) => Promise.resolve(items)),
    // The export format is tested elsewhere; here one parsed row is enough.
    parseLoot: jest.fn(() => [{ source: "manual", rawId: "imp1", character: "Fritz", characterKey: "fritz", itemId: 7, itemName: "Ring", itemIconUrl: "x.jpg", itemQuality: 4, awardedAt: 1790000000000 }]),
}));
jest.mock("../../../../src/services/events/raidEventGroups", () => ({
    ...jest.requireActual("../../../../src/services/events/raidEventGroups"),
    // The raid list of the active server: none listed, so the server rule decides.
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
}));

let mockGuild = "gA";
// Two linked servers: B is linked to A, still none of B's loot shows on A.
const mockConfig = {
    mainVersion: "tbc",
    discordServers: {
        servers: [{ guildId: "gA" }, { guildId: "gB" }],
        links: [{ from: "gA", to: "gB" }],
    },
};

const { json, status, routerClient } = require("../../../helpers/http");
const { getUser, getUserWithoutRank } = require("../../../../src/web/http/auth");
const { rememberFromLoot, resolveMissing } = require("../../../../src/services/characters/characterInfo");
const { issuesForCharacter } = require("../../../../src/web/characters/charGearIssues");
const characterStore = require("../../../../src/stores/roster/characterStore");
const inbox = require("../../../../src/stores/loot/lootInboxStore");
const lootStore = require("../../../../src/stores/loot/lootStore");
const eventStore = require("../../../../src/stores/events/eventStore");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { get, post } = routerClient(require("../../../../src/web/apiRoutes/loot/history"));

const ADMIN = { id: "1", name: "Admin", isAdmin: true };

const row = (rawId, character, itemId) => ({
    source: "manual", rawId, character, characterKey: character.toLowerCase(), itemId,
    itemName: `Item ${rawId}`, itemIconUrl: "x.jpg", itemQuality: 4, awardedAt: 1790000000000,
});

let eventA;
let eventB;
beforeEach(() => {
    mockGuild = "gA";
    getUser.mockReturnValue(ADMIN);
    lootStore.useFile(tempStoreFile("srv-loot.json"));
    eventStore.useFile(tempStoreFile("srv-events.json"));
    const base = { channelId: "ch1", startTime: 1790000000, title: "Kara" };
    eventA = eventStore.createEvent({ ...base, guildId: "gA", categoryId: "cat-a" }).event;
    eventB = eventStore.createEvent({ ...base, guildId: "gB", categoryId: "cat-b" }).event;
    // Rule 1: over the raid. Rule 2: the server a raidless bucket was imported on.
    // Rule 3: the bucket's category. Rule 4: nothing known -> the first server (A).
    lootStore.addImport(eventA.id, [row("a1", "Anna", 1)], { eventLabel: "Kara A" });
    lootStore.addImport(eventB.id, [row("b1", "Bert", 2), row("b2", "Anna", 3)], { eventLabel: "Kara B" });
    lootStore.addImport("manual-raid-sgB", [row("b3", "Bert", 4)], { eventLabel: "Raid B", guildId: "gB" });
    lootStore.addImport("manual-cat-b", [row("b4", "Cleo", 5)], { eventLabel: "Kat B", categoryId: "cat-b" });
    lootStore.addImport("manual-old", [row("a2", "Dora", 6)], { eventLabel: "Alt" });
});
afterAll(() => {
    lootStore.useFile(null);
    eventStore.useFile(null);
});

const idsOf = (items) => items.map((it) => it.rawId).sort();

describe("reading", () => {
    it("shows a raid of server B as empty on server A, and in full on B", async () => {
        expect(json(await get("/api/history/event", { event: eventB.id })).data.items).toEqual([]);
        mockGuild = "gB";
        expect(idsOf(json(await get("/api/history/event", { event: eventB.id })).data.items)).toEqual(["b1", "b2"]);
    });

    it("lists only the character's loot of the active server", async () => {
        expect(idsOf(json(await get("/api/history/char", { name: "Anna" })).data.items)).toEqual(["a1"]);
        mockGuild = "gB";
        expect(idsOf(json(await get("/api/history/char", { name: "Anna" })).data.items)).toEqual(["b2"]);
    });

    it("places raidless buckets by import server, category, else the first server", async () => {
        const char = async (name) => idsOf(json(await get("/api/history/char", { name })).data.items);
        expect(await char("Bert")).toEqual([]);
        expect(await char("Cleo")).toEqual([]);
        expect(await char("Dora")).toEqual(["a2"]);
        mockGuild = "gB";
        expect(await char("Bert")).toEqual(["b1", "b3"]);
        expect(await char("Cleo")).toEqual(["b4"]);
        expect(await char("Dora")).toEqual([]);
    });
});

describe("writing", () => {
    it("refuses an import into server B's raid on server A", async () => {
        const res = await post("/api/history/import", { data: "x", event: eventB.id });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(lootStore.listByEvent(eventB.id)).toHaveLength(2);
        expect(status(await post("/api/history/import", { data: "x", event: eventA.id }))).toBe(201);
        expect(lootStore.listByEvent(eventA.id)).toHaveLength(2);
    });

    it("refuses clearing or re-categorising server B's bucket on server A", async () => {
        const cleared = await post("/api/history/clear", { event: "manual-raid-sgB" });
        expect(status(cleared)).toBe(403);
        const recat = await post("/api/history/loot-category", { event: eventB.id, categoryId: "cat-a" });
        expect(status(recat)).toBe(403);
        expect(lootStore.listByEvent("manual-raid-sgB")).toHaveLength(1);
    });

    it("treats a row of server B as not found when deleting on server A", async () => {
        const [rowB] = lootStore.listByEvent(eventB.id);
        const res = await post("/api/history/loot-delete", { id: rowB.id });
        expect(status(res)).toBe(404);
        expect(lootStore.listByEvent(eventB.id)).toHaveLength(2);
        mockGuild = "gB";
        expect(status(await post("/api/history/loot-delete", { id: rowB.id }))).toBe(200);
    });

    it("files a manual bucket of a second server under its own id", async () => {
        mockGuild = "gB";
        const res = await post("/api/history/loot-add", {
            event: "__manual__", manualLabel: "Pug", character: "Emil", itemId: 30095, awardedAt: 5000, response: "Mainspec",
        });
        expect(status(res)).toBe(201);
        expect(json(res).data.eventId).toBe("manual-pug-sgB");
        expect(lootStore.listByEvent("manual-pug-sgB")[0].guildId).toBe("gB");
    });
});

describe("the rank Server-Admin (#1072): the store decides, not the right", () => {
    const WRITE = { history: { read: true, write: true } };
    const RANK = { id: "9", name: "Rang", isAdmin: false, isServerAdmin: true, isOrga: true, access: WRITE };
    const ORGA = { id: "8", name: "Orga", isAdmin: false, isOrga: true, access: WRITE };
    const HISTORY_ROLE = { id: "9", isAdmin: false, access: { history: { read: true, write: true } } };
    const NO_ROLE = { id: "9", isAdmin: false, access: {} };

    const upload = (sessionId, extra) => inbox.upsertPending({
        sessionId, startedAt: 1790000000000,
        items: [{ source: "gargul", rawId: sessionId, itemId: 30095, itemName: "Ring", character: "Arthas", characterKey: "arthas", awardedAt: 1790000000000 }],
    }, { realm: "Thunderstrike", gameVersion: "tbc", ...extra }).entry;
    const waitingIds = async () => json(await get("/api/history/inbox")).data.waiting.map((s) => s.id);
    const sessionIds = async () => json(await get("/api/history/inbox")).data.sessions.map((s) => s.id);

    beforeEach(() => {
        jest.clearAllMocks();
        inbox.useFile(tempStoreFile("srv-inbox.json"));
        characterStore.useFile(tempStoreFile("srv-chars.json"));
        getUser.mockReturnValue(RANK);
        getUserWithoutRank.mockReturnValue(NO_ROLE);
    });
    afterAll(() => {
        inbox.useFile(null);
        characterStore.useFile(null);
    });

    describe("inbox cards no server is tied to", () => {
        it("hides a waiting card without servers from the rank, regular orga keeps seeing it", async () => {
            const free = upload("free", { waiting: true, servers: [], match: { candidates: [], suggested: null } });
            const bound = upload("bound", { waiting: true, servers: ["gA"], match: { candidates: [], suggested: null } });
            expect(await waitingIds()).toEqual([bound.id]);
            getUser.mockReturnValue(ORGA);
            expect((await waitingIds()).sort()).toEqual([free.id, bound.id].sort());
        });

        it("hides it from an orga by role on a server without the mark too (#1073)", async () => {
            upload("free", { waiting: true, servers: [], match: { candidates: [], suggested: null } });
            const bound = upload("bound", { waiting: true, servers: ["gA"], match: { candidates: [], suggested: null } });
            getUser.mockReturnValue(ORGA);
            mockTrusted = false;
            try {
                expect(await waitingIds()).toEqual([bound.id]);
            } finally {
                mockTrusted = true;
            }
        });

        it("hides a card of an upload key without server, shows one with the own server", async () => {
            const free = upload("free", { match: null });
            const own = upload("own", { guildId: "gA", match: null });
            upload("foreign", { guildId: "gB", match: null });
            expect(await sessionIds()).toEqual([own.id]);
            getUser.mockReturnValue(ORGA);
            expect((await sessionIds()).sort()).toEqual([free.id, own.id].sort());
        });

        it.each(["/api/history/inbox-accept", "/api/history/inbox-dismiss"])("refuses %s on such a card", async (path) => {
            const free = upload("free", { match: null });
            const res = await post(path, { id: free.id, event: "__manual__", manualLabel: "Kara" });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("other_server");
            expect(inbox.getPending(free.id)).toBeTruthy();
        });

        it("refuses bringing such a card back from the dismissed ones", async () => {
            getUser.mockReturnValue(ORGA);
            const free = upload("free", { match: null });
            expect(status(await post("/api/history/inbox-dismiss", { id: free.id }))).toBe(200);
            getUser.mockReturnValue(RANK);
            const res = await post("/api/history/inbox-restore", { id: free.id });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("other_server");
        });

        it("still lets the rank dismiss a card of its own server", async () => {
            const own = upload("own", { guildId: "gA", match: null });
            expect(status(await post("/api/history/inbox-dismiss", { id: own.id }))).toBe(200);
        });

        describe("when a role gives the rank holder the area too: as on main", () => {
            beforeEach(() => getUserWithoutRank.mockReturnValue(HISTORY_ROLE));

            it("shows the cards without a server", async () => {
                const free = upload("free", { match: null });
                const waiting = upload("waiting", { waiting: true, servers: [], match: { candidates: [], suggested: null } });
                expect(await sessionIds()).toEqual([free.id]);
                expect(await waitingIds()).toEqual([waiting.id]);
            });

            it("files, dismisses and brings back a card without a server", async () => {
                const filed = upload("filed", { match: null });
                const res = await post("/api/history/inbox-accept", { id: filed.id, event: "__manual__", manualLabel: "Kara" });
                expect(status(res)).toBeLessThan(300);
                const free = upload("free", { match: null });
                expect(status(await post("/api/history/inbox-dismiss", { id: free.id }))).toBe(200);
                expect(status(await post("/api/history/inbox-restore", { id: free.id }))).toBe(200);
            });
        });

        it("keeps the card from the rank when its role only reads the area, while writing", async () => {
            getUserWithoutRank.mockReturnValue({ id: "9", isAdmin: false, access: { history: { read: true, write: false } } });
            const free = upload("free", { match: null });
            expect(await sessionIds()).toEqual([free.id]);
            const res = await post("/api/history/inbox-dismiss", { id: free.id });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("other_server");
        });
    });

    describe("classes learned from an import, a store of every server", () => {
        it("saves the loot but learns no class when only the rank gives the right", async () => {
            expect(status(await post("/api/history/import", { data: "x", event: eventA.id }))).toBe(201);
            expect(lootStore.listByEvent(eventA.id)).toHaveLength(2);
            expect(rememberFromLoot).not.toHaveBeenCalled();
        });

        it("learns it when a role of its own gives the right", async () => {
            getUserWithoutRank.mockReturnValue(HISTORY_ROLE);
            expect(status(await post("/api/history/import", { data: "x", event: eventA.id }))).toBe(201);
            expect(rememberFromLoot).toHaveBeenCalledTimes(1);
        });

        it("learns it for regular orga, without asking for the role view", async () => {
            getUser.mockReturnValue(ORGA);
            expect(status(await post("/api/history/import", { data: "x", event: eventA.id }))).toBe(201);
            expect(rememberFromLoot).toHaveBeenCalledTimes(1);
            expect(getUserWithoutRank).not.toHaveBeenCalled();
        });

        it("skips it when an inbox card is filed by the rank alone", async () => {
            const own = upload("own", { guildId: "gA", match: null });
            const res = await post("/api/history/inbox-accept", { id: own.id, event: "__manual__", manualLabel: "Kara" });
            expect(status(res)).toBeLessThan(300);
            expect(rememberFromLoot).not.toHaveBeenCalled();
        });

        describe("POST /api/history/characters-resolve", () => {
            it("refuses the rank alone before anything is written", async () => {
                const res = await post("/api/history/characters-resolve", {});
                expect(status(res)).toBe(403);
                expect(json(res).error.code).toBe("forbidden");
                expect(resolveMissing).not.toHaveBeenCalled();
            });

            it("runs for a role with the right and for regular orga, as on main", async () => {
                getUserWithoutRank.mockReturnValue(HISTORY_ROLE);
                expect(status(await post("/api/history/characters-resolve", {}))).toBe(200);
                expect(resolveMissing).toHaveBeenCalledTimes(1);
                getUser.mockReturnValue(ORGA);
                expect(status(await post("/api/history/characters-resolve", {}))).toBe(200);
                expect(resolveMissing).toHaveBeenCalledTimes(2);
            });
        });
    });

    describe("GET /api/history/char", () => {
        const charData = async (name) => json(await get("/api/history/char", { name })).data;

        it("gives the rank the store entry only for a name its server has loot for", async () => {
            characterStore.saveCharacter("Anna", { className: "Mage", source: "manual" });
            characterStore.saveCharacter("Bert", { className: "Rogue", source: "manual" });
            expect((await charData("Anna")).info).toEqual(expect.objectContaining({ className: "Mage" }));
            expect((await charData("Bert")).info).toBeNull();
            getUser.mockReturnValue(ORGA);
            expect((await charData("Bert")).info).toEqual(expect.objectContaining({ className: "Rogue" }));
        });

        it("gives an orga by role on a server without the mark no more than the rank (#1073)", async () => {
            characterStore.saveCharacter("Bert", { className: "Rogue", source: "manual" });
            getUser.mockReturnValue(ORGA);
            mockTrusted = false;
            try {
                expect((await charData("Bert")).info).toBeNull();
            } finally {
                mockTrusted = true;
            }
        });

        it("narrows the gear findings of the rank to evaluations of the active server", async () => {
            await charData("Anna");
            const { accept } = issuesForCharacter.mock.calls[0][1];
            expect(accept({ id: "r1", guildId: "gA" })).toBe(true);
            expect(accept({ id: "r2", guildId: "gB" })).toBe(false);
            expect(accept({ id: "r3" })).toBe(false);
        });

        it("leaves regular orga without a filter", async () => {
            getUser.mockReturnValue(ORGA);
            await charData("Anna");
            expect(issuesForCharacter).toHaveBeenCalledWith("Anna");
        });

        it("leaves the rank plus a role with the right as on main: the entry and every finding", async () => {
            getUserWithoutRank.mockReturnValue(HISTORY_ROLE);
            characterStore.saveCharacter("Bert", { className: "Rogue", source: "manual" });
            expect((await charData("Bert")).info).toEqual(expect.objectContaining({ className: "Rogue" }));
            await charData("Anna");
            expect(issuesForCharacter).toHaveBeenLastCalledWith("Anna");
        });
    });
});
