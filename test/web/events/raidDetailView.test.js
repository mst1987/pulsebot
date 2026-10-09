// The raid detail read (#424): raidDetailView.js builds the payload of
// GET /api/raids/detail from one builder per part; apiRoutes/raidDetail.js only
// sends it. The byte-for-byte comparison against the old handler was done on
// the dev data before the move (see the PR); these tests pin each part.
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
let mockUser = ADMIN;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 123) }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    listNotify: jest.fn(() => [{ id: "n1" }]),
    listRaidsheets: jest.fn(() => [{ id: "sheet-kara", name: "Karazhan", keywords: ["kara"] }]),
    resolveEventSheetLink: jest.fn(() => ({ url: "https://sheet" })),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => [{ id: "r1", name: "Raider" }]),
    resolveUserNames: jest.fn(async (g, ids) => Object.fromEntries(ids.map((id) => [id, `Name ${id}`]))),
    getGuild: jest.fn(() => null),
}));
jest.mock("../../../src/utils/raidhelper/client", () => ({ createRaidhelperClient: jest.fn(), raidhelperDisabled: jest.fn(() => false) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ getRaidEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: jest.fn(() => null), listRosters: jest.fn(() => []) }));
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: jest.fn(() => null) }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../../src/stores/raidplanStore", () => ({ getPlan: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventSheetStore", () => ({ getEventSheet: jest.fn(() => null) }));
jest.mock("../../../src/stores/raidplanPostStore", () => ({ getRaidplanPost: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../../src/stores/eventLootSystemStore", () => ({ lootSystemOf: jest.fn(() => "softres") }));
jest.mock("../../../src/stores/lootStore", () => ({ listByEvent: jest.fn(() => []), listAll: jest.fn(() => []) }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ resolveAssignmentProfiles: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/logStore", () => ({
    ...jest.requireActual("../../../src/stores/logStore"),
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
}));
jest.mock("../../../src/services/logcheck/logChannel", () => ({ backfillLogTitles: jest.fn(async () => {}) }));
jest.mock("../../../src/services/discord/pingDelivery", () => ({ ...jest.requireActual("../../../src/services/discord/pingDelivery"), pingTargetInfo: jest.fn(() => ({ talk: false })) }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { createRaidhelperClient, raidhelperDisabled } = require("../../../src/utils/raidhelper/client");
const { getRaidEvent } = require("../../../src/stores/raidEventStore");
const { getEvent } = require("../../../src/stores/eventStore");
const { listSignups } = require("../../../src/stores/signupStore");
const raidplanStore = require("../../../src/stores/raidplanStore");
const { getEventSoftres } = require("../../../src/stores/eventSoftresStore");
const logStore = require("../../../src/stores/logStore");
const { backfillLogTitles } = require("../../../src/services/logcheck/logChannel");
const { buildRaidDetail, _internal } = require("../../../src/web/events/raidDetailView");
const { getRaidDetail } = require("../../../src/web/apiRoutes/raidDetail");
const { mockRes, status, json } = require("../../helpers/http");
const { knownChannels } = require("../../helpers/linkCheck");

// The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
beforeEach(() => knownChannels("c1", "c2", "c"));

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;
const SLOTS = [
    { name: "Tanki", userId: "u1", className: "Warrior", specName: "Protection", groupNumber: 1, slotNumber: 1 },
    { name: "Heili", userId: "u2", className: "Paladin", specName: "Holy", groupNumber: 1, slotNumber: 2 },
];
const rhEvent = (over = {}) => ({
    id: "rh1", source: "raidhelper", title: "Kara Montag", startTime: FUTURE, channelId: "c1", channelName: "kara", channelState: "ok",
    signupCount: 2, signUps: [{ userId: "u1", specName: "Protection", status: "signed" }], ...over,
});
const ownEvent = (over = {}) => ({
    id: "eh-1", source: "eventhelper", title: "Tempest Keep", startTime: FUTURE, channelId: "c2", channelName: "tk",
    signupCount: 1, signUps: [{ userId: "u7", specName: "Arms", status: "signed" }], size: 25, signupDeadline: FUTURE - 3600,
    instanceIds: ["tempest-keep"], ...over,
});
const groupsWith = (event, extra = {}) => ({ groups: [{ categoryId: "cat1", categoryName: "TBC", events: [event] }], error: null, stale: false, ...extra });
const rhClient = (getSetup) => createRaidhelperClient.mockReturnValue({ getSetup });

const sent = (r) => ({ status: status(r), body: json(r) });

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    settingsStore.getConfig.mockReturnValue({});
    rhClient(async () => ({ setup: SLOTS }));
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "u1", name: "Tanki" }, { id: "u9", name: "Fehlt" }], error: null });
});
afterEach(() => console.error.mockRestore());

describe("web/events/raidDetailView buildRaidDetail", () => {
    it("fails with 404 for an unknown event and with 400 when the events could not be loaded", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        expect(await buildRaidDetail({ guildId: "g1", eventId: "weg" })).toEqual({ error: { status: 404, code: "not_found", message: "Event nicht gefunden." } });
        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper down", stale: true });
        expect(await buildRaidDetail({ guildId: "g1", eventId: "weg" })).toEqual({ error: { status: 400, code: "events_unavailable", message: "Raid-Helper down" } });
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 123 });
    });

    it("builds a Raid-Helper event: live setup, attendance, sheet match, steps null", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] }, categoryLootTool: { cat1: "gargul" } });
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: true } });
        raidhelperDisabled.mockReturnValue(true);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(Object.keys(body)).toEqual([
            "event", "planning", "setupFromSnapshot", "categoryName", "guildId", "eventsWarning", "notifyTemplates", "roles", "pingTargets",
            "raidsheets", "matchedSheetId", "setup", "setupError", "tankCandidates", "eventSheet", "sheetLink", "raidplanPost", "eventSoftres",
            "softresCatalogue", "softresEdition", "versionId", "wowheadPath", "archived", "softresSuggested", "attendance", "ownSignups", "ownSetup", "ownSetupPost",
            "ownSetupEditors", "attendanceRoleIds", "attendanceSource", "membersError", "signupTarget", "lootItems", "lootTool", "lootSystem", "eventLogs", "unlinkedLogs",
            "progress", "steps", "playerSummaries",
        ]);
        expect(body.event).toEqual({
            id: "rh1", source: "raidhelper", title: "Kara Montag", startTime: FUTURE, channelId: "c1", channelName: "kara", channelState: "ok",
            signupCount: 2, isPast: false, signupsKnown: true, signUpsFromSnapshot: false, raidplanEnabled: true, raidhelperDisabled: true,
        });
        expect(body.setup.groups).toHaveLength(1);
        expect(body.setupFromSnapshot).toBe(false);
        expect(body.tankCandidates.length).toBeGreaterThan(0);
        expect(body.attendance.responded.map((m) => m.id)).toEqual(["u1"]);
        expect(body.attendance.missing.map((m) => m.id)).toEqual(["u9"]);
        expect(body.attendanceRoleIds).toEqual(["r1"]);
        expect(body.signupTarget).toBe(2);
        expect(body.matchedSheetId).toBe("sheet-kara");
        expect(body.softresEdition).toBe("tbc");
        expect(body.softresCatalogue.every((g) => g.edition === "tbc")).toBe(true);
        expect(body.softresSuggested).toContain("kara");
        expect(body.lootTool).toBe("gargul");
        expect(body.ownSignups).toBeNull();
        expect(body.steps).toBeNull();
        expect(Array.isArray(body.progress.steps)).toBe(true);
        // the plan is switched on but empty (#502): nothing posted, nothing to post
        expect(body.raidplanPost).toEqual({ filled: false, published: false, publicPath: "", channelId: "", messageId: "", message: "", postedAt: 0 });
        expect(body.progress.steps.map((s) => s.key)).toContain("raidplan");
        // no fixed sheet and no pick: the category plans with the raid plan, so there is no sheet step
        expect(body.planning).toBe("raidplan");
        expect(body.progress.steps.map((s) => s.key)).not.toContain("sheet");
        expect(body.eventsWarning).toBeNull();
        expect(body.roles).toEqual([{ id: "r1", name: "Raider" }]);
    });

    it("leaves the raid plan out of a category that plans with a sheet", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({ categoryPlanning: { cat1: "sheet" } });
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: true } });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.planning).toBe("sheet");
        expect(body.event.raidplanEnabled).toBe(false);
        expect(body.raidplanPost).toBeNull();
        expect(body.progress.steps.map((s) => s.key)).toEqual(expect.arrayContaining(["sheet"]));
        expect(body.progress.steps.map((s) => s.key)).not.toContain("raidplan");
    });

    it("follows the version of the event's category (#542): no softres edition, no TBC list, the version's own sheet", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        settingsStore.getConfig.mockReturnValue({
            categoryVersion: { cat1: "forever" },
            versionSettings: { tbc: { softresEdition: "tbc", wowheadPath: "tbc", raidsheetId: "sheet-kara" }, forever: { raidsheetId: "sheet-fv" } },
        });
        settingsStore.listRaidsheets.mockReturnValueOnce([
            { id: "sheet-kara", name: "Karazhan", keywords: ["kara"] },
            { id: "sheet-fv", name: "Forever", keywords: [] },
        ]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.versionId).toBe("forever");
        expect(body.softresEdition).toBe("");
        expect(body.softresCatalogue).toEqual([]);
        expect(body.softresSuggested).toEqual([]);
        expect(body.wowheadPath).toBe("");
        // "Kara Montag" names the TBC sheet's keyword, but that sheet is TBC's own
        expect(body.matchedSheetId).toBe("sheet-fv");
    });

    it("falls back to the frozen snapshot when Raid-Helper returns an empty raidplan or fails", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getRaidEvent.mockReturnValue({ setup: SLOTS });
        rhClient(async () => ({ setup: [] }));
        let { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.setupFromSnapshot).toBe(true);
        expect(body.setup.groups).toHaveLength(1);
        rhClient(async () => { throw new Error("rh down"); });
        ({ body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" }));
        expect(body.setupFromSnapshot).toBe(true);
        expect(body.setupError).toBeNull();
        expect(body.tankCandidates.length).toBeGreaterThan(0);
    });

    it("reports a setup that could not be loaded when there is no snapshot", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getRaidEvent.mockReturnValue(null);
        rhClient(async () => { throw new Error("rh down"); });
        let { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.setup).toBeNull();
        expect(body.setupError).toBe("rh down");
        expect(body.tankCandidates).toEqual([]);
        rhClient(async () => { throw new Error(""); });
        ({ body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" }));
        expect(body.setupError).toBe("Setup konnte nicht geladen werden.");
    });

    it("builds an own event: manage state, own signups with names, size as target, five steps", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent(), { stale: true }));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        getEvent.mockReturnValue({
            status: "cancelled", signupsClosed: true, cancel: { reason: "Urlaub", archived: true }, log: [{}, {}], autoSuggest: true,
            setupPost: { channelId: "c2", messageId: "m1", version: 3, dms: { total: 5, sent: 4, failed: ["x"] } },
            setup: { status: "approved", version: 3, groups: [{ slots: [{}, {}] }], bench: [{}], pool: [], checks: { ok: true } }, size: 25,
        });
        listSignups.mockReturnValue([{ userId: "u7", character: "Devihra", spec: "Warrior-Arms", role: "melee", status: "signed" }]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "eh-1" });
        expect(createRaidhelperClient).not.toHaveBeenCalled();
        expect(body.event).toMatchObject({
            source: "eventhelper", status: "cancelled", signupsClosed: true, cancelReason: "Urlaub", cancelArchived: true,
            logCount: 2, autoSuggest: true, size: 25, signupDeadline: FUTURE - 3600, raidplanEnabled: true,
        });
        expect(body.event).not.toHaveProperty("raidhelperDisabled");
        expect(body.setup).toEqual(expect.objectContaining({ groups: [] }));
        expect(body.ownSetupPost).toEqual({ channelId: "c2", messageId: "m1", version: 3, dms: { total: 5, sent: 4, failed: 1 } });
        expect(body.ownSetup).toMatchObject({ status: "approved", placed: 2, bench: 1, ok: true });
        expect(body.ownSignups).toEqual([expect.objectContaining({ userId: "u7", name: "Name u7" })]);
        expect(body.signupTarget).toBe(25);
        expect(body.softresSuggested).toEqual(expect.any(Array));
        expect(Array.isArray(body.steps.steps || body.steps)).toBe(true);
        expect(body.eventsWarning).toBe("Raid-Helper aktuell nicht erreichbar — zeige zwischengespeicherte Event-Daten.");
    });

    // Posting the plan's link is a raid plan write (docs/permissions.md): without it there is no step to nudge.
    it("leaves out the plan's link state and the \"Einteilungen\" step for a reader who may not post it", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        getEvent.mockReturnValue({ status: "active", setup: null });
        const ids = (body) => body.steps.steps.map((s) => s.id);
        const all = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1" })).body;
        expect(ids(all)).toContain("plan");
        const without = (await buildRaidDetail({ guildId: "g1", eventId: "eh-1", planPost: false })).body;
        expect(ids(without)).toEqual(ids(all).filter((id) => id !== "plan"));
        expect(without.raidplanPost).toBeNull();
    });

    it("measures the missing list against the roster's core and trial members where the category has a roster (#658)", async () => {
        const rosterStore = require("../../../src/stores/rosterStore");
        rosterStore.rosterForCategory.mockReturnValue({ roleIds: [], members: { u1: { status: "core" }, u5: { status: "trial" }, u6: { status: "bench" } } });
        discord.listHumanMembers.mockResolvedValueOnce({ members: [{ id: "u1", displayName: "Tanki" }, { id: "u5", displayName: "Neu" }, { id: "u6", displayName: "Bank" }], error: null });
        try {
            loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
            const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
            expect(body.attendanceSource).toBe("roster");
            expect(body.attendanceRoleIds).toEqual([]);
            expect(body.attendance.missing.map((m) => m.id)).toEqual(["u5"]);
            expect(body.attendance.responded.map((m) => m.id)).toEqual(["u1"]);
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(body.signupTarget).toBe(2);
        } finally {
            rosterStore.rosterForCategory.mockReturnValue(null);
        }
    });

    it("leaves the member list alone when the roster of a past raid is unknown", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent({ startTime: PAST, signUps: [] })));
        settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["r1"] } });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(body.event).toMatchObject({ isPast: true, signupsKnown: false });
        expect(body.attendance).toEqual({ responded: [], missing: [] });
        expect(body.signupTarget).toBe(0);
    });

    it("takes the signup target from a created softres list", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        getEventSoftres.mockReturnValue({ instances: ["kara"] });
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.signupTarget).toBe(10);
    });

    it("lists this event's logs and the unassigned ones of this guild, with their evaluated sections", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const own = { id: "l1", eventId: "rh1", status: "done" };
        logStore.listLogsForEvent.mockReturnValue([own]);
        logStore.listLogs.mockReturnValue([own, { id: "l2", guildId: "g1" }, { id: "l3", guildId: "g2" }, { id: "l4", sections: ["rpb"] }]);
        const { body } = await buildRaidDetail({ guildId: "g1", eventId: "rh1" });
        expect(body.eventLogs).toEqual([{ id: "l1", eventId: "rh1", status: "done", sections: ["cla"] }]);
        expect(body.unlinkedLogs.map((l) => [l.id, l.sections])).toEqual([["l2", []], ["l4", ["rpb"]]]);
        expect(backfillLogTitles).toHaveBeenCalledTimes(1);
    });
});

describe("web/events/raidDetailView parts", () => {
    it("setupPostState is null until the setup was posted", () => {
        getEvent.mockReturnValue({ setupPost: { channelId: "c" } });
        expect(_internal.setupPostState("e")).toBeNull();
        getEvent.mockReturnValue(null);
        expect(_internal.setupPostState("e")).toBeNull();
        getEvent.mockReturnValue({ setupPost: { messageId: "m" } });
        expect(_internal.setupPostState("e")).toEqual({ channelId: "", messageId: "m", version: 0, dms: null });
    });

    it("manageState has defaults for an event it does not know", () => {
        getEvent.mockReturnValue(null);
        expect(_internal.manageState("e")).toEqual({
            status: "active", signupsClosed: false, cancelReason: "", cancelArchived: false, logCount: 0, autoSuggest: false,
        });
    });

    it("raidplanSwitchedOn reads the plan's link", () => {
        raidplanStore.getPlan.mockReturnValue({ link: { enabled: false } });
        expect(_internal.raidplanSwitchedOn("e")).toBe(false);
        raidplanStore.getPlan.mockReturnValue(null);
        expect(_internal.raidplanSwitchedOn("e")).toBe(false);
    });
});

describe("GET /api/raids/detail (the route only speaks HTTP)", () => {
    it("sends the payload as data", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail?event=%20rh1%20"));
        const { status, body } = sent(r);
        expect(status).toBe(200);
        expect(body.data.event.id).toBe("rh1");
        expect(body.data.guildId).toBe("g1");
    });

    it("sends the failure with its status", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(rhEvent()));
        const r = mockRes();
        await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail"));
        expect(sent(r)).toEqual({ status: 404, body: { error: { code: "not_found", message: "Event nicht gefunden." } } });
    });

    it("hands the \"Einteilungen\" step only to a caller with raidplan write", async () => {
        loadEventGroups.mockResolvedValue(groupsWith(ownEvent()));
        getEvent.mockReturnValue({ status: "active", setup: null });
        const stepIds = async (user) => {
            mockUser = user;
            const r = mockRes();
            await getRaidDetail({ headers: {} }, r, new URL("http://x/api/raids/detail?event=eh-1"));
            return json(r).data.steps.steps.map((s) => s.id);
        };
        try {
            expect(await stepIds(ADMIN)).toContain("plan");
            expect(await stepIds({ id: "o", isAdmin: false, access: { raids: { read: true, write: true } } })).not.toContain("plan");
            expect(await stepIds({ id: "p", isAdmin: false, access: { raids: { read: true, write: false }, raidplan: { read: true, write: false } } })).not.toContain("plan");
            expect(await stepIds({ id: "w", isAdmin: false, access: { raids: { read: true, write: false }, raidplan: { read: true, write: true } } })).toContain("plan");
        } finally {
            mockUser = ADMIN;
        }
    });
});
